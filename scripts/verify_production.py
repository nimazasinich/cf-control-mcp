#!/usr/bin/env python3
"""Fail-closed production acceptance verification for cf-control-mcp v1.8.

This script is intended for GitHub Actions or an operator shell with secrets supplied
through environment variables. It never prints secret values and exits non-zero if
any required acceptance gate FAILS or is BLOCKED.
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request
from typing import Any

BASE_URL = os.environ.get("PRODUCTION_BASE_URL", "https://cf-control-mcp.amin-chinisaz-edu.workers.dev").rstrip("/")
GATEWAY_AUTH_TOKEN = os.environ.get("GATEWAY_AUTH_TOKEN", "").strip()
CF_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "").strip()
CF_ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "").strip()
CF_AIG_TOKEN = os.environ.get("CF_AIG_TOKEN", "").strip()
D1_DATABASE_ID = os.environ.get("D1_DATABASE_ID", "138a2aef-9f5a-4635-8346-dc474fdfff93").strip()
GATEWAY_SLUG = os.environ.get("CF_AIG_GATEWAY_SLUG", "cf-control-mcp").strip()
WORKER_SCRIPT_NAME = os.environ.get("WORKER_SCRIPT_NAME", "cf-control-mcp").strip()
EXPECTED_TOOL_COUNT = int(os.environ.get("EXPECTED_MCP_TOOL_COUNT", "44"))

KNOWN_SECRETS = [s for s in (GATEWAY_AUTH_TOKEN, CF_API_TOKEN, CF_AIG_TOKEN) if s]
TOKENISH = re.compile(r"(?:cfut_|ghp_|hf_|vck_)[A-Za-z0-9_-]{12,}")


def redact(text: str) -> str:
    safe = text
    for secret in KNOWN_SECRETS:
        safe = safe.replace(secret, "<REDACTED>")
    return TOKENISH.sub("<REDACTED>", safe)


def http_req(
    url: str,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    data: Any = None,
) -> tuple[int, dict[str, Any], str]:
    merged = {"User-Agent": "cf-control-production-verifier/1.8"}
    if headers:
        merged.update(headers)
    body = None
    if data is not None:
        if isinstance(data, (dict, list)):
            body = json.dumps(data).encode("utf-8")
            merged.setdefault("Content-Type", "application/json")
        elif isinstance(data, str):
            body = data.encode("utf-8")
        elif isinstance(data, bytes):
            body = data
    req = urllib.request.Request(url, data=body, headers=merged, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            try:
                parsed = json.loads(raw)
            except Exception:
                parsed = {}
            return resp.status, parsed, redact(raw)
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(raw)
        except Exception:
            parsed = {}
        return exc.code, parsed, redact(raw)
    except Exception as exc:
        return 0, {}, redact(str(exc))


results: list[tuple[str, str, str]] = []


def record(name: str, status: str, evidence: str) -> None:
    results.append((name, status, redact(evidence)))
    print(f"{status}: {name} — {redact(evidence)}")


def require_env() -> bool:
    ok = True
    required = {
        "GATEWAY_AUTH_TOKEN": GATEWAY_AUTH_TOKEN,
        "CLOUDFLARE_API_TOKEN": CF_API_TOKEN,
        "CLOUDFLARE_ACCOUNT_ID": CF_ACCOUNT_ID,
        "CF_AIG_TOKEN": CF_AIG_TOKEN,
    }
    for name, value in required.items():
        if value:
            record(f"environment:{name}", "PASS", "configured")
        else:
            record(f"environment:{name}", "BLOCKED", "missing required runtime/verification secret")
            ok = False
    return ok


def main() -> int:
    print("=================================================================")
    print("PRODUCTION ACCEPTANCE — cf-control-mcp v1.8")
    print("=================================================================")
    print(f"Target URL: {BASE_URL}")

    env_ok = require_env()

    status, parsed, raw = http_req(
        f"{BASE_URL}/v1/models",
        headers={"Authorization": "Bearer invalid-test-token-123"},
    )
    if status == 401 and parsed.get("error", {}).get("code") == "invalid_api_key":
        record("/v1 invalid-token challenge", "PASS", "HTTP 401 invalid_api_key")
    else:
        record("/v1 invalid-token challenge", "FAIL", f"expected 401 invalid_api_key, got HTTP {status}: {raw[:200]}")

    if GATEWAY_AUTH_TOKEN:
        status, parsed, raw = http_req(
            f"{BASE_URL}/v1/models",
            headers={"Authorization": f"Bearer {GATEWAY_AUTH_TOKEN}"},
        )
        model_ids = [m.get("id") for m in parsed.get("data", []) if isinstance(m, dict)]
        required_models = {
            "fast", "coding", "research",
            "gemini-3.5-flash", "gemini-3.6-flash", "gemini-3.7-flash", "gemini-3.8-flash",
        }
        if status == 200 and required_models.issubset(set(model_ids)):
            record("/v1/models", "PASS", f"HTTP 200 with expected model set ({len(model_ids)} returned)")
        else:
            record("/v1/models", "FAIL", f"HTTP {status}; returned={model_ids}; body={raw[:300]}")
    else:
        record("/v1/models", "BLOCKED", "GATEWAY_AUTH_TOKEN missing")

    for alias, marker in (("fast", "FAST_OK"), ("coding", "CODING_OK")):
        if not GATEWAY_AUTH_TOKEN:
            record(f"/v1/chat/completions:{alias}", "BLOCKED", "GATEWAY_AUTH_TOKEN missing")
            continue
        status, parsed, raw = http_req(
            f"{BASE_URL}/v1/chat/completions",
            method="POST",
            headers={"Authorization": f"Bearer {GATEWAY_AUTH_TOKEN}"},
            data={
                "model": alias,
                "messages": [{"role": "user", "content": f"Return the single word {marker}."}],
                "max_tokens": 10,
            },
        )
        choices = parsed.get("choices", [])
        if status == 200 and choices:
            returned_model = parsed.get("model", "")
            record(f"/v1/chat/completions:{alias}", "PASS", f"HTTP 200 real completion; response model={returned_model}")
        else:
            record(f"/v1/chat/completions:{alias}", "FAIL", f"HTTP {status}: {raw[:350]}")

    account_id = CF_ACCOUNT_ID
    cf_headers = {"Authorization": f"Bearer {CF_API_TOKEN}"} if CF_API_TOKEN else {}

    if CF_API_TOKEN and account_id:
        d1_url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/d1/database/{D1_DATABASE_ID}/query"
        query_results: dict[str, list[dict[str, Any]]] = {}
        queries = {
            "providers": "SELECT id, display_name, kind, enabled, byok_alias, health_state FROM providers;",
            "models": "SELECT id, provider_id, public_alias, enabled FROM models;",
            "routing_rules": "SELECT public_alias, model_id, updated_at FROM routing_rules;",
        }
        d1_ok = True
        for label, sql in queries.items():
            status, parsed, raw = http_req(d1_url, method="POST", headers=cf_headers, data={"sql": sql})
            rows = parsed.get("result", [{}])[0].get("results", []) if status == 200 and parsed.get("result") else []
            query_results[label] = rows
            if status != 200:
                d1_ok = False
                record(f"D1:{label}", "FAIL", f"HTTP {status}: {raw[:250]}")
            else:
                record(f"D1:{label}", "PASS", f"HTTP 200; {len(rows)} rows")

        providers = query_results.get("providers", [])
        models = query_results.get("models", [])
        rules = query_results.get("routing_rules", [])
        rules_map = {r.get("public_alias"): r.get("model_id") for r in rules}
        enabled_models = {m.get("id") for m in models if m.get("enabled") == 1}
        provider_ok = any(
            p.get("id") == "google-ai-studio" and p.get("enabled") == 1 and p.get("byok_alias") == "default"
            for p in providers
        )
        invariants_ok = (
            d1_ok
            and provider_ok
            and rules_map.get("fast") == "gemini-3.6-flash"
            and rules_map.get("coding") == "gemini-3.8-flash"
            and rules_map.get("research") == "gemini-3.8-flash"
            and {"gemini-3.5-flash", "gemini-3.6-flash", "gemini-3.7-flash", "gemini-3.8-flash"}.issubset(enabled_models)
        )
        record(
            "D1 routing/provider invariants",
            "PASS" if invariants_ok else "FAIL",
            f"provider_ok={provider_ok}; routes={rules_map}",
        )
    else:
        record("D1 readback", "BLOCKED", "CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID missing")

    if CF_API_TOKEN and account_id:
        aig_url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/ai-gateway/gateways/{GATEWAY_SLUG}"
        status, parsed, raw = http_req(aig_url, headers=cf_headers)
        result = parsed.get("result", {}) if status == 200 else {}
        auth_enabled = result.get("authentication", False) or result.get("auth_required", False)
        if status == 200 and auth_enabled is True:
            record("AI Gateway authentication", "PASS", "authentication=true")
        else:
            record("AI Gateway authentication", "FAIL", f"HTTP {status}; authentication={auth_enabled}; {raw[:200]}")
    else:
        record("AI Gateway authentication", "BLOCKED", "management credential/account ID missing")

    if CF_API_TOKEN and account_id:
        expected_secret_name = f"{GATEWAY_SLUG}_google-ai-studio_default"
        ss_url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/secrets_store/stores"
        status, parsed, raw = http_req(ss_url, headers=cf_headers)
        stores = parsed.get("result", []) if status == 200 else []
        default_store = next((s for s in stores if s.get("name") == "default_secrets_store"), None)
        if not default_store:
            record("BYOK Secrets Store", "FAIL", f"default_secrets_store not found; HTTP {status}: {raw[:180]}")
        else:
            sec_url = f"{ss_url}/{default_store.get('id')}/secrets"
            sec_status, sec_parsed, sec_raw = http_req(sec_url, headers=cf_headers)
            secret_rows = sec_parsed.get("result", []) if sec_status == 200 else []
            target = next((s for s in secret_rows if s.get("name") == expected_secret_name), None)
            scopes = target.get("scopes", []) if target else []
            secret_ok = bool(target and target.get("status") == "active" and "ai_gateway" in scopes)
            record(
                "BYOK Secrets Store",
                "PASS" if secret_ok else "FAIL",
                f"secret={expected_secret_name}; active={bool(target and target.get('status') == 'active')}; ai_gateway_scope={'ai_gateway' in scopes}; HTTP {sec_status}",
            )
            if sec_status != 200:
                print(redact(sec_raw[:180]))

        pc_url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/ai-gateway/gateways/{GATEWAY_SLUG}/provider_configs"
        pc_status, pc_parsed, pc_raw = http_req(pc_url, headers=cf_headers)
        configs = pc_parsed.get("result", []) if pc_status == 200 else []
        config = next(
            (c for c in configs if c.get("provider_slug") == "google-ai-studio" and c.get("alias") == "default"),
            None,
        )
        config_ok = bool(config and config.get("default_config") is True)
        record("BYOK Provider Config", "PASS" if config_ok else "FAIL", f"HTTP {pc_status}; matching default config={config_ok}")
        if pc_status != 200:
            print(redact(pc_raw[:180]))
    else:
        record("BYOK configuration", "BLOCKED", "management credential/account ID missing")

    if CF_AIG_TOKEN and account_id:
        direct_url = f"https://gateway.ai.cloudflare.com/v1/{account_id}/{GATEWAY_SLUG}/compat/chat/completions"
        status, parsed, raw = http_req(
            direct_url,
            method="POST",
            headers={"cf-aig-authorization": f"Bearer {CF_AIG_TOKEN}"},
            data={
                "model": "google-ai-studio/gemini-3.6-flash",
                "messages": [{"role": "user", "content": "Return the single word AIG_OK."}],
                "max_tokens": 10,
            },
        )
        choices = parsed.get("choices", [])
        if status == 200 and choices:
            record("CF_AIG_TOKEN direct BYOK inference", "PASS", "HTTP 200 real Gemini completion")
        else:
            record("CF_AIG_TOKEN direct BYOK inference", "FAIL", f"HTTP {status}: {raw[:350]}")
    else:
        record("CF_AIG_TOKEN direct BYOK inference", "BLOCKED", "CF_AIG_TOKEN or account ID missing")

    if CF_API_TOKEN and account_id:
        secrets_url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/workers/scripts/{WORKER_SCRIPT_NAME}/secrets"
        status, parsed, raw = http_req(secrets_url, headers=cf_headers)
        rows = parsed.get("result", []) if status == 200 else []
        names = {row.get("name") for row in rows if isinstance(row, dict)}
        required_names = {"MCP_AUTH_TOKEN", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "GATEWAY_AUTH_TOKEN", "CF_AIG_TOKEN"}
        missing = sorted(required_names - names)
        record(
            "Worker required secret bindings",
            "PASS" if status == 200 and not missing else "FAIL",
            f"HTTP {status}; missing={missing}",
        )
        if status != 200:
            print(redact(raw[:180]))
    else:
        record("Worker required secret bindings", "BLOCKED", "management credential/account ID missing")

    print("=================================================================")
    print("FINAL ACCEPTANCE MATRIX")
    print("=================================================================")
    for name, status, evidence in results:
        print(f"{status:7} | {name} | {evidence}")

    non_pass = [(n, s) for n, s, _ in results if s != "PASS"]
    if not env_ok or non_pass:
        print(f"FINAL: FAIL/BLOCKED — {len(non_pass)} acceptance gate(s) are not PASS")
        return 1
    print("FINAL: PASS — all production acceptance gates passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
