# CF Control plugin

This plugin packages the `cf-control-mcp` remote MCP server for OpenAI plugin-compatible surfaces.

## MCP endpoint

`https://cf-control-mcp.amin-chinisaz-edu.workers.dev/mcp`

The plugin contains no credentials. The Worker now supports OAuth discovery, Dynamic Client Registration, PKCE/S256, explicit owner approval, access tokens, and refresh tokens. OAuth clients receive only the read-only Cloudflare tool set.

The original static `MCP_AUTH_TOKEN` bearer path remains available for trusted legacy/desktop clients and CI. Never commit that token into the plugin.

## Web compatibility

The MCP server itself is OAuth-ready for ChatGPT-compatible remote MCP clients. ChatGPT Web still requires the account/workspace to expose Developer Mode / Custom MCP configuration before this endpoint can be attached there.

The direct plugin package declares the MCP endpoint in `.mcp.json`, so plugin-surface availability is determined by the OpenAI client/runtime. Do not add a fake `.app.json`; an app-backed plugin must reference a real ChatGPT App ID that actually exists and is enabled for the target account/workspace.

## Security

- Never commit `MCP_AUTH_TOKEN` or `CLOUDFLARE_API_TOKEN`.
- OAuth authorization requires explicit owner approval and PKCE/S256.
- OAuth clients are restricted to read-only tools server-side.
- Keep Cloudflare API token scopes limited to the tools that are actually exposed.
- The legacy owner-token path can access destructive tools and must remain tightly protected.
