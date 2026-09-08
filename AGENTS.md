# cf-control-mcp Agent Contract

This repository exposes one public OpenAI-compatible client gateway. Do not
create or document a second public LLM gateway.

## Public Client Gateway

Base URL:

```text
https://cf-control-mcp.amin-chinisaz-edu.workers.dev/v1
```

Chat endpoint:

```text
POST https://cf-control-mcp.amin-chinisaz-edu.workers.dev/v1/chat/completions
```

Client authentication:

```text
Authorization: Bearer <GATEWAY_AUTH_TOKEN>
```

Primary routing aliases:

```text
fast
coding
research
```

Canonical client path:

```text
Hermes / OpenAI-compatible SDK / Agent
        -> cf-control-mcp Worker `/v1`
        -> D1 Provider + Model + Routing
        -> Cloudflare AI Gateway
        -> Google / Gemini / other configured provider
```

Clients must not receive, store, or use:

- Google upstream API keys
- provider upstream credentials
- `CF_AIG_TOKEN`
- `MCP_AUTH_TOKEN`
- `CLOUDFLARE_API_TOKEN`

Those values remain server-side only.

## Trust Boundaries

`/v1/*`:

- Authenticates with `GATEWAY_AUTH_TOKEN`.

`/mcp` plus owner/Admin trust boundary:

- Authenticates with `MCP_AUTH_TOKEN` and/or the supported OAuth/session flow.

Internal Cloudflare AI Gateway:

- Uses `CF_AIG_TOKEN` when configured or required.

Cloudflare account administration:

- Uses `CLOUDFLARE_API_TOKEN`.

Upstream provider credentials:

- Use the BYOK/server-side secret mechanism.

## Operator Surfaces

Admin:

```text
https://cf-control-mcp.amin-chinisaz-edu.workers.dev/admin
```

MCP:

```text
https://cf-control-mcp.amin-chinisaz-edu.workers.dev/mcp
```
