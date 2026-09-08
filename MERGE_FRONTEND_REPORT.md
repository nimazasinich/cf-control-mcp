# DreamWorker Admin Frontend Merge Report

Date: 2026-09-08
Status: local merged source, **not deployed and not merged to production**.
Base: user-supplied `README(2).zip`.
Runtime adapter SHA-256: `1d204c7014dbe227d05d564ec26f790d6f378c374608c04daba4b8b3f0b4e154`.

## Merge policy

The richer approved DreamWorker frontend remains the visual base. Runtime behavior is fail-closed: operational state is taken from authenticated Admin APIs, unsupported actions are disabled or converted to navigation/read-only controls, and no reference/mock operational value is treated as live state.

The approved reference documents under `src/admin/ui/approved/*.ts` intentionally remain design/reference fixtures. Their sample text is not an operational source of truth. The additive runtime adapter clears or replaces sample-bearing live regions and renders API-backed values or explicit empty/unavailable states. Unit/browser tests may use synthetic fixtures strictly as test inputs; they are not runtime data providers.

## Live bindings

| Surface | Authoritative binding |
| --- | --- |
| Overview | `/admin/api/overview`, `/admin/api/providers`, `/admin/api/tools`, `/admin/api/logs` |
| Providers | `/admin/api/providers`; real provider enable/disable PATCH |
| Models | `/admin/api/models`; real model enable/disable PATCH |
| MCP Tools | `/admin/api/tools`; catalog/schema/annotations only; no invented `tools/call` |
| Routing | `/admin/api/routing`; read-only because no routing mutation API exists |
| Health | `/admin/api/providers`, `/admin/api/health`; real provider health-test POST |
| Usage | `/admin/api/usage`; uses current `activity/registry/health/coverage` schema |
| Audit | `/admin/api/logs`; persisted evidence only |
| Settings | `/admin/api/settings`; safe/masked runtime metadata only |
| Login | real owner-token `POST /admin/login` |
| Loading | all nine authenticated Admin read surfaces, completion only after requests settle |

## Important correctness fixes

- Providers use the real `byok_alias` field and no longer reuse a sample provider brand/logo for arbitrary runtime providers.
- Models keep `provider_enabled` separate from model `enabled` when computing callability.
- Usage binds to `totalAuditEvents`, `enabledModels`, `toolCatalogCount`, `totalChecks`, and coverage availability rather than stale field names.
- Uninstrumented gateway/token/cost telemetry remains explicitly unavailable; no graph, cost, latency, uptime, or request volume is fabricated.
- Model registration, Admin model invocation, Admin MCP tool invocation, routing mutation/simulation, provider creation, and Settings writes stay unavailable unless a real backend contract exists.
- Command palette is navigation-only; reference preview actions cannot report local fake completion.
- Loading probes all nine real Admin surfaces and does not use timer-based readiness.
- Reference tool counts such as `44 tools` are neutralized and replaced only by authenticated `/admin/api/tools` results.

## Verification

- `npm run typecheck`: PASS.
- `npm test`: **196 total / 188 PASS / 8 SKIP / 0 FAIL**.
- Added focused approved-adapter runtime contract tests for schema bindings, fail-closed reference handling, and real bootstrap behavior.
- Browser acceptance at exactly **1368 x 753**: **17 scenarios PASS**, including populated and empty states; zero page/console errors; no overflow beyond the locked viewport.
- Browser verification confirmed all nine Loading requests, owner-token Login contract, disabled unsupported controls, real empty states, and removal of forbidden reference markers from rendered runtime UI.

## Packaging

The clean deliverable intentionally excludes local `.env`, `.git`, `node_modules`, npm/wrangler caches, generated `build-test`, scratch data, and local deploy/verify logs. No deployment was performed.
