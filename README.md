# cf-control-mcp

A private remote MCP server deployed on Cloudflare Workers for inspecting and managing a Cloudflare account. It supports Streamable HTTP at `/mcp`, OAuth discovery + PKCE for ChatGPT-compatible clients, and the original owner bearer-token path for legacy/desktop use.

## Security model

There are two separate credential layers:

1. **Client → MCP Worker** — OAuth 2.1-style authorization with PKCE and explicit owner approval. The existing `MCP_AUTH_TOKEN` is used as the owner approval secret and as the HMAC root key for stateless OAuth artifacts.
2. **MCP Worker → Cloudflare API** — `CLOUDFLARE_API_TOKEN`, stored only as a Worker secret. It is never returned to MCP clients.

Rotating `MCP_AUTH_TOKEN` invalidates previously registered OAuth clients, authorization codes, access tokens, refresh tokens, and the legacy bearer credential.

## Deploy

```bash
npm install
wrangler login

openssl rand -hex 32
wrangler secret put MCP_AUTH_TOKEN
wrangler secret put CLOUDFLARE_API_TOKEN
wrangler secret put CLOUDFLARE_ACCOUNT_ID

npm run deploy
```

The production MCP endpoint is:

```text
https://cf-control-mcp.amin-chinisaz-edu.workers.dev/mcp
```

`wrangler.jsonc` routes the Worker through `src/oauth-worker.ts`, which wraps the existing MCP implementation in `src/index.ts`.

## OAuth endpoints

The Worker exposes the metadata and endpoints required by an OAuth-capable MCP client:

| Endpoint | Purpose |
|---|---|
| `/.well-known/oauth-protected-resource` | Protected-resource metadata |
| `/.well-known/oauth-authorization-server` | Authorization-server metadata |
| `/register` | Dynamic client registration |
| `/authorize` | PKCE authorization + explicit owner approval page |
| `/token` | Authorization-code and refresh-token exchange |
| `/mcp` | Streamable HTTP MCP endpoint |

OAuth public clients must use PKCE with `S256`. The authorization page displays the requesting client and redirect URI, then requires the owner approval token before issuing an authorization code.

The OAuth scopes are:

- `mcp:read`
- `offline_access`

`offline_access` enables refresh tokens so clients can maintain connectivity without repeating authorization every hour.

## ChatGPT Web / Pro

Use the MCP URL only:

```text
https://cf-control-mcp.amin-chinisaz-edu.workers.dev/mcp
```

When ChatGPT Web has Custom MCP / Developer Mode available for the account, it should discover OAuth from the MCP 401 challenge and `.well-known` metadata, dynamically register itself, open the `/authorize` approval page, and complete PKCE after owner approval.

For OAuth-connected clients, the server intentionally exposes **read-only tools only**. This matches the current ChatGPT Pro custom-MCP read/fetch capability and prevents write actions from leaking into the Pro connection.

### OAuth-visible tools

| Tool | Purpose |
|---|---|
| `cf_list_zones` | List zones/domains |
| `cf_list_dns_records` | List DNS records |
| `cf_list_workers` | List Workers |
| `cf_get_worker_metadata` | Inspect Worker metadata |
| `cf_kv_list_namespaces` | List KV namespaces |
| `cf_kv_get_value` | Read a KV key |

Write tools are filtered from OAuth `tools/list` and are blocked server-side if called with an OAuth access token.

## Legacy owner-token access

The original direct bearer-token path is retained for trusted desktop/CI clients. Supplying the exact `MCP_AUTH_TOKEN` as the bearer token bypasses the OAuth flow and exposes the full existing toolset.

```bash
curl -X POST https://cf-control-mcp.amin-chinisaz-edu.workers.dev/mcp \
  -H "Authorization: Bearer <MCP_AUTH_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

### Full legacy toolset

| Tool | What it does | Destructive? |
|---|---|---|
| `cf_list_zones` | List domains on the account | no |
| `cf_list_dns_records` | List DNS records for a zone | no |
| `cf_create_dns_record` | Create a DNS record | yes |
| `cf_delete_dns_record` | Delete a DNS record | yes |
| `cf_purge_cache` | Purge edge cache | yes |
| `cf_list_workers` | List deployed Worker scripts | no |
| `cf_get_worker_metadata` | Get Worker bindings/routes metadata | no |
| `cf_kv_list_namespaces` | List Workers KV namespaces | no |
| `cf_kv_get_value` | Read a KV key | no |
| `cf_kv_put_value` | Write a KV key | yes |

## Verification

Typecheck locally:

```bash
npx tsc --noEmit
```

The deployment workflow also runs `scripts/oauth_smoke.py` against the live Worker. The smoke test verifies:

- OAuth protected-resource discovery
- authorization-server discovery
- Dynamic Client Registration
- PKCE `S256`
- explicit consent/approval page
- authorization-code exchange
- refresh-token grant
- read-only OAuth `tools/list`
- server-side blocking of write tools for OAuth clients
- legacy owner-token compatibility
- unauthenticated `401` with `WWW-Authenticate` resource metadata

The smoke test never prints the owner secret or issued OAuth tokens.

## Plugin package

The repository also contains an OpenAI/Codex plugin package under `plugins/cf-control` and marketplace metadata under `.agents/plugins/marketplace.json`.

The direct `.mcp.json` plugin package is useful for MCP-capable desktop environments. ChatGPT Web custom-app availability still depends on the account exposing Developer Mode / Custom MCP UI; the repository does not invent or hard-code a fake ChatGPT App ID.

## Operational notes

- Scope `CLOUDFLARE_API_TOKEN` to only the Cloudflare permissions required by the tools you intend to use.
- Keep all secrets in Worker/GitHub secret stores, never in the repository.
- The OAuth authorization artifacts are stateless and short-lived; PKCE binds authorization codes to the initiating client.
- `MCP_AUTH_TOKEN` rotation is the emergency revocation mechanism for all client-side access.
- Workers observability remains enabled in `wrangler.jsonc`.
