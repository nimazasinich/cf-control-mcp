/**
 * cf-control-mcp
 * -----------------------------------------------------------------------
 * A remote MCP (Model Context Protocol) server, deployed as a Cloudflare
 * Worker, that lets an MCP client (ChatGPT Developer Mode, Claude, etc.)
 * inspect and manage a Cloudflare account: zones, DNS records, cache
 * purging, Workers scripts, and KV namespaces.
 *
 * Transport: Streamable HTTP, stateless mode (single POST -> single JSON
 * response). This avoids needing Durable Objects / SSE session state and
 * is the transport recommended for simple, scalable remote MCP servers.
 *
 * Auth model (two layers):
 *  1. Client -> this Worker: a static bearer token (MCP_AUTH_TOKEN) that
 *     you generate yourself and paste into ChatGPT's connector config.
 *     This is what stops a random person from calling your server.
 *  2. This Worker -> Cloudflare API: your real Cloudflare API token
 *     (CLOUDFLARE_API_TOKEN), stored as a Worker secret. It is NEVER sent
 *     to the MCP client - the client only ever talks to this Worker.
 */

import { internetTools } from "./internet/tools";

export interface Env {
	MCP_AUTH_TOKEN: string;
	CLOUDFLARE_API_TOKEN: string;
	CLOUDFLARE_ACCOUNT_ID: string;
	/** v1.8 Admin Console — D1 metadata store (providers/models/routing/audit). Never holds raw credentials. */
	DM_DB: D1Database;
	/** Optional. Set with `wrangler secret put HUGGINGFACE_TOKEN` to enable the hf_* tools. */
	HUGGINGFACE_TOKEN?: string;
	/** Optional. Set with `wrangler secret put GITHUB_PAT` to enable the gh_* real-sandbox tools. */
	GITHUB_PAT?: string;
	/** Optional. "owner/repo" that hosts .github/workflows/mcp-exec.yml. Defaults to nimazasinich/cf-control-mcp. */
	GITHUB_REPO?: string;
	/** Optional. Brave Search API key — enables the `brave` search provider. Set via `wrangler secret put BRAVE_SEARCH_API_KEY`. */
	BRAVE_SEARCH_API_KEY?: string;
	/** Optional. Tavily API key — enables the `tavily` search provider. Set via `wrangler secret put TAVILY_API_KEY`. */
	TAVILY_API_KEY?: string;
	/** Optional. Exa API key — enables the `exa` search provider. Set via `wrangler secret put EXA_API_KEY`. */
	EXA_API_KEY?: string;

	// -------------------------------------------------------------------------
	// Provider Gateway (v1.7) — OpenAI-compatible /v1/* endpoints for Gemini
	// -------------------------------------------------------------------------

	/**
	 * Bearer token that clients must supply to access /v1/*.
	 * Completely separate from MCP_AUTH_TOKEN — never forwarded to Google.
	 * Set via: wrangler secret put GATEWAY_AUTH_TOKEN
	 */
	GATEWAY_AUTH_TOKEN?: string;
	/**
	 * Cloudflare AI Gateway gateway slug.
	 * Primary/intended mode: /v1/chat/completions is routed via the AI
	 * Gateway compat endpoint, which resolves the Google AI Studio credential
	 * itself via BYOK (Secrets Store) — the Worker never holds that key.
	 * Set as a plain var (not a secret) in wrangler.jsonc.
	 */
	CF_AIG_GATEWAY_SLUG?: string;
	/**
	 * Optional AI Gateway auth token (sent as cf-aig-authorization). Only
	 * needed if the gateway is configured as an "authenticated gateway" in
	 * Cloudflare. Cloudflare-side credential; never forwarded to Google.
	 * Set via: wrangler secret put CF_AIG_TOKEN
	 */
	CF_AIG_TOKEN?: string;
	/**
	 * Legacy escape hatch, disabled by default. Set to "true" to allow the
	 * Worker to call Google AI Studio directly with a locally-held key
	 * instead of using AI Gateway BYOK. Discouraged — see provider-gateway
	 * module docs.
	 */
	ALLOW_DIRECT_PROVIDER_KEY?: string;
	/**
	 * Google AI Studio API key. Only consulted when
	 * ALLOW_DIRECT_PROVIDER_KEY === "true" (legacy direct path).
	 * Under standard BYOK usage this should not be set as a Worker secret.
	 * Set via: wrangler secret put GOOGLE_AI_STUDIO_KEY
	 */
	GOOGLE_AI_STUDIO_KEY?: string;
}

// ---------------------------------------------------------------------------
// JSON-RPC / MCP plumbing
// ---------------------------------------------------------------------------

interface JsonRpcRequest {
	jsonrpc: "2.0";
	id: string | number | null;
	method: string;
	params?: Record<string, unknown>;
}

interface JsonRpcSuccess {
	jsonrpc: "2.0";
	id: string | number | null;
	result: unknown;
}

interface JsonRpcError {
	jsonrpc: "2.0";
	id: string | number | null;
	error: { code: number; message: string; data?: unknown };
}

const JSONRPC_PARSE_ERROR = -32700;
const JSONRPC_INVALID_REQUEST = -32600;
const JSONRPC_METHOD_NOT_FOUND = -32601;
const JSONRPC_INTERNAL_ERROR = -32603;

function rpcResult(id: JsonRpcRequest["id"], result: unknown): JsonRpcSuccess {
	return { jsonrpc: "2.0", id, result };
}

