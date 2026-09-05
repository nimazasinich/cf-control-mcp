#!/usr/bin/env python3
"""Deterministic in-repo upgrade for cf-control-mcp v1.1.0.

This migration adds focused Cloudflare Worker control tools while keeping the
existing generic cf_api_request escape hatch and OAuth/legacy transports intact.
It is intentionally idempotent so a rerun is safe.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one anchor, found {count}")
    return text.replace(old, new, 1)


def upgrade_index() -> None:
    path = ROOT / "src" / "index.ts"
    text = path.read_text(encoding="utf-8")

    helper_anchor = "const tools: ToolDef[] = ["
    helper = r'''async function cfUploadWorkerModule(
	env: Env,
	scriptName: string,
	source: string,
	moduleName: string,
	compatibilityDate: string,
	compatibilityFlags: string[],
): Promise<any> {
	const form = new FormData();
	const metadata: Record<string, unknown> = {
		main_module: moduleName,
		compatibility_date: compatibilityDate,
	};
	if (compatibilityFlags.length > 0) metadata.compatibility_flags = compatibilityFlags;
	form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }), "metadata.json");
	form.append(moduleName, new Blob([source], { type: "application/javascript+module" }), moduleName);

	const apiPath = `/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${scriptName}`;
	const res = await fetch(`https://api.cloudflare.com/client/v4${apiPath}`, {
		method: "PUT",
		headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
		body: form,
	});
	const contentType = res.headers.get("content-type") ?? "";
	const body = contentType.includes("application/json") ? await res.json() : await res.text();
	if (!res.ok || (typeof body === "object" && body !== null && (body as any).success === false)) {
		const errors = typeof body === "object" && body !== null ? (body as any).errors : undefined;
		throw new Error(
			`Cloudflare API error (${res.status}) uploading ${scriptName}: ${
				errors ? JSON.stringify(errors) : typeof body === "string" ? body : JSON.stringify(body)
			}`,
		);
	}
	return body;
}

const tools: ToolDef[] = ['''
    text = replace_once(text, helper_anchor, helper, "insert upload helper")

    tools_anchor = '\n\t{\n\t\tname: "cf_list_zones",'
    tools_block = r'''
	{
		name: "cf_verify_api_token",
		description: "Verify that the configured Cloudflare API token is valid and return its verification status.",
		inputSchema: { type: "object", properties: {} },
		annotations: { readOnlyHint: true, openWorldHint: true },
		handler: async (_args, env) => {
			const data = await cfFetch(env, "/user/tokens/verify");
			return data.result;
		},
	},
	{
		name: "cf_get_workers_subdomain",
		description: "Get the account workers.dev subdomain used for public Worker URLs.",
		inputSchema: { type: "object", properties: {} },
		annotations: { readOnlyHint: true, openWorldHint: true },
		handler: async (_args, env) => {
			const data = await cfFetch(env, `/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/subdomain`);
			return data.result;
		},
	},
	{
		name: "cf_list_worker_routes",
		description: "List Cloudflare Worker routes for a zone. Use cf_list_zones first to resolve zone_id.",
		inputSchema: {
			type: "object",
			properties: { zone_id: { type: "string", description: "Cloudflare zone ID" } },
			required: ["zone_id"],
		},
		annotations: { readOnlyHint: true, openWorldHint: true },
		handler: async (args, env) => {
			const data = await cfFetch(env, `/zones/${args.zone_id}/workers/routes`);
			return data.result;
		},
	},
	{
		name: "cf_deploy_worker_module",
		description:
			"Upload and immediately deploy a single-module ES module Cloudflare Worker. This is a destructive write operation. " +
			"Source is sent directly to Cloudflare and is not persisted by this MCP server.",
		inputSchema: {
			type: "object",
			properties: {
				script_name: { type: "string", description: "Worker script name, e.g. proxyharvest-gateway" },
				source: { type: "string", description: "Complete ES-module Worker source code" },
				module_name: { type: "string", description: "Multipart module filename. Default: worker.mjs" },
				compatibility_date: { type: "string", description: "YYYY-MM-DD. Defaults to today's UTC date." },
				compatibility_flags: { type: "array", items: { type: "string" }, description: "Optional Workers compatibility flags" },
				confirm_destructive: { type: "boolean", description: "Must be true to permit deployment" },
			},
			required: ["script_name", "source", "confirm_destructive"],
		},
		annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: true },
		handler: async (args, env) => {
			if (args.confirm_destructive !== true) throw new Error("confirm_destructive=true is required");
			const scriptName = String(args.script_name ?? "").trim();
			const moduleName = String(args.module_name ?? "worker.mjs").trim();
			const source = String(args.source ?? "");
			const compatibilityDate = String(args.compatibility_date ?? new Date().toISOString().slice(0, 10));
			const compatibilityFlags = Array.isArray(args.compatibility_flags)
				? args.compatibility_flags.map((flag) => String(flag)).filter(Boolean).slice(0, 32)
				: [];
			if (!/^[A-Za-z0-9_-]{1,64}$/.test(scriptName)) throw new Error("invalid script_name");
			if (!/^[A-Za-z0-9._-]{1,128}$/.test(moduleName)) throw new Error("invalid module_name");
			if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(compatibilityDate)) throw new Error("invalid compatibility_date");
			if (!source.trim()) throw new Error("source is empty");
			if (source.length > 1_500_000) throw new Error("source exceeds 1.5 MB MCP safety limit");
			const data = await cfUploadWorkerModule(env, scriptName, source, moduleName, compatibilityDate, compatibilityFlags);
			return { deployed: true, script_name: scriptName, compatibility_date: compatibilityDate, result: data.result ?? data };
		},
	},
	{
		name: "cf_delete_worker",
		description: "Delete a Cloudflare Worker script by name. Requires explicit confirm_destructive=true.",
		inputSchema: {
			type: "object",
			properties: {
				script_name: { type: "string", description: "Worker script name" },
				confirm_destructive: { type: "boolean", description: "Must be true to permit deletion" },
			},
			required: ["script_name", "confirm_destructive"],
		},
		annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
		handler: async (args, env) => {
			if (args.confirm_destructive !== true) throw new Error("confirm_destructive=true is required");
			const scriptName = String(args.script_name ?? "").trim();
			if (!/^[A-Za-z0-9_-]{1,64}$/.test(scriptName)) throw new Error("invalid script_name");
			const data = await cfFetch(env, `/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${scriptName}`, { method: "DELETE" });
			return { deleted: true, script_name: scriptName, result: data.result ?? data };
		},
	},
	{
		name: "cf_list_zones",'''
    text = replace_once(text, tools_anchor, "\n" + tools_block, "insert focused Worker tools")

    old_workers = 'return data.result.map((w: any) => ({ id: w.id, modified_on: w.modified_on, created_on: w.created_on }));'
    new_workers = '''return data.result.map((w: any) => ({
				id: w.id,
				modified_on: w.modified_on,
				created_on: w.created_on,
				compatibility_date: w.compatibility_date,
				deployment_id: w.deployment_id,
				etag: w.etag,
				last_deployed_from: w.last_deployed_from,
				handlers: w.handlers,
			}));'''
    text = replace_once(text, old_workers, new_workers, "enrich cf_list_workers")
    text = replace_once(
        text,
        'const SERVER_INFO = { name: "cf-control-mcp", version: "1.0.0" };',
        'const SERVER_INFO = { name: "cf-control-mcp", version: "1.1.0" };',
        "bump MCP server version",
    )
    text = replace_once(
        text,
        '\t\t\t\tname: SERVER_INFO.name,\n\t\t\t\tdescription:',
        '\t\t\t\tname: SERVER_INFO.name,\n\t\t\t\tversion: SERVER_INFO.version,\n\t\t\t\tdescription:',
        "expose root version",
    )
    path.write_text(text, encoding="utf-8")


def upgrade_package_files() -> None:
    package_path = ROOT / "package.json"
    package = json.loads(package_path.read_text(encoding="utf-8"))
    package["version"] = "1.1.0"
    package_path.write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")

    lock_path = ROOT / "package-lock.json"
    lock = json.loads(lock_path.read_text(encoding="utf-8"))
    lock["version"] = "1.1.0"
    if isinstance(lock.get("packages"), dict) and isinstance(lock["packages"].get(""), dict):
        lock["packages"][""]["version"] = "1.1.0"
    lock_path.write_text(json.dumps(lock, indent=2) + "\n", encoding="utf-8")


def upgrade_smoke() -> None:
    path = ROOT / "scripts" / "oauth_smoke.py"
    text = path.read_text(encoding="utf-8")
    text = replace_once(
        text,
        '    "cf_kv_get_value",\n}',
        '    "cf_kv_get_value",\n    "cf_verify_api_token",\n    "cf_get_workers_subdomain",\n    "cf_list_worker_routes",\n}',
        "extend read tool smoke set",
    )
    text = replace_once(
        text,
        '    "cf_kv_put_value",\n}',
        '    "cf_kv_put_value",\n    "cf_deploy_worker_module",\n    "cf_delete_worker",\n}',
        "extend write tool smoke set",
    )
    text = text.replace(
        'print("PASS: OAuth discovery, DCR, consent, PKCE, token exchange, refresh, read-only MCP scope, legacy path, and 401 challenge")',
        'print("PASS: OAuth discovery, DCR, consent, PKCE, token exchange, refresh, upgraded MCP tools, legacy path, and 401 challenge")',
    )
    path.write_text(text, encoding="utf-8")


def upgrade_readme() -> None:
    path = ROOT / "README.md"
    text = path.read_text(encoding="utf-8")
    text = text.replace(
        "For OAuth-connected clients, the server intentionally exposes **read-only tools only**. This matches the current ChatGPT Pro custom-MCP read/fetch capability and prevents write actions from leaking into the Pro connection.",
        "For OAuth-connected clients, explicit owner approval grants the same private Cloudflare control surface as the legacy owner-token path. The consent page clearly warns that write/destructive tools are available; use a narrowly scoped Cloudflare API token.",
    )
    start = text.find("### OAuth-visible tools")
    end_marker = "Write tools are filtered from OAuth `tools/list` and are blocked server-side if called with an OAuth access token."
    end = text.find(end_marker)
    if start != -1 and end != -1:
        end += len(end_marker)
        replacement = '''### OAuth-visible tools

OAuth clients receive the full owner-approved tool catalog. v1.1.0 adds focused Worker operations on top of the existing DNS, cache, KV, and generic API tools:

| Tool | Purpose |
|---|---|
| `cf_verify_api_token` | Verify the configured Cloudflare API token |
| `cf_get_workers_subdomain` | Resolve the account workers.dev subdomain |
| `cf_list_worker_routes` | List Worker routes for a zone |
| `cf_deploy_worker_module` | Upload/deploy a single-module ES Worker with explicit destructive confirmation |
| `cf_delete_worker` | Delete a Worker with explicit destructive confirmation |
| `cf_api_request` | Generic Cloudflare API v4 passthrough for endpoints not covered by focused tools |

`cf_deploy_worker_module` sends source directly to Cloudflare and does not persist it in the MCP Worker. The tool enforces conservative script/module-name validation, a 1.5 MB source limit, and `confirm_destructive=true`.'''
        text = text[:start] + replacement + text[end:]
    else:
        raise RuntimeError("README OAuth tool section anchors not found")

    version_note = '''\n## v1.1.0 focused Worker-control upgrade\n\nThe MCP server now exposes dedicated token verification, workers.dev discovery, Worker route listing, direct single-module Worker deployment, and Worker deletion tools. `cf_list_workers` also returns richer deployment metadata. The generic `cf_api_request` remains available for advanced Cloudflare API operations.\n'''
    if "## v1.1.0 focused Worker-control upgrade" not in text:
        insert_at = text.find("\n## Verification")
        if insert_at == -1:
            text += version_note
        else:
            text = text[:insert_at] + version_note + text[insert_at:]
    path.write_text(text, encoding="utf-8")


def write_result() -> None:
    path = ROOT / "results" / "mcp-upgrade" / "v1.1.0.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "ok": True,
        "version": "1.1.0",
        "executed_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "added_tools": [
            "cf_verify_api_token",
            "cf_get_workers_subdomain",
            "cf_list_worker_routes",
            "cf_deploy_worker_module",
            "cf_delete_worker",
        ],
        "upgraded_tools": ["cf_list_workers"],
        "notes": [
            "direct Worker deployment uses Cloudflare multipart upload API",
            "destructive Worker deploy/delete require confirm_destructive=true",
            "OAuth and legacy owner-token transports remain compatible",
        ],
    }
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    upgrade_index()
    upgrade_package_files()
    upgrade_smoke()
    upgrade_readme()
    write_result()
    print("Prepared cf-control-mcp v1.1.0 focused Worker-control upgrade")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
