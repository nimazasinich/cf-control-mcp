#!/usr/bin/env python3
"""Deploy and verify ProxyHarvest Cloudflare Workers through GitHub Actions.

Requests live under requests/proxyharvest/<id>.json and results are written to
results/proxyharvest/<id>.json. Cloudflare credentials are read only from
GitHub Actions secrets/environment and are never written to the repository.
"""
from __future__ import annotations

import json
import mimetypes
import os
import secrets
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
REQUEST_DIR = ROOT / "requests" / "proxyharvest"
RESULT_DIR = ROOT / "results" / "proxyharvest"
CF_API_BASE = "https://api.cloudflare.com/client/v4"
TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def redact(value: Any) -> Any:
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for key, item in value.items():
            lk = str(key).lower()
            if any(s in lk for s in ("token", "secret", "password", "authorization", "api_key", "apikey")):
                out[str(key)] = "[REDACTED]"
            else:
                out[str(key)] = redact(item)
        return out
    if isinstance(value, list):
        return [redact(x) for x in value]
    if isinstance(value, str) and TOKEN and TOKEN in value:
        return value.replace(TOKEN, "[REDACTED]")
    return value


def write_result(request_id: str, payload: dict[str, Any]) -> None:
    RESULT_DIR.mkdir(parents=True, exist_ok=True)
    (RESULT_DIR / f"{request_id}.json").write_text(
        json.dumps(redact(payload), indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )


def cf_request(path: str, method: str = "GET", body: bytes | None = None, headers: dict[str, str] | None = None) -> tuple[int, Any, dict[str, str]]:
    req_headers = {
        "Authorization": f"Bearer {TOKEN}",
        "Accept": "application/json",
        "User-Agent": "proxyharvest-github-cloudflare-bridge/1.0",
    }
    if headers:
        req_headers.update(headers)
    req = urllib.request.Request(CF_API_BASE + path, data=body, headers=req_headers, method=method)
    raw = b""
    resp_headers: dict[str, str] = {}
    try:
        with urllib.request.urlopen(req, timeout=90) as response:
            status = response.status
            raw = response.read()
            resp_headers = dict(response.headers.items())
    except urllib.error.HTTPError as exc:
        status = exc.code
        raw = exc.read()
        resp_headers = dict(exc.headers.items()) if exc.headers else {}
    try:
        payload: Any = json.loads(raw.decode("utf-8")) if raw else None
    except Exception:
        payload = raw.decode("utf-8", errors="replace")
    return status, payload, resp_headers


def multipart_worker(source_path: Path, compatibility_date: str) -> tuple[bytes, str]:
    boundary = "----proxyharvest-" + secrets.token_hex(16)
    metadata = {
        "main_module": source_path.name,
        "compatibility_date": compatibility_date,
    }
    parts: list[bytes] = []

    def add_part(name: str, content: bytes, content_type: str, filename: str | None = None) -> None:
        parts.append(f"--{boundary}\r\n".encode())
        disp = f'Content-Disposition: form-data; name="{name}"'
        if filename:
            disp += f'; filename="{filename}"'
        parts.append((disp + "\r\n").encode())
        parts.append(f"Content-Type: {content_type}\r\n\r\n".encode())
        parts.append(content)
        parts.append(b"\r\n")

    add_part("metadata", json.dumps(metadata).encode("utf-8"), "application/json")
    ctype = mimetypes.guess_type(source_path.name)[0] or "application/javascript+module"
    if source_path.suffix in {".mjs", ".js"}:
        ctype = "application/javascript+module"
    add_part(source_path.name, source_path.read_bytes(), ctype, source_path.name)
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts), boundary


def workers_subdomain() -> str:
    status, body, _ = cf_request(f"/accounts/{ACCOUNT_ID}/workers/subdomain")
    if status // 100 != 2 or not isinstance(body, dict) or body.get("success") is False:
        raise RuntimeError(f"failed to read Workers subdomain: HTTP {status}: {body}")
    return str((body.get("result") or {}).get("subdomain") or "").strip()


def public_health_url(script_name: str) -> str:
    subdomain = workers_subdomain()
    if not subdomain:
        raise RuntimeError("Cloudflare Workers subdomain is empty")
    return f"https://{script_name}.{subdomain}.workers.dev/health"


def verify_health(url: str) -> tuple[bool, int, Any]:
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "proxyharvest-deploy-verify/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            status = response.status
            raw = response.read()
    except urllib.error.HTTPError as exc:
        status = exc.code
        raw = exc.read()
    except Exception as exc:
        return False, 0, {"error": str(exc)}
    try:
        body: Any = json.loads(raw.decode("utf-8")) if raw else None
    except Exception:
        body = raw.decode("utf-8", errors="replace")
    ok = 200 <= status < 300 and isinstance(body, dict) and body.get("ok") is True
    return ok, status, body


