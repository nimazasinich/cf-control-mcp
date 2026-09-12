# CP04/CP05 attachment merge report

Status: WIP / UNVERIFIED. This package is not a PASS checkpoint because dependencies are not restorable in the current execution environment, so Vitest, Vite, Wrangler, and full TypeScript module/type checks could not run.

## Source inputs

- Base project: `cloudflare-ai-router-CP02-TOPOLOGY-MERGED-WIP-UNVERIFIED.zip`
- Attachment inspected: `CP04-CP05-FAILOVER-POLICY(2).zip`

## Useful information merged

The attachment contained more than documentation. It included a verified CP04/CP05 backend baseline with failover and policy-routing logic. The following useful parts were merged into this project:

- CP04/CP05 server schema with `requests`, `routing_decisions`, `request_attempts`, `audit_log`, hashed/prefixed API keys, provider health state, and model enablement fields.
- Node/D1 database runtime split from CP04/CP05: `src/server/db/node.ts`, `src/server/db/d1.ts`, and driver-neutral `src/server/db/types.ts`.
- CP04 failover evidence table and local FK enforcement path.
- CP05 policy router semantics where the `policies.action` field is load-bearing and audited per candidate.
- Verified source tests: `failover.test.ts`, `policy.test.ts`, and `testHarness.ts`.
- CP04/CP05 checkpoint directories and final verified report.

## CP02 topology preservation

The prior CP02 topology work was preserved and adapted to the CP04/CP05 `requests` schema:

- `TopologyMap.tsx`, rail pagination, responsive node layout, and topology formatting helpers were retained.
- `/api/topology` now feeds the CP02 `buildTopologyPayload()` helper from real `requests`, `api_keys`, `providers`, and `models` records.
- `/api/admin/topology` mirrors the same payload for dashboard compatibility.
- Provider model counts now include enabled-model count when that status is present.
- Configured providers without observed traffic remain visible but are not treated as observed routes.

## UI compatibility changes

The dashboard was adapted to the CP04/CP05 backend response shapes:

- Read endpoints now use the CP04/CP05 public observability API where possible.
- Provider, model, stats, history, event, and log payloads are normalized in the frontend.
- API-key creation accepts both `rawKey` and the legacy UI `rawSecret` shape.
- Policy creation accepts the previous UI `value` field and converts it into CP05 `config` shape.
- The stale `sqlite.db` from the previous UI-oriented package was removed to avoid mixing the old schema with the CP04/CP05 schema.
- Fake dashboard/log fallbacks such as `1.24M`, default `OpenAI`, and default non-zero request cost were removed from the touched views.

## Verification actually run

See `merge-logs/` for raw outputs.

- Static TypeScript syntax check: PASS, 49 TS/TSX files checked, 0 syntax errors.
- CP02 topology runtime helper check: PASS for 0, 1, 3, 6, 10, 20, 30, and 37 nodes across 230/300/480/720 rail heights.
- CP04/CP05 copied identity check: MATCH for router, policy, firewall, crypto, schema, db type adapters, failover test, policy test, test harness, and request-attempt migration.

## Blockers

- `npm ci --offline` fails with `ENOTCACHED` for `yocto-queue-1.2.2.tgz`.
- `npm test` fails because `vitest` is not installed.
- `npm run build` fails because `vite` is not installed.
- `npm run cf:d1:migrate:local` fails because `wrangler` is not installed.
- `npm run lint` fails because dependency/type packages are missing; therefore full TypeScript semantic validation is still unverified.

## Not claimed

This package is not marked CP02/CP04/CP05 PASS in the integrated UI project. Browser screenshots and real runtime verification were not produced in this environment.
