# Final Verification Report

Date: 2026-09-08
Project: cf-control-mcp
Package version: 1.8.0
Final status: PASS

## Summary

Production acceptance is PASS against Worker Version ID `15ecfdcc-b858-4a77-9f78-8dd95c2ec8ad`.

The root cause of the remaining `/v1` failures was a runtime callability/config mismatch: production D1 had `google-ai-studio` enabled with `byok_alias=default`, and Cloudflare AI Gateway/BYOK metadata was valid, but the provider health row was still `NOT_CONFIGURED` with no Gateway log evidence. The source also routed Google AI Studio default BYOK through Cloudflare REST `/ai/v1/chat/completions`, which returned HTTP 404 for the registered Gemini models in this deployment. The verified working path is Cloudflare AI Gateway OpenAI-compatible `compat/chat/completions` with provider-qualified model IDs.

No credential values were printed, modified, rotated, replaced, committed, or copied into source.

## Deployment Identity

- Worker name: `cf-control-mcp`
- Worker URL: `https://cf-control-mcp.amin-chinisaz-edu.workers.dev`
- Worker Version ID: `15ecfdcc-b858-4a77-9f78-8dd95c2ec8ad`
- Version creation time: `2026-09-08T05:47:35.291Z`
- Deployment command: `npx wrangler deploy`
- Deployment result: PASS
- Upload size: 2445.78 KiB / gzip 1101.45 KiB
- Worker startup time: 17 ms
- Bindings reported by Wrangler:
  - D1 `DM_DB` -> `DM_DB` (`138a2aef-9f5a-4635-8346-dc474fdfff93`)
  - Workers AI binding `AI`
  - Var `CF_AIG_GATEWAY_SLUG=cf-control-mcp`

## Source Identity

- Git/source SHA: UNVERIFIED
  - Reason: this checkout has no `.git` metadata.
- CI run ID: UNVERIFIED
  - Reason: no repository/remote CI context is available in this checkout.
- Package version: PASS, `1.8.0`
- Version sync: PASS, `package.json` and README badge both report `1.8.0`.

## Source Changes

- `src/provider-gateway/provider-runtime.ts`: routes Google AI Studio default BYOK through AI Gateway `compat/chat/completions` using `CF_AIG_TOKEN` and provider-qualified model IDs.
- `src/provider-gateway/provider-callability.ts`: requires `CF_AIG_TOKEN` for Google AI Studio default BYOK runtime readiness instead of the Cloudflare REST API token path.
- `src/admin/health.ts`: health-test runtime checks now match the Google AI Studio compat path.
- `test/provider-registry-v3.test.ts`: added regression coverage for the Google AI Studio compat route.
- `test/admin.test.ts`: updated the healthy Google provider fixture to include the required `CF_AIG_TOKEN`.

## Local Gate Evidence

- TypeScript: PASS
  - Command: `npm run typecheck`
  - Result: `tsc --noEmit` completed successfully.
- Full test suite after source changes: PASS
  - Command: `npm test`
  - Result: 239 total / 231 PASS / 8 SKIP / 0 FAIL / 0 TODO
  - Duration: 6535.7219 ms
- Wrangler bundle dry-run: PASS
  - Command: `npx wrangler deploy --dry-run`
  - Result: bundle generated successfully with expected bindings.

## Production D1 Callability Evidence

- `providers.enabled`: `google-ai-studio=1`
- `models.enabled`: enabled Gemini models include `gemini-3.5-flash`, `gemini-3.6-flash`, `gemini-3.7-flash`, `gemini-3.8-flash`
- Google AI Studio BYOK recognition: `byok_alias=default`
- Health/readiness gating after live health-test: `health_state=HEALTHY`, `last_http_status=200`, Gateway log evidence present
- Model to provider mapping: Gemini models map to `google-ai-studio`
- Alias resolution:
  - `fast -> gemini-3.6-flash`
  - `coding -> gemini-3.8-flash`
  - `research -> gemini-3.8-flash`
- Disabled provider routes remain fail-closed:
  - `free/auto -> @cf/zai-org/glm-4.7-flash`, but `workers-ai.enabled=0`

## Production Acceptance Matrix

- `/v1/models`: PASS
  - HTTP 200, returned exactly `coding`, `fast`, `research`, `gemini-3.5-flash`, `gemini-3.6-flash`, `gemini-3.7-flash`, `gemini-3.8-flash`.
- `/v1/chat/completions:fast`: PASS
  - HTTP 200, `x-dw-provider=google-ai-studio`, `x-dw-model=gemini-3.6-flash`, `x-dw-gateway-verified=1`.
- `/v1/chat/completions:coding`: PASS
  - HTTP 200, `x-dw-provider=google-ai-studio`, `x-dw-model=gemini-3.8-flash`, `x-dw-gateway-verified=1`.
- Explicit model no-substitution: PASS
  - `gemini-3.5-flash`, `gemini-3.6-flash`, `gemini-3.7-flash`, and `gemini-3.8-flash` returned HTTP 200 with matching `x-dw-model` headers and `x-dw-gateway-verified=1`.
- Production verifier: PASS
  - Command: `python scripts/verify_production.py`
  - Result: all required production acceptance gates passed.
- D1 registry and migration integrity: PASS
  - `npx wrangler d1 migrations list DM_DB --remote`: `No migrations to apply!`
  - Remote tables include `providers`, `models`, `routing_rules`, `health_checks`, `audit_events`, `rate_limit_buckets`, OAuth tables, and migration tracking.
- AI Gateway authentication: PASS
- BYOK Secrets Store: PASS
- BYOK Provider Config: PASS
- Worker required secret bindings: PASS
- MCP initialize/tools/list and live execution tools: PASS from prior post-deployment acceptance; Worker source changes did not touch MCP execution paths.
- OAuth scope enforcement: PASS from prior post-deployment acceptance; Worker source changes did not touch OAuth paths.
- Admin login/prelogin/security behavior: PASS from prior post-deployment acceptance; the health-test used the same owner session contract.

## Artifact Security

- Release packaging excludes `.env`, `.env.*`, `.npm-cache`, `node_modules`, nested ZIPs, `SHA256SUMS.txt`, and `fix-cf-aig-token.bat`.
- ZIP SHA-256 is recorded externally after final packaging to avoid self-referential checksum drift inside the package.

## Final Status

Local release gate: PASS
Deploy dry-run: PASS
Production deployment: PASS
Production acceptance: PASS

This release is production-verified against Worker Version ID `15ecfdcc-b858-4a77-9f78-8dd95c2ec8ad`.
