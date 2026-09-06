#!/usr/bin/env python3
"""Secure one-time runtime-secret installer for cf-control-mcp v1.8.

Designed for an operator/agent machine with outbound HTTPS access. The script reads
secrets from a dotenv-style file or existing environment variables, never prints
secret values, validates the AI Gateway token with a real BYOK request, installs it
as the Worker secret CF_AIG_TOKEN through the Cloudflare API, verifies the binding,
and optionally dispatches the repository's verify-only GitHub Actions workflow.

Supported legacy/local aliases intentionally include the user's existing env names:
  cf-aig-authorization -> CF_AIG_TOKEN
  cluadflairapi        -> CLOUDFLARE_API_TOKEN
  github_token         -> GITHUB_TOKEN

No secret is written to source control or command-line arguments.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

DEFAULT_BASE_URL = "https://cf-control-mcp.amin-chinisaz-edu.workers.dev"
DEFAULT_WORKER = "cf-control-mcp"
DEFAULT_GATEWAY = "cf-control-mcp"
DEFAULT_REPO = "nimazasinich/cf-control-mcp"

ALIASES: dict[str, tuple[str, ...]] = {
    "CF_AIG_TOKEN": ("CF_AIG_TOKEN", "cf-aig-authorization", "CF_AIG_AUTH_TOKEN"),
    "CLOUDFLARE_API_TOKEN": ("CLOUDFLARE_API_TOKEN", "CF_API_TOKEN", "cluadflairapi"),
    "CLOUDFLARE_ACCOUNT_ID": ("CLOUDFLARE_ACCOUNT_ID", "CF_ACCOUNT_ID"),
    "GITHUB_TOKEN": ("GITHUB_TOKEN", "GH_TOKEN", "github_token"),
    "MCP_AUTH_TOKEN": ("MCP_AUTH_TOKEN",),
}


def parse_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        values[key] = value
    return values


def resolve(values: dict[str, str], canonical: str) -> str:
    for name in ALIASES[canonical]:
        value = os.environ.get(name, "").strip() or values.get(name, "").strip()
        if value:
            return value
    return ""


def request_json(
    url: str,
    *,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    body: Any = None,
    timeout: int = 30,
) -> tuple[int, dict[str, Any], str]:
    hdrs = {"User-Agent": "cf-control-runtime-secret-installer/1.8", **(headers or {})}
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        hdrs.setdefault("Content-Type", "application/json")
    req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            parsed = json.loads(raw) if raw else {}
            return resp.status, parsed, raw
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(raw)
        except Exception:
            parsed = {}
        return exc.code, parsed, raw


def cf_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def discover_account_id(mgmt_token: str, worker_name: str) -> str:
    status, parsed, _ = request_json(
        "https://api.cloudflare.com/client/v4/accounts?per_page=50",
        headers=cf_headers(mgmt_token),
    )
    if status != 200 or not parsed.get("success"):
        raise RuntimeError(f"Cloudflare account discovery failed (HTTP {status})")
    accounts = parsed.get("result", [])
    candidates: list[str] = []
    for account in accounts:
        account_id = str(account.get("id", ""))
        if not account_id:
            continue
        worker_url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/workers/scripts/{urllib.parse.quote(worker_name, safe='')}/settings"
        s, _, _ = request_json(worker_url, headers=cf_headers(mgmt_token))
        if s == 200:
            candidates.append(account_id)
    if len(candidates) == 1:
        return candidates[0]
    if not candidates:
        raise RuntimeError(f"No accessible Cloudflare account contains Worker {worker_name!r}")
    raise RuntimeError(
        "More than one accessible account contains the target Worker; set CLOUDFLARE_ACCOUNT_ID explicitly"
    )


def validate_aig_token(account_id: str, gateway: str, token: str) -> None:
    url = f"https://gateway.ai.cloudflare.com/v1/{account_id}/{urllib.parse.quote(gateway, safe='')}/compat/chat/completions"
    status, parsed, raw = request_json(
        url,
        method="POST",
        headers={"cf-aig-authorization": f"Bearer {token}"},
        body={
            "model": "google-ai-studio/gemini-3.6-flash",
            "messages": [{"role": "user", "content": "Return the single word AIG_OK."}],
            "max_tokens": 10,
        },
    )
    if status != 200 or not parsed.get("choices"):
        error = parsed.get("error") if isinstance(parsed, dict) else None
        safe = json.dumps(error, ensure_ascii=False)[:300] if error else raw[:300]
        raise RuntimeError(f"CF_AIG_TOKEN validation failed (HTTP {status}): {safe}")


def put_worker_secret(account_id: str, worker: str, mgmt_token: str, name: str, value: str) -> None:
    url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/workers/scripts/{urllib.parse.quote(worker, safe='')}/secrets"
    status, parsed, _ = request_json(
        url,
        method="PUT",
        headers=cf_headers(mgmt_token),
        body={"name": name, "text": value, "type": "secret_text"},
    )
    if status not in (200, 201) or parsed.get("success") is False:
        raise RuntimeError(f"Worker secret update for {name} failed (HTTP {status})")


def list_worker_secret_names(account_id: str, worker: str, mgmt_token: str) -> set[str]:
    url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/workers/scripts/{urllib.parse.quote(worker, safe='')}/secrets"
    status, parsed, _ = request_json(url, headers=cf_headers(mgmt_token))
    if status != 200 or parsed.get("success") is False:
        raise RuntimeError(f"Worker secret list failed (HTTP {status})")
    return {str(row.get("name")) for row in parsed.get("result", []) if isinstance(row, dict)}


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def admin_cookie(owner_secret: str) -> str:
    payload = b64url(json.dumps({"exp": int(time.time()) + 600}, separators=(",", ":")).encode())
    sig = b64url(hmac.new(owner_secret.encode(), payload.encode(), hashlib.sha256).digest())
    return f"admin_session={payload}.{sig}"


def verify_admin_health(base_url: str, mcp_auth_token: str) -> None:
    status, parsed, raw = request_json(
        f"{base_url.rstrip('/')}/admin/api/providers/google-ai-studio/health-test",
        method="POST",
        headers={"Cookie": admin_cookie(mcp_auth_token)},
    )
    state = parsed.get("state") if isinstance(parsed, dict) else None
    if status != 200 or state != "HEALTHY":
        raise RuntimeError(f"Admin live BYOK health failed (HTTP {status}, state={state!r}): {raw[:250]}")


def dispatch_verify(repo: str, github_token: str, ref: str = "main") -> None:
    url = f"https://api.github.com/repos/{repo}/actions/workflows/verify-only.yml/dispatches"
    status, _, raw = request_json(
        url,
        method="POST",
        headers={
            "Authorization": f"Bearer {github_token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
        body={"ref": ref},
    )
    if status != 204:
        raise RuntimeError(f"GitHub verify-only dispatch failed (HTTP {status}): {raw[:250]}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env-file", type=Path, required=True, help="dotenv-style secret file; values are never printed")
    parser.add_argument("--worker", default=DEFAULT_WORKER)
    parser.add_argument("--gateway", default=DEFAULT_GATEWAY)
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--repo", default=DEFAULT_REPO)
    parser.add_argument("--dispatch-verify", action="store_true")
    parser.add_argument("--verify-ref", default="main")
    args = parser.parse_args()

    values = parse_env_file(args.env_file)
    aig_token = resolve(values, "CF_AIG_TOKEN")
    mgmt_token = resolve(values, "CLOUDFLARE_API_TOKEN")
    account_id = resolve(values, "CLOUDFLARE_ACCOUNT_ID")
    github_token = resolve(values, "GITHUB_TOKEN")
    mcp_auth_token = resolve(values, "MCP_AUTH_TOKEN")

    missing = [
        name
        for name, value in (
            ("CF_AIG_TOKEN (or cf-aig-authorization)", aig_token),
            ("CLOUDFLARE_API_TOKEN (or cluadflairapi)", mgmt_token),
            ("MCP_AUTH_TOKEN", mcp_auth_token),
        )
        if not value
    ]
    if missing:
        print("BLOCKED: missing " + ", ".join(missing), file=sys.stderr)
        return 2

    print("PASS: required local credentials detected (values hidden)")
    if not account_id:
        account_id = discover_account_id(mgmt_token, args.worker)
        print("PASS: Cloudflare account resolved by exact Worker ownership")
    else:
        print("PASS: explicit CLOUDFLARE_ACCOUNT_ID provided")

    validate_aig_token(account_id, args.gateway, aig_token)
    print("PASS: CF_AIG_TOKEN performed a real authenticated BYOK Gemini request")

    put_worker_secret(account_id, args.worker, mgmt_token, "CF_AIG_TOKEN", aig_token)
    print("PASS: Worker secret CF_AIG_TOKEN installed/updated")

    names = list_worker_secret_names(account_id, args.worker, mgmt_token)
    if "CF_AIG_TOKEN" not in names:
        raise RuntimeError("CF_AIG_TOKEN is not present in Worker secret bindings after update")
    print("PASS: Worker secret binding readback confirms CF_AIG_TOKEN exists")

    verify_admin_health(args.base_url, mcp_auth_token)
    print("PASS: production Admin health executed real BYOK path and returned HEALTHY")

    if args.dispatch_verify:
        if not github_token:
            print("BLOCKED: --dispatch-verify requested but GITHUB_TOKEN/github_token is missing", file=sys.stderr)
            return 3
        dispatch_verify(args.repo, github_token, args.verify_ref)
        print(f"PASS: dispatched verify-only.yml on ref {args.verify_ref}")

    print("FINAL: runtime AI Gateway token provisioning completed without printing or committing secret values")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        raise SystemExit(1)
