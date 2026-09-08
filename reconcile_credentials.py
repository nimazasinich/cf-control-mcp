#!/usr/bin/env python3
"""
cf-control-mcp credential + branch reconciliation orchestrator v1.2
===============================================================

Purpose
-------
Run this script INSIDE your local cf-control-mcp repository, where outbound
Internet/Cloudflare/GitHub access is available.

It is designed for the current multi-branch state of:
    nimazasinich/cf-control-mcp

What it does
------------
AUDIT (default, no remote mutation):
  1. Load the user-supplied .env without printing secret values.
  2. Canonicalize safe aliases while preserving legacy names.
  3. Fetch/scan remote branches for legacy secret-name dependencies.
  4. Live-test:
       - Cloudflare management API + Workers + D1 + AI Gateway + Secrets Store
       - Cloudflare AI Gateway runtime token via real BYOK Gemini inference
       - MCP initialize + tools/list
       - Provider Gateway /v1/models + fast/coding if auth token is locally available
       - Hugging Face token
       - GitHub token/repository access
       - Vercel tokens
       - Google AI Studio key (optional direct models check)
       - scoped/legacy Cloudflare tokens (best-effort, non-destructive)
  5. Write:
       - credential-reconcile-report.json
       - credential-reconcile-report.md
       - cf-control-mcp.env.runtime-tested

APPLY (--apply):
  6. Install CF_AIG_TOKEN directly as a Worker secret (secret via stdin).
  7. Create/update GitHub canonical repository secret CF_AIG_TOKEN.
  8. Create/update GitHub Actions Variables:
       CLOUDFLARE_ACCOUNT_ID
       GITHUB_RUNNER_REPO
  9. If a real local GATEWAY_AUTH_TOKEN / PROVIDER_GATEWAY_AUTH_TOKEN exists,
       create/update PROVIDER_GATEWAY_AUTH_TOKEN.
 10. Optionally patch workflow references on the target branch to dual-read
       canonical + legacy names, preserving compatibility.
 11. Run local typecheck/tests/python compile.
 12. Push workflow patches. It first tries normal `git push`; if unavailable,
       it falls back to the GitHub Contents API.
 13. Dispatch verify-only.yml and optionally wait for completion.

IMPORTANT SAFETY BEHAVIOR
-------------------------
- NEVER prints secret values.
- NEVER puts secrets in git commits.
- NEVER deletes or revokes legacy secrets automatically.
- NEVER promotes CF_TOKEN5 / APEX token if account access is not proven.
- NEVER overwrites a working GitHub-only secret with an invented value.
- Keeps old secret names available while divergent branches still reference them.
- Fails closed on required production gates.

Recommended command
-------------------
Windows PowerShell:
    python scripts\\reconcile_credentials.py ^
      --env-file .\\cf-control-mcp.env.full-secrets ^
      --target-branch main ^
      --apply ^
      --patch-workflows ^
      --dispatch-verify ^
      --wait-actions

Or, if this script is placed in repository root:
    python .\\reconcile_credentials.py --env-file .\\cf-control-mcp.env.full-secrets --apply --patch-workflows --dispatch-verify --wait-actions
"""

from __future__ import annotations

import argparse
import base64
import dataclasses
import datetime as dt
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Iterable

DEFAULT_REPO = "nimazasinich/cf-control-mcp"
# NOTE: previously hardcoded to "fix/v1.8-fail-closed-acceptance". That branch
# was merged into main long ago and never updated since, so it still contains
# the pre-fix (buggy) scripts/verify_production.py `is True` check. Patching
# workflows or dispatching verify-only.yml against that stale branch re-runs
# old, already-fixed bugs and fails forever regardless of what's on main.
DEFAULT_BRANCH = "main"
DEFAULT_WORKER = "cf-control-mcp"
DEFAULT_GATEWAY = "cf-control-mcp"
DEFAULT_PROD_BASE = "https://cf-control-mcp.amin-chinisaz-edu.workers.dev"
DEFAULT_GOOGLE_MODEL = "google-ai-studio/gemini-3.6-flash"

LEGACY_NAMES = [
    "CF_AIG_AUTHORIZATION",
    "CF_TOKEN5",
    "GATEWAY_AUTH_TOKEN",
    "GH_RUNNER_PAT",
    "GH_RUNNER_REPO",
    "PROBE_ACCOUNT_ID2",
    "PROBE_TOKEN_F",
    "PROBE_TOKEN_G",
]

CANONICAL_NAMES = [
    "CF_AIG_TOKEN",
    "APEX_CLOUDFLARE_DEPLOY_TOKEN",
    "PROVIDER_GATEWAY_AUTH_TOKEN",
    "GITHUB_RUNNER_PAT",
    "GITHUB_RUNNER_REPO",
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
    "MCP_AUTH_TOKEN",
    "HUGGINGFACE_TOKEN",
    "VERCEL_TOKEN",
]

WORKFLOW_REPLACEMENTS = {
    # Keep runtime variable names unchanged; only normalize Actions secret/variable sources.
    "secrets.CF_AIG_AUTHORIZATION":
        "secrets.CF_AIG_TOKEN || secrets.CF_AIG_AUTHORIZATION",
    "secrets.GATEWAY_AUTH_TOKEN":
        "secrets.PROVIDER_GATEWAY_AUTH_TOKEN || secrets.GATEWAY_AUTH_TOKEN",
    "secrets.GH_RUNNER_PAT":
        "secrets.GITHUB_RUNNER_PAT || secrets.GH_RUNNER_PAT",
    "secrets.GH_RUNNER_REPO":
        "vars.GITHUB_RUNNER_REPO || secrets.GITHUB_RUNNER_REPO || secrets.GH_RUNNER_REPO",
    "secrets.CLOUDFLARE_ACCOUNT_ID":
        "vars.CLOUDFLARE_ACCOUNT_ID || secrets.CLOUDFLARE_ACCOUNT_ID",
    "secrets.CF_TOKEN5":
        "secrets.APEX_CLOUDFLARE_DEPLOY_TOKEN || secrets.CF_TOKEN5",
}

# ---------------------------------------------------------------------------
# Logging / redaction
# ---------------------------------------------------------------------------

SECRET_VALUES: list[str] = []

def register_secret(value: str | None) -> None:
    if value and len(value) >= 8 and value not in SECRET_VALUES:
        SECRET_VALUES.append(value)

def redact(value: Any) -> str:
    s = str(value)
    for secret in sorted(SECRET_VALUES, key=len, reverse=True):
        if secret:
            s = s.replace(secret, "<REDACTED>")
    s = re.sub(r"(?:cfut_|ghp_|github_pat_|hf_|vck_)[A-Za-z0-9_.-]{8,}", "<REDACTED>", s)
    return s

def log(msg: str) -> None:
    print(redact(msg), flush=True)

def section(title: str) -> None:
    print("\n" + "=" * 78)
    print(title)
    print("=" * 78, flush=True)

# ---------------------------------------------------------------------------
# .env loader / canonicalization
# ---------------------------------------------------------------------------

def parse_env_file(path: Path) -> dict[str, str]:
    text = path.read_text(encoding="utf-8-sig", errors="replace")
    out: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        out[key] = value
        register_secret(value if looks_secretish(key, value) else None)
    return out

def looks_secretish(key: str, value: str) -> bool:
    k = key.upper()
    if not value:
        return False
    if any(word in k for word in ("TOKEN", "SECRET", "KEY", "AUTH", "PAT")):
        return True
    return bool(re.match(r"^(?:cfut_|ghp_|github_pat_|hf_|vck_)", value))

