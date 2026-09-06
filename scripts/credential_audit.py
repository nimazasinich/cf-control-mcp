#!/usr/bin/env python3
"""Non-gating, redacted live credential audit for repository/production secrets.

Never prints secret values. Intended for GitHub Actions on trusted same-repository
branches. Results distinguish missing, valid, partial-scope and failed credentials.
"""
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

BASE = "https://cf-control-mcp.amin-chinisaz-edu.workers.dev"
CF_API = "https://api.cloudflare.com/client/v4"
AIG = "https://gateway.ai.cloudflare.com"
APEX_ACCOUNT_ID = "d902b91f0f1076e0601ffd6e7b4382c0"

results: list[dict[str, str]] = []

def val(name: str) -> str:
    return os.environ.get(name, "").strip()

def safe(text: str) -> str:
    text = str(text).replace("\n", " ").replace("\r", " ").replace("|", "/")
    return text[:220]

def record(name: str, present: bool, status: str, evidence: str) -> None:
    row = {"name": name, "present": "yes" if present else "no", "status": status, "evidence": safe(evidence)}
    results.append(row)
    print(f"AUDIT {status:7} {name}: {row['evidence']}")

def req(url: str, *, method: str = "GET", headers: dict[str, str] | None = None, body: Any = None, timeout: int = 25) -> tuple[int, dict[str, Any], str]:
    h = {"User-Agent": "cf-control-credential-audit/1.0", **(headers or {})}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        h.setdefault("Content-Type", "application/json")
    request = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8", errors="replace")
            try:
                parsed = json.loads(raw) if raw else {}
            except Exception:
                parsed = {}
            return response.status, parsed, raw
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(raw) if raw else {}
        except Exception:
            parsed = {}
        return exc.code, parsed, raw
    except Exception as exc:
        return 0, {}, type(exc).__name__

def cf_verify(name: str, token: str, account_id: str = "") -> None:
    if not token:
        record(name, False, "MISSING", "secret not configured")
        return
    code, payload, _ = req(f"{CF_API}/user/tokens/verify", headers={"Authorization": f"Bearer {token}"})
    state = payload.get("result", {}).get("status", "unknown")
    if code != 200 or state != "active":
        record(name, True, "FAIL", f"token verify HTTP={code} status={state}")
        return
    if account_id:
        acode, _, _ = req(f"{CF_API}/accounts/{account_id}", headers={"Authorization": f"Bearer {token}"})
        record(name, True, "PASS" if acode == 200 else "PARTIAL", f"active token; account access HTTP={acode}")
    else:
        record(name, True, "PASS", "active token; account scope not supplied")

