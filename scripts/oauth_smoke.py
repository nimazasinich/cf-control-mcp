#!/usr/bin/env python3
"""End-to-end OAuth/MCP smoke test for cf-control-mcp.

Requires MCP_AUTH_TOKEN in the environment. Never prints the secret or issued tokens.
"""
from __future__ import annotations

import base64
import hashlib
import html.parser
import json
import os
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE_URL = os.environ.get("MCP_BASE_URL", "https://cf-control-mcp.amin-chinisaz-edu.workers.dev").rstrip("/")
OWNER_TOKEN = os.environ.get("MCP_AUTH_TOKEN", "")
READ_ONLY_TOOLS = {
    "cf_list_zones",
    "cf_list_dns_records",
    "cf_list_workers",
    "cf_get_worker_metadata",
    "cf_kv_list_namespaces",
    "cf_kv_get_value",
}
WRITE_TOOLS = {
    "cf_create_dns_record",
    "cf_delete_dns_record",
    "cf_purge_cache",
    "cf_kv_put_value",
}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


NO_REDIRECT = urllib.request.build_opener(NoRedirect)


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


def request(path: str, *, method: str = "GET", headers: dict[str, str] | None = None, data: bytes | None = None, no_redirect: bool = False):
    req = urllib.request.Request(BASE_URL + path, data=data, headers=headers or {}, method=method)
    opener = NO_REDIRECT if no_redirect else urllib.request
    try:
        return opener.open(req, timeout=30)
    except urllib.error.HTTPError as exc:
        if no_redirect and exc.code in (301, 302, 303, 307, 308):
            return exc
        raise


def request_json(path: str, *, method: str = "GET", headers: dict[str, str] | None = None, body=None, expected: int = 200):
    hdrs = {"Accept": "application/json", **(headers or {})}
    data = None
    if body is not None:
        if isinstance(body, bytes):
            data = body
        else:
            data = json.dumps(body).encode()
            hdrs.setdefault("Content-Type", "application/json")
    try:
        response = request(path, method=method, headers=hdrs, data=data)
        status = response.status
        raw = response.read()
    except urllib.error.HTTPError as exc:
        status = exc.code
        raw = exc.read()
        response = exc
    if status != expected:
        fail(f"{method} {path}: expected HTTP {expected}, got {status}: {raw[:500]!r}")
    return json.loads(raw.decode()) if raw else None, response


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
    page = authorize.read().decode()
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
        no_redirect=True,
    )
    if approval.code != 302:
        fail(f"approval did not redirect with an authorization code (HTTP {approval.code})")
    location = approval.headers.get("Location", "")
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
    oauth_tools = {tool["name"] for tool in tools_response["result"]["tools"]}
    if oauth_tools != READ_ONLY_TOOLS:
        fail(f"OAuth tools/list mismatch: {sorted(oauth_tools)}")
    if oauth_tools & WRITE_TOOLS:
        fail("write tools leaked into the read-only OAuth connection")

    blocked, _ = request_json(
        "/mcp",
        method="POST",
        headers={"Authorization": "Bearer " + access_token},
        body={
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {"name": "cf_create_dns_record", "arguments": {}},
        },
    )
    if "read-only OAuth scope" not in blocked.get("error", {}).get("message", ""):
        fail("write tool was not blocked by the OAuth scope guard")

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

    try:
        request(
            "/mcp",
            method="POST",
            headers={"Content-Type": "application/json"},
            data=json.dumps(tools_body).encode(),
        )
        fail("unauthenticated MCP request unexpectedly succeeded")
    except urllib.error.HTTPError as exc:
        if exc.code != 401:
            fail(f"unauthenticated MCP request returned HTTP {exc.code}, expected 401")
        challenge_header = exc.headers.get("WWW-Authenticate", "")
        if "oauth-protected-resource" not in challenge_header:
            fail("401 response does not advertise OAuth protected-resource metadata")

    print("PASS: OAuth discovery, DCR, consent, PKCE, token exchange, refresh, read-only MCP scope, legacy path, and 401 challenge")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
