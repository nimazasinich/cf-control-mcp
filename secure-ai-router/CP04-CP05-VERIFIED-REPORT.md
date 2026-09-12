# FINAL REPORT — CP04-CP05-FAILOVER-POLICY continuation

Scope of this checkpoint cycle: Stage A (CP04 request/attempt persistence) and
Stage D (CP05 policy allow/deny semantics) only. Stages B, C, E, F not started —
see below.

## CP02 (topology scalability)
**PARTIAL** — unchanged from the status handed in at the start of this cycle.
Not touched this cycle. Known: `App.tsx` still has the two pre-existing `key`-prop
type errors flagged by `tsc --noEmit`; the 8/10 render caps have not been removed.

## CP04 (failover persistence)
**PASS**, with reproducible evidence, scoped to what was fixed:
- 8/8 `failover.test.ts` cases pass against a real in-memory libsql db with
  `PRAGMA foreign_keys = ON`.
- Verified against the *real* D1 engine, not just Node: `wrangler d1 migrations
  apply ai-router-db --local` applies both migrations (the previously-orphaned
  `0001_request_attempts.sql` now actually runs), `PRAGMA foreign_keys` reports `1`
  on D1 by default, and a manually-inserted orphan `request_attempts` row is
  rejected with `SQLITE_CONSTRAINT_FOREIGNKEY` on that same local D1 instance.
- Caveat: the streaming-response code path was fixed identically to the
  non-streaming path but has no automated test in this checkpoint (see
  `checkpoints/CP04-FAILOVER-VERIFIED/CHECKPOINT.md`). Treat that one branch as
  reviewed, not test-verified.

## CP05 (policy routing)
**PASS**, with reproducible evidence:
- 10/10 `policy.test.ts` cases pass, covering every case Stage D and Stage F asked
  for: allow provider, deny provider, allow model, deny model, conflicting
  allow+deny (hard deny wins), token limit, sensitive-data/external restriction,
  no eligible provider, and highest-score-provider-denied-so-second-is-selected.
- `policies.action` is now genuinely load-bearing in the routing engine (it was
  previously accepted by the admin API and stored, but silently ignored at
  routing time).
- Caveat: no data migration for pre-existing rows whose `action` column sat at its
  default — documented rather than guessed at, in
  `checkpoints/CP05-POLICY-ROUTING-V2/CHECKPOINT.md`.

## CP06 (data truthfulness)
**PARTIAL** — unchanged, not touched this cycle.

## CP07 (real test suite)
**BLOCKED / PARTIAL** — 2 of the 7 planned suites exist and pass
(`failover.test.ts`, `policy.test.ts`, 18 tests total). `router.test.ts`,
`firewall.test.ts`, `health.test.ts`, `topology.test.ts`, `bootstrap.test.ts`, and
the full end-to-end local test are **not written**. Not claimed as done.

## Commands actually run this cycle, actual results
```
npx vitest run                                    → 2 files, 18 tests, all passed
npx tsc --noEmit                                   → 2 pre-existing errors (App.tsx, CP02-scope, not introduced this cycle)
npm run build                                      → succeeded (vite build; tsc errors don't block it)
npx wrangler d1 migrations apply ai-router-db --local → both migrations applied
npx wrangler d1 execute ... PRAGMA foreign_keys    → 1
npx wrangler d1 execute ... orphan INSERT          → rejected, SQLITE_CONSTRAINT_FOREIGNKEY
```
`npm run lint` (= `tsc --noEmit`) is **not** currently green — the 2 App.tsx errors
block it. Not marking lint as PASS.

## Next checkpoint
Stage B (CP02 — remove the 8/10 render caps, virtualize/scroll, no silent
truncation) is next, since it's also what's blocking `npm run lint` from passing
cleanly. After that: Stage C (explicit model semantics), Stage E (CP06 data
truthfulness audit), then the rest of Stage F's test suite and the end-to-end test.
