# cf-control-mcp — Agent Runtime Contract

This file is the canonical orientation for coding agents and automation working in this repository.

## Public client gateway

The public OpenAI-compatible gateway exposed by this project is the Cloudflare Worker itself.

- **Base URL:** `https://cf-control-mcp.amin-chinisaz-edu.workers.dev/v1`
- **Chat Completions:** `POST https://cf-control-mcp.amin-chinisaz-edu.workers.dev/v1/chat/completions`
- **Client authentication:** `Authorization: Bearer <GATEWAY_AUTH_TOKEN>`

Clients such as Hermes, OpenAI-compatible SDKs, agents, and local applications should use this Worker `/v1` surface.

They must **not** call the internal Cloudflare AI Gateway URL directly unless a task is explicitly about internal gateway verification or Cloudflare administration.

## Model selection

The public gateway accepts the repository's configured routing aliases and explicit registered model IDs.

Primary routing aliases are currently intended to include:

- `fast`
- `coding`
- `research`

Example request:

```bash
curl https://cf-control-mcp.amin-chinisaz-edu.workers.dev/v1/chat/completions \
  -H "Authorization: Bearer $CF_CONTROL_GATEWAY_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "coding",
    "messages": [
      {"role": "user", "content": "Hello from an OpenAI-compatible client"}
    ]
  }'
```

Recommended local/client environment convention:

```text
CF_CONTROL_GATEWAY_KEY=<value of the deployment's GATEWAY_AUTH_TOKEN>
```

Do not commit the value.

## Authentication boundaries

These credentials are intentionally separate and must never be substituted for one another:

| Surface | Credential | Who should use it |
|---|---|---|
| `/v1/*` public LLM gateway | `GATEWAY_AUTH_TOKEN` | Hermes, OpenAI-compatible clients, trusted applications |
| `/mcp` legacy owner path / Admin trust boundary | `MCP_AUTH_TOKEN` or the repository's supported OAuth/session flow | MCP/Admin clients only |
| Internal Cloudflare AI Gateway | `CF_AIG_TOKEN` when required | Worker/server-side runtime only |
| Cloudflare account administration | `CLOUDFLARE_API_TOKEN` | Worker/server-side Admin operations only |
| Upstream provider API keys / BYOK | provider-specific secret storage | Server-side / Cloudflare only |

Never expose `CF_AIG_TOKEN`, `MCP_AUTH_TOKEN`, `CLOUDFLARE_API_TOKEN`, or upstream provider API keys to a `/v1` client.

## Runtime path

The intended provider path is:

```text
Hermes / SDK / Agent
        |
        v
cf-control-mcp Worker
https://cf-control-mcp.amin-chinisaz-edu.workers.dev/v1
        |
        v
Provider + Model + Routing state in D1
        |
        v
Cloudflare AI Gateway (internal upstream layer)
        |
        v
Google / Gemini or another configured provider
```

The Cloudflare AI Gateway slug used by this repository is `cf-control-mcp`. Its internal compatibility endpoint is built from the Cloudflare account ID and is an implementation detail, not the public client base URL.

## Other production surfaces

- **Admin UI:** `https://cf-control-mcp.amin-chinisaz-edu.workers.dev/admin`
- **MCP endpoint:** `https://cf-control-mcp.amin-chinisaz-edu.workers.dev/mcp`

Do not confuse either of those with the `/v1` LLM gateway.

## Provider onboarding intent

Providers, models, and routing form a private OpenRouter-style control plane:

1. provider credentials stay server-side;
2. providers are registered in the existing control plane;
3. models belong to providers;
4. routing aliases such as `fast`, `coding`, and `research` resolve to registered models;
5. clients call only the public `/v1` Worker gateway;
6. clients never need Google/OpenAI/etc. upstream keys.

When extending provider onboarding, reuse the existing D1 provider/model/routing architecture and Cloudflare AI Gateway/BYOK paths. Do not invent a second public gateway.

## Hard behavioral rules

- Preserve `GATEWAY_AUTH_TOKEN` vs `MCP_AUTH_TOKEN` separation.
- Preserve explicit-model no-substitution behavior.
- Preserve provider/model enabled state and fail-closed callability.
- Do not fabricate provider health, readiness, availability, or verification.
- Do not place secrets in source, logs, fixtures, screenshots, or documentation.
- Normal D1/provider/routing configuration changes must not require a Worker redeploy unless Worker source/configuration itself changed.
- `BLOCKED`, `SKIP`, `UNVERIFIED`, and existing baseline debt are never clean PASS.