function rpcError(id: JsonRpcRequest["id"], code: number, message: string, data?: unknown): JsonRpcError {
	return { jsonrpc: "2.0", id, error: { code, message, data } };
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

interface ToolDef {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	annotations?: {
		readOnlyHint?: boolean;
		destructiveHint?: boolean;
		idempotentHint?: boolean;
		openWorldHint?: boolean;
	};
	handler: (args: Record<string, unknown>, env: Env) => Promise<unknown>;
}

/** Minimal fetch wrapper for the Cloudflare API v4, with actionable errors. */
async function cfFetch(env: Env, path: string, init: RequestInit = {}): Promise<any> {
	const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
			"Content-Type": "application/json",
			...(init.headers ?? {}),
		},
	});

	const contentType = res.headers.get("content-type") ?? "";
	const body = contentType.includes("application/json") ? await res.json() : await res.text();

	if (!res.ok || (typeof body === "object" && body !== null && (body as any).success === false)) {
		const errors = typeof body === "object" && body !== null ? (body as any).errors : undefined;
		throw new Error(
			`Cloudflare API error (${res.status}) on ${path}: ${
				errors ? JSON.stringify(errors) : typeof body === "string" ? body : JSON.stringify(body)
			}`,
		);
	}

	return body;
}

async function cfUploadWorkerModule(
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

const PROXYHARVEST_MCP_V12 = "1.2.0";
const PROXYHARVEST_GATEWAY_BASE = "https://proxyharvest-gateway.amin-chinisaz-edu.workers.dev";

function proxyHarvestBase(args: Record<string, unknown>): string {
	const raw = String(args.gateway_url ?? PROXYHARVEST_GATEWAY_BASE).trim().replace(/\/$/, "");
	const u = new URL(raw);
	if (u.protocol !== "https:") throw new Error("gateway_url must use https");
	return u.toString().replace(/\/$/, "");
}

async function proxyHarvestJson(base: string, path: string, init: RequestInit = {}): Promise<any> {
	const res = await fetch(base + path, { ...init, headers: { Accept: "application/json", ...(init.headers ?? {}) } });
	const body = await res.json().catch(() => null);
	if (!res.ok) throw new Error(`ProxyHarvest gateway HTTP ${res.status} on ${path}`);
	if (!body || typeof body !== "object") throw new Error(`ProxyHarvest gateway returned non-JSON on ${path}`);
	return body;
}

/** Minimal fetch wrapper for the Hugging Face Hub API, with actionable errors. */
async function hfFetch(env: Env, path: string, init: RequestInit = {}): Promise<any> {
	if (!env.HUGGINGFACE_TOKEN) throw new Error("HUGGINGFACE_TOKEN is not configured as a Worker secret");
	const res = await fetch(`https://huggingface.co${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${env.HUGGINGFACE_TOKEN}`,
			...(init.headers ?? {}),
		},
	});
	const contentType = res.headers.get("content-type") ?? "";
	const body = contentType.includes("application/json") ? await res.json() : await res.text();
	if (!res.ok) {
		throw new Error(
			`Hugging Face API error (${res.status}) on ${path}: ${typeof body === "string" ? body : JSON.stringify(body)}`,
		);
	}
	return body;
}

function normalizeRepoType(value: unknown): "model" | "dataset" | "space" {
	const t = String(value ?? "model").trim().toLowerCase();
	if (t === "model" || t === "dataset" || t === "space") return t;
	throw new Error("repo_type must be one of: model, dataset, space");
}

function encodeRepoId(value: unknown): string {
	const id = String(value ?? "").trim();
	if (!id) throw new Error("repo_id is required");
	return id.split("/").map(encodeURIComponent).join("/");
}

function base64EncodeUtf8(text: string): string {
	const bytes = new TextEncoder().encode(text);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

// ---------------------------------------------------------------------------
// Sandbox code execution (Piston, emkc.org) — free, no API key required.
// ---------------------------------------------------------------------------

/** Executes a snippet via the public Piston API. Ephemeral, stateless, no secrets involved. */
async function pistonExecute(
	language: string,
	version: string,
	code: string,
	stdin: string,
	args: string[],
): Promise<any> {
	const res = await fetch("https://emkc.org/api/v2/piston/execute", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			language,
			version: version || "*",
			files: [{ content: code }],
			stdin: stdin || "",
			args: args || [],
		}),
	});
	const contentType = res.headers.get("content-type") ?? "";
	const body = contentType.includes("application/json") ? await res.json() : await res.text();
	if (!res.ok) {
		throw new Error(`Piston API error (${res.status}): ${typeof body === "string" ? body : JSON.stringify(body)}`);
	}
	return body;
}

async function pistonRuntimes(): Promise<any> {
	const res = await fetch("https://emkc.org/api/v2/piston/runtimes");
	if (!res.ok) throw new Error(`Piston API error (${res.status}) listing runtimes`);
	return await res.json();
}

// ---------------------------------------------------------------------------
// NOTE: Generic outbound internet access (web_fetch), keyless web search
// (web_search), and their SSRF guard now live in src/internet/ (v1.6.0
// "Internet Intelligence"). The hardened, multi-provider implementations there
// supersede the old inline DuckDuckGo scraper + regex host filter.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Real sandbox execution via GitHub Actions (.github/workflows/mcp-exec.yml).
// A full ephemeral Ubuntu VM with real internet access, free on GitHub's
// Actions minutes, dispatched and polled through the REST API.
// ---------------------------------------------------------------------------

function ghRepo(env: Env): string {
	return (env.GITHUB_REPO || "nimazasinich/cf-control-mcp").trim();
}

