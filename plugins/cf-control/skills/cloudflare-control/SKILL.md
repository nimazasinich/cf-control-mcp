---
name: cloudflare-control
description: Inspect and manage the user's Cloudflare account through the cf-control MCP tools, with read-first diagnostics and explicit approval before destructive changes.
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

## Authentication

This plugin intentionally contains no credentials. Authentication must be handled by the MCP client/app connection. Do not add bearer tokens to `.mcp.json` or commit them to GitHub.
