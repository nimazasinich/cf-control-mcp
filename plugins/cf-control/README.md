# CF Control plugin

This plugin packages the `cf-control-mcp` remote MCP server for OpenAI plugin-compatible surfaces.

## MCP endpoint

`https://cf-control-mcp.amin-chinisaz-edu.workers.dev/mcp`

The plugin does **not** contain credentials. The current MCP Worker protects `/mcp` with a bearer token, so a client must supply authentication out of band or the server must be upgraded to OAuth.

## Web compatibility

OpenAI currently marks imported plugins that directly declare MCP servers in `.mcp.json` as **Desktop only**, even when the MCP server is a remote HTTPS endpoint. For ChatGPT Web, the supported route is an app-backed plugin: publish or enable a ChatGPT App for the MCP server, then reference that app from the plugin using `.app.json`.

Do not add an `.app.json` placeholder: it must contain a real ChatGPT App ID that actually exists and is available to the target account/workspace.

## Security

- Never commit `MCP_AUTH_TOKEN` or `CLOUDFLARE_API_TOKEN`.
- Prefer OAuth 2.1 for MCP client authorization if this integration will be installed through a UI.
- Keep Cloudflare API token scopes limited to the tools that are actually exposed.
- Require user approval before destructive tools are invoked.
