"""Canonical production-verification entry point for cf-control-mcp.

Loads .env into the current process environment only (never modifies the
file, never prints secret values, supports common aliases and a leading
"Bearer " prefix), then runs scripts/verify_production.py against
PRODUCTION_BASE_URL (or its default).

Usage:
    python scripts\\run_verify_with_env.py
"""
import os
import re
import runpy

PROJECT_ROOT = r"C:\Users\Dreammaker\Pictures\cf-control-mcp-"
ENV_PATH = os.path.join(PROJECT_ROOT, ".env")
VERIFY_SCRIPT = os.path.join(PROJECT_ROOT, "scripts", "verify_production.py")

REQUIRED = ["GATEWAY_AUTH_TOKEN", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]
ALIASES = {
    "CF_API_TOKEN": "CLOUDFLARE_API_TOKEN",
    "CF_ACCOUNT_ID": "CLOUDFLARE_ACCOUNT_ID",
}


def load_env(path: str) -> dict:
    raw = {}
    if not os.path.exists(path):
        return raw
    with open(path, encoding="utf-8", errors="ignore") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            key, val = key.strip(), val.strip()
            if len(val) >= 2 and val[0] == val[-1] and val[0] in ("'", '"'):
                val = val[1:-1]
            if val.startswith("Bearer "):
                val = val[len("Bearer "):]
            raw[key] = val
    return raw


def apply_env(raw: dict) -> None:
    for k, v in raw.items():
        os.environ.setdefault(k, v)
    for src, dst in ALIASES.items():
        if src in raw and dst not in os.environ:
            os.environ[dst] = raw[src]


def main() -> None:
    apply_env(load_env(ENV_PATH))
    print("=== env presence (names only, no values) ===")
    for k in REQUIRED:
        print(f"{k}: {'SET' if os.environ.get(k) else 'MISSING'}")
    print("=== running verify_production.py ===")
    runpy.run_path(VERIFY_SCRIPT, run_name="__main__")


if __name__ == "__main__":
    main()
