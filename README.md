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

For OAuth-connected clients, explicit owner approval grants the same private Cloudflare control surface as the legacy owner-token path. The consent page clearly warns that write/destructive tools are available; use a narrowly scoped Cloudflare API token.

### OAuth-visible tools

OAuth clients receive the full owner-approved tool catalog. v1.1.0 adds focused Worker operations on top of the existing DNS, cache, KV, and generic API tools:

| Tool | Purpose |
|---|---|
| `cf_verify_api_token` | Verify the configured Cloudflare API token |
| `cf_get_workers_subdomain` | Resolve the account workers.dev subdomain |
| `cf_list_worker_routes` | List Worker routes for a zone |
| `cf_deploy_worker_module` | Upload/deploy a single-module ES Worker with explicit destructive confirmation |
| `cf_delete_worker` | Delete a Worker with explicit destructive confirmation |
| `cf_api_request` | Generic Cloudflare API v4 passthrough for endpoints not covered by focused tools |

`cf_deploy_worker_module` sends source directly to Cloudflare and does not persist it in the MCP Worker. The tool enforces conservative script/module-name validation, a 1.5 MB source limit, and `confirm_destructive=true`.

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

## v1.1.0 focused Worker-control upgrade

The MCP server now exposes dedicated token verification, workers.dev discovery, Worker route listing, direct single-module Worker deployment, and Worker deletion tools. `cf_list_workers` also returns richer deployment metadata. The generic `cf_api_request` remains available for advanced Cloudflare API operations.

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