def deploy_worker(request_id: str, req: dict[str, Any]) -> bool:
    if req.get("confirm_destructive") is not True:
        raise ValueError("deploy_worker requires confirm_destructive=true")
    script_name = str(req.get("script_name", "")).strip()
    if not script_name or not all(c.isalnum() or c in "-_" for c in script_name):
        raise ValueError("invalid script_name")
    source_rel = str(req.get("source_path", "")).strip()
    source_path = (ROOT / source_rel).resolve()
    allowed_root = (ROOT / "deploy" / "proxyharvest").resolve()
    if not str(source_path).startswith(str(allowed_root) + os.sep):
        raise ValueError("source_path must be under deploy/proxyharvest/")
    if not source_path.is_file():
        raise ValueError(f"source file not found: {source_rel}")
    compatibility_date = str(req.get("compatibility_date") or datetime.now(timezone.utc).date().isoformat())

    body, boundary = multipart_worker(source_path, compatibility_date)
    api_path = f"/accounts/{ACCOUNT_ID}/workers/scripts/{script_name}"
    status, response, headers = cf_request(
        api_path,
        method="PUT",
        body=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    ok = 200 <= status < 300 and (not isinstance(response, dict) or response.get("success") is not False)
    health_url = ""
    health_ok = False
    health_status = 0
    health_body: Any = None
    if ok:
        health_url = public_health_url(script_name)
        health_ok, health_status, health_body = verify_health(health_url)
        ok = ok and health_ok

    write_result(
        request_id,
        {
            "request_id": request_id,
            "project": "ProxyHarvest",
            "operation": "deploy_worker",
            "ok": ok,
            "executed_at": utc_now(),
            "script_name": script_name,
            "source_path": source_rel,
            "compatibility_date": compatibility_date,
            "cloudflare": {
                "http_status": status,
                "api_path": api_path,
                "response": response,
                "cf_ray": headers.get("cf-ray", headers.get("CF-Ray", "")),
            },
            "health": {
                "url": health_url,
                "ok": health_ok,
                "status": health_status,
                "body": health_body,
            },
            "reason": str(req.get("reason", "")),
        },
    )
    print(f"{'PASS' if ok else 'FAIL'} {request_id}: worker={script_name} upload={status} health={health_status}")
    return ok


def execute(path: Path) -> bool:
    request_id = path.stem
    result_path = RESULT_DIR / f"{request_id}.json"
    if result_path.exists():
        print(f"SKIP {request_id}: result already exists")
        return True
    try:
        req = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        write_result(request_id, {"request_id": request_id, "project": "ProxyHarvest", "ok": False, "error": f"invalid JSON: {exc}"})
        return False
    if req.get("project") != "ProxyHarvest":
        write_result(request_id, {"request_id": request_id, "project": "ProxyHarvest", "ok": False, "error": "project must be ProxyHarvest"})
        return False
    if req.get("request_id") != request_id:
        write_result(request_id, {"request_id": request_id, "project": "ProxyHarvest", "ok": False, "error": "request_id must match filename"})
        return False
    if not str(req.get("reason", "")).strip():
        write_result(request_id, {"request_id": request_id, "project": "ProxyHarvest", "ok": False, "error": "reason is required"})
        return False
    if not TOKEN or not ACCOUNT_ID:
        write_result(request_id, {"request_id": request_id, "project": "ProxyHarvest", "ok": False, "error": "Cloudflare credentials unavailable in Actions"})
        return False

    try:
        operation = str(req.get("operation", ""))
        if operation == "deploy_worker":
            return deploy_worker(request_id, req)
        raise ValueError(f"unsupported operation: {operation}")
    except Exception as exc:
        write_result(
            request_id,
            {
                "request_id": request_id,
                "project": "ProxyHarvest",
                "operation": req.get("operation"),
                "ok": False,
                "executed_at": utc_now(),
                "error": str(exc),
                "request": redact(req),
            },
        )
        print(f"FAIL {request_id}: {exc}")
        return False


def main() -> int:
    REQUEST_DIR.mkdir(parents=True, exist_ok=True)
    RESULT_DIR.mkdir(parents=True, exist_ok=True)
    request_files = sorted(REQUEST_DIR.glob("*.json"))
    if not request_files:
        print("No ProxyHarvest Cloudflare requests found.")
        return 0
    success = True
    for path in request_files:
        success = execute(path) and success
    return 0 if success else 1


if __name__ == "__main__":
    raise SystemExit(main())
