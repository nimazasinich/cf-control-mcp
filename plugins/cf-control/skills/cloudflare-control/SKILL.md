---
name: cloudflare-control
description: Inspect and manage the user's Cloudflare account and search/read/research the open internet through the cf-control MCP tools, with read-first diagnostics and explicit approval before destructive changes.
---

# Cloudflare Control

Use the `cf_control` MCP server for Cloudflare account work.

## Operating rules

1. Prefer read-only inspection before proposing or performing a change.
2. Never invent zone IDs, record IDs, Worker names, KV namespace IDs, API results, or deployment state.
3. Before any destructive or externally visible action, summarize the exact intended change and obtain explicit user approval in the current conversation.
4. Treat these as write/destructive operations: creating or deleting DNS records, purging cache, writing KV values, deployments, routing changes, or any future tool that mutates Cloudflare state.
5. Never reveal, log, copy into source, or return Cloudflare API tokens, MCP bearer tokens, OAuth tokens, or other secrets.
6. If an MCP call fails authentication, stop and report the authentication failure; do not weaken endpoint security or bypass auth.
7. After a write, verify the resulting state with the corresponding read tool when available.

## Common flows

### Inventory

- List zones.
- List Workers.
- List KV namespaces only when relevant.
- Summarize what was actually returned by the tools.

### DNS change

- Resolve the target zone with `cf_list_zones`.
- Inspect existing records with `cf_list_dns_records`.
- Present the exact proposed record change and ask for approval.
- Perform the write only after approval.
- Re-read DNS records and verify the intended state.

### Worker inspection

- Use `cf_list_workers` first.
- Use `cf_get_worker_metadata` only for an existing returned Worker name.
- Distinguish observed configuration from recommendations.

## Internet Intelligence (web tools)

The server also exposes twelve `web_*` tools for searching, reading, and researching the public internet. Pick the narrowest tool that answers the need:

- `web_search` — the default for a general lookup. Use `provider="auto"` unless the user asks for a specific provider (`brave`, `tavily`, `exa`, `ddg`). It auto-falls back across configured providers and always has the keyless `ddg` fallback, so it works even with no paid search keys set.
- `web_search_multi` — when breadth/coverage matters and you want several providers merged and deduped in one call. Per-provider failures are reported separately rather than failing the whole call.
- `web_news_search` — for current events and recency-sensitive queries.
- `web_image_search` — image metadata only (needs `BRAVE_SEARCH_API_KEY`); it does not download image bytes.
- `web_fetch` — retrieve one known URL. It can issue `POST/PUT/PATCH/DELETE`, so treat any non-GET call as a write and confirm intent first.
- `web_render` — only when a plain `web_fetch` misses client-rendered content and you need the post-JavaScript HTML.
- `web_markdown` — to read an article/doc as clean Markdown without HTML noise.
- `web_extract` — to pull specific fields from a page via CSS selectors. It returns exactly what the DOM contained.
- `web_links` — to enumerate a page's outbound/internal links.
- `web_snapshot` — for a quick one-page overview (title, markdown, text, optional links) before deciding to fetch/render/crawl further. The snapshot is a static (no-JS) fetch and reports `source: "static-fetch"`; use `web_render` if you need post-JavaScript content.
- `web_crawl` — for a strictly bounded multi-page walk from a start URL. Keep page/depth limits small and prefer `same_origin_only`. It respects `robots.txt` by default (identity `cf-control-mcp/1.6`): pages disallowed by robots come back with `skippedReason: "ROBOTS_DENIED"` (a policy decision, not a network error), and an origin demanding a Crawl-delay above 10 s is dropped with `ROBOTS_CRAWL_DELAY_EXCEEDED`. Only pass `respect_robots: false` when you have a legitimate reason to ignore the site's policy.
- `web_deep_research` — for a multi-source investigation. It returns ranked sources plus extracted evidence passages; it does NOT produce a conclusion. Synthesize the answer yourself from the returned evidence and cite the source URLs. It also respects `robots.txt` by default; a source skipped for that reason is marked `skipped_reason: "ROBOTS_DENIED"`.

### Web operating rules

1. Never fabricate search results, page contents, URLs, quotes, or research conclusions. Report only what the tools actually returned.
2. When `web_deep_research` returns evidence, base any summary strictly on that evidence and attribute claims to their source URLs. If the evidence is thin or conflicting, say so.
3. A tool may return a structured error code (`CONFIGURATION_ERROR`, `PROVIDER_ERROR`, `RATE_LIMITED`, `TIMEOUT`, `BLOCKED_TARGET`, `INVALID_ARGUMENT`, `NETWORK_ERROR`, `RENDER_ERROR`). Report it plainly. A `CONFIGURATION_ERROR` means the relevant provider secret is not set — suggest setting it rather than retrying blindly.
4. Blocked targets (localhost, private/link-local ranges, cloud metadata) are refused by design; do not attempt to work around the SSRF guard.
5. Keep search `max_results`, crawl `max_pages`/`max_depth`, and research `max_sources` modest; request more only when needed.
6. Treat only `web_fetch` with a mutating HTTP method as write-like. Every other web tool is read-only.

## Authentication

This plugin intentionally contains no credentials. Authentication must be handled by the MCP client/app connection. Do not add bearer tokens to `.mcp.json` or commit them to GitHub.
