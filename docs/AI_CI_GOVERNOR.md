# Adaptive CI Governor

The repository's CI repair system is designed to be intelligent without giving an AI model a GitHub write token or a repository code-execution tool.

## Zero-cost runtime

For this public repository:

- standard GitHub-hosted Actions minutes are free;
- the Governor calls the Gemini Developer API directly;
- the default model is `gemini-3.7-flash`, which has a Free Tier;
- there is no paid fallback.

Required repository secret: `GEMINI_API_KEY`.

Optional repository variable: `AI_CI_GOVERNOR_MODEL`. Leave it unset to use `gemini-3.7-flash`.

## Architecture

```text
Failed CI or owner PR merge conflict
   |
   v
Evidence / three-way merge collector (GitHub read only)
   |
   v
Repair worker (Gemini API; no GitHub token; no code execution)
   |
   v
Independent critic (Gemini API; read only)
   |
   v
Candidate-tree patch artifact
   |
   v
Deterministic verifier in a fresh checkout (no Gemini key)
   |
   v
Non-AI mutation controller
   |
   +--> normal verified repair commit
   |
   +--> or real two-parent semantic merge commit
   |
   +--> explicitly dispatch CI on the repaired branch
```

The model never commits, pushes, merges, deploys, calls GitHub APIs, or executes repository tests. This prevents repository code from running in the same process tree as the Gemini credential. All project execution happens later in the isolated verifier without `GEMINI_API_KEY`.

## What the Governor can decide

The Governor classifies evidence before acting:

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

For a real merge conflict, the workflow prepares a temporary three-way merge using the exact head and base SHAs. The agent edits the conflicted working tree semantically. The verifier tests the resulting tree. If it passes, the non-AI mutation controller creates a two-parent merge commit with the authoritative head as first parent and the exact analyzed base commit as second parent.

This allows trusted, non-conflicting changes from `main` to flow in without allowing the AI to overwrite protected control-plane files. Protected files included by the merge must byte-match the exact trusted base commit.

## Protected control plane

The worker cannot modify its own constitution/runner, security policy, package manifests/lockfiles, git control files, deployment workflows, or other GitHub control-plane files. `.github/workflows/ci.yml` is the only adaptive workflow file and has additional `STALE_CI`, confidence, and critic requirements.

## Verification

Before a repair can be pushed, a fresh checkout with no Gemini key must pass:

```text
python3 -m py_compile scripts/ai_ci_governor.py
npm ci
npm run typecheck
npm test
python3 scripts/verify_migrations_local.py
node scripts/check-version-sync.mjs
npx wrangler deploy --dry-run
```

If any of these fails, the candidate tree is not pushed.

## Flakes

A high-confidence `FLAKE` decision with no code changes may re-run failed CI jobs once. A retry-pass is evidence of flakiness, not silently equivalent to a first-run clean pass.

## Repair loop

The Governor allows at most three `fix(ai-ci-governor):` repair commits between the default branch and the head branch. After that it stops and requires human direction.

## CI redispatch

GitHub suppresses ordinary workflow triggers caused by a push authenticated with the workflow's own `GITHUB_TOKEN`. Therefore the mutation controller explicitly dispatches `ci.yml` on the repaired branch after pushing a verified candidate.

The Governor also listens to owner-only, same-repository `pull_request_target` events so a PR whose merge conflict prevents ordinary `pull_request` CI from starting can still be reconciled safely.
