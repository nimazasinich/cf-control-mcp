# Provider Registry V3 — Implementation & Verification Report

Status: **implemented locally; not deployed by this package**.

## What changed

Provider Registry V3 turns the Admin Providers page into a real registry/routing control plane rather than a fixed provider list.

### Provider presets

The registry contains presets for:

- Workers AI
- Google AI Studio
- Google Antigravity / custom endpoint profile
- OpenAI
- Anthropic
- DeepSeek
- OpenRouter
- Groq
- Mistral AI
- xAI
- Perplexity
- Cerebras
- Cohere
- Hugging Face
- Generic Custom OpenAI-compatible provider
- TaBiToken (New API gateway)
- GoRouter (New API gateway)
- New API (self-hosted / other instance)

The generic Custom flow provisions a Cloudflare AI Gateway Custom Provider and requires a real HTTPS upstream URL. Credentials are never accepted in the URL.

### New API-compatible gateways (added post-v3)

TaBiToken, GoRouter, and self-hosted New API are all deployments of the same
open-source project (`QuantumNous/new-api`), consolidated in
`AI-Gateway-Master-Report.md`. Because they share one codebase, the
request/response schema, auth headers, and endpoint paths are identical
across all three — only the base URL, the BYOK key, and the instance's
enabled models differ.

They are modeled as `gateway-custom` presets (same transport family as
Google Antigravity/custom-endpoint and the generic Custom provider):

| Preset id | Display name | Default base URL | Operator-editable? |
|---|---|---|---|
| `tabitoken` | TaBiToken (New API gateway) | `https://tabitoken.com` | Yes |
| `gorouter` | GoRouter (New API gateway) | `https://gorouter.app` | Yes |
| `new-api` | New API (self-hosted / other instance) | *(none — required)* | Yes |

Notes:

- **Base URL is disputed in the source report** (Section 3): live fetches of
  the root domains returned the New API application, but some agent reports
  claimed an `api.` subdomain instead. The seeded default uses the root
  domain, but the field stays editable in the Add Provider flow so the
  operator can switch to `https://api.tabitoken.com`, `https://api.gorouter.app`,
  or the reported TaBiToken backup domain `https://tabitoken.cc` if
  `GET /v1/models` does not resolve against the default.
- `api_path` defaults to `v1/chat/completions` (OpenAI-compatible surface).
  The underlying New API project also exposes a native Claude route
  (`/v1/messages`, requires an `anthropic-version` header) and a native
  Gemini route (`/v1beta/models/{model}:{action}`), but those are upstream
  capabilities of the gateway itself, not separate transports this Worker
  needs to implement — the existing `gateway-custom` → Cloudflare Custom
  Provider path already forwards whatever path/body the caller sends.
- `new-api` has no default base URL because it represents *any* self-hosted
  or third-party deployment of the project; the operator must supply their
  own HTTPS endpoint (e.g. `https://your-host:3000`).
- All three require a BYOK credential (`sk-...` token) — same as every other
  `byok`-only preset in this registry (OpenRouter, Hugging Face). Rows are
  seeded disabled/`NOT_CONFIGURED` and only go live once the operator adds a
  credential through the Providers UI, which provisions the Cloudflare
  Custom Provider and stores the secret exactly like the existing Custom
  flow.
- Router fallback fix: `POST /admin/api/providers` previously required the
  request body to repeat `baseUrl`/`testModel` even for a `customizable`
  preset that already declares them, silently discarding the template's
  defaults. It now falls back to `template.baseUrl` / `template.testModel`
  when the body omits them, so these presets pre-fill as intended while
  remaining fully overridable.
- Migration: `migrations/0004_new_api_gateways.sql` adds the three seed rows
  for existing v1.8/v3 D1 databases; `src/admin/schema.sql` carries the same
  rows for fresh installs.
- Tests: `test/provider-registry-v3.test.ts` covers catalog shape, the
  baseUrl/testModel fallback (default and operator-overridden), the
  self-hosted preset's required-base-URL validation, and the
  `gateway-custom` runtime call routing through
  `gateway.ai.cloudflare.com/v1/{account}/{gateway}/custom-tabitoken/...`.

Google Antigravity is intentionally **not** treated as a fake Cloudflare-native provider. It is a disabled custom-endpoint profile until the operator supplies a real HTTPS endpoint and model ID.

## Authentication modes

Each preset exposes only the auth modes that the runtime supports for it:

- `byok` — provider credential stored through Cloudflare AI Gateway BYOK / Secrets Store integration; D1 stores safe metadata only.
- `cloudflare-unified` — Cloudflare Unified Billing where supported.
- `cloudflare-binding` — Workers AI binding; no upstream provider API token.
- `none` — only for a custom upstream that truly requires no upstream authentication.

Non-default BYOK aliases remain non-default and are selected explicitly; the registry no longer marks every BYOK alias as the default configuration.

## Provider table UX

The Providers table keeps controls in-row:

`Priority | Provider | Auth | Network | Models | Latency | Test | Actions`

Available row actions include:

- `↑` / `↓` priority changes persisted to D1
- connection `Test`
- `Key` credential setup/rotation for BYOK providers
- enable / disable

The Network column is fail-closed. `Gateway verified` is shown only when the health probe receives Cloudflare Gateway evidence and records the Gateway log identifier.

## Routing behavior

`model: "auto"` builds candidates only from providers that are:

1. enabled,
2. runtime-configured,
3. last verified `HEALTHY`, and
4. backed by recorded Cloudflare Gateway evidence.

Candidates are ordered by the provider priority stored in D1. Retryable upstream failures (for example 429 and 5xx) fall through to the next eligible provider.

A successful HTTP status without Cloudflare Gateway evidence is **not** accepted as a successful provider response; routing continues to another eligible candidate.

Explicit model IDs are strict: requesting a specific model never silently substitutes a different model.

## Provider-token-free models

Workers AI is configured through the `AI` binding. V3 seeds three Workers AI models as token-free/free-tier candidates and binds the `free` and `auto` aliases to the token-free pool initially. `free_tier=1` cannot be assigned to a normal BYOK provider model.

`free_tier` in this project means **no upstream provider API token is required**. It does not promise unlimited zero-cost usage; Cloudflare plan limits and pricing still apply.

## D1 migration

Migration:

`migrations/0003_provider_registry_v3.sql`

Migration verification was executed against an in-memory SQLite representation of the previous Admin schema.

Verified result:

- 14 seeded provider profiles
- 3 Workers AI token-free model rows
- `auto` and `free` initial routing aliases
- Antigravity remains disabled / `NOT_CONFIGURED` as a custom endpoint profile

## Verification performed

### Runtime regression suite

- Total: **208**
- Passed: **200**
- Skipped: **8**
- Failed: **0**

The suite includes Provider Registry V3 contracts for:

- major + custom provider catalog coverage
- HTTPS-only custom provider URLs
- no provider token embedded in Custom Provider provisioning
- fail-closed health without Gateway evidence
- Cloudflare REST gateway identity
- official OpenRouter Gateway passthrough path
- priority-based retry/fallback
- rejection of 2xx responses without Gateway evidence
- strict explicit-model behavior
- token-free model restrictions

### Type checking

A focused TypeScript verification covering the changed Admin/provider/gateway files passed with **0 diagnostics** using the system TypeScript compiler and a temporary Cloudflare-type verification shim.

The uploaded dependency snapshot contains incomplete `node_modules` package contents, so a clean full-project `npm run typecheck` is **not claimed**. `node_modules`, emitted `build-test`, and the temporary verification shim are excluded from the release ZIP.

### Browser visual acceptance

Chromium/CDP verification at exactly **1368 × 753** passed for:

- Providers table
- Add Provider modal
- Generic Custom Provider modal state
- Antigravity custom-endpoint modal state

Observed in the verification fixture:

- no document overflow
- no browser/page errors
- priority controls stay in the table row
- Test/Key/Enable actions stay in the table row
- Custom/Antigravity URL + model requirements are visible
- auth options are sourced from the backend provider catalog

The populated browser fixture uses test payloads only for UI verification. Runtime production state is always API-backed.

## Required runtime configuration

The project expects:

- `DM_DB` — D1 binding
- `AI` — Workers AI binding
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `CF_AIG_GATEWAY_SLUG` — configured as a non-secret Wrangler variable
- `CF_AIG_TOKEN` where authenticated Gateway passthrough / non-default aliases require it
- existing `MCP_AUTH_TOKEN` / `GATEWAY_AUTH_TOKEN` according to the existing project authentication contract

Provider secrets must be set through the Admin credential flow / Cloudflare secret infrastructure, never embedded in source or D1 plaintext.

## Not claimed

This artifact was **not deployed** and no live user Cloudflare account/secrets were available to perform a production provider round-trip. Gateway behavior is validated by runtime tests, route/evidence contracts, D1 migration verification, browser verification, and Cloudflare's documented API shape—not by claiming a live production call that was not made.