async function ghFetch(env: Env, path: string, init: RequestInit = {}): Promise<any> {
	if (!env.GITHUB_PAT) throw new Error("GITHUB_PAT is not configured as a Worker secret");
	const res = await fetch(`https://api.github.com${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${env.GITHUB_PAT}`,
			Accept: "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28",
			"User-Agent": "cf-control-mcp",
			...(init.headers ?? {}),
		},
	});
	if (res.status === 204) return null;
	const contentType = res.headers.get("content-type") ?? "";
	const body = contentType.includes("application/json") ? await res.json() : await res.text();
	if (!res.ok) {
		throw new Error(`GitHub API error (${res.status}) on ${path}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
	}
	return body;
}

function newRunKey(): string {
	return crypto.randomUUID();
}

/** Finds the workflow run whose dynamic run-name embeds this run_key. May return null if not visible yet. */
async function ghFindRunByKey(env: Env, runKey: string): Promise<any | null> {
	const repo = ghRepo(env);
	const data = await ghFetch(env, `/repos/${repo}/actions/workflows/mcp-exec.yml/runs?event=workflow_dispatch&per_page=20`);
	const runs: any[] = data.workflow_runs ?? [];
	return runs.find((r) => typeof r.display_title === "string" && r.display_title.includes(runKey)) ?? null;
}

/** Fetches the plain-text log for the first job of a completed run. */
async function ghGetRunLog(env: Env, runId: number): Promise<string> {
	const repo = ghRepo(env);
	const jobsData = await ghFetch(env, `/repos/${repo}/actions/runs/${runId}/jobs`);
	const job = (jobsData.jobs ?? [])[0];
	if (!job) return "(no jobs found for this run yet)";
	const res = await fetch(`https://api.github.com/repos/${repo}/actions/jobs/${job.id}/logs`, {
		headers: {
			Authorization: `Bearer ${env.GITHUB_PAT}`,
			Accept: "application/vnd.github+json",
			"User-Agent": "cf-control-mcp",
		},
	});
	if (!res.ok) throw new Error(`GitHub API error (${res.status}) fetching job logs`);
	const text = await res.text();
	return text.length > 60_000 ? `${text.slice(0, 60_000)}\n... [truncated]` : text;
}

