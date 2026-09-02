# cf-control-mcp

A remote MCP server, deployed as a Cloudflare Worker, that exposes tools for
controlling a Cloudflare account (zones, DNS, cache, Workers, KV) to any MCP
client — including ChatGPT (Developer Mode), Claude, or any other MCP-capable
agent.

## 1. Prerequisites

- A Cloudflare account with `wrangler` CLI access: `npm install -g wrangler`
- A **Cloudflare API Token** (not your Global API Key) with the permissions
  you want to expose, e.g.:
  - Zone → DNS → Edit
  - Zone → Cache Purge → Purge
  - Account → Workers Scripts → Read
  - Account → Workers KV Storage → Edit
  Create one at: https://dash.cloudflare.com/profile/api-tokens
- Your **Cloudflare Account ID** (shown on the right sidebar of any zone's
  Overview page in the dashboard).

## 2. Deploy

```bash
cd cf-control-mcp
npm install
wrangler login

# Generate a random secret to protect this server's /mcp endpoint.
# Anyone with this token can call every tool below, so treat it like a password.
openssl rand -hex 32

wrangler secret put MCP_AUTH_TOKEN        # paste the value you just generated
wrangler secret put CLOUDFLARE_API_TOKEN  # paste your Cloudflare API token
wrangler secret put CLOUDFLARE_ACCOUNT_ID # paste your Cloudflare account ID

npm run deploy
```

Wrangler prints your Worker's URL, e.g. `https://cf-control-mcp.<subdomain>.workers.dev`.
The MCP endpoint is that URL + `/mcp`.

## 3. Connect it to ChatGPT

ChatGPT connects to arbitrary remote MCP servers through **Developer Mode**
(Settings → Apps & Connectors → Advanced → Developer mode), available on
Plus/Pro/Business/Enterprise/Edu plans:

1. Settings → Apps & Connectors → **Create** (or **Add custom connector**).
2. **MCP server URL**: `https://cf-control-mcp.<subdomain>.workers.dev/mcp`
3. **Authentication**: choose "API key" / "Bearer token" and paste the
   `MCP_AUTH_TOKEN` value you generated above.
4. Save, then enable the connector for a conversation via the tools (+) menu.
   ChatGPT will call `initialize` and `tools/list` automatically and the
   Cloudflare tools will show up as available functions.

The same server URL + Bearer token also works with Claude ("Add custom
connector" in Settings → Connectors) or any other MCP client that supports
remote Streamable HTTP servers.

## 4. Tools exposed

| Tool | What it does | Destructive? |
|---|---|---|
| `cf_list_zones` | List domains on the account | no |
| `cf_list_dns_records` | List DNS records for a zone | no |
| `cf_create_dns_record` | Create a DNS record | yes |
| `cf_delete_dns_record` | Delete a DNS record | yes |
| `cf_purge_cache` | Purge edge cache (selective or full) | yes |
| `cf_list_workers` | List deployed Worker scripts | no |
| `cf_get_worker_metadata` | Get bindings/routes for a Worker | no |
| `cf_kv_list_namespaces` | List Workers KV namespaces | no |
| `cf_kv_get_value` | Read a KV key | no |
| `cf_kv_put_value` | Write a KV key | yes |

Add more by appending to the `tools` array in `src/index.ts` — each tool is
just a name, a JSON Schema `inputSchema`, and an async `handler(args, env)`
that calls `cfFetch()` (or `fetch()` directly for non-JSON endpoints like KV
values) and returns plain data.

## 5. Security notes

- `MCP_AUTH_TOKEN` is the only thing standing between the internet and your
  Cloudflare account. Rotate it (`wrangler secret put MCP_AUTH_TOKEN`) if it
  ever leaks.
- Scope the underlying `CLOUDFLARE_API_TOKEN` as narrowly as possible —
  don't hand the Worker a token with more permissions than the tools you
  actually want to expose need.
- Everything is logged via Workers Logs (`observability.enabled` in
  `wrangler.jsonc`) — check `wrangler tail` if a tool call misbehaves.
- For a locked-down team deployment, swap the static-bearer-token check in
  `fetch()` for real OAuth (e.g. Cloudflare Access, or the `agents` package's
  `OAuthProvider`) — the static token is the simplest option for personal/
  single-user use.

## 6. Local testing

```bash
npm run dev
curl -X POST http://localhost:8787/mcp \
  -H "Authorization: Bearer <your MCP_AUTH_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```