def first_nonempty(env: dict[str, str], *names: str) -> str:
    for n in names:
        v = env.get(n, "").strip()
        if v and not v.startswith("<"):
            return v
    return ""

def canonicalize(env: dict[str, str], repo: str) -> dict[str, str]:
    c = dict(env)

    # Primary management token: do NOT fall back to cluadflairapi because that
    # source represented a different scoped token in the supplied files.
    c["CLOUDFLARE_API_TOKEN"] = first_nonempty(
        c, "CLOUDFLARE_API_TOKEN", "CF_API_TOKEN"
    )
    c["CF_API_TOKEN"] = c.get("CF_API_TOKEN") or c["CLOUDFLARE_API_TOKEN"]

    c["CLOUDFLARE_ACCOUNT_ID"] = first_nonempty(
        c, "CLOUDFLARE_ACCOUNT_ID", "CF_ACCOUNT_ID"
    )
    c["CF_ACCOUNT_ID"] = c.get("CF_ACCOUNT_ID") or c["CLOUDFLARE_ACCOUNT_ID"]

    c["CF_AIG_TOKEN"] = first_nonempty(
        c, "CF_AIG_TOKEN", "CF_AIG_AUTHORIZATION", "cf-aig-authorization"
    )
    if c["CF_AIG_TOKEN"]:
        # Compatibility only; keep old name while divergent branches exist.
        c["CF_AIG_AUTHORIZATION"] = c.get("CF_AIG_AUTHORIZATION") or c["CF_AIG_TOKEN"]

    c["PROVIDER_GATEWAY_AUTH_TOKEN"] = first_nonempty(
        c, "PROVIDER_GATEWAY_AUTH_TOKEN", "GATEWAY_AUTH_TOKEN"
    )

    c["MCP_ENDPOINT"] = first_nonempty(c, "MCP_ENDPOINT")
    if not c["MCP_ENDPOINT"] and c.get("MCP endpoint"):
        c["MCP_ENDPOINT"] = c["MCP endpoint"]

    c["MCP_BASE_URL"] = first_nonempty(c, "MCP_BASE_URL")
    if not c["MCP_BASE_URL"] and c.get("MCP_ENDPOINT"):
        c["MCP_BASE_URL"] = c["MCP_ENDPOINT"].removesuffix("/mcp")

    c["HUGGINGFACE_TOKEN"] = first_nonempty(
        c, "HUGGINGFACE_TOKEN", "huggingfacetoken"
    )
    c["GITHUB_TOKEN"] = first_nonempty(c, "GITHUB_TOKEN", "github_token")
    c["VERCEL_TEAM_TOKEN"] = first_nonempty(
        c, "VERCEL_TEAM_TOKEN", "Team_VERCEL_TOKEN"
    )
    c["GOOGLE_AI_STUDIO_KEY"] = first_nonempty(
        c, "GOOGLE_AI_STUDIO_KEY", "aistudioApi"
    )

    c["GITHUB_RUNNER_REPO"] = first_nonempty(
        c, "GITHUB_RUNNER_REPO", "GH_RUNNER_REPO"
    ) or repo

    # Do NOT automatically treat GITHUB_TOKEN as the production runner PAT for
    # remote mutation. The supplied compatibility env may intentionally alias it.
    c["GITHUB_RUNNER_PAT"] = first_nonempty(
        c, "GITHUB_RUNNER_PAT", "GH_RUNNER_PAT"
    )

    c["APEX_CLOUDFLARE_DEPLOY_TOKEN"] = first_nonempty(
        c, "APEX_CLOUDFLARE_DEPLOY_TOKEN", "CF_TOKEN5"
    )

    for value in c.values():
        if looks_secretish("", value):
            register_secret(value)
    return c

# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

@dataclasses.dataclass
class HttpResult:
    status: int
    headers: dict[str, str]
    body: str
    json: Any = None

def http(
    url: str,
    *,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    json_body: Any = None,
    raw_body: bytes | None = None,
    timeout: int = 35,
) -> HttpResult:
    hdrs = {"User-Agent": "cf-control-mcp-reconciler/1.0"}
    if headers:
        hdrs.update(headers)
    body = raw_body
    if json_body is not None:
        body = json.dumps(json_body).encode("utf-8")
        hdrs.setdefault("Content-Type", "application/json")
    req = urllib.request.Request(url, data=body, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            text = r.read().decode("utf-8", errors="replace")
            try:
                parsed = json.loads(text) if text.strip() else None
            except Exception:
                parsed = None
            return HttpResult(r.status, dict(r.headers.items()), text, parsed)
    except urllib.error.HTTPError as exc:
        text = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(text) if text.strip() else None
        except Exception:
            parsed = None
        return HttpResult(exc.code, dict(exc.headers.items()), text, parsed)
    except Exception as exc:
        return HttpResult(0, {}, str(exc), None)

def auth_bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}

# Transient upstream statuses (rate limiting / momentary overload) that must
# NOT be treated the same as a real configuration/auth failure. Google's
# preview Gemini models in particular have tight per-minute quotas, and a
# single 429 here does not mean CF_AIG_TOKEN or the BYOK provider config is
# broken -- it means "try again in a moment". Without a retry, this single
# transient response was permanently blocking --apply even though the very
# next live check (ProviderGateway:fast/coding, same underlying BYOK path)
# succeeded seconds later.
TRANSIENT_HTTP_STATUSES = {429, 500, 502, 503, 504}

def http_retry(
    url: str,
    *,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    json_body: Any = None,
    raw_body: bytes | None = None,
    timeout: int = 35,
    attempts: int = 3,
    base_delay: float = 2.0,
) -> HttpResult:
    """Like http(), but retries transient statuses with backoff.

    Honors a numeric Retry-After header when present; otherwise backs off as
    base_delay * 2**attempt (2s, 4s, 8s by default). The final attempt's
    result (success or failure) is always returned.
    """
    result: HttpResult | None = None
    for attempt in range(attempts):
        result = http(
            url,
            method=method,
            headers=headers,
            json_body=json_body,
            raw_body=raw_body,
            timeout=timeout,
        )
        if result.status not in TRANSIENT_HTTP_STATUSES:
            return result
        if attempt == attempts - 1:
            return result
        retry_after_raw = (result.headers or {}).get("Retry-After", "")
        try:
            delay = float(retry_after_raw)
        except (TypeError, ValueError):
            delay = base_delay * (2 ** attempt)
        delay = max(delay, 0.5)
        log(
            f"INFO: transient HTTP {result.status} from {url.split('?')[0]}; "
            f"retrying in {delay:.1f}s (attempt {attempt + 1}/{attempts})"
        )
        time.sleep(delay)
    assert result is not None
    return result

def error_detail(r: HttpResult) -> str:
    """Extract a short, redacted human-readable error message from a response.

    Without this, a FAIL only ever recorded "HTTP=429; choices=0" -- never
    saying *why* -- so every failure looked identical whether it was a bad
    token, a missing config, or a transient rate limit.
    """
    if not isinstance(r.json, dict):
        return redact(r.body[:200]) if r.body else ""
    err = r.json.get("error")
    if err is None:
        return ""
    msg = err.get("message", str(err)) if isinstance(err, dict) else str(err)
    return redact(str(msg))[:200]

def parse_json_or_sse(text: str) -> Any:
    s = text.strip()
    if not s:
        return None
    try:
        return json.loads(s)
    except Exception:
        pass
    for line in s.splitlines():
        line = line.strip()
        if line.startswith("data:"):
            payload = line[5:].strip()
            if payload == "[DONE]":
                continue
            try:
                return json.loads(payload)
            except Exception:
                continue
    return None

# ---------------------------------------------------------------------------
# GitHub API helpers
# ---------------------------------------------------------------------------

