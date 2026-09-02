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

export interface Env {
	MCP_AUTH_TOKEN: string;
	CLOUDFLARE_API_TOKEN: string;
	CLOUDFLARE_ACCOUNT_ID: string;
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

const tools: ToolDef[] = [
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
			return data.result.map((w: any) => ({ id: w.id, modified_on: w.modified_on, created_on: w.created_on }));
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
];

const toolsByName = new Map(tools.map((t) => [t.name, t]));

// ---------------------------------------------------------------------------
// MCP method handlers
// ---------------------------------------------------------------------------

const SERVER_INFO = { name: "cf-control-mcp", version: "1.0.0" };
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
