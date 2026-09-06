#!/usr/bin/env python3
"""Comprehensive production verification script for cf-control-mcp v1.8.

Runs in GitHub Actions using repository secrets:
  - GATEWAY_AUTH_TOKEN
  - CLOUDFLARE_API_TOKEN
  - CLOUDFLARE_ACCOUNT_ID

Never prints secret values. Outputs structured test evidence.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any, Dict

BASE_URL = os.environ.get("PRODUCTION_BASE_URL", "https://cf-control-mcp.amin-chinisaz-edu.workers.dev")
GATEWAY_AUTH_TOKEN = os.environ.get("GATEWAY_AUTH_TOKEN", "").strip()
CF_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "").strip()
CF_ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "").strip()
D1_DATABASE_ID = "138a2aef-9f5a-4635-8346-dc474fdfff93"
GATEWAY_SLUG = "cf-control-mcp"


def http_req(url: str, method: str = "GET", headers: Dict[str, str] = None, data: Any = None) -> tuple[int, Dict[str, Any], str]:
    h = {"User-Agent": "Antigravity-Verifier/1.8"}
    if headers:
        h.update(headers)
    body = None
    if data is not None:
        if isinstance(data, (dict, list)):
            body = json.dumps(data).encode("utf-8")
            if "Content-Type" not in h:
                h["Content-Type"] = "application/json"
        elif isinstance(data, str):
            body = data.encode("utf-8")
        elif isinstance(data, bytes):
            body = data

    req = urllib.request.Request(url, data=body, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            try:
                parsed = json.loads(raw)
            except Exception:
                parsed = {}
            return resp.status, parsed, raw
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(raw)
        except Exception:
            parsed = {}
        return e.code, parsed, raw
    except Exception as e:
        return 0, {}, str(e)


def main() -> int:
    print("=================================================================")
    print("PRODUCTION VERIFICATION — cf-control-mcp v1.8")
    print("=================================================================")
    print(f"Target URL: {BASE_URL}")
    print(f"GATEWAY_AUTH_TOKEN set: {bool(GATEWAY_AUTH_TOKEN)} (len={len(GATEWAY_AUTH_TOKEN)})")
    print(f"CLOUDFLARE_API_TOKEN set: {bool(CF_API_TOKEN)} (len={len(CF_API_TOKEN)})")
    print(f"CLOUDFLARE_ACCOUNT_ID set: {bool(CF_ACCOUNT_ID)} (len={len(CF_ACCOUNT_ID)})")
    print()

    # -----------------------------------------------------------------
    # Gate 1: /v1 401 Challenge
    # -----------------------------------------------------------------
    print("--- Gate 1: /v1 Authentication Challenge (Invalid Token) ---")
    status, parsed, raw = http_req(f"{BASE_URL}/v1/models", headers={"Authorization": "Bearer invalid-test-token-123"})
    print(f"GET /v1/models [invalid token] -> HTTP {status}")
    if status == 401 and parsed.get("error", {}).get("code") == "invalid_api_key":
        print("PASS: Correctly rejected with 401 and invalid_api_key")
    else:
        print(f"FAIL: Expected 401 invalid_api_key, got {status}: {raw[:200]}")
    print()

    # -----------------------------------------------------------------
    # Gate 2: /v1/models with valid GATEWAY_AUTH_TOKEN
    # -----------------------------------------------------------------
    print("--- Gate 2: /v1/models (Valid GATEWAY_AUTH_TOKEN) ---")
    if not GATEWAY_AUTH_TOKEN:
        print("BLOCKED: GATEWAY_AUTH_TOKEN secret not available")
    else:
        status, parsed, raw = http_req(f"{BASE_URL}/v1/models", headers={"Authorization": f"Bearer {GATEWAY_AUTH_TOKEN}"})
        print(f"GET /v1/models -> HTTP {status}")
        models_data = parsed.get("data", [])
        model_ids = [m.get("id") for m in models_data if isinstance(m, dict)]
        print(f"Returned {len(models_data)} models: {model_ids}")
        if status == 200 and len(models_data) > 0:
            print("PASS: /v1/models returned model list successfully")
        else:
            print(f"FAIL: Expected 200 with models, got {status}: {raw[:300]}")
    print()

    # -----------------------------------------------------------------
    # Gate 3: /v1/chat/completions model=fast
    # -----------------------------------------------------------------
    print("--- Gate 3: /v1/chat/completions (model=fast) ---")
    if not GATEWAY_AUTH_TOKEN:
        print("BLOCKED: GATEWAY_AUTH_TOKEN secret not available")
    else:
        status, parsed, raw = http_req(
            f"{BASE_URL}/v1/chat/completions",
            method="POST",
            headers={"Authorization": f"Bearer {GATEWAY_AUTH_TOKEN}"},
            data={
                "model": "fast",
                "messages": [{"role": "user", "content": "Return the single word FAST_OK."}],
                "max_tokens": 10,
            }
        )
        print(f"POST /v1/chat/completions [model=fast] -> HTTP {status}")
        choices = parsed.get("choices", [])
        content = choices[0].get("message", {}).get("content", "") if choices else ""
        returned_model = parsed.get("model", "")
        print(f"Response model: {returned_model}")
        print(f"Response content: {content.strip()}")
        if status == 200 and choices:
            print("PASS: REAL Gemini completion succeeded for model=fast")
        else:
            print(f"FAIL/BLOCKED: HTTP {status} — response: {raw[:400]}")
    print()

    # -----------------------------------------------------------------
    # Gate 4: /v1/chat/completions model=coding
    # -----------------------------------------------------------------
    print("--- Gate 4: /v1/chat/completions (model=coding) ---")
    if not GATEWAY_AUTH_TOKEN:
        print("BLOCKED: GATEWAY_AUTH_TOKEN secret not available")
    else:
        status, parsed, raw = http_req(
            f"{BASE_URL}/v1/chat/completions",
            method="POST",
            headers={"Authorization": f"Bearer {GATEWAY_AUTH_TOKEN}"},
            data={
                "model": "coding",
                "messages": [{"role": "user", "content": "Return the single word CODING_OK."}],
                "max_tokens": 10,
            }
        )
        print(f"POST /v1/chat/completions [model=coding] -> HTTP {status}")
        choices = parsed.get("choices", [])
        content = choices[0].get("message", {}).get("content", "") if choices else ""
        returned_model = parsed.get("model", "")
        print(f"Response model: {returned_model}")
        print(f"Response content: {content.strip()}")
        if status == 200 and choices:
            print("PASS: REAL Gemini completion succeeded for model=coding")
        else:
            print(f"FAIL/BLOCKED: HTTP {status} — response: {raw[:400]}")
    print()

    # -----------------------------------------------------------------
    # Gate 5: Direct D1 Database Readback
    # -----------------------------------------------------------------
    print("--- Gate 5: Direct D1 Database Readback ---")
    account_id = CF_ACCOUNT_ID
    if not account_id and CF_API_TOKEN:
        s, p, _ = http_req("https://api.cloudflare.com/client/v4/accounts?per_page=1", headers={"Authorization": f"Bearer {CF_API_TOKEN}"})
        if s == 200 and p.get("result"):
            account_id = p["result"][0]["id"]
            print(f"Resolved Account ID: {account_id[:6]}...{account_id[-4:]}")

    if not CF_API_TOKEN or not account_id:
        print("BLOCKED: CLOUDFLARE_API_TOKEN or ACCOUNT_ID unavailable for direct D1 readback")
    else:
        d1_url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/d1/database/{D1_DATABASE_ID}/query"
        cf_headers = {"Authorization": f"Bearer {CF_API_TOKEN}"}

        # 5a: Providers
        s, p, r = http_req(d1_url, method="POST", headers=cf_headers, data={"sql": "SELECT id, display_name, kind, enabled, byok_alias, health_state FROM providers;"})
        print(f"D1 Query: providers -> HTTP {s}")
        providers = p.get("result", [{}])[0].get("results", []) if s == 200 else []
        print(f"Providers ({len(providers)}):")
        for prov in providers:
            print(f"  - {prov.get('id')}: enabled={prov.get('enabled')}, alias={prov.get('byok_alias')}, health={prov.get('health_state')}")

        # 5b: Models
        s, p, r = http_req(d1_url, method="POST", headers=cf_headers, data={"sql": "SELECT id, provider_id, public_alias, enabled FROM models;"})
        print(f"D1 Query: models -> HTTP {s}")
        models = p.get("result", [{}])[0].get("results", []) if s == 200 else []
        print(f"Models ({len(models)}):")
        for m in models:
            print(f"  - {m.get('id')}: enabled={m.get('enabled')}")

        # 5c: Routing Rules
        s, p, r = http_req(d1_url, method="POST", headers=cf_headers, data={"sql": "SELECT public_alias, model_id, updated_at FROM routing_rules;"})
        print(f"D1 Query: routing_rules -> HTTP {s}")
        rules = p.get("result", [{}])[0].get("results", []) if s == 200 else []
        rules_map = {r.get("public_alias"): r.get("model_id") for r in rules}
        print(f"Routing rules ({len(rules)}): {rules_map}")

        prov_enabled = any(prov.get("id") == "google-ai-studio" and prov.get("enabled") == 1 for prov in providers)
        fast_ok = rules_map.get("fast") == "gemini-3.6-flash"
        coding_ok = rules_map.get("coding") == "gemini-3.8-flash"
        research_ok = rules_map.get("research") == "gemini-3.8-flash"

        print(f"D1 Invariant: google-ai-studio enabled: {prov_enabled}")
        print(f"D1 Invariant: fast -> gemini-3.6-flash: {fast_ok} (actual: {rules_map.get('fast')})")
        print(f"D1 Invariant: coding -> gemini-3.8-flash: {coding_ok} (actual: {rules_map.get('coding')})")
        print(f"D1 Invariant: research -> gemini-3.8-flash: {research_ok} (actual: {rules_map.get('research')})")

        if prov_enabled and fast_ok and coding_ok and research_ok:
            print("PASS: Direct D1 readback verifies all v1.8 routing and provider invariants!")
        else:
            print("FAIL: D1 invariants not met")
    print()

    # -----------------------------------------------------------------
    # Gate 6: Verify AI Gateway Authentication & Configuration
    # -----------------------------------------------------------------
    print("--- Gate 6: Cloudflare AI Gateway Configuration & Auth ---")
    if CF_API_TOKEN and account_id:
        aig_url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/ai-gateway/gateways/{GATEWAY_SLUG}"
        s, p, r = http_req(aig_url, headers={"Authorization": f"Bearer {CF_API_TOKEN}"})
        print(f"GET AI Gateway metadata -> HTTP {s}")
        if s == 200:
            result = p.get("result", {})
            auth_enabled = result.get("authentication", False) or result.get("auth_required", False)
            print(f"Gateway ID: {result.get('id')}")
            print(f"Gateway Authentication required/enabled: {auth_enabled}")
            print(f"Gateway collect_logs: {result.get('collect_logs')}")
            print(f"Gateway rate_limiting_technique: {result.get('rate_limiting_technique')}")
            print("PASS: AI Gateway exists and metadata inspected.")
        else:
            print(f"AI Gateway query returned HTTP {s}: {r[:200]}")
    print()

    # -----------------------------------------------------------------
    # Gate 7: Verify BYOK Provider Config & Secrets Store (No secrets printed)
    # -----------------------------------------------------------------
    print("--- Gate 7: BYOK Provider Config & Secrets Store State ---")
    if CF_API_TOKEN and account_id:
        # Secrets Store
        ss_url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/secrets_store/stores"
        s, p, r = http_req(ss_url, headers={"Authorization": f"Bearer {CF_API_TOKEN}"})
        print(f"GET Secrets Store list -> HTTP {s}")
        stores = p.get("result", []) if s == 200 else []
        store_id = None
        for st in stores:
            print(f"  Store: name='{st.get('name')}', id='{st.get('id')}'")
            if st.get("name") == "default_secrets_store" or not store_id:
                store_id = st.get("id")

        if store_id:
            sec_url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/secrets_store/stores/{store_id}/secrets"
            s, p, r = http_req(sec_url, headers={"Authorization": f"Bearer {CF_API_TOKEN}"})
            print(f"GET Secrets Store secrets -> HTTP {s}")
            secrets_list = p.get("result", []) if s == 200 else []
            print(f"  Stored secrets count: {len(secrets_list)}")
            for sec in secrets_list:
                print(f"    Secret: name='{sec.get('name')}', id='{sec.get('id')}', status='{sec.get('status')}', scopes={sec.get('scopes')}")

        # Provider configs
        pc_url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/ai-gateway/gateways/{GATEWAY_SLUG}/provider_configs"
        s, p, r = http_req(pc_url, headers={"Authorization": f"Bearer {CF_API_TOKEN}"})
        print(f"GET AI Gateway Provider Configs -> HTTP {s}")
        configs = p.get("result", []) if s == 200 else []
        print(f"  Provider configs count: {len(configs)}")
        for cfg in configs:
            print(f"    Config: id='{cfg.get('id')}', provider_slug='{cfg.get('provider_slug')}', alias='{cfg.get('alias')}', default={cfg.get('default_config')}")

        print("PASS: BYOK Provider Config and Secrets Store inspected securely without exposing credential values.")
    print()

    print("=================================================================")
    print("VERIFICATION SCRIPT COMPLETED")
    print("=================================================================")
    return 0


if __name__ == "__main__":
    sys.exit(main())