def main() -> int:
    cf_account = val("CLOUDFLARE_ACCOUNT_ID")
    cf_mgmt = val("CLOUDFLARE_API_TOKEN")

    # Primary Cloudflare management credential and required scopes.
    cf_verify("CLOUDFLARE_API_TOKEN", cf_mgmt, cf_account)
    if cf_mgmt and cf_account:
        h = {"Authorization": f"Bearer {cf_mgmt}"}
        scopes = {
            "Workers": f"{CF_API}/accounts/{cf_account}/workers/scripts",
            "D1": f"{CF_API}/accounts/{cf_account}/d1/database",
            "AI_GATEWAY": f"{CF_API}/accounts/{cf_account}/ai-gateway/gateways",
            "SECRETS_STORE": f"{CF_API}/accounts/{cf_account}/secrets_store/stores",
        }
        for label, url in scopes.items():
            code, _, _ = req(url, headers=h)
            record(f"CLOUDFLARE_API_TOKEN:{label}", True, "PASS" if code == 200 else "FAIL", f"HTTP={code}")
        acode, _, _ = req(f"{CF_API}/accounts/{cf_account}", headers=h)
        record("CLOUDFLARE_ACCOUNT_ID", True, "PASS" if acode == 200 else "FAIL", f"validated via management token HTTP={acode}")
    else:
        record("CLOUDFLARE_ACCOUNT_ID", bool(cf_account), "BLOCKED", "requires account ID and management token")

    # AI Gateway runtime tokens: legacy and canonical names.
    for name in ("CF_AIG_AUTHORIZATION", "CF_AIG_TOKEN"):
        token = val(name)
        if not token:
            record(name, False, "MISSING", "secret not configured")
            continue
        if not cf_account:
            record(name, True, "BLOCKED", "CLOUDFLARE_ACCOUNT_ID missing")
            continue
        code, payload, _ = req(
            f"{AIG}/v1/{cf_account}/cf-control-mcp/compat/chat/completions",
            method="POST",
            headers={"cf-aig-authorization": f"Bearer {token}"},
            body={"model": "google-ai-studio/gemini-3.6-flash", "messages": [{"role": "user", "content": "Reply AIG_OK"}], "max_tokens": 8},
            timeout=40,
        )
        choices = payload.get("choices", []) if isinstance(payload, dict) else []
        record(name, True, "PASS" if code == 200 and choices else "FAIL", f"real BYOK inference HTTP={code}; choices={len(choices)}")

    # APEX and probe candidates.
    cf_verify("CF_TOKEN5", val("CF_TOKEN5"), APEX_ACCOUNT_ID)
    cf_verify("APEX_CLOUDFLARE_DEPLOY_TOKEN", val("APEX_CLOUDFLARE_DEPLOY_TOKEN"), APEX_ACCOUNT_ID)
    probe_account = val("PROBE_ACCOUNT_ID2")
    cf_verify("PROBE_TOKEN_F", val("PROBE_TOKEN_F"), probe_account)
    cf_verify("PROBE_TOKEN_G", val("PROBE_TOKEN_G"), probe_account)
    record("PROBE_ACCOUNT_ID2", bool(probe_account), "INFO" if probe_account else "MISSING", "paired identifier for F/G probe credentials")

    # Provider Gateway auth, old and canonical names.
    for name in ("GATEWAY_AUTH_TOKEN", "PROVIDER_GATEWAY_AUTH_TOKEN"):
        token = val(name)
        if not token:
            record(name, False, "MISSING", "secret not configured")
            continue
        code, payload, _ = req(f"{BASE}/v1/models", headers={"Authorization": f"Bearer {token}"})
        count = len(payload.get("data", [])) if isinstance(payload, dict) else 0
        record(name, True, "PASS" if code == 200 and count else "FAIL", f"/v1/models HTTP={code}; models={count}")

    # MCP owner/legacy auth.
    mcp = val("MCP_AUTH_TOKEN")
    if mcp:
        headers = {"Authorization": f"Bearer {mcp}"}
        icode, ip, _ = req(f"{BASE}/mcp", method="POST", headers=headers, body={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "credential-audit", "version": "1"}}})
        tcode, tp, _ = req(f"{BASE}/mcp", method="POST", headers=headers, body={"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
        protocol = ip.get("result", {}).get("protocolVersion", "") if isinstance(ip, dict) else ""
        tools = len(tp.get("result", {}).get("tools", [])) if isinstance(tp, dict) else 0
        record("MCP_AUTH_TOKEN", True, "PASS" if icode == 200 and tcode == 200 and tools else "FAIL", f"initialize HTTP={icode} protocol={protocol}; tools/list HTTP={tcode} count={tools}")
    else:
        record("MCP_AUTH_TOKEN", False, "MISSING", "secret not configured")

    # Hugging Face.
    hf = val("HUGGINGFACE_TOKEN")
    if hf:
        code, _, _ = req("https://huggingface.co/api/whoami-v2", headers={"Authorization": f"Bearer {hf}"})
        record("HUGGINGFACE_TOKEN", True, "PASS" if code == 200 else "FAIL", f"whoami-v2 HTTP={code}")
    else:
        record("HUGGINGFACE_TOKEN", False, "MISSING", "secret not configured")

    # GitHub runner PAT and repo, old/canonical pairs.
    def test_gh(name: str, token: str, repo: str) -> None:
        if not token:
            record(name, False, "MISSING", "secret not configured")
            return
        ucode, _, _ = req("https://api.github.com/user", headers={"Authorization": f"Bearer {token}", "X-GitHub-Api-Version": "2022-11-28"})
        rcode = 0
        clean = re.sub(r"^(?:https?://github\.com/|git@github\.com:)", "", repo.strip()).removesuffix(".git").rstrip("/") if repo else ""
        if clean and "/" in clean:
            rcode, _, _ = req(f"https://api.github.com/repos/{clean}", headers={"Authorization": f"Bearer {token}", "X-GitHub-Api-Version": "2022-11-28"})
        ok = ucode == 200 and (not clean or rcode == 200)
        record(name, True, "PASS" if ok else "FAIL", f"user HTTP={ucode}; repo HTTP={rcode}")

    old_repo = val("GH_RUNNER_REPO")
    new_repo = val("GITHUB_RUNNER_REPO") or old_repo
    test_gh("GH_RUNNER_PAT", val("GH_RUNNER_PAT"), old_repo)
    test_gh("GITHUB_RUNNER_PAT", val("GITHUB_RUNNER_PAT"), new_repo)
    record("GH_RUNNER_REPO", bool(old_repo), "INFO" if old_repo else "MISSING", "identifier; access tested with GH_RUNNER_PAT")
    record("GITHUB_RUNNER_REPO", bool(val("GITHUB_RUNNER_REPO")), "INFO" if val("GITHUB_RUNNER_REPO") else "MISSING", "canonical identifier")

    # Vercel tokens.
    for name in ("VERCEL_TOKEN", "VERCEL_TEAM_TOKEN"):
        token = val(name)
        if not token:
            record(name, False, "MISSING", "secret not configured")
            continue
        code, _, _ = req("https://api.vercel.com/v2/user", headers={"Authorization": f"Bearer {token}"})
        record(name, True, "PASS" if code == 200 else "FAIL", f"/v2/user HTTP={code}")

    Path("credential-audit.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    md = ["# Credential Audit — redacted", "", "| Credential | Present | Status | Evidence |", "|---|---:|---|---|"]
    md.extend(f"| `{r['name']}` | {r['present']} | **{r['status']}** | {r['evidence']} |" for r in results)
    Path("credential-audit.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    print("\n" + "\n".join(md))
    # Non-gating by design: legacy/candidate failures must not block normal CI.
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
