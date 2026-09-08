# cf-control-mcp — AI CI Repair Contract

This repository uses an AI CI repair controller. These rules are mandatory for every AI-assisted repair.

## Source-of-truth precedence

1. The current PR/head branch is the authoritative representation of the developer's latest local source.
2. The default branch is an integration source, not an authority that may overwrite newer head-branch behavior.
3. During merge conflict resolution, preserve the head branch by default. Integrate changes from the default branch only when they are non-conflicting or clearly required for compatibility, security, or repository invariants.
4. Never reset, rebase, checkout, or replace the authoritative head branch with the default branch merely to make CI green.

## CI integrity

- Never weaken, disable, skip, or bypass required checks.
- Never introduce `continue-on-error`, unconditional success exits, fake fixtures, fake provider data, or test-only shortcuts to manufacture a PASS.
- Never delete or relax tests simply because they fail.
- Never modify `.github/workflows/ci.yml` as part of an automated repair run.
- Never increase timeouts merely to hide a deterministic failure.
- Treat BLOCKED, SKIP, QUOTA, UNVERIFIED, or missing evidence as distinct from PASS.

## Project safety invariants

- Do not deploy or mutate production from the CI repair agent.
- Do not print, copy, rotate, revoke, or modify secrets or credentials.
- Keep `MCP_AUTH_TOKEN` and `GATEWAY_AUTH_TOKEN` trust boundaries separate.
- Preserve explicit-model no-substitution behavior and provider/model enabled-state semantics.
- D1-only configuration changes must not cause a Worker redeploy.
- Do not fabricate provider health, model availability, usage, verification, or production state.

## Required verification before an automated repair commit

Run the repository's real gates against the repaired head branch:

1. `npm ci`
2. `npm run typecheck`
3. `npm test`
4. `python3 scripts/verify_migrations_local.py`
5. `node scripts/check-version-sync.mjs`
6. `npx wrangler deploy --dry-run`

If a gate fails, fix the real root cause and rerun it. If the root cause cannot be repaired safely, stop and report the remaining failure instead of claiming success.

## Repair behavior

- Read CI failure evidence first.
- Inspect the smallest relevant set of files.
- Prefer minimal, reversible changes.
- Preserve newer head-branch architecture and behavior unless concrete evidence shows it is the cause of failure.
- Resolve textual conflicts semantically, not by blindly accepting the default branch.
- Do not commit or push directly; the workflow owns Git staging, verification, commit, and push.
