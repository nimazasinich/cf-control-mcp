#!/usr/bin/env python3
"""Deterministic verification helpers for Adaptive CI Governor v2.

This script is control-plane code. The AI repair worker may not edit it.
It never contacts production and never consumes repository secrets.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(rel: str) -> str:
    p = ROOT / rel
    if not p.is_file():
        raise SystemExit(f"missing invariant source: {rel}")
    return p.read_text(encoding="utf-8", errors="replace")


def strip_ts_comments(text: str) -> str:
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    return re.sub(r"//.*", "", text)


def require(cond: bool, message: str) -> None:
    if not cond:
        raise SystemExit(f"INVARIANT FAIL: {message}")
    print(f"INVARIANT PASS: {message}")


def invariants() -> int:
    admin_auth = strip_ts_comments(read("src/admin/auth.ts"))
    gateway_auth = strip_ts_comments(read("src/provider-gateway/auth.ts"))
    gateway_router = strip_ts_comments(read("src/provider-gateway/router.ts"))
    models = strip_ts_comments(read("src/provider-gateway/models.ts"))
    governor = read(".github/workflows/ai-ci-governor.yml")

    require("env.MCP_AUTH_TOKEN" in admin_auth, "Admin auth is rooted in MCP_AUTH_TOKEN")
    require("env.GATEWAY_AUTH_TOKEN" not in admin_auth, "Admin auth does not use GATEWAY_AUTH_TOKEN")
    require("env.GATEWAY_AUTH_TOKEN" in gateway_auth, "Provider gateway auth is rooted in GATEWAY_AUTH_TOKEN")
    require("env.MCP_AUTH_TOKEN" not in gateway_auth, "Provider gateway auth does not use MCP_AUTH_TOKEN")
    require("authenticateGateway(request, env)" in gateway_router, "all non-OPTIONS /v1 requests pass gateway auth")
    require('path === "/v1/chat/completions"' in gateway_router, "provider gateway chat route remains explicit")

    # Explicit model requests must fail closed instead of silently selecting an
    # unrelated model. Aliases may route/fallback by policy; direct model ids do not.
    require("if (exact) return [exact];" in models, "exact registered model resolves only to itself")
    require('throw new ModelUnavailableError(model, "not_registered")' in models, "unknown explicit model fails closed")
    require('throw new ModelUnavailableError(model, "model_disabled")' in models, "disabled explicit model fails closed")
    require('throw new ModelUnavailableError(model, "provider_disabled")' in models, "disabled provider fails closed")

    # The model-facing stage must not receive GitHub write authority or execute
    # repository code. The deterministic verifier is the only execution authority.
    repair_anchor = "Run free repair reasoner with no GitHub credential or code-execution tool"
    require(repair_anchor in governor, "AI repair stage declares no GitHub credential/code execution")
    require("persist-credentials: false" in governor, "read-only checkouts disable persisted GitHub credentials")
    require("scripts/ai_ci_verify.py" in governor, "Governor workflow protects/uses deterministic v2 verifier")

    print("HARD INVARIANTS: PASS")
    return 0


def failures(text: str) -> Counter[str]:
    out: Counter[str] = Counter()
    # Node's TAP runner emits nested and top-level `not ok N - name` lines.
    # Normalize volatile timing/locations but preserve the logical test label.
    for raw in text.splitlines():
        m = re.match(r"^\s*not ok\s+\d+\s+-\s+(.+?)\s*$", raw)
        if not m:
            continue
        name = m.group(1)
        name = re.sub(r"\s+# time=\S+", "", name)
        name = re.sub(r"\s+\(.*?:\d+:\d+\)$", "", name)
        out[name.strip()] += 1
    return out


def compare_tests(baseline_log: Path, candidate_log: Path, baseline_rc: int, candidate_rc: int, out_path: Path | None) -> int:
    btxt = baseline_log.read_text(encoding="utf-8", errors="replace") if baseline_log.exists() else ""
    ctxt = candidate_log.read_text(encoding="utf-8", errors="replace") if candidate_log.exists() else ""
    bf = failures(btxt)
    cf = failures(ctxt)

    new_failures: list[str] = []
    for name, count in cf.items():
        extra = count - bf.get(name, 0)
        if extra > 0:
            new_failures.extend([name] * extra)

    result = {
        "baseline_exit": baseline_rc,
        "candidate_exit": candidate_rc,
        "baseline_failure_count": sum(bf.values()),
        "candidate_failure_count": sum(cf.values()),
        "removed_failures": sorted(list((bf - cf).elements())),
        "new_failures": sorted(new_failures),
        "baseline_failed": baseline_rc != 0,
        "candidate_failed": candidate_rc != 0,
    }

    if out_path:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(result, indent=2, sort_keys=True), encoding="utf-8")

    print(json.dumps(result, indent=2, sort_keys=True))

    if candidate_rc == 0:
        print("DIFFERENTIAL TEST VERDICT: PASS (candidate suite is fully green)")
        return 0
    if baseline_rc == 0 and candidate_rc != 0:
        print("DIFFERENTIAL TEST VERDICT: FAIL (candidate regressed a green baseline)", file=sys.stderr)
        return 1
    if not cf:
        print("DIFFERENTIAL TEST VERDICT: FAIL (candidate failed but TAP failures could not be identified)", file=sys.stderr)
        return 1
    if new_failures:
        print("DIFFERENTIAL TEST VERDICT: FAIL (candidate introduced new failing test identities)", file=sys.stderr)
        return 1
    if sum(cf.values()) > sum(bf.values()):
        print("DIFFERENTIAL TEST VERDICT: FAIL (candidate increased failure count)", file=sys.stderr)
        return 1

    print("DIFFERENTIAL TEST VERDICT: PASS_WITH_BASELINE_DEBT")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("invariants")
    cp = sub.add_parser("compare-tests")
    cp.add_argument("--baseline-log", required=True)
    cp.add_argument("--candidate-log", required=True)
    cp.add_argument("--baseline-rc", required=True, type=int)
    cp.add_argument("--candidate-rc", required=True, type=int)
    cp.add_argument("--out")
    ns = ap.parse_args()
    if ns.cmd == "invariants":
        return invariants()
    return compare_tests(Path(ns.baseline_log), Path(ns.candidate_log), ns.baseline_rc, ns.candidate_rc, Path(ns.out) if ns.out else None)


if __name__ == "__main__":
    raise SystemExit(main())
