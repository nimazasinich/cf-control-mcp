# cf-control-mcp — Admin Login + UI/Feedback Handoff

Date: 2026-09-08
Source of truth used: uploaded project snapshot (`assets(1).zip`), which is ahead of GitHub `main` and already contains migration `0009_model_metadata.sql` plus the model-metadata backend/tests.

## What was fixed

### 1. Real Admin login blocker
The live served login is the approved/byte-locked page plus `src/admin/ui/approved/adapter.ts`.
The approved page still validates an email before delegating to `DreamWorkerAuthAdapter`. The previous live adapter replaced that email with the visible text `Owner-only Admin`, which failed the approved email validator. Result: valid Owner Token submissions could be blocked before the real `/admin/login` request.

The fix keeps the approved generated file untouched and changes only the additive live adapter:
- removes the fake Account/Email field from the visible UI;
- supplies a hidden, non-routable `owner@admin.invalid` sentinel only for the legacy approved validator;
- keeps the actual auth contract strictly Owner Token / `MCP_AUTH_TOKEN`;
- sends the token only in a same-origin JSON POST body to `/admin/login`;
- preserves the signed HttpOnly Admin session-cookie flow;
- removes/hides preview-only OAuth, theme/language and fake account controls;
- changes visible login copy to Owner-access language;
- translates the stale approved validation message to `Enter your Owner Token to continue.`;
- does not add Google OAuth (still deferred by project priority).

No auth boundary was weakened and `GATEWAY_AUTH_TOKEN` is not used for Admin login.

### 2. Admin feedback layer
Added a truthful request-backed feedback layer across live Admin pages:
- current Admin API load/mutation activity;
- `Loading authoritative state…` / `Applying change…`;
- success feedback only after an actual successful response;
- error state with the real response/error text;
- concurrent request accounting so one later success cannot hide an earlier real failure;
- browser offline/online feedback;
- accessible `role=status` / `aria-live` surfaces;
- generic live toasts for actions whose approved-page toast helper is unavailable.

This feedback describes Admin API request state only. It does **not** invent provider health, callability, usage or deployment state.

### 3. Model metadata UI completed
The uploaded snapshot already had the additive 0009 backend (`display_name`, `description`) and API. The actual served Models UI is now wired to it:
- Register Model includes optional Display Name and Description;
- character counters reflect backend limits (120 / 1000);
- Model ID remains visibly immutable;
- model rows show operator display name while retaining technical model ID/provider context;
- inspector shows description + immutable ID;
- `Edit model details` opens a real D1-backed editor;
- save calls `PATCH /admin/api/models/:id/metadata`;
- successful metadata edits update the row/inspector in place and show real feedback;
- search now includes display name and description;
- metadata is explicitly described as non-routing/non-health/non-callability state.

## Files changed in this handoff
- `src/admin/ui/approved/adapter.ts`
- `test/admin-approved-adapter-runtime-contract.test.ts`

The package also contains the uploaded snapshot's existing 0009 model-metadata implementation and tests.

## Evidence run in this environment

### PASS
- Standalone TypeScript compile of the modified live adapter: PASS.
- Latest live adapter contract tests: 6/6 PASS (login owner-token contract, hidden sentinel, corrected validation copy, same-origin token POST, model metadata UI/PATCH wiring, request-backed feedback/failure persistence).
- Uploaded snapshot precompiled baseline suite: 254 tests total / 246 PASS / 8 SKIP / 0 FAIL.
  - Important: this is the compiled baseline that came with the uploaded snapshot; it is useful baseline evidence but is not a substitute for rebuilding the final modified source with `npm test` on your machine.
- `python scripts/verify_migrations_local.py`: PASS — fresh schema + 0002→0009 upgrade chain.
- `node scripts/check-version-sync.mjs`: PASS — package.json and README both 1.8.0.

### BLOCKED / UNVERIFIED here
- `npm run typecheck` on the entire modified project: BLOCKED because npm registry resolution in this sandbox repeatedly returned `EAI_AGAIN`, so a trustworthy dependency install could not complete.
- `npm test` rebuilt from the final modified source: same dependency-install blocker. Do not treat the precompiled 254-test baseline as this gate.
- `npx wrangler deploy --dry-run`: same Wrangler dependency-install blocker.
- Canonical Chromium 1368×753 browser screenshot: attempted, but this container's Chromium hangs even on a trivial local document due its runtime/DBus environment, so visual browser verification is UNVERIFIED here.
- Remote D1 migration, Worker deployment, and production verifier were intentionally not run. You asked to perform local/deploy operations yourself.

## Exact Windows finalization sequence

Run from:
`C:\Users\Dreammaker\Pictures\cf-control-mcp-`

### A. Restore dependencies and run all pre-deploy gates
```powershell
npm ci
npm run typecheck
npm test
python scripts\verify_migrations_local.py
node scripts\check-version-sync.mjs
npx wrangler deploy --dry-run
```

Required result: every required gate PASS. The existing 8 explicit SKIPs are not failures, but do not convert any new SKIP/BLOCKED into PASS.

### B. Check/apply the additive D1 migration
Production was previously known through migration 0008. This source reads `models.display_name` and `models.description`, so 0009 must be present in remote `DM_DB` before the new Worker code is made live.

```powershell
npx wrangler d1 migrations list DM_DB --remote
npx wrangler d1 migrations apply DM_DB --remote
npx wrangler d1 migrations list DM_DB --remote
```

Expected: after apply, 0009 is no longer listed as unapplied. This is a D1-only configuration/schema operation and does not itself require a Worker redeploy.

### C. Deploy source change
Only after A and B are clean:
```powershell
npx wrangler deploy
```

Record the exact Worker Version ID from the deploy output. As an additional readback:
```powershell
npx wrangler versions list --name cf-control-mcp --json
npx wrangler deployments list --name cf-control-mcp
```

### D. Production acceptance on that exact deployment
Immediately after the deployment/readback, run:
```powershell
python scripts\run_verify_with_env.py
```

Do not call the new Worker FINAL if the verifier ends in FAIL/BLOCKED or if you cannot pair the verifier evidence with the exact deployed Version ID.

### E. Manual browser flows at 1368×753
1. Open `/admin/login` in a fresh/private browser session.
2. Confirm there is no visible fake email/account requirement and no visible fake OAuth/theme/language action.
3. Submit an empty token: visible feedback must say Owner Token is required; no network success should be shown.
4. Submit an invalid Owner Token: request reaches `/admin/login`, returns a real error, and no authenticated Admin page is shown.
5. Submit the valid Owner Token: `/admin/login` succeeds, then `/admin/loading`, then authenticated `/admin`.
6. Check Overview/Providers/Models/Routing/Health/Usage/Audit/Settings: request-status feedback must track actual API work and must not invent health/usage.
7. Models: edit Display Name/Description; verify the UI updates after the PATCH succeeds.
8. Reload Models and confirm metadata persisted from D1.
9. D1 readback the edited test model, then restore any temporary probe values.
10. Confirm `/v1/models`, explicit-model no-substitution, and fast/coding/research routing still behave as before.

## GitHub status
GitHub was inspected read-only only. No branch, commit, PR, workflow change, or file mutation was made. At inspection time, GitHub `main` did not contain `migrations/0009_model_metadata.sql`, so it is behind the uploaded snapshot used for this handoff.

## Secret handling
This handoff package intentionally excludes `.env`, `.wrangler`, `state`, `requests`, `results`, `node_modules`, and other runtime/generated credential-bearing material. No token values were printed or changed.