const tools: ToolDef[] = [
	{
		name: "proxyharvest_gateway_health",
		description: "Check the live ProxyHarvest Cloudflare gateway, Cloud Edge Relay boundary, and optional HF repair-advisor health. This never represents protocol/tunnel/WireGuard verification.",
		inputSchema: { type: "object", properties: {
			gateway_url: { type: "string", description: "Optional HTTPS gateway base URL" },
			deep_ai: { type: "boolean", description: "Run a real HF provider health check when true" },
		} },
		annotations: { readOnlyHint: true, openWorldHint: true },
		handler: async (args) => {
			const base = proxyHarvestBase(args);
			const [gateway, edge, ai] = await Promise.all([
				proxyHarvestJson(base, "/health"),
				proxyHarvestJson(base, "/bridge/health"),
				proxyHarvestJson(base, `/ai/health${args.deep_ai === true ? "?deep=1" : ""}`),
			]);
			return { ok: Boolean(gateway.ok && edge.ok && ai.ok), gateway, edge, ai, verification: false, verification_source: "local-real-test-bridge-only" };
		},
	},
	{
		name: "proxyharvest_source_check",
		description: "Check one public ProxyHarvest source through the Cloudflare source-check route. This is source reachability only, never proxy verification.",
		inputSchema: { type: "object", properties: {
			url: { type: "string", description: "Public HTTP/HTTPS source URL" },
			gateway_url: { type: "string", description: "Optional HTTPS gateway base URL" },
		}, required: ["url"] },
		annotations: { readOnlyHint: true, openWorldHint: true },
		handler: async (args) => {
			const base = proxyHarvestBase(args);
			const source = String(args.url ?? "").trim();
			if (!/^https?:\/\//i.test(source)) throw new Error("url must be public http/https");
			const result = await proxyHarvestJson(base, `/source-check?url=${encodeURIComponent(source)}`);
			return { ...result, source, verification: false, classification: "source-reachability" };
		},
	},
	{
		name: "proxyharvest_transport_probe",
		description: "Probe TCP/TLS transport reachability through the ProxyHarvest Cloudflare gateway. Reachable must never be interpreted as protocol/tunnel/WireGuard Verified.",
		inputSchema: { type: "object", properties: {
			host: { type: "string", description: "Public hostname or IP" },
			port: { type: "number", description: "TCP port 1-65535" },
			tls: { type: "boolean", description: "Prefer TLS probe" },
			gateway_url: { type: "string", description: "Optional HTTPS gateway base URL" },
		}, required: ["host"] },
		annotations: { readOnlyHint: true, openWorldHint: true },
		handler: async (args) => {
			const base = proxyHarvestBase(args);
			const host = String(args.host ?? "").trim();
			const port = Math.max(1, Math.min(65535, Number(args.port ?? 443) || 443));
			const tls = args.tls === true ? "1" : "0";
			const result = await proxyHarvestJson(base, `/probe?host=${encodeURIComponent(host)}&port=${port}&tls=${tls}`);
			return { ...result, verification: false, classification: "transport-reachability", verified: false };
		},
	},
	{
		name: "cf_api_request",
		description:
			"Call any Cloudflare API v4 endpoint directly, with any HTTP method. Use this for anything not covered " +
			"by the other specific tools (zone settings, SSL/TLS, WAF/firewall rules, Access policies, R2, D1, " +
			"Workers KV, Stream, Images, Load Balancing, Pages, account members, billing, etc). " +
			"Path is relative to https://api.cloudflare.com/client/v4, e.g. '/zones/{zone_id}/settings/ssl'. " +
			"This has full read/write/delete power over the Cloudflare account tied to CLOUDFLARE_API_TOKEN.",
		inputSchema: {
			type: "object",
			properties: {
				method: { type: "string", description: "HTTP method: GET, POST, PUT, PATCH, DELETE" },
				path: { type: "string", description: "API path starting with '/', e.g. '/zones'" },
				body: { type: "object", description: "JSON body for POST/PUT/PATCH. Omit for GET/DELETE." },
				query: { type: "object", description: "Optional query string params as key/value pairs." },
			},
			required: ["method", "path"],
		},
		annotations: { destructiveHint: true, openWorldHint: true },
		handler: async (args, env) => {
			let path = String(args.path);
			if (!path.startsWith("/")) path = "/" + path;
			if (args.query && typeof args.query === "object") {
				const qs = new URLSearchParams();
				for (const [k, v] of Object.entries(args.query as Record<string, unknown>)) qs.set(k, String(v));
				const sep = path.includes("?") ? "&" : "?";
				path = `${path}${sep}${qs.toString()}`;
			}
			const method = String(args.method || "GET").toUpperCase();
			const init: RequestInit = { method };
			if (args.body !== undefined && method !== "GET" && method !== "DELETE") {
				init.body = JSON.stringify(args.body);
			}
			return await cfFetch(env, path, init);
		},
	},

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
		name: "cf_list_zones",
		description:
			"List Cloudflare zones (domains) on this account. Optionally filter by name (exact or partial match).",
		inputSchema: {
			type: "object",
			properties: {
				name: { type: "string", description: "Filter zones by domain name, e.g. 'example.com'" },
				per_page: { type: "number", description: "Results per page (default 50, max 50)" },
			},
		},
		annotations: { readOnlyHint: true, openWorldHint: true },
		handler: async (args, env) => {
			const params = new URLSearchParams();
			if (args.name) params.set("name", String(args.name));
			params.set("per_page", String(args.per_page ?? 50));
			const data = await cfFetch(env, `/zones?${params.toString()}`);
			return data.result.map((z: any) => ({ id: z.id, name: z.name, status: z.status, plan: z.plan?.name }));
		},
	},
	{
		name: "cf_list_dns_records",
		description: "List DNS records for a given zone ID. Use cf_list_zones first to find the zone ID.",
		inputSchema: {
			type: "object",
			properties: {
				zone_id: { type: "string", description: "Zone ID (from cf_list_zones)" },
				type: { type: "string", description: "Filter by record type, e.g. 'A', 'CNAME', 'TXT'" },
				name: { type: "string", description: "Filter by record name, e.g. 'www.example.com'" },
			},
			required: ["zone_id"],
		},
		annotations: { readOnlyHint: true, openWorldHint: true },
		handler: async (args, env) => {
			const params = new URLSearchParams();
			if (args.type) params.set("type", String(args.type));
			if (args.name) params.set("name", String(args.name));
			const data = await cfFetch(env, `/zones/${args.zone_id}/dns_records?${params.toString()}`);
			return data.result.map((r: any) => ({
				id: r.id,
				type: r.type,
				name: r.name,
				content: r.content,
				ttl: r.ttl,
				proxied: r.proxied,
			}));
		},
	},
	{
		name: "cf_create_dns_record",
		description: "Create a new DNS record in a zone.",
		inputSchema: {
			type: "object",
			properties: {
				zone_id: { type: "string", description: "Zone ID" },
				type: { type: "string", description: "Record type, e.g. 'A', 'CNAME', 'TXT'" },
				name: { type: "string", description: "Record name, e.g. 'app.example.com'" },
				content: { type: "string", description: "Record value, e.g. an IP address or hostname" },
				ttl: { type: "number", description: "TTL in seconds (1 = automatic). Default 1." },
				proxied: { type: "boolean", description: "Whether to proxy through Cloudflare (orange-cloud). Default false." },
			},
			required: ["zone_id", "type", "name", "content"],
		},
		annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: true },
		handler: async (args, env) => {
			const data = await cfFetch(env, `/zones/${args.zone_id}/dns_records`, {
				method: "POST",
				body: JSON.stringify({
					type: args.type,
					name: args.name,
					content: args.content,
					ttl: args.ttl ?? 1,
					proxied: args.proxied ?? false,
				}),
			});
			return data.result;
		},
	},
	{
		name: "cf_delete_dns_record",
		description: "Delete a DNS record by ID. Use cf_list_dns_records first to find the record ID.",
		inputSchema: {
			type: "object",
			properties: {
				zone_id: { type: "string", description: "Zone ID" },
				record_id: { type: "string", description: "DNS record ID to delete" },
			},
			required: ["zone_id", "record_id"],
		},
		annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
		handler: async (args, env) => {
			const data = await cfFetch(env, `/zones/${args.zone_id}/dns_records/${args.record_id}`, { method: "DELETE" });
			return data.result;
		},
	},
	{
		name: "cf_purge_cache",
		description:
			"Purge Cloudflare's edge cache for a zone. Pass specific 'files' (URLs) to purge selectively, or omit to purge everything.",
		inputSchema: {
			type: "object",
			properties: {
				zone_id: { type: "string", description: "Zone ID" },
				files: {
					type: "array",
					items: { type: "string" },
					description: "Specific URLs to purge. Omit (or leave empty) to purge the entire zone cache.",
				},
			},
			required: ["zone_id"],
		},
		annotations: { destructiveHint: true, openWorldHint: true },
		handler: async (args, env) => {
			const body = args.files && (args.files as string[]).length > 0 ? { files: args.files } : { purge_everything: true };
			const data = await cfFetch(env, `/zones/${args.zone_id}/purge_cache`, {
				method: "POST",
				body: JSON.stringify(body),
			});
			return data.result;
		},
	},
	{
		name: "cf_list_workers",
		description: "List Worker scripts deployed on this Cloudflare account.",
		inputSchema: { type: "object", properties: {} },
		annotations: { readOnlyHint: true, openWorldHint: true },
		handler: async (_args, env) => {
			const data = await cfFetch(env, `/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts`);
			return data.result.map((w: any) => ({
				id: w.id,
				modified_on: w.modified_on,
				created_on: w.created_on,
				compatibility_date: w.compatibility_date,
				deployment_id: w.deployment_id,
				etag: w.etag,
				last_deployed_from: w.last_deployed_from,
				handlers: w.handlers,
			}));
		},
	},
	{
		name: "cf_get_worker_metadata",
		description: "Get deployment metadata (bindings, compatibility date, routes) for a specific Worker script.",
		inputSchema: {
			type: "object",
			properties: { script_name: { type: "string", description: "Worker script name" } },
			required: ["script_name"],
		},
		annotations: { readOnlyHint: true, openWorldHint: true },
		handler: async (args, env) => {
			const data = await cfFetch(
				env,
				`/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/services/${args.script_name}`,
			);
			return data.result;
		},
	},
	{
		name: "cf_kv_list_namespaces",
		description: "List Workers KV namespaces on this account.",
		inputSchema: { type: "object", properties: {} },
		annotations: { readOnlyHint: true, openWorldHint: true },
		handler: async (_args, env) => {
			const data = await cfFetch(env, `/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces`);
			return data.result.map((n: any) => ({ id: n.id, title: n.title }));
		},
	},
	{
		name: "cf_kv_get_value",
		description: "Read a value from a Workers KV namespace by key.",
		inputSchema: {
			type: "object",
			properties: {
				namespace_id: { type: "string", description: "KV namespace ID (from cf_kv_list_namespaces)" },
				key: { type: "string", description: "Key to read" },
			},
			required: ["namespace_id", "key"],
		},
		annotations: { readOnlyHint: true, openWorldHint: true },
		handler: async (args, env) => {
			const res = await fetch(
				`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${args.namespace_id}/values/${encodeURIComponent(String(args.key))}`,
				{ headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` } },
			);
			if (res.status === 404) return { found: false };
			if (!res.ok) throw new Error(`Cloudflare API error (${res.status}) reading KV key`);
			return { found: true, value: await res.text() };
		},
	},
	{
		name: "cf_kv_put_value",
		description: "Write a value to a Workers KV namespace.",
		inputSchema: {
			type: "object",
			properties: {
				namespace_id: { type: "string", description: "KV namespace ID" },
				key: { type: "string", description: "Key to write" },
				value: { type: "string", description: "String value to store" },
			},
			required: ["namespace_id", "key", "value"],
		},
		annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
		handler: async (args, env) => {
			const res = await fetch(
				`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${args.namespace_id}/values/${encodeURIComponent(String(args.key))}`,
				{
					method: "PUT",
					headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
					body: String(args.value),
				},
			);
			if (!res.ok) throw new Error(`Cloudflare API error (${res.status}) writing KV key`);
			return { ok: true };
		},
	},
	{
		name: "hf_whoami",
		description: "Verify the configured Hugging Face token and return account info (username, orgs, plan).",
		inputSchema: { type: "object", properties: {} },
		annotations: { readOnlyHint: true, openWorldHint: true },
		handler: async (_args, env) => hfFetch(env, "/api/whoami-v2"),
	},
	{
		name: "hf_search_models",
		description:
			"Search Hugging Face models. Omit 'author' to search publicly; set author to your own username " +
			"(from hf_whoami) to list your own models. Also works for finding models to use elsewhere.",
		inputSchema: {
			type: "object",
			properties: {
				search: { type: "string", description: "Free-text search term" },
				author: { type: "string", description: "Filter by author/organization username" },
				limit: { type: "number", description: "Max results (default 20, max 100)" },
			},
		},
		annotations: { readOnlyHint: true, openWorldHint: true },
		handler: async (args, env) => {
			const params = new URLSearchParams();
			if (args.search) params.set("search", String(args.search));
			if (args.author) params.set("author", String(args.author));
			params.set("limit", String(Math.max(1, Math.min(100, Number(args.limit ?? 20) || 20))));
			return hfFetch(env, `/api/models?${params.toString()}`);
		},
	},
	{
		name: "hf_repo_info",
		description: "Get metadata for a Hugging Face repo (model, dataset, or space): visibility, tags, downloads, files.",
		inputSchema: {
			type: "object",
			properties: {
				repo_id: { type: "string", description: "Repo id, e.g. 'username/model-name'" },
				repo_type: { type: "string", description: "model | dataset | space. Default model." },
			},
			required: ["repo_id"],
		},
		annotations: { readOnlyHint: true, openWorldHint: true },
		handler: async (args, env) => hfFetch(env, `/api/${normalizeRepoType(args.repo_type)}s/${encodeRepoId(args.repo_id)}`),
	},
	{
		name: "hf_list_repo_files",
		description: "List files (tree) in a Hugging Face repo at a given revision.",
		inputSchema: {
			type: "object",
			properties: {
				repo_id: { type: "string" },
				repo_type: { type: "string", description: "model | dataset | space. Default model." },
				revision: { type: "string", description: "Branch/tag/commit. Default main." },
			},
			required: ["repo_id"],
		},
		annotations: { readOnlyHint: true, openWorldHint: true },
		handler: async (args, env) => {
			const revision = String(args.revision ?? "main");
			return hfFetch(env, `/api/${normalizeRepoType(args.repo_type)}s/${encodeRepoId(args.repo_id)}/tree/${encodeURIComponent(revision)}`);
		},
	},
	{
		name: "hf_create_repo",
		description: "Create a new Hugging Face repo (model, dataset, or space). Requires confirm_destructive=true.",
		inputSchema: {
			type: "object",
			properties: {
				name: { type: "string", description: "Repo name, e.g. 'my-model' (without namespace)" },
				repo_type: { type: "string", description: "model | dataset | space. Default model." },
				organization: { type: "string", description: "Optional org namespace to create under" },
				private: { type: "boolean", description: "Whether the repo is private. Default true." },
				space_sdk: { type: "string", description: "Required if repo_type=space: gradio | streamlit | docker | static" },
				confirm_destructive: { type: "boolean", description: "Must be true to permit creation" },
			},
			required: ["name", "confirm_destructive"],
		},
		annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: true },
		handler: async (args, env) => {
			if (args.confirm_destructive !== true) throw new Error("confirm_destructive=true is required");
			const repoType = normalizeRepoType(args.repo_type);
			const body: Record<string, unknown> = {
				type: repoType,
				name: String(args.name ?? "").trim(),
				private: args.private ?? true,
			};
			if (args.organization) body.organization = String(args.organization);
			if (repoType === "space") {
				const sdk = String(args.space_sdk ?? "").trim();
				if (!["gradio", "streamlit", "docker", "static"].includes(sdk)) {
					throw new Error("space_sdk must be one of gradio, streamlit, docker, static");
				}
				body.sdk = sdk;
			}
			return hfFetch(env, "/api/repos/create", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
		},
	},
	{
		name: "hf_delete_repo",
		description: "Permanently delete a Hugging Face repo. Requires confirm_destructive=true.",
		inputSchema: {
			type: "object",
			properties: {
				name: { type: "string", description: "Repo name (without namespace)" },
				repo_type: { type: "string", description: "model | dataset | space. Default model." },
				organization: { type: "string", description: "Optional org namespace" },
				confirm_destructive: { type: "boolean", description: "Must be true to permit deletion" },
			},
			required: ["name", "confirm_destructive"],
		},
		annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
		handler: async (args, env) => {
			if (args.confirm_destructive !== true) throw new Error("confirm_destructive=true is required");
			const body: Record<string, unknown> = { type: normalizeRepoType(args.repo_type), name: String(args.name ?? "").trim() };
			if (args.organization) body.organization = String(args.organization);
			return hfFetch(env, "/api/repos/delete", {
				method: "DELETE",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
		},
	},
	{
		name: "hf_commit_file",
		description:
			"Create or update a single file in a Hugging Face repo via the Commit API (no Git LFS - text or base64 " +
			"content only, under the safety size limit). Requires confirm_destructive=true.",
		inputSchema: {
			type: "object",
			properties: {
				repo_id: { type: "string" },
				repo_type: { type: "string", description: "model | dataset | space. Default model." },
				path: { type: "string", description: "File path inside the repo, e.g. 'README.md'" },
				content: { type: "string", description: "File content. UTF-8 text by default, or base64 if content_is_base64=true." },
				content_is_base64: { type: "boolean", description: "Set true if 'content' is already base64-encoded (for binary files)." },
				revision: { type: "string", description: "Branch to commit to. Default main." },
				commit_message: { type: "string" },
				confirm_destructive: { type: "boolean", description: "Must be true to permit the write" },
			},
			required: ["repo_id", "path", "content", "confirm_destructive"],
		},
		annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: true },
		handler: async (args, env) => {
			if (args.confirm_destructive !== true) throw new Error("confirm_destructive=true is required");
			const repoType = normalizeRepoType(args.repo_type);
			const revision = String(args.revision ?? "main");
			const path = String(args.path ?? "").trim().replace(/^\/+/, "");
			if (!path) throw new Error("path is required");
			const raw = String(args.content ?? "");
			const base64Content = args.content_is_base64 === true ? raw : base64EncodeUtf8(raw);
			if (base64Content.length > 7_000_000) throw new Error("content exceeds the ~5MB MCP safety limit for non-LFS commits");
			const ndjson = [
				JSON.stringify({ key: "header", value: { summary: String(args.commit_message ?? `Update ${path} via cf-control-mcp`) } }),
				JSON.stringify({ key: "file", value: { path, content: base64Content, encoding: "base64" } }),
			].join("\n");
			const result = await hfFetch(env, `/api/${repoType}s/${encodeRepoId(args.repo_id)}/commit/${encodeURIComponent(revision)}`, {
				method: "POST",
				headers: { "Content-Type": "application/x-ndjson" },
				body: ndjson,
			});
			return { committed: true, repo_id: args.repo_id, path, revision, result };
		},
	},
	{
		name: "hf_delete_file",
		description: "Delete a file from a Hugging Face repo via the Commit API. Requires confirm_destructive=true.",
		inputSchema: {
			type: "object",
			properties: {
				repo_id: { type: "string" },
				repo_type: { type: "string", description: "model | dataset | space. Default model." },
				path: { type: "string" },
				revision: { type: "string", description: "Branch to commit to. Default main." },
				commit_message: { type: "string" },
				confirm_destructive: { type: "boolean", description: "Must be true to permit the delete" },
			},
			required: ["repo_id", "path", "confirm_destructive"],
		},
		annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
		handler: async (args, env) => {
			if (args.confirm_destructive !== true) throw new Error("confirm_destructive=true is required");
			const repoType = normalizeRepoType(args.repo_type);
			const revision = String(args.revision ?? "main");
			const path = String(args.path ?? "").trim().replace(/^\/+/, "");
			if (!path) throw new Error("path is required");
			const ndjson = [
				JSON.stringify({ key: "header", value: { summary: String(args.commit_message ?? `Delete ${path} via cf-control-mcp`) } }),
				JSON.stringify({ key: "deletedFile", value: { path } }),
			].join("\n");
			const result = await hfFetch(env, `/api/${repoType}s/${encodeRepoId(args.repo_id)}/commit/${encodeURIComponent(revision)}`, {
				method: "POST",
				headers: { "Content-Type": "application/x-ndjson" },
				body: ndjson,
			});
			return { deleted: true, repo_id: args.repo_id, path, revision, result };
		},
	},
	{
		name: "hf_api_request",
		description:
			"Call any Hugging Face Hub API endpoint directly, with any HTTP method. Use this for anything not covered " +
			"by the other hf_* tools. Path is relative to https://huggingface.co, e.g. '/api/models/username/model-name'. " +
			"This has full read/write power tied to HUGGINGFACE_TOKEN.",
		inputSchema: {
			type: "object",
			properties: {
				method: { type: "string", description: "HTTP method: GET, POST, PUT, PATCH, DELETE" },
				path: { type: "string", description: "API path starting with '/', e.g. '/api/models'" },
				body: { type: "object", description: "JSON body for POST/PUT/PATCH. Omit for GET/DELETE." },
				query: { type: "object", description: "Optional query string params as key/value pairs." },
			},
			required: ["method", "path"],
		},
		annotations: { destructiveHint: true, openWorldHint: true },
		handler: async (args, env) => {
			let path = String(args.path);
			if (!path.startsWith("/")) path = "/" + path;
			if (args.query && typeof args.query === "object") {
				const qs = new URLSearchParams();
				for (const [k, v] of Object.entries(args.query as Record<string, unknown>)) qs.set(k, String(v));
				const sep = path.includes("?") ? "&" : "?";
				path = `${path}${sep}${qs.toString()}`;
			}
			const method = String(args.method || "GET").toUpperCase();
			const init: RequestInit = { method };
			if (args.body !== undefined && method !== "GET" && method !== "DELETE") {
				init.headers = { "Content-Type": "application/json" };
				init.body = JSON.stringify(args.body);
			}
			return await hfFetch(env, path, init);
		},
	},

	{
		name: "run_code",
		description:
			"Execute a short code snippet for free in an ephemeral public sandbox (Piston, emkc.org) and return " +
			"stdout, stderr, and exit code. Supports common languages (python, javascript/node, typescript, bash, " +
			"go, rust, java, c, cpp, etc — call list_code_runtimes for the exact catalog). No account or credentials " +
			"involved, no persistent state, and nothing here touches the Cloudflare/HF accounts. Not suitable for " +
			"secrets or private data: the sandbox is a shared free third-party service.",
		inputSchema: {
			type: "object",
			properties: {
				language: { type: "string", description: "Piston language id, e.g. 'python', 'javascript', 'bash', 'go'" },
				version: { type: "string", description: "Language version, or '*' for latest. Default '*'." },
				code: { type: "string", description: "Source code to run" },
				stdin: { type: "string", description: "Optional stdin to feed the program" },
				args: { type: "array", items: { type: "string" }, description: "Optional CLI args passed to the program" },
			},
			required: ["language", "code"],
		},
		annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
		handler: async (args) => {
			const language = String(args.language ?? "").trim();
			const code = String(args.code ?? "");
			if (!language) throw new Error("language is required");
			if (!code.trim()) throw new Error("code is empty");
			if (code.length > 200_000) throw new Error("code exceeds 200 KB sandbox limit");
			const version = String(args.version ?? "*");
			const stdin = String(args.stdin ?? "");
			const cliArgs = Array.isArray(args.args) ? args.args.map((a) => String(a)).slice(0, 32) : [];
			return await pistonExecute(language, version, code, stdin, cliArgs);
		},
	},
	{
		name: "list_code_runtimes",
		description: "List the languages/versions currently available in the free Piston sandbox used by run_code.",
		inputSchema: { type: "object", properties: {} },
		annotations: { readOnlyHint: true, openWorldHint: true },
		handler: async () => await pistonRuntimes(),
	},
	{
		name: "gh_run_code",
		description:
			"Run code for real in an ephemeral, full Ubuntu VM with genuine internet access, via a GitHub Actions " +
			"workflow (.github/workflows/mcp-exec.yml) dispatched on this repo. Unlike run_code (Piston), this can " +
			"install packages (apt/pip/npm/etc via 'setup'), make real outbound network calls, and run for up to " +
			"10 minutes. It's asynchronous: this only starts the run and returns a run_key. Call gh_get_run_result " +
			"with that run_key afterward (poll every few seconds) to get status and logs. Requires GITHUB_PAT to be " +
			"configured as a Worker secret with 'actions:write' + 'contents:read' on the target repo.",
		inputSchema: {
			type: "object",
			properties: {
				language: { type: "string", description: "python | node | bash | go | ruby | php" },
				code: { type: "string", description: "Source code to run" },
				setup: { type: "string", description: "Optional shell command to run first, e.g. 'pip install requests'" },
				args: { type: "string", description: "Optional space-separated CLI args" },
			},
			required: ["language", "code"],
		},
		annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
		handler: async (args, env) => {
			const language = String(args.language ?? "").trim();
			const code = String(args.code ?? "");
			if (!language) throw new Error("language is required");
			if (!code.trim()) throw new Error("code is empty");
			if (code.length > 500_000) throw new Error("code exceeds 500 KB limit");
			const repo = ghRepo(env);
			const runKey = newRunKey();
			await ghFetch(env, `/repos/${repo}/actions/workflows/mcp-exec.yml/dispatches`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					ref: "main",
					inputs: {
						run_key: runKey,
						language,
						code_b64: base64EncodeUtf8(code),
						setup: String(args.setup ?? ""),
						args: String(args.args ?? ""),
					},
				}),
			});
			return {
				run_key: runKey,
				status: "dispatched",
				note: "GitHub takes a few seconds to schedule the run. Call gh_get_run_result with this run_key, retrying every 3-5s, until status is 'completed'.",
			};
		},
	},
	{
		name: "gh_get_run_result",
		description:
			"Poll for the status/result of a gh_run_code run by its run_key. Returns status 'not_found_yet' " +
			"(retry shortly), 'queued'/'in_progress', or 'completed' with the conclusion and full job log.",
		inputSchema: {
			type: "object",
			properties: { run_key: { type: "string", description: "The run_key returned by gh_run_code" } },
			required: ["run_key"],
		},
		annotations: { readOnlyHint: true, openWorldHint: true },
		handler: async (args, env) => {
			const runKey = String(args.run_key ?? "").trim();
			if (!runKey) throw new Error("run_key is required");
			const run = await ghFindRunByKey(env, runKey);
			if (!run) return { status: "not_found_yet" };
			if (run.status !== "completed") {
				return { status: run.status, run_id: run.id, html_url: run.html_url };
			}
			const log = await ghGetRunLog(env, run.id);
			return { status: "completed", conclusion: run.conclusion, run_id: run.id, html_url: run.html_url, log };
		},
	},
	...(internetTools as ToolDef[]),
];

const toolsByName = new Map(tools.map((t) => [t.name, t]));

// ---------------------------------------------------------------------------
// MCP method handlers
// ---------------------------------------------------------------------------

const SERVER_INFO = { name: "cf-control-mcp", version: "1.8.0" };
const PROTOCOL_VERSION = "2025-06-18";

async function handleRpc(req: JsonRpcRequest, env: Env): Promise<JsonRpcSuccess | JsonRpcError> {
	switch (req.method) {
		case "initialize":
			return rpcResult(req.id, {
				protocolVersion: PROTOCOL_VERSION,
				capabilities: { tools: {} },
				serverInfo: SERVER_INFO,
			});

		case "notifications/initialized":
			// Notifications have no response body; caller filters these out.
			return rpcResult(req.id, null);

		case "tools/list":
			return rpcResult(req.id, {
				tools: tools.map((t) => ({
					name: t.name,
					description: t.description,
					inputSchema: t.inputSchema,
					annotations: t.annotations,
				})),
			});

		case "tools/call": {
			const name = req.params?.name as string;
			const args = (req.params?.arguments as Record<string, unknown>) ?? {};
			const tool = toolsByName.get(name);
			if (!tool) {
				return rpcError(req.id, JSONRPC_INVALID_REQUEST, `Unknown tool: ${name}`);
			}
			try {
				const result = await tool.handler(args, env);
				return rpcResult(req.id, {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
					isError: false,
				});
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				// MCP convention: tool-level failures are returned as a successful
				// RPC call with isError: true, so the model can see and react to them.
				return rpcResult(req.id, {
					content: [{ type: "text", text: `Tool "${name}" failed: ${message}` }],
					isError: true,
				});
			}
		}

		default:
			return rpcError(req.id, JSONRPC_METHOD_NOT_FOUND, `Method not found: ${req.method}`);
	}
}

// ---------------------------------------------------------------------------
// HTTP entrypoint
// ---------------------------------------------------------------------------

const CORS_HEADERS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "POST, GET, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id",
};

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json", ...CORS_HEADERS },
	});
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		if (request.method === "OPTIONS") {
			return new Response(null, { headers: CORS_HEADERS });
		}

		if (url.pathname === "/" && request.method === "GET") {
			return json({
				name: SERVER_INFO.name,
				version: SERVER_INFO.version,
				description: "Remote MCP server for controlling a Cloudflare account. POST MCP JSON-RPC requests to /mcp.",
				mcp_endpoint: `${url.origin}/mcp`,
			});
		}

		if (url.pathname !== "/mcp") {
			return json({ error: "Not found. The MCP endpoint is /mcp." }, 404);
		}

		if (request.method !== "POST") {
			return json({ error: "Method not allowed. Use POST." }, 405);
		}

		// Layer 1 auth: static bearer token shared with the MCP client.
		const authHeader = request.headers.get("Authorization") ?? "";
		const providedToken = authHeader.replace(/^Bearer\s+/i, "");
		if (!env.MCP_AUTH_TOKEN || providedToken !== env.MCP_AUTH_TOKEN) {
			return json(rpcError(null, JSONRPC_INVALID_REQUEST, "Unauthorized"), 401);
		}

		let payload: unknown;
		try {
			payload = await request.json();
		} catch {
			return json(rpcError(null, JSONRPC_PARSE_ERROR, "Invalid JSON"), 400);
		}

		const requests = Array.isArray(payload) ? payload : [payload];
		const responses: (JsonRpcSuccess | JsonRpcError)[] = [];

		for (const item of requests) {
			const r = item as JsonRpcRequest;
			if (!r || r.jsonrpc !== "2.0" || typeof r.method !== "string") {
				responses.push(rpcError(r?.id ?? null, JSONRPC_INVALID_REQUEST, "Invalid Request"));
				continue;
			}
			try {
				responses.push(await handleRpc(r, env));
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				responses.push(rpcError(r.id, JSONRPC_INTERNAL_ERROR, message));
			}
		}

		// Notifications (no "id") get no response per JSON-RPC spec.
		const filtered = responses.filter((_, i) => (requests[i] as JsonRpcRequest)?.id !== undefined);

		if (filtered.length === 0) {
			return new Response(null, { status: 202, headers: CORS_HEADERS });
		}

		return json(Array.isArray(payload) ? filtered : filtered[0]);
	},
} satisfies ExportedHandler<Env>;