class GitHubAPI:
    def __init__(self, repo: str, token: str):
        self.repo = repo
        self.token = token
        self.base = f"https://api.github.com/repos/{repo}"
        register_secret(token)

    @property
    def headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }

    def req(self, path_or_url: str, *, method="GET", body=None) -> HttpResult:
        url = path_or_url if path_or_url.startswith("http") else self.base + path_or_url
        return http(url, method=method, headers=self.headers, json_body=body)

    def list_secret_names(self) -> set[str]:
        r = self.req("/actions/secrets?per_page=100")
        if r.status != 200 or not isinstance(r.json, dict):
            return set()
        return {x.get("name") for x in r.json.get("secrets", []) if x.get("name")}

    def repo_public_key(self) -> tuple[str, str]:
        r = self.req("/actions/secrets/public-key")
        if r.status != 200 or not isinstance(r.json, dict):
            raise RuntimeError(f"GitHub public-key lookup failed: HTTP {r.status}")
        return r.json["key_id"], r.json["key"]

    def set_secret(self, name: str, value: str) -> None:
        if not value:
            raise ValueError(f"refusing to set empty GitHub secret {name}")
        try:
            from nacl import encoding, public
        except ImportError as exc:
            raise RuntimeError(
                "PyNaCl is required for GitHub secret encryption. "
                "Run: python -m pip install pynacl"
            ) from exc
        key_id, key_b64 = self.repo_public_key()
        public_key = public.PublicKey(key_b64.encode("utf-8"), encoding.Base64Encoder())
        sealed_box = public.SealedBox(public_key)
        encrypted = sealed_box.encrypt(value.encode("utf-8"))
        enc_b64 = base64.b64encode(encrypted).decode("ascii")
        r = self.req(
            f"/actions/secrets/{urllib.parse.quote(name)}",
            method="PUT",
            body={"encrypted_value": enc_b64, "key_id": key_id},
        )
        if r.status not in (201, 204):
            raise RuntimeError(f"setting GitHub secret {name} failed: HTTP {r.status}")
        log(f"PASS: GitHub secret {name} created/updated")

    def set_variable(self, name: str, value: str) -> None:
        if not value:
            raise ValueError(f"refusing to set empty GitHub variable {name}")
        existing = self.req("/actions/variables?per_page=100")
        names = set()
        if existing.status == 200 and isinstance(existing.json, dict):
            names = {x.get("name") for x in existing.json.get("variables", [])}
        if name in names:
            r = self.req(
                f"/actions/variables/{urllib.parse.quote(name)}",
                method="PATCH",
                body={"name": name, "value": value},
            )
            ok = r.status == 204
        else:
            r = self.req(
                "/actions/variables",
                method="POST",
                body={"name": name, "value": value},
            )
            ok = r.status == 201
        if not ok:
            raise RuntimeError(f"setting GitHub variable {name} failed: HTTP {r.status}")
        log(f"PASS: GitHub Actions variable {name} created/updated")

    def dispatch(self, workflow: str, ref: str) -> None:
        r = self.req(
            f"/actions/workflows/{urllib.parse.quote(workflow)}/dispatches",
            method="POST",
            body={"ref": ref},
        )
        if r.status != 204:
            raise RuntimeError(
                f"workflow dispatch {workflow}@{ref} failed: HTTP {r.status}"
            )
        log(f"PASS: dispatched {workflow} on {ref}")

    def recent_workflow_runs(self, workflow: str, branch: str, event="workflow_dispatch") -> list[dict]:
        q = urllib.parse.urlencode(
            {"branch": branch, "event": event, "per_page": 10}
        )
        r = self.req(f"/actions/workflows/{urllib.parse.quote(workflow)}/runs?{q}")
        if r.status != 200 or not isinstance(r.json, dict):
            return []
        return r.json.get("workflow_runs", [])

    def wait_for_dispatched_run(
        self,
        workflow: str,
        branch: str,
        not_before: dt.datetime,
        timeout_sec: int = 900,
    ) -> dict | None:
        deadline = time.time() + timeout_sec
        selected: dict | None = None
        while time.time() < deadline:
            runs = self.recent_workflow_runs(workflow, branch)
            for run in runs:
                created = run.get("created_at")
                if not created:
                    continue
                try:
                    when = dt.datetime.fromisoformat(created.replace("Z", "+00:00"))
                except Exception:
                    continue
                if when >= not_before - dt.timedelta(seconds=5):
                    selected = run
                    break
            if selected:
                break
            time.sleep(5)
        if not selected:
            return None

        run_id = selected["id"]
        while time.time() < deadline:
            r = self.req(f"/actions/runs/{run_id}")
            if r.status == 200 and isinstance(r.json, dict):
                status = r.json.get("status")
                conclusion = r.json.get("conclusion")
                log(f"workflow run {run_id}: status={status} conclusion={conclusion}")
                if status == "completed":
                    return r.json
            time.sleep(8)
        return None

    def get_contents(self, path: str, branch: str) -> dict | None:
        q = urllib.parse.urlencode({"ref": branch})
        r = self.req(f"/contents/{urllib.parse.quote(path, safe='/')}?{q}")
        if r.status != 200 or not isinstance(r.json, dict):
            return None
        return r.json

    def update_text_file(self, path: str, branch: str, content: str, message: str) -> None:
        current = self.get_contents(path, branch)
        if not current or "sha" not in current:
            raise RuntimeError(f"could not fetch {path} on {branch} for API update")
        body = {
            "message": message,
            "content": base64.b64encode(content.encode("utf-8")).decode("ascii"),
            "sha": current["sha"],
            "branch": branch,
        }
        r = self.req(
            f"/contents/{urllib.parse.quote(path, safe='/')}",
            method="PUT",
            body=body,
        )
        if r.status not in (200, 201):
            raise RuntimeError(f"GitHub file update failed {path}: HTTP {r.status}")
        log(f"PASS: pushed {path} through GitHub Contents API")

# ---------------------------------------------------------------------------
# Result model
# ---------------------------------------------------------------------------

@dataclasses.dataclass
class Check:
    name: str
    status: str
    evidence: str

class Results:
    def __init__(self):
        self.items: list[Check] = []

    def add(self, name: str, status: str, evidence: str) -> None:
        c = Check(name, status, redact(evidence))
        self.items.append(c)
        log(f"{status:8} {name}: {c.evidence}")

    def by_name(self, name: str) -> Check | None:
        return next((x for x in self.items if x.name == name), None)

    def to_json(self) -> list[dict[str, str]]:
        return [dataclasses.asdict(x) for x in self.items]

# ---------------------------------------------------------------------------
# Live credential checks
# ---------------------------------------------------------------------------

def test_cloudflare_management(env: dict[str, str], results: Results) -> None:
    token = env.get("CLOUDFLARE_API_TOKEN", "")
    account = env.get("CLOUDFLARE_ACCOUNT_ID", "")
    if not token:
        results.add("CLOUDFLARE_API_TOKEN", "MISSING", "not present locally")
        return

    r = http(
        "https://api.cloudflare.com/client/v4/user/tokens/verify",
        headers=auth_bearer(token),
    )
    active = (
        r.status == 200
        and isinstance(r.json, dict)
        and (r.json.get("result") or {}).get("status") == "active"
    )
    results.add(
        "CLOUDFLARE_API_TOKEN",
        "PASS" if active else "FAIL",
        f"token verify HTTP={r.status}; active={active}",
    )

    if not account:
        results.add("CLOUDFLARE_ACCOUNT_ID", "MISSING", "not present locally")
        return

    endpoints = {
        "Cloudflare:account": f"https://api.cloudflare.com/client/v4/accounts/{account}",
        "Cloudflare:Workers": f"https://api.cloudflare.com/client/v4/accounts/{account}/workers/scripts",
        "Cloudflare:D1": f"https://api.cloudflare.com/client/v4/accounts/{account}/d1/database",
        "Cloudflare:AI_GATEWAY": f"https://api.cloudflare.com/client/v4/accounts/{account}/ai-gateway/gateways",
        "Cloudflare:SECRETS_STORE": f"https://api.cloudflare.com/client/v4/accounts/{account}/secrets_store/stores",
    }
    for name, url in endpoints.items():
        rr = http(url, headers=auth_bearer(token))
        results.add(name, "PASS" if rr.status == 200 else "FAIL", f"HTTP={rr.status}")

