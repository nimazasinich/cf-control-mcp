#!/usr/bin/env python3
"""Execute pending APEX-scoped Cloudflare API requests from GitHub Actions.

Requests live under requests/apex/<id>.json and results are written to
results/apex/<id>.json. Cloudflare credentials are read only from Actions
secrets/environment and are never written to the repository.
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
REQUEST_DIR = ROOT / "requests" / "apex"
RESULT_DIR = ROOT / "results" / "apex"
CF_API_BASE = "https://api.cloudflare.com/client/v4"
TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
ALLOWED_METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE"}
REDACT_KEY = re.compile(r"(?:token|secret|password|credential|authorization|api[_-]?key|private[_-]?key|client[_-]?secret)", re.I)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def redact(value: Any) -> Any:
    if isinstance(value, dict):
        clean: dict[str, Any] = {}
        for key, item in value.items():
            clean[str(key)] = "[REDACTED]" if REDACT_KEY.search(str(key)) else redact(item)
        return clean
    if isinstance(value, list):
        return [redact(item) for item in value]
    if isinstance(value, str) and TOKEN and TOKEN in value:
        return value.replace(TOKEN, "[REDACTED]")
    return value


def write_result(request_id: str, payload: dict[str, Any]) -> None:
    RESULT_DIR.mkdir(parents=True, exist_ok=True)
    (RESULT_DIR / f"{request_id}.json").write_text(
        json.dumps(redact(payload), indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def fail_result(request_id: str, request: dict[str, Any] | None, message: str) -> None:
    write_result(
        request_id,
        {
            "request_id": request_id,
            "project": "APEX",
            "ok": False,
            "executed_at": utc_now(),
            "request": redact(request or {}),
            "error": message,
        },
    )


def execute(request_path: Path) -> bool:
    request_id = request_path.stem
    result_path = RESULT_DIR / f"{request_id}.json"
    if result_path.exists():
        print(f"SKIP {request_id}: result already exists")
        return True

    try:
        request = json.loads(request_path.read_text(encoding="utf-8"))
    except Exception as exc:
        fail_result(request_id, None, f"invalid request JSON: {exc}")
        return False

    if request.get("project") != "APEX":
        fail_result(request_id, request, "project must be exactly 'APEX'")
        return False
    if request.get("request_id") != request_id:
        fail_result(request_id, request, "request_id must match the JSON filename")
        return False

    method = str(request.get("method", "GET")).upper()
    if method not in ALLOWED_METHODS:
        fail_result(request_id, request, f"unsupported HTTP method: {method}")
        return False

    api_path = str(request.get("path", ""))
    if not api_path.startswith("/") or "://" in api_path or ".." in api_path:
        fail_result(request_id, request, "path must be an absolute Cloudflare API v4 path without a URL or '..'")
        return False
    api_path = api_path.replace("{account_id}", ACCOUNT_ID)
    if "{account_id}" in api_path or ("/accounts/" in api_path and not ACCOUNT_ID):
        fail_result(request_id, request, "CLOUDFLARE_ACCOUNT_ID is required for this request")
        return False

    destructive = method != "GET"
    if destructive and request.get("confirm_destructive") is not True:
        fail_result(request_id, request, "non-GET requests require confirm_destructive=true")
        return False

    reason = str(request.get("reason", "")).strip()
    if not reason:
        fail_result(request_id, request, "reason is required")
        return False

    if not TOKEN:
        fail_result(request_id, request, "CLOUDFLARE_API_TOKEN is not configured in GitHub Actions")
        return False

    body = request.get("body")
    data: bytes | None = None
    headers = {
        "Authorization": f"Bearer {TOKEN}",
        "Accept": "application/json",
        "User-Agent": "apex-github-cloudflare-bridge/1.0",
    }
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = urllib.request.Request(CF_API_BASE + api_path, data=data, headers=headers, method=method)
    status = 0
    raw = b""
    response_headers: dict[str, str] = {}
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            status = response.status
            raw = response.read()
            response_headers = dict(response.headers.items())
    except urllib.error.HTTPError as exc:
        status = exc.code
        raw = exc.read()
        response_headers = dict(exc.headers.items()) if exc.headers else {}
    except Exception as exc:
        fail_result(request_id, request, f"Cloudflare request failed before an HTTP response: {exc}")
        return False

    try:
        response_body: Any = json.loads(raw.decode("utf-8")) if raw else None
    except Exception:
        response_body = raw.decode("utf-8", errors="replace")

    ok = 200 <= status < 300
    if isinstance(response_body, dict) and response_body.get("success") is False:
        ok = False

    write_result(
        request_id,
        {
            "request_id": request_id,
            "project": "APEX",
            "ok": ok,
            "executed_at": utc_now(),
            "http": {"method": method, "path": api_path, "status": status},
            "reason": reason,
            "response": response_body,
            "response_meta": {
                "content_type": response_headers.get("Content-Type", ""),
                "cf_ray": response_headers.get("cf-ray", response_headers.get("CF-Ray", "")),
            },
        },
    )
    print(f"{'PASS' if ok else 'FAIL'} {request_id}: {method} {api_path} -> HTTP {status}")
    return ok


def main() -> int:
    REQUEST_DIR.mkdir(parents=True, exist_ok=True)
    RESULT_DIR.mkdir(parents=True, exist_ok=True)
    requests = sorted(REQUEST_DIR.glob("*.json"))
    if not requests:
        print("No APEX Cloudflare requests found.")
        return 0

    success = True
    for request_path in requests:
        success = execute(request_path) and success
    return 0 if success else 1


if __name__ == "__main__":
    raise SystemExit(main())
