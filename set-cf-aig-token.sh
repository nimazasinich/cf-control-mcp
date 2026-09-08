#!/usr/bin/env bash
# Sets CF_AIG_TOKEN on the cf-control-mcp Worker and verifies the fix.
# Run this on your own machine where you're logged into your real Cloudflare account.
set -euo pipefail

echo "=== Setting CF_AIG_TOKEN worker secret ==="
echo "Paste the AI Gateway authentication token when prompted, then press Enter."
npx wrangler secret put CF_AIG_TOKEN

echo ""
echo "=== Verifying production ==="
python3 scripts/verify_production.py