def test_cf_aig(env: dict[str, str], results: Results, gateway_slug: str) -> None:
    token = env.get("CF_AIG_TOKEN", "")
    account = env.get("CLOUDFLARE_ACCOUNT_ID", "")
    if not token or not account:
        results.add(
            "CF_AIG_TOKEN",
            "MISSING",
            "CF_AIG_TOKEN or CLOUDFLARE_ACCOUNT_ID missing",
        )
        return
    url = (
        f"https://gateway.ai.cloudflare.com/v1/{account}/"
        f"{gateway_slug}/compat/chat/completions"
    )
    r = http_retry(
        url,
        method="POST",
        headers={"cf-aig-authorization": f"Bearer {token}"},
        json_body={
            "model": DEFAULT_GOOGLE_MODEL,
            "messages": [{"role": "user", "content": "Return exactly AIG_OK."}],
            "max_tokens": 12,
        },
        timeout=60,
    )
    choices = []
    if isinstance(r.json, dict):
        choices = r.json.get("choices", []) or []
    ok = r.status == 200 and bool(choices)
    evidence = f"real BYOK inference HTTP={r.status}; choices={len(choices)}"
    if not ok:
        detail = error_detail(r)
        if detail:
            evidence += f"; error={detail!r}"
        if r.status in TRANSIENT_HTTP_STATUSES:
            evidence += " (transient upstream status after retries; not a config/auth problem)"
    results.add("CF_AIG_TOKEN", "PASS" if ok else "FAIL", evidence)

def test_provider_gateway(env: dict[str, str], results: Results, prod_base: str) -> None:
    token = env.get("PROVIDER_GATEWAY_AUTH_TOKEN", "")
    if not token:
        results.add(
            "PROVIDER_GATEWAY_AUTH_TOKEN",
            "SKIP",
            "not present locally; preserve existing GitHub-only GATEWAY_AUTH_TOKEN",
        )
        return
    h = auth_bearer(token)
    r = http(f"{prod_base}/v1/models", headers=h)
    models = []
    if isinstance(r.json, dict):
        models = [x.get("id") for x in r.json.get("data", []) if isinstance(x, dict)]
    results.add(
        "ProviderGateway:/v1/models",
        "PASS" if r.status == 200 and len(models) >= 1 else "FAIL",
        f"HTTP={r.status}; models={len(models)}",
    )

    for alias in ("fast", "coding"):
        rr = http_retry(
            f"{prod_base}/v1/chat/completions",
            method="POST",
            headers=h,
            json_body={
                "model": alias,
                "messages": [{"role": "user", "content": f"Return exactly {alias.upper()}_OK."}],
                "max_tokens": 12,
            },
            timeout=60,
        )
        choices = rr.json.get("choices", []) if isinstance(rr.json, dict) else []
        ok = rr.status == 200 and bool(choices)
        evidence = f"HTTP={rr.status}; choices={len(choices)}"
        if not ok:
            detail = error_detail(rr)
            if detail:
                evidence += f"; error={detail!r}"
        results.add(f"ProviderGateway:{alias}", "PASS" if ok else "FAIL", evidence)

