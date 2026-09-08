# cf-control-mcp Admin Visual Upgrade — 2026-09-08

## Scope

This checkpoint strengthens the existing DreamWorker / cf-control-mcp Admin visual language without redesigning the product from scratch and without changing the approved HTML reference layer.

The live visual work is additive in:

- `src/admin/ui/approved/adapter.ts`
- `test/admin-approved-adapter-runtime-contract.test.ts`

The approved reference HTML files under `ui-reference/` remain unchanged.

## What changed visually

### Shared shell

- Stronger page depth with restrained layered backgrounds and elevation tokens.
- Sidebar hierarchy improved while preserving the existing navy/blue/teal identity.
- Clearer active navigation state and more subtle hover feedback.
- Header/search controls now have stronger focus, hover and surface separation.
- Cards and panels use a more consistent border/elevation system.
- Buttons, inputs and interactive rows have more legible hover/focus/pressed states.
- Keyboard `:focus-visible` treatment was strengthened.
- Reduced-motion behavior is respected.

### Overview / Usage

- Hero and metric cards have clearer visual hierarchy.
- Quick actions, content panels and status surfaces are more distinct without increasing visual noise.
- Empty/backend-unavailable states remain truthful and are not replaced with fabricated operational data.

### Providers

- Provider rows have clearer hover/selected states.
- Disabled providers are visually distinct without hiding them.
- Provider logos and metric cards have stronger surface separation.

### Models

- Registered model rows and selected model state are easier to scan.
- Inspector surface and runtime facts are visually separated more clearly.
- Existing metadata-editing flow receives the same refined modal/input treatment.
- Immutable model ID behavior and Admin API contracts are unchanged.

### MCP Tools

- Scope rail, tool rows, schema preview and inspector surfaces are more distinct.
- Selection state is easier to follow across dense tool lists.

### Routing

- Resolver card, route nodes, policy stages and selected targets have stronger hierarchy.
- The topology remains information-dense, but the eye can follow alias → model → provider → callable state more easily.

### Health

- Radar/diagnostic presentation has more controlled depth and emphasis.
- Health fact cards and diagnostic summaries are easier to distinguish.
- No provider-health values are invented by the visual layer.

### Audit

- Selected audit rows, lineage stages and detail surfaces are visually clearer.
- Selection emphasis is differentiated from ordinary hover feedback.

### Settings

- Settings index/detail separation is stronger.
- Environment/security/danger surfaces have clearer semantic hierarchy.

### Login

- Keeps the fixed Owner Token-only authentication flow from the previous checkpoint.
- Card depth, input focus, primary action, auth explanation and background composition were polished.
- No fake username/email requirement was reintroduced.
- OAuth remains deferred.

### Loading

- Loading stage, spinner halo and progress treatment were polished while preserving the existing structure.

## Visual verification evidence

Static browser rendering was executed at the canonical `1368 × 753` viewport for all 11 Admin surfaces:

1. Overview
2. Providers
3. Models
4. MCP Tools
5. Routing
6. Health
7. Usage
8. Audit
9. Settings
10. Login
11. Loading

Evidence is in `evidence/ui-visual-2026-09-08/`.

`render-report.json` records for every page:

- root box = exactly `1368 × 753`
- document width/height = exactly `1368 × 753`
- enhancement style injected exactly once
- zero JavaScript page errors during the static render

This browser pass validates layout/CSS integration. It does **not** claim production API availability because the render harness intentionally does not use production data.

## Verification status

### PASS

- Isolated TypeScript compilation of the modified `adapter.ts`.
- Adapter visual contract: 11/11 pages receive the expected visual layer.
- 11/11 canonical 1368×753 browser renders completed with zero page errors.
- `ui-reference/`: 11 files checked, 0 changed from the prior handoff package.
- In `src/admin/ui/approved/`, the only changed source file is `adapter.ts`; generated approved page modules were not rewritten.

### BLOCKED in this sandbox

A full project `tsc --noEmit` could not be rerun because the sandbox's attempted npm install left dependency directories incomplete; TypeScript reports the missing `@cloudflare/workers-types` type package. This is an environment/dependency-install block, not reported as PASS.

Therefore the following must be run on the user's normal Windows workspace before deploy:

```powershell
npm ci
npm run typecheck
npm test
python scripts\verify_migrations_local.py
node scripts\check-version-sync.mjs
npx wrangler deploy --dry-run
```

Only if all required gates pass and Worker/source code is being deployed:

```powershell
npx wrangler deploy
```

Record the exact new Worker Version ID and run production verification against that exact deployment:

```powershell
python scripts\run_verify_with_env.py
```

Do not classify the new source checkpoint as production-verified until that exact-version production verifier passes.

## Safety / project invariants

- No GitHub writes, commits, branches, PRs or workflow changes were made.
- No token was rotated, revoked or changed.
- No secret values are included in the handoff package.
- `.env`, `node_modules`, `.wrangler`, runtime state and temporary request/result directories are excluded from the final package.
- `MCP_AUTH_TOKEN` and `GATEWAY_AUTH_TOKEN` trust boundaries remain separate.
- No provider health, usage, callability or readiness data was fabricated.
- No Worker deployment was performed.
