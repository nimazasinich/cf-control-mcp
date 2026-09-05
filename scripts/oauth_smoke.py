#!/usr/bin/env python3
"""End-to-end OAuth/MCP smoke test for cf-control-mcp.

Requires MCP_AUTH_TOKEN in the environment. Never prints the secret or issued tokens.
Uses the runner's curl binary so Cloudflare sees the same normal HTTP/TLS client that
is used by the repository's other live endpoint checks.
"""
from __future__ import annotations

import base64
import hashlib
import html.parser
import json
import os
import secrets
import subprocess
import sys
import tempfile
import urllib.parse
from dataclasses import dataclass
from pathlib import Path

BASE_URL = os.environ.get("MCP_BASE_URL", "https://cf-control-mcp.amin-chinisaz-edu.workers.dev").rstrip("/")
OWNER_TOKEN = os.environ.get("MCP_AUTH_TOKEN", "")
READ_ONLY_TOOLS = {
    "cf_list_zones",
    "cf_list_dns_records",
    "cf_list_workers",
    "cf_get_worker_metadata",
    "cf_kv_list_namespaces",
    "cf_kv_get_value",
    "cf_verify_api_token",
    "cf_get_workers_subdomain",
    "cf_list_worker_routes",
}
WRITE_TOOLS = {
    "cf_create_dns_record",
    "cf_delete_dns_record",
    "cf_purge_cache",
    "cf_kv_put_value",
    "cf_deploy_worker_module",
    "cf_delete_worker",
}


@dataclass
class HttpResponse:
    status: int
    headers: dict[str, str]
    body: bytes