def test_mcp(env: dict[str, str], results: Results) -> None:
    endpoint = env.get("MCP_ENDPOINT", "")
    token = env.get("MCP_AUTH_TOKEN", "")
    if not endpoint or not token:
        results.add("MCP", "MISSING", "MCP_ENDPOINT or MCP_AUTH_TOKEN missing")
        return
    headers = {
        **auth_bearer(token),
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json",
    }
    init = http(
        endpoint,
        method="POST",
        headers=headers,
        json_body={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": "credential-reconciler", "version": "1.0"},
            },
        },
    )
    init_json = init.json or parse_json_or_sse(init.body)
    session_id = (
        init.headers.get("Mcp-Session-Id")
        or init.headers.get("mcp-session-id")
        or ""
    )
    proto = ""
    if isinstance(init_json, dict):
        proto = ((init_json.get("result") or {}).get("protocolVersion") or "")
    ok_init = init.status == 200 and bool(init_json)
    results.add(
        "MCP:initialize",
        "PASS" if ok_init else "FAIL",
        f"HTTP={init.status}; protocol={proto or 'unknown'}",
    )
    if not ok_init:
        return

    h2 = dict(headers)
    if session_id:
        h2["Mcp-Session-Id"] = session_id

    # initialized notification is best-effort.
    http(
        endpoint,
        method="POST",
        headers=h2,
        json_body={"jsonrpc": "2.0", "method": "notifications/initialized"},
    )

    tools = http(
        endpoint,
        method="POST",
        headers=h2,
        json_body={"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
    )
    tools_json = tools.json or parse_json_or_sse(tools.body)
    rows = []
    if isinstance(tools_json, dict):
        rows = ((tools_json.get("result") or {}).get("tools") or [])
    results.add(
        "MCP:tools/list",
        "PASS" if tools.status == 200 and len(rows) == 44 else "FAIL",
        f"HTTP={tools.status}; tool_count={len(rows)}",
    )

def test_huggingface(env: dict[str, str], results: Results) -> None:
    token = env.get("HUGGINGFACE_TOKEN", "")
    if not token:
        results.add("HUGGINGFACE_TOKEN", "MISSING", "not present locally")
        return
    r = http("https://huggingface.co/api/whoami-v2", headers=auth_bearer(token))
    results.add("HUGGINGFACE_TOKEN", "PASS" if r.status == 200 else "FAIL", f"whoami-v2 HTTP={r.status}")

def test_github(env: dict[str, str], results: Results, repo: str) -> None:
    token = env.get("GITHUB_TOKEN", "")
    if not token:
        results.add("GITHUB_TOKEN", "MISSING", "not present locally")
        return
    h = {
        **auth_bearer(token),
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    user = http("https://api.github.com/user", headers=h)
    rp = http(f"https://api.github.com/repos/{repo}", headers=h)
    results.add(
        "GITHUB_TOKEN",
        "PASS" if user.status == 200 and rp.status == 200 else "FAIL",
        f"user HTTP={user.status}; repo HTTP={rp.status}",
    )

def test_vercel(env: dict[str, str], results: Results) -> None:
    for name in ("VERCEL_TOKEN", "VERCEL_TEAM_TOKEN"):
        token = env.get(name, "")
        if not token:
            results.add(name, "MISSING", "not present locally")
            continue
        r = http("https://api.vercel.com/v2/user", headers=auth_bearer(token))
        results.add(name, "PASS" if r.status == 200 else "FAIL", f"/v2/user HTTP={r.status}")

def test_google_direct(env: dict[str, str], results: Results) -> None:
    key = env.get("GOOGLE_AI_STUDIO_KEY", "")
    if not key:
        results.add("GOOGLE_AI_STUDIO_KEY", "MISSING", "not present locally")
        return
    url = "https://generativelanguage.googleapis.com/v1beta/models?" + urllib.parse.urlencode({"key": key})
    r = http_retry(url, timeout=30)
    # Direct key is optional; BYOK path can still be authoritative.
    evidence = f"direct models check HTTP={r.status}; BYOK result is evaluated separately"
    if r.status != 200:
        detail = error_detail(r)
        if detail:
            evidence += f"; error={detail!r}"
    results.add("GOOGLE_AI_STUDIO_KEY", "PASS" if r.status == 200 else "PARTIAL", evidence)

def test_cloudflare_legacy(env: dict[str, str], results: Results) -> None:
    account = env.get("CLOUDFLARE_ACCOUNT_ID", "")
    zone = env.get("CF_ZONE_ID", "")
    token_names = [
        "CF_WORKERS_AI_API_TOKEN",
        "CF_WORKERS_MAX_TOKEN",
        "CF_READ_API_TOKEN",
        "CF_TOKEN_DNS",
        "CF_TOKEN_WORKERS",
        "CF_TOKEN1",
        "CF_TOKEN2",
        "CF_TOKEN3",
        "CF_TOKEN4",
        "CF_TOKEN5",
        "CF_BACKUP_TOKEN_1",
        "CF_BACKUP_TOKEN_2",
    ]
    seen: dict[str, str] = {}
    for name in token_names:
        token = env.get(name, "")
        if not token:
            continue
        if token in seen:
            results.add(name, "ALIAS", f"same credential value as {seen[token]}")
            continue
        seen[token] = name

        vr = http(
            "https://api.cloudflare.com/client/v4/user/tokens/verify",
            headers=auth_bearer(token),
        )
        active = (
            vr.status == 200
            and isinstance(vr.json, dict)
            and (vr.json.get("result") or {}).get("status") == "active"
        )

        relevant_status = None
        relevant = ""
        if name in ("CF_TOKEN_DNS",) and zone:
            rr = http(
                f"https://api.cloudflare.com/client/v4/zones/{zone}/dns_records?per_page=1",
                headers=auth_bearer(token),
            )
            relevant_status = rr.status
            relevant = "dns_records"
        elif name in ("CF_TOKEN_WORKERS", "CF_WORKERS_MAX_TOKEN", "CF_TOKEN5") and account:
            rr = http(
                f"https://api.cloudflare.com/client/v4/accounts/{account}/workers/scripts",
                headers=auth_bearer(token),
            )
            relevant_status = rr.status
            relevant = "workers/scripts"
        elif account:
            rr = http(
                f"https://api.cloudflare.com/client/v4/accounts/{account}",
                headers=auth_bearer(token),
            )
            relevant_status = rr.status
            relevant = "account"

        if active and relevant_status == 200:
            status = "PASS"
        elif active:
            status = "PARTIAL"
        else:
            status = "FAIL"
        results.add(
            name,
            status,
            f"active={active}; {relevant or 'scope-check'} HTTP={relevant_status}",
        )

# ---------------------------------------------------------------------------
# Branch dependency scan
# ---------------------------------------------------------------------------

def run_cmd(
    cmd: list[str],
    *,
    cwd: Path | None = None,
    env: dict[str, str] | None = None,
    check: bool = False,
    input_text: str | None = None,
) -> subprocess.CompletedProcess[str]:
    log("$ " + " ".join(cmd))
    cp = subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        env=env,
        input=input_text,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    if check and cp.returncode != 0:
        raise RuntimeError(
            f"command failed ({cp.returncode}): {' '.join(cmd)}\n{redact(cp.stdout[-4000:])}"
        )
    return cp

def is_git_repo(root: Path) -> bool:
    return (root / ".git").exists() and shutil.which("git") is not None

def fetch_branches(root: Path) -> None:
    if not is_git_repo(root):
        return
    cp = run_cmd(["git", "fetch", "origin", "--prune"], cwd=root)
    if cp.returncode != 0:
        log("WARN: git fetch failed; branch scan will use currently available refs")

def remote_branches(root: Path) -> list[str]:
    if not is_git_repo(root):
        return []
    cp = run_cmd(
        ["git", "for-each-ref", "--format=%(refname:short)", "refs/remotes/origin/"],
        cwd=root,
    )
    out = []
    for line in cp.stdout.splitlines():
        s = line.strip()
        if not s or s.endswith("/HEAD"):
            continue
        out.append(s)
    return out

def scan_branch_dependencies(root: Path) -> dict[str, list[str]]:
    deps: dict[str, list[str]] = {}
    if not is_git_repo(root):
        return deps
    pattern = "|".join(re.escape(x) for x in LEGACY_NAMES + CANONICAL_NAMES)
    for ref in remote_branches(root):
        cp = subprocess.run(
            ["git", "grep", "-n", "-E", pattern, ref],
            cwd=str(root),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
        matches = []
        if cp.returncode in (0, 1):
            for line in cp.stdout.splitlines():
                # git grep output: ref:path:line:text
                if any(p in line for p in (":.github/workflows/", ":scripts/", ":src/", ":plugins/")):
                    matches.append(redact(line))
        if matches:
            deps[ref] = matches[:200]
    return deps

# ---------------------------------------------------------------------------
# Worker secret install / Cloudflare readback
# ---------------------------------------------------------------------------

def install_worker_secret(
    root: Path,
    env: dict[str, str],
    worker_name: str,
    secret_name: str,
    secret_value: str,
) -> None:
    cf_token = env.get("CLOUDFLARE_API_TOKEN", "")
    account = env.get("CLOUDFLARE_ACCOUNT_ID", "")
    if not cf_token or not account or not secret_value:
        raise RuntimeError(f"missing inputs for Worker secret {secret_name}")
    child_env = os.environ.copy()
    child_env["CLOUDFLARE_API_TOKEN"] = cf_token
    child_env["CLOUDFLARE_ACCOUNT_ID"] = account
    cp = run_cmd(
        ["npx", "wrangler", "secret", "put", secret_name, "--name", worker_name],
        cwd=root,
        env=child_env,
        input_text=secret_value,
    )
    if cp.returncode != 0:
        raise RuntimeError(
            f"wrangler secret put {secret_name} failed:\n{redact(cp.stdout[-2000:])}"
        )
    log(f"PASS: Worker secret {secret_name} installed")

def verify_worker_secret_binding(
    env: dict[str, str], worker_name: str, secret_name: str
) -> bool:
    token = env.get("CLOUDFLARE_API_TOKEN", "")
    account = env.get("CLOUDFLARE_ACCOUNT_ID", "")
    r = http(
        f"https://api.cloudflare.com/client/v4/accounts/{account}/workers/scripts/{worker_name}/secrets",
        headers=auth_bearer(token),
    )
    names = set()
    if r.status == 200 and isinstance(r.json, dict):
        names = {
            row.get("name")
            for row in r.json.get("result", [])
            if isinstance(row, dict)
        }
    ok = secret_name in names
    log(f"{'PASS' if ok else 'FAIL'}: Worker binding {secret_name}; HTTP={r.status}")
    return ok

# ---------------------------------------------------------------------------
# Workflow compatibility patching
# ---------------------------------------------------------------------------

def patch_expression_once(text: str, old: str, new: str) -> str:
    if new in text:
        return text
    return text.replace(old, new)

def patch_workflows(root: Path) -> list[Path]:
    changed: list[Path] = []
    wf_dir = root / ".github" / "workflows"
    if not wf_dir.exists():
        return changed
    for path in sorted(list(wf_dir.glob("*.yml")) + list(wf_dir.glob("*.yaml"))):
        text = path.read_text(encoding="utf-8")
        new_text = text
        for old, new in WORKFLOW_REPLACEMENTS.items():
            new_text = patch_expression_once(new_text, old, new)
        if new_text != text:
            path.write_text(new_text, encoding="utf-8")
            changed.append(path)
            log(f"PATCHED: {path.relative_to(root)}")
    return changed

def validate_no_nested_duplicate_expressions(root: Path) -> None:
    wf_dir = root / ".github" / "workflows"
    bad = []
    for path in list(wf_dir.glob("*.yml")) + list(wf_dir.glob("*.yaml")):
        text = path.read_text(encoding="utf-8")
        if "secrets.CF_AIG_TOKEN || secrets.CF_AIG_TOKEN" in text:
            bad.append(str(path))
        if "secrets.PROVIDER_GATEWAY_AUTH_TOKEN || secrets.PROVIDER_GATEWAY_AUTH_TOKEN" in text:
            bad.append(str(path))
    if bad:
        raise RuntimeError(f"workflow replacement duplication detected: {bad}")

# ---------------------------------------------------------------------------
# Local verification / commit / push
# ---------------------------------------------------------------------------

def checkout_target_branch(root: Path, branch: str) -> None:
    if not is_git_repo(root):
        raise RuntimeError("not a git repository")
    run_cmd(["git", "fetch", "origin", branch], cwd=root, check=True)
    cp = run_cmd(["git", "checkout", branch], cwd=root)
    if cp.returncode != 0:
        run_cmd(["git", "checkout", "-B", branch, f"origin/{branch}"], cwd=root, check=True)

    # Do not overwrite meaningful local edits. Ignore only files generated by
    # this reconciler/audit and user-supplied local secret env files, because
    # Audit mode intentionally creates them before Apply mode is run.
    status = run_cmd(["git", "status", "--porcelain", "--untracked-files=all"], cwd=root, check=True)
    allowed_exact = {
        "credential-reconcile-report.md",
        "credential-reconcile-report.json",
        "credential-audit.md",
        "cf-control-mcp.env.runtime-tested",
        "cf-control-mcp.env.full-secrets",
        "cf-control-mcp.env.organized",
        "cf-control-mcp.env.tested-standardized",
    }
    meaningful = []
    for raw in status.stdout.splitlines():
        line = raw.rstrip()
        if not line:
            continue
        path_part = line[3:].strip().replace("\\", "/")
        # Rename records may look like "old -> new"; keep them meaningful.
        if " -> " in path_part:
            meaningful.append(line)
            continue
        name = path_part.rsplit("/", 1)[-1]
        if name in allowed_exact:
            continue
        if path_part.startswith(".reconcile-worktree/"):
            continue
        # Generic local env snapshots are allowed only when untracked.
        if line.startswith("?? ") and (
            name == ".env"
            or name.startswith(".env.")
            or name.endswith(".env")
            or ".env." in name
        ):
            continue
        meaningful.append(line)

    if meaningful:
        preview = "\n".join(meaningful[:30])
        raise RuntimeError(
            "working tree has meaningful local changes before reconciliation; "
            "stash/commit them first. Ignored reconciler reports/env snapshots.\n"
            + preview
        )

    run_cmd(["git", "pull", "--ff-only", "origin", branch], cwd=root, check=True)

def local_verify(root: Path) -> None:
    section("LOCAL VERIFICATION")
    run_cmd(["npm", "ci"], cwd=root, check=True)
    run_cmd(["npx", "tsc", "--noEmit"], cwd=root, check=True)
    run_cmd(["npm", "run", "test:internet"], cwd=root, check=True)

    scripts = [
        "scripts/oauth_smoke.py",
        "scripts/verify_production.py",
        "scripts/install_runtime_secrets.py",
        "scripts/credential_audit.py",
        "scripts/apex_cf_bridge.py",
    ]
    existing = [x for x in scripts if (root / x).exists()]
    if existing:
        run_cmd([sys.executable, "-m", "py_compile", *existing], cwd=root, check=True)

def commit_if_changed(root: Path, message: str) -> bool:
    cp = run_cmd(["git", "status", "--porcelain"], cwd=root, check=True)
    if not cp.stdout.strip():
        log("No local workflow changes to commit")
        return False
    run_cmd(["git", "add", ".github/workflows", "scripts"], cwd=root, check=True)
    cp = run_cmd(["git", "diff", "--cached", "--quiet"], cwd=root)
    if cp.returncode == 0:
        log("No staged changes")
        return False
    run_cmd(["git", "commit", "-m", message], cwd=root, check=True)
    return True

def push_or_api_fallback(
    root: Path,
    github: GitHubAPI,
    branch: str,
    changed_paths: list[Path],
) -> None:
    cp = run_cmd(["git", "push", "origin", branch], cwd=root)
    if cp.returncode == 0:
        log(f"PASS: pushed branch {branch}")
        return

    log("WARN: normal git push failed; using GitHub Contents API for changed text files")
    for path in changed_paths:
        rel = path.relative_to(root).as_posix()
        github.update_text_file(
            rel,
            branch,
            path.read_text(encoding="utf-8"),
            "ci: standardize credential aliases with backward-compatible fallbacks",
        )

# ---------------------------------------------------------------------------
# Reports / .env output
# ---------------------------------------------------------------------------

def safe_env_line(name: str, value: str) -> str:
    esc = value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
    return f'{name}="{esc}"'

def write_runtime_env(
    out_path: Path,
    env: dict[str, str],
    results: Results,
    deps: dict[str, list[str]],
) -> None:
    lines: list[str] = [
        "# ============================================================================",
        "# cf-control-mcp — runtime-tested full-secret environment",
        f"# Generated: {dt.datetime.now(dt.timezone.utc).isoformat()}",
        "# CONTAINS REAL SECRETS. DO NOT COMMIT.",
        "# Legacy aliases are intentionally retained while remote branches reference them.",
        "# ============================================================================",
        "",
    ]

    groups = [
        ("MCP", ["MCP_ENDPOINT", "MCP_BASE_URL", "MCP_AUTH_TOKEN"]),
        (
            "Cloudflare primary",
            [
                "CLOUDFLARE_API_TOKEN",
                "CF_API_TOKEN",
                "CLOUDFLARE_ACCOUNT_ID",
                "CF_ACCOUNT_ID",
                "CF_ZONE_ID",
            ],
        ),
        (
            "Cloudflare AI Gateway",
            [
                "CF_AIG_TOKEN",
                "CF_AIG_AUTHORIZATION",
                "CF_AIG_GATEWAY_SLUG",
                "CF_AI_GATEWAY_BASE_URL",
            ],
        ),
        (
            "Provider Gateway",
            [
                "PROVIDER_GATEWAY_AUTH_TOKEN",
                "GATEWAY_AUTH_TOKEN",
            ],
        ),
        (
            "GitHub",
            [
                "GITHUB_TOKEN",
                "github_token",
                "GITHUB_RUNNER_PAT",
                "GH_RUNNER_PAT",
                "GITHUB_RUNNER_REPO",
                "GH_RUNNER_REPO",
            ],
        ),
        (
            "Hugging Face / Vercel / Google",
            [
                "HUGGINGFACE_TOKEN",
                "huggingfacetoken",
                "VERCEL_TOKEN",
                "VERCEL_TEAM_TOKEN",
                "Team_VERCEL_TOKEN",
                "GOOGLE_AI_STUDIO_KEY",
                "aistudioApi",
            ],
        ),
        (
            "Cloudflare scoped / legacy",
            [
                "CF_WORKERS_AI_API_TOKEN",
                "CloudflareWorkersAIAPItoken",
                "CF_WORKERS_MAX_TOKEN",
                "CloudflaremaxAPiWorkers",
                "cluadflairapi",
                "CF_READ_API_TOKEN",
                "CF_TOKEN_DNS",
                "CF_TOKEN_WORKERS",
                "CF_TOKEN1",
                "CF_TOKEN2",
                "CF_TOKEN3",
                "CF_TOKEN4",
                "CF_TOKEN5",
                "APEX_CLOUDFLARE_DEPLOY_TOKEN",
            ],
        ),
        (
            "Cloudflare resource IDs",
            [
                "CF_KV_NAMESPACE_ID",
                "CF_KV_HEALTH_ID",
                "CF_KV_EDGE_SCORES_ID",
                "CF_D1_DATABASE_ID",
                "CF_D1_DATABASE_NAME",
            ],
        ),
        (
            "Probe compatibility (only if values exist locally)",
            ["PROBE_ACCOUNT_ID2", "PROBE_TOKEN_F", "PROBE_TOKEN_G"],
        ),
    ]

    for title, names in groups:
        lines += ["# ---------------------------------------------------------------------------", f"# {title}", "# ---------------------------------------------------------------------------"]
        for name in names:
            value = env.get(name, "")
            if value:
                lines.append(safe_env_line(name, value))
            else:
                lines.append(f'# {name}="<NOT_PRESENT_LOCALLY>"')
        lines.append("")

    lines += [
        "# ---------------------------------------------------------------------------",
        "# Live test summary (no secret values)",
        "# ---------------------------------------------------------------------------",
    ]
    for item in results.items:
        lines.append(f"# {item.status:8} {item.name}: {item.evidence}")

    lines += [
        "",
        "# ---------------------------------------------------------------------------",
        "# Branch dependency summary",
        "# ---------------------------------------------------------------------------",
        f"# branches_with_credential_references={len(deps)}",
        "# Legacy aliases should not be deleted until those branches are reconciled.",
        "",
    ]
    out_path.write_text("\n".join(lines), encoding="utf-8")
    try:
        os.chmod(out_path, 0o600)
    except Exception:
        pass

def write_reports(
    root: Path,
    results: Results,
    deps: dict[str, list[str]],
    open_prs: list[dict[str, Any]],
) -> None:
    data = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "results": results.to_json(),
        "branch_dependencies": deps,
        "open_pull_requests": open_prs,
    }
    (root / "credential-reconcile-report.json").write_text(
        json.dumps(data, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    md = [
        "# Credential Reconciliation Report",
        "",
        f"Generated: `{data['generated_at']}`",
        "",
        "## Live checks",
        "",
        "| Check | Status | Evidence |",
        "|---|---|---|",
    ]
    for x in results.items:
        md.append(f"| `{x.name}` | **{x.status}** | {x.evidence.replace('|', '/')} |")
    md += [
        "",
        "## Open pull requests",
        "",
    ]
    if open_prs:
        for pr in open_prs:
            md.append(
                f"- #{pr.get('number')} `{pr.get('head', {}).get('ref', '')}` -> "
                f"`{pr.get('base', {}).get('ref', '')}`: {pr.get('title', '')}"
            )
    else:
        md.append("- none found or GitHub lookup unavailable")

    md += [
        "",
        "## Branches referencing credential names",
        "",
    ]
    for branch, refs in sorted(deps.items()):
        md.append(f"### `{branch}`")
        for line in refs[:25]:
            md.append(f"- `{line[:300]}`")
        if len(refs) > 25:
            md.append(f"- ... {len(refs)-25} more")
        md.append("")
    (root / "credential-reconcile-report.md").write_text(
        "\n".join(md), encoding="utf-8"
    )

# ---------------------------------------------------------------------------
# GitHub branch/PR metadata
# ---------------------------------------------------------------------------

def github_open_prs(github: GitHubAPI) -> list[dict[str, Any]]:
    r = github.req("/pulls?state=open&per_page=100")
    if r.status == 200 and isinstance(r.json, list):
        return r.json
    return []

# ---------------------------------------------------------------------------
# Apply canonical secret/variable migration
# ---------------------------------------------------------------------------

def apply_github_migration(
    env: dict[str, str],
    github: GitHubAPI,
    *,
    migrate_runner_pat: bool,
    apex_account_id: str,
    results: Results,
) -> None:
    section("GITHUB CANONICAL SECRET / VARIABLE MIGRATION")

    # Always safe: user supplied and live BYOK-tested token.
    cf_aig = env.get("CF_AIG_TOKEN", "")
    aig_check = results.by_name("CF_AIG_TOKEN")
    if cf_aig and aig_check and aig_check.status == "PASS":
        github.set_secret("CF_AIG_TOKEN", cf_aig)
    else:
        raise RuntimeError("CF_AIG_TOKEN did not pass live BYOK test; refusing GitHub sync")

    # Account ID is not a secret.
    account = env.get("CLOUDFLARE_ACCOUNT_ID", "")
    if account:
        github.set_variable("CLOUDFLARE_ACCOUNT_ID", account)

    repo_id = env.get("GITHUB_RUNNER_REPO", "")
    if repo_id:
        github.set_variable("GITHUB_RUNNER_REPO", repo_id)

    # Provider gateway canonical name only if exact secret exists locally.
    provider = env.get("PROVIDER_GATEWAY_AUTH_TOKEN", "")
    if provider:
        pg_check = results.by_name("ProviderGateway:/v1/models")
        if pg_check and pg_check.status == "PASS":
            github.set_secret("PROVIDER_GATEWAY_AUTH_TOKEN", provider)
        else:
            raise RuntimeError(
                "local Provider Gateway auth exists but /v1/models did not PASS; refusing sync"
            )
    else:
        log(
            "INFO: PROVIDER_GATEWAY_AUTH_TOKEN not locally available; "
            "preserving working legacy GATEWAY_AUTH_TOKEN in GitHub"
        )

    # Runner PAT is deliberately opt-in because the full compatibility env may
    # map it to GITHUB_TOKEN and we must not silently replace a verified runner PAT.
    runner = env.get("GITHUB_RUNNER_PAT", "")
    if migrate_runner_pat:
        if not runner:
            raise RuntimeError("--migrate-runner-pat requested but no local GITHUB_RUNNER_PAT")
        github.set_secret("GITHUB_RUNNER_PAT", runner)
    else:
        log(
            "INFO: not overwriting production runner PAT. "
            "Use --migrate-runner-pat only when the exact desired PAT is locally supplied."
        )

    # APEX canonical token is only promoted when an explicit account pairing is
    # provided AND proves accessible. Current historical audit showed CF_TOKEN5
    # active but 403 for the tested account.
    apex = env.get("APEX_CLOUDFLARE_DEPLOY_TOKEN", "")
    if apex and apex_account_id:
        rr = http(
            f"https://api.cloudflare.com/client/v4/accounts/{apex_account_id}",
            headers=auth_bearer(apex),
        )
        if rr.status == 200:
            github.set_secret("APEX_CLOUDFLARE_DEPLOY_TOKEN", apex)
        else:
            log(
                f"BLOCKED: APEX token account check HTTP={rr.status}; "
                "not promoting APEX_CLOUDFLARE_DEPLOY_TOKEN"
            )
    else:
        log("INFO: APEX canonical token not promoted without --apex-account-id proof")

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def discover_env_file(root: Path) -> Path | None:
    candidates = [
        root / "cf-control-mcp.env.full-secrets",
        root / ".env",
        root / "cf-control-mcp.env.organized",
        root / "cf-control-mcp.env.tested-standardized",
    ]
    return next((x for x in candidates if x.exists()), None)

def main() -> int:
    ap = argparse.ArgumentParser(description="cf-control-mcp credential reconciler")
    ap.add_argument("--env-file", help="Path to full-secret env file")
    ap.add_argument("--repo", default=DEFAULT_REPO)
    ap.add_argument("--repo-root", default=".")
    ap.add_argument("--target-branch", default=DEFAULT_BRANCH)
    ap.add_argument("--worker-name", default=DEFAULT_WORKER)
    ap.add_argument("--gateway-slug", default=DEFAULT_GATEWAY)
    ap.add_argument("--prod-base", default=DEFAULT_PROD_BASE)
    ap.add_argument("--apply", action="store_true", help="Apply safe remote mutations")
    ap.add_argument("--patch-workflows", action="store_true", help="Patch workflow refs with canonical+legacy fallbacks")
    ap.add_argument("--dispatch-verify", action="store_true", help="Dispatch verify-only.yml after apply")
    ap.add_argument("--wait-actions", action="store_true", help="Wait for dispatched verify workflow")
    ap.add_argument("--migrate-runner-pat", action="store_true", help="Overwrite canonical GITHUB_RUNNER_PAT with local value")
    ap.add_argument("--apex-account-id", default="", help="Explicit APEX Cloudflare account ID used to prove CF_TOKEN5/APEX token access before promotion")
    ap.add_argument("--skip-git-fetch", action="store_true")
    ap.add_argument("--skip-google-direct", action="store_true")
    args = ap.parse_args()

    root = Path(args.repo_root).resolve()
    env_path = Path(args.env_file).resolve() if args.env_file else discover_env_file(root)
    if not env_path or not env_path.exists():
        log("ERROR: no env file found. Pass --env-file <path>.")
        return 2

    section("LOAD ENVIRONMENT")
    log(f"repo_root={root}")
    log(f"env_file={env_path}")
    env = canonicalize(parse_env_file(env_path), args.repo)

    required_local = [
        "CLOUDFLARE_API_TOKEN",
        "CLOUDFLARE_ACCOUNT_ID",
        "CF_AIG_TOKEN",
        "MCP_AUTH_TOKEN",
        "GITHUB_TOKEN",
    ]
    missing = [x for x in required_local if not env.get(x)]
    if missing:
        log(f"ERROR: required local values missing: {missing}")
        return 2

    results = Results()

    # Branch scan first, before any mutation.
    section("BRANCH / WORKFLOW DEPENDENCY SCAN")
    if not args.skip_git_fetch:
        fetch_branches(root)
    deps = scan_branch_dependencies(root)
    log(f"branches referencing credential names: {len(deps)}")

    github = GitHubAPI(args.repo, env["GITHUB_TOKEN"])
    open_prs = github_open_prs(github)
    log(f"open PRs found: {len(open_prs)}")
    for pr in open_prs:
        log(
            f"PR #{pr.get('number')}: "
            f"{(pr.get('head') or {}).get('ref')} -> {(pr.get('base') or {}).get('ref')} "
            f"{pr.get('title','')}"
        )

    # Live audit.
    section("LIVE CREDENTIAL TESTS")
    test_cloudflare_management(env, results)
    test_cf_aig(env, results, args.gateway_slug)
    test_provider_gateway(env, results, args.prod_base)
    test_mcp(env, results)
    test_huggingface(env, results)
    test_github(env, results, args.repo)
    test_vercel(env, results)
    if not args.skip_google_direct:
        test_google_direct(env, results)
    test_cloudflare_legacy(env, results)

    # Always write local outputs.
    write_reports(root, results, deps, open_prs)
    runtime_env = root / "cf-control-mcp.env.runtime-tested"
    write_runtime_env(runtime_env, env, results, deps)
    log(f"WROTE: {runtime_env}")
    log(f"WROTE: {root / 'credential-reconcile-report.md'}")
    log(f"WROTE: {root / 'credential-reconcile-report.json'}")

    if not args.apply:
        section("AUDIT COMPLETE")
        log("No remote mutations performed. Re-run with --apply when ready.")
        return 0

    # Required apply gates.
    required_pass = [
        "CLOUDFLARE_API_TOKEN",
        "Cloudflare:account",
        "Cloudflare:Workers",
        "Cloudflare:D1",
        "Cloudflare:AI_GATEWAY",
        "Cloudflare:SECRETS_STORE",
        "CF_AIG_TOKEN",
        "MCP:initialize",
        "MCP:tools/list",
        "GITHUB_TOKEN",
    ]
    bad = []
    for name in required_pass:
        item = results.by_name(name)
        if not item or item.status != "PASS":
            bad.append(name)
    if bad:
        log(f"ERROR: refusing mutations because required live gates are not PASS: {bad}")
        return 3

    # If patching workflows, move to the target branch first.
    changed_paths: list[Path] = []
    if args.patch_workflows:
        section("CHECKOUT TARGET BRANCH")
        checkout_target_branch(root, args.target_branch)

    # Install Worker runtime token BEFORE GitHub workflow migration.
    section("INSTALL / VERIFY WORKER RUNTIME SECRET")
    install_worker_secret(
        root, env, args.worker_name, "CF_AIG_TOKEN", env["CF_AIG_TOKEN"]
    )
    if not verify_worker_secret_binding(env, args.worker_name, "CF_AIG_TOKEN"):
        raise RuntimeError("CF_AIG_TOKEN Worker binding readback failed")

    # GitHub canonical secret/variable sync.
    apply_github_migration(
        env,
        github,
        migrate_runner_pat=args.migrate_runner_pat,
        apex_account_id=args.apex_account_id,
        results=results,
    )

    # Patch target branch with backward-compatible fallbacks.
    committed = False
    if args.patch_workflows:
        section("PATCH WORKFLOWS WITH DUAL-READ ALIASES")
        changed_paths = patch_workflows(root)
        validate_no_nested_duplicate_expressions(root)
        if changed_paths:
            local_verify(root)
            committed = commit_if_changed(
                root,
                "ci: standardize credential names with legacy fallbacks",
            )
            if committed:
                push_or_api_fallback(root, github, args.target_branch, changed_paths)
        else:
            log("No workflow patch required")

    # Re-test AI Gateway after Worker secret install.
    section("POST-INSTALL LIVE CHECKS")
    post = Results()
    test_cf_aig(env, post, args.gateway_slug)
    if post.by_name("CF_AIG_TOKEN").status != "PASS":
        raise RuntimeError("post-install AI Gateway inference failed")

    # Dispatch verify-only workflow, which can use existing GitHub-only secrets
    # such as GATEWAY_AUTH_TOKEN that cannot be read back locally.
    if args.dispatch_verify:
        section("DISPATCH PRODUCTION VERIFY")
        started = dt.datetime.now(dt.timezone.utc)
        github.dispatch("verify-only.yml", args.target_branch)
        if args.wait_actions:
            run = github.wait_for_dispatched_run(
                "verify-only.yml",
                args.target_branch,
                started,
                timeout_sec=1200,
            )
            if not run:
                raise RuntimeError("timed out waiting for verify-only workflow")
            if run.get("conclusion") != "success":
                raise RuntimeError(
                    f"verify-only workflow failed: conclusion={run.get('conclusion')} "
                    f"url={run.get('html_url')}"
                )
            log(f"PASS: verify-only workflow {run.get('id')} concluded success")

    section("RECONCILIATION COMPLETE")
    log("Canonical CF_AIG_TOKEN is live and Worker-bound.")
    log("Legacy credential names were NOT deleted.")
    log("Branch dependency report was preserved for safe later cleanup.")
    log("Review credential-reconcile-report.md before deleting any old secret name.")
    return 0

if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        log("Interrupted by user.")
        raise SystemExit(130)
    except Exception as exc:
        log(f"FATAL: {type(exc).__name__}: {exc}")
        raise SystemExit(1)
