# Adaptive CI Governor

The repository's CI repair system is designed to be intelligent without giving an AI model a GitHub write token.

## Zero-cost runtime

For this public repository:

- standard GitHub-hosted Actions minutes are free;
- the Governor calls the Gemini Developer API directly;
- the default model is `gemini-3.7-flash`, which has a Free Tier;
- there is no paid fallback.

Required repository secret:

`GEMINI_API_KEY`

Optional repository variable:

`AI_CI_GOVERNOR_MODEL`

Leave the variable unset to use `gemini-3.7-flash`.

## Architecture

```text
Failed CI
   |
   v
Evidence collector (read-only GitHub token)
   |
   v
Repair worker (Gemini API; no GitHub token)
   |
   v
Independent critic (Gemini API; read-only)
   |
   v
Patch artifact
   |
   v
Deterministic verifier in a fresh checkout
   |
   v
Non-AI mutation controller
   |
   +--> push exact verified patch
   |
   +--> explicitly dispatch CI on the repaired branch
```

The repair worker never commits, pushes, merges, deploys, or calls GitHub APIs. Its subprocess verification tools also run with token/key/secret-looking environment variables stripped.

## What the Governor can decide

The Governor classifies failures before acting:

- `PRODUCT_BUG`
- `STALE_TEST`
- `STALE_CI`
- `MERGE_CONFLICT`
- `FLAKE`
- `INFRA`
- `QUOTA`
- `SECURITY_SAFETY`
- `ENVIRONMENT_DRIFT`
- `FIXTURE_DRIFT`
- `AMBIGUOUS`

A stale test or stale CI rule may be updated if the underlying invariant is preserved. A pure infrastructure/quota/flake diagnosis cannot mutate source.

## Local source precedence

The current PR/head branch is treated as the latest local source and is authoritative by default. `main` is integration context, not automatic truth.

For merge conflicts the agent receives three-way merge-tree evidence and must reconcile semantically rather than blindly choosing one side.

## Protected control plane

The worker cannot modify its own constitution/runner, security policy, package manifests, deploy workflows, or other GitHub control-plane files. `ci.yml` is the only adaptive workflow file and has additional classification/confidence/critic requirements.

## Verification

Before a repair can be pushed, a fresh checkout must pass:

```text
python3 -m py_compile scripts/ai_ci_governor.py
npm ci
npm run typecheck
npm test
python3 scripts/verify_migrations_local.py
node scripts/check-version-sync.mjs
npx wrangler deploy --dry-run
```

If any of these fails, the patch is not pushed.

## Flakes

A high-confidence `FLAKE` decision with no code changes may re-run failed CI jobs once. A retry-pass is evidence of flakiness, not silently equivalent to a first-run clean pass.

## Repair loop

The Governor allows at most three `fix(ai-ci-governor):` repair commits between the default branch and the head branch. After that it stops and requires human direction.

## CI redispatch

GitHub suppresses ordinary workflow triggers caused by a push authenticated with the workflow's own `GITHUB_TOKEN`. Therefore the mutation controller explicitly dispatches `ci.yml` on the repaired branch after pushing a verified patch.