class HiddenInputParser(html.parser.HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.form_token: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "input":
            return
        values = dict(attrs)
        if values.get("name") == "form_token":
            self.form_token = values.get("value")


def fail(message: str) -> None:
    raise AssertionError(message)


def parse_last_header_block(raw: bytes) -> dict[str, str]:
    text = raw.decode("iso-8859-1", errors="replace").replace("\r\n", "\n")
    blocks = [block for block in text.split("\n\n") if block.lstrip().startswith("HTTP/")]
    if not blocks:
        return {}
    headers: dict[str, str] = {}
    for line in blocks[-1].splitlines()[1:]:
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        headers[key.strip().lower()] = value.strip()
    return headers


def request(
    path: str,
    *,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    data: bytes | None = None,
) -> HttpResponse:
    with tempfile.TemporaryDirectory(prefix="cf-control-oauth-smoke-") as tmp:
        header_path = Path(tmp) / "headers.txt"
        body_path = Path(tmp) / "body.bin"
        command = [
            "curl",
            "--silent",
            "--show-error",
            "--max-time",
            "30",
            "--request",
            method,
            "--dump-header",
            str(header_path),
            "--output",
            str(body_path),
            "--write-out",
            "%{http_code}",
        ]
        for key, value in (headers or {}).items():
            command.extend(["--header", f"{key}: {value}"])
        if data is not None:
            command.extend(["--data-binary", "@-"])
        command.append(BASE_URL + path)

        proc = subprocess.run(
            command,
            input=data,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        if proc.returncode != 0:
            fail(
                f"curl transport failed for {method} {path}: exit {proc.returncode}: "
                f"{proc.stderr.decode(errors='replace')[:500]}"
            )

        status_text = proc.stdout.decode().strip()
        if not status_text.isdigit():
            fail(f"curl did not return a valid HTTP status for {method} {path}: {status_text!r}")
        return HttpResponse(
            status=int(status_text),
            headers=parse_last_header_block(header_path.read_bytes()),
            body=body_path.read_bytes(),
        )


def request_json(
    path: str,
    *,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    body=None,
    expected: int = 200,
):
    hdrs = {"Accept": "application/json", **(headers or {})}
    data = None
    if body is not None:
        if isinstance(body, bytes):
            data = body
        else:
            data = json.dumps(body).encode()
            hdrs.setdefault("Content-Type", "application/json")
    response = request(path, method=method, headers=hdrs, data=data)
    if response.status != expected:
        fail(
            f"{method} {path}: expected HTTP {expected}, got {response.status}: "
            f"{response.body[:500]!r}"
        )
    return json.loads(response.body.decode()) if response.body else None, response


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def main() -> int:
    if not OWNER_TOKEN:
        print("MCP_AUTH_TOKEN is required", file=sys.stderr)
        return 2

    protected, _ = request_json("/.well-known/oauth-protected-resource")
    if protected.get("resource") != BASE_URL + "/mcp":
        fail("protected resource metadata has the wrong resource URI")
    if BASE_URL not in protected.get("authorization_servers", []):
        fail("protected resource metadata does not advertise this authorization server")

    auth_meta, _ = request_json("/.well-known/oauth-authorization-server")
    if auth_meta.get("registration_endpoint") != BASE_URL + "/register":
        fail("authorization server metadata is missing dynamic registration")
    if "S256" not in auth_meta.get("code_challenge_methods_supported", []):
        fail("authorization server does not advertise PKCE S256")
    if "offline_access" not in auth_meta.get("scopes_supported", []):
        fail("authorization server does not advertise offline_access")

    redirect_uri = "https://example.invalid/cf-control-oauth-smoke"
    registration, _ = request_json(
        "/register",
        method="POST",
        body={
            "client_name": "cf-control OAuth CI smoke test",
            "redirect_uris": [redirect_uri],
            "token_endpoint_auth_method": "none",
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
        },
        expected=201,
    )
    client_id = registration.get("client_id")
    if not client_id:
        fail("dynamic registration did not return client_id")

    verifier = b64url(secrets.token_bytes(48))
    challenge = b64url(hashlib.sha256(verifier.encode()).digest())
    state = secrets.token_urlsafe(18)
    query = urllib.parse.urlencode(
        {
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "scope": "mcp:read offline_access",
            "state": state,
            "resource": BASE_URL + "/mcp",
        }
    )
    authorize = request("/authorize?" + query)
    if authorize.status != 200:
        fail(f"GET /authorize: expected HTTP 200, got {authorize.status}: {authorize.body[:500]!r}")
    page = authorize.body.decode()
    if "Approve Cloudflare connection" not in page:
        fail("authorization page did not render the approval UI")
    parser = HiddenInputParser()
    parser.feed(page)
    if not parser.form_token:
        fail("authorization page did not contain a signed form token")

    approval_body = urllib.parse.urlencode(
        {"form_token": parser.form_token, "approval_token": OWNER_TOKEN}
    ).encode()
    approval = request(
        "/authorize",
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        data=approval_body,
    )
    if approval.status != 302:
        fail(f"approval did not redirect with an authorization code (HTTP {approval.status})")
    location = approval.headers.get("location", "")
    parsed_location = urllib.parse.urlparse(location)
    query_params = urllib.parse.parse_qs(parsed_location.query)
    code = query_params.get("code", [None])[0]
    returned_state = query_params.get("state", [None])[0]
    if not code or returned_state != state:
        fail("authorization redirect is missing code/state")

    token_body = urllib.parse.urlencode(
        {
            "grant_type": "authorization_code",
            "client_id": client_id,
            "code": code,
            "redirect_uri": redirect_uri,
            "code_verifier": verifier,
        }
    ).encode()
    tokens, _ = request_json(
        "/token",
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        body=token_body,
    )
    access_token = tokens.get("access_token")
    refresh_token = tokens.get("refresh_token")
    if not access_token or not refresh_token:
        fail("authorization-code exchange did not issue access + refresh tokens")
    if tokens.get("scope") != "mcp:read offline_access":
        fail(f"unexpected OAuth scope: {tokens.get('scope')!r}")

    tools_body = {"jsonrpc": "2.0", "id": 1, "method": "tools/list"}
    tools_response, _ = request_json(
        "/mcp",
        method="POST",
        headers={"Authorization": "Bearer " + access_token},
        body=tools_body,
    )
    # OAuth-connected clients are intentionally granted the same full tool
    # access as the legacy owner-token path (design decision: owner approval
    # in /authorize is the gate, not a permanent read-only scope). Verify the
    # write tools are present and reachable, without actually invoking a
    # destructive one from CI.
    oauth_tools = {tool["name"] for tool in tools_response["result"]["tools"]}
    if not WRITE_TOOLS.issubset(oauth_tools) or "cf_api_request" not in oauth_tools:
        fail(f"OAuth tools/list is missing full write access: {sorted(oauth_tools)}")
    if not READ_ONLY_TOOLS.issubset(oauth_tools):
        fail(f"OAuth tools/list is missing read tools: {sorted(oauth_tools)}")

    # Confirm a write-capable tool call actually executes for an OAuth token
    # (no "read-only OAuth scope" guard error) using a harmless read-only
    # Cloudflare API call routed through the newly-added generic passthrough
    # tool, so nothing is mutated by this check.
    passthrough, _ = request_json(
        "/mcp",
        method="POST",
        headers={"Authorization": "Bearer " + access_token},
        body={
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {"name": "cf_api_request", "arguments": {"method": "GET", "path": "/zones"}},
        },
    )
    if passthrough.get("result", {}).get("isError"):
        fail(f"cf_api_request via OAuth token failed: {passthrough}")
    if "read-only OAuth scope" in json.dumps(passthrough):
        fail("OAuth token was unexpectedly blocked by a leftover read-only scope guard")

    refresh_body = urllib.parse.urlencode(
        {
            "grant_type": "refresh_token",
            "client_id": client_id,
            "refresh_token": refresh_token,
        }
    ).encode()
    refreshed, _ = request_json(
        "/token",
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        body=refresh_body,
    )
    if not refreshed.get("access_token") or not refreshed.get("refresh_token"):
        fail("refresh grant did not issue replacement tokens")

    legacy, _ = request_json(
        "/mcp",
        method="POST",
        headers={"Authorization": "Bearer " + OWNER_TOKEN},
        body=tools_body,
    )
    legacy_tools = {tool["name"] for tool in legacy["result"]["tools"]}
    if not WRITE_TOOLS.issubset(legacy_tools):
        fail("legacy owner-token path no longer exposes the existing write tools")

    unauthenticated = request(
        "/mcp",
        method="POST",
        headers={"Content-Type": "application/json"},
        data=json.dumps(tools_body).encode(),
    )
    if unauthenticated.status != 401:
        fail(f"unauthenticated MCP request returned HTTP {unauthenticated.status}, expected 401")
    challenge_header = unauthenticated.headers.get("www-authenticate", "")
    if "oauth-protected-resource" not in challenge_header:
        fail("401 response does not advertise OAuth protected-resource metadata")

    print("PASS: OAuth discovery, DCR, consent, PKCE, token exchange, refresh, upgraded MCP tools, legacy path, and 401 challenge")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
