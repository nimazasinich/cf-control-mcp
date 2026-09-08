# cf-control-mcp Hardening — Implementation Status

This checkpoint continues from Provider Registry V3 / v1.8.0 and contains source-level hardening that has been verified locally in this environment.

## Implemented

- Admin login trust boundary narrowed to the owner MCP trust root.
- Admin session-cookie policy centralized and reused by runtime/settings metadata.
- Same-origin guard for Admin mutation endpoints.
- MCP capability authorization (`mcp:read`, `mcp:write`, `mcp:execute`, `mcp:admin`) enforced in both `tools/list` and `tools/call`.
- OAuth consent supports owner down-scoping of privileged requested capabilities; granted scopes cannot exceed the client's request.
- Schema-first MCP argument validation with required/type/enum plus declared string, numeric, array and additional-property bounds.
- Generic Cloudflare/Hugging Face passthrough path normalization and deny policy.
- D1-backed one-time OAuth authorization-code consumption.
- D1-backed refresh-token family rotation with compare-and-swap semantics and reuse revocation.
- Shared provider/model callability predicate across Admin and Provider Gateway.
- Provider/credential lifecycle operation state and reconciliation support.
- Fail-closed credential cleanup ordering and provider delete/deprovision flow.
- Atomic provider priority reorder via D1 batch.
- MCP tool-call audit integration.
- Correlation IDs for health/provider Gateway evidence paths.
- Health freshness/staleness presentation in the Admin runtime adapter.
- D1-backed fixed-window rate limiting for privileged/high-cost MCP calls and provider health testing.
- Legacy direct-provider-key env declarations removed because the routed runtime had no callers.
- Legacy dedicated Antigravity transport branch removed; the supported Antigravity profile remains the existing fail-closed `gateway-custom` profile.
- Additive migrations `0005` through `0008` for OAuth state, lifecycle state, observability and rate limits.
- Clean checkpoint packaging + exact SHA256 manifest tooling.

## Local verification evidence

- TypeScript verification: PASS (`tsc -p tsconfig.verify.json` in the verification harness).
- Full compiled test suite: **230 total / 222 PASS / 8 SKIP / 0 FAIL**.
- Hardening-focused suite: **16 / 16 PASS**.
- D1 migration verification: PASS for both fresh schema and `0002 → 0008` upgrade chain.
- Existing approved-page/UI contract tests are included in the full passing suite.

The 8 skips are pre-existing environment-dependent HTML parser cases and are not counted as PASS.

## Not claimed by this checkpoint

- No production deployment claim is made by this file.
- No live external provider/BYOK lifecycle round-trip is claimed unless separately evidenced by a production verification artifact.
- Wrangler major-version upgrade is not included because this environment cannot complete a registry-backed dependency install/verification for that change.
- The original source checkpoint did not include a compatible `package-lock.json`; therefore a clean `npm ci` proof is not claimed here. The source/test verification above uses the local strict TypeScript verification harness.

## Verification commands used here

```text
tsc -p /mnt/data/cf-control-mcp-work/tsconfig.verify.json
tsc -p /mnt/data/cf-control-mcp-work/tsconfig.test.verify.json
cd <project-root> && node --test '../build-test-verify/test/*.test.js'
python scripts/verify_migrations_local.py
```
