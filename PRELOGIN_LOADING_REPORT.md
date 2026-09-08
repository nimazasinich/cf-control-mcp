# Pre-Login Loading Gate — Implementation Report

## Requested behavior

Show the approved DreamWorker Loading Experience before the owner Login page.

The uploaded loading document is already the canonical project reference:

- reference: `ui-reference/my_mcp_tools_loading_experience_v2_1368x753.html`
- SHA-256: `115d44492592a8b5543781b507ddeea1ac9e55d6aa8b534cca5573fc59339306`
- viewport contract: `1368 × 753`

The reference document itself was not modified. Runtime behavior is added through the existing additive approved-page adapter.

## Final route flow

### Unauthenticated entry

1. `GET /admin` or normal `GET /admin/login`
2. Server renders the approved Loading page.
3. Loading calls `GET /admin/api/prelogin`.
4. The endpoint returns only `{ ok, authenticated }` from the real signed-session check.
5. When no session exists, Loading fetches `GET /admin/login?ready=1` and validates that the real Login document contains the expected owner-token surface.
6. The Loading composition remains perceptible for a minimum 900 ms, but readiness/progress is not advanced by this timer. The dwell begins only after the real checks have completed.
7. Browser handoff: `/admin/login?ready=1`.
8. The real Login adapter binds `POST /admin/login` and `name=token`.

`ready=1` is only an internal visual-handoff marker. It does not authenticate a user and it does not change the POST authentication contract.

### Authenticated entry / post-login

1. Login succeeds and sets the signed Admin session cookie.
2. Login adapter navigates to `/admin/loading`.
3. The same Loading page detects the authenticated session via `/admin/api/prelogin`.
4. It probes all nine authenticated Admin surfaces:
   - `/admin/api/overview`
   - `/admin/api/providers`
   - `/admin/api/models`
   - `/admin/api/tools`
   - `/admin/api/routing`
   - `/admin/api/health`
   - `/admin/api/usage`
   - `/admin/api/logs`
   - `/admin/api/settings`
5. Only after all requests settle successfully does it hand off to `/admin`.

## Data and security properties

- No fake operational data is introduced.
- Pre-login probe exposes no model/provider/routing/health/settings state.
- Pre-login probe exposes no secret values or secret presence metadata.
- `Cache-Control: private, no-store` and `Vary: Cookie` are used for the pre-login session probe.
- Owner-token authentication remains the only real Login contract.
- OAuth/social preview controls remain non-operational.
- The display-reference timer is paused immediately by the live adapter.
- A live-copy guard prevents the reference preview's delayed subtitle transition from overwriting real pre-login status text.
- Live progress is driven by real session/API events.
- The 900 ms minimum visual dwell does not claim readiness; it runs only after readiness has already been established.

## Files changed

- `src/admin/router.ts`
- `src/admin/ui/approved/adapter.ts`
- `test/admin.test.ts`
- `test/admin-approved-adapter-runtime-contract.test.ts`
- `test/admin-prelogin-loading-contract.test.ts` (new)

The approved Loading HTML and generated Loading source remain unchanged.

## Verification

### Focused contracts

- 69 tests
- 69 PASS
- 0 FAIL

Includes route gating, pre-login probe shape, Loading adapter runtime contract, authentication regression coverage, and approved-page byte identity.

### Full runtime regression suite

- 198 tests
- 190 PASS
- 8 SKIP
- 0 FAIL

The complete TypeScript source/test tree (96 `.ts` files) was transpiled with TypeScript 5.8.3 and executed with Node's test runner. Standard `npm ci` could not complete in this isolated environment because npm exited internally before restoring the clean package's dev dependencies, so this report does not claim a fresh `npm run typecheck` execution.

### Chromium 1368 × 753 acceptance

Production HTML/adapters were rendered in Chrome 144 at exactly 1368 × 753.

Observed pre-login state:

- title: `DreamWorker — Loading Refined 1368×753`
- heading: `Preparing secure access`
- subtitle: `Checking your Admin session`
- progress: `12%`
- viewport: `1368 × 753`
- document: `1368 × 753`

Observed successful handoff state:

- heading: `Sign-in ready`
- subtitle: `Opening the owner authentication interface`
- progress: `100%`
- handoff target: `/admin/login?ready=1`

Observed Login state:

- title: `cf-control-mcp — Admin · DreamWorker MCP Control Plane`
- owner-token input present
- form action: `/admin/login`
- token name: `token`
- auth contract: `owner-token-only`
- viewport/document: `1368 × 753`

Browser console/runtime errors for the final isolated visual run: `0`.

The execution environment blocks Chromium network navigation to localhost (`ERR_BLOCKED_BY_ADMINISTRATOR`). Therefore the visual run used the exact production HTML/adapter through DevTools `setDocumentContent`, with only the two pre-login fetch responses substituted in the browser harness. The real router and response behavior were verified separately by the passing route/runtime tests above.

## Deployment

No production deployment, merge, or GitHub write was performed.
