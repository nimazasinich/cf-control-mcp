#!/usr/bin/env python3
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
    if "PROXYHARVEST_MCP_V12" not in text:
        anchor = "const tools: ToolDef[] = ["
        block = r'''const PROXYHARVEST_MCP_V12 = "1.2.0";
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
	},'''
        text = replace_once(text, anchor, block, "insert ProxyHarvest v1.2 tools")

    text = text.replace('const SERVER_INFO = { name: "cf-control-mcp", version: "1.1.0" };', 'const SERVER_INFO = { name: "cf-control-mcp", version: "1.2.0" };')
    path.write_text(text, encoding="utf-8")


def upgrade_versions() -> None:
    p = ROOT / "package.json"
    package = json.loads(p.read_text(encoding="utf-8"))
    package["version"] = "1.2.0"
    p.write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")

    p = ROOT / "package-lock.json"
    lock = json.loads(p.read_text(encoding="utf-8"))
    lock["version"] = "1.2.0"
    if isinstance(lock.get("packages"), dict) and isinstance(lock["packages"].get(""), dict):
        lock["packages"][""]["version"] = "1.2.0"
    p.write_text(json.dumps(lock, indent=2) + "\n", encoding="utf-8")


def upgrade_smoke() -> None:
    p = ROOT / "scripts" / "oauth_smoke.py"
    text = p.read_text(encoding="utf-8")
    marker = '    "proxyharvest_gateway_health",\n    "proxyharvest_source_check",\n    "proxyharvest_transport_probe",\n'
    if '"proxyharvest_gateway_health"' not in text:
        anchor = '    "cf_list_worker_routes",\n'
        text = replace_once(text, anchor, anchor + marker, "extend OAuth smoke read tools")
    p.write_text(text, encoding="utf-8")


def upgrade_readme() -> None:
    p = ROOT / "README.md"
    text = p.read_text(encoding="utf-8")
    heading = "## v1.2.0 ProxyHarvest control tools"
    if heading not in text:
        text += f'''\n\n{heading}\n\nThe private MCP exposes three focused read-only ProxyHarvest tools: `proxyharvest_gateway_health`, `proxyharvest_source_check`, and `proxyharvest_transport_probe`. They operate against the live Cloudflare gateway and preserve the architecture boundary: Cloudflare source/transport reachability is never protocol, tunnel, or WireGuard verification. Real `VERIFIED` status remains exclusive to the Local Real Test Bridge using sing-box + curl.\n'''
    p.write_text(text, encoding="utf-8")


def write_result() -> None:
    p = ROOT / "results" / "mcp-upgrade" / "v1.2.0.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({
        "ok": True,
        "version": "1.2.0",
        "executed_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "added_tools": ["proxyharvest_gateway_health", "proxyharvest_source_check", "proxyharvest_transport_probe"],
        "verification_boundary": "local-real-test-bridge-only",
        "gateway": "https://proxyharvest-gateway.amin-chinisaz-edu.workers.dev",
    }, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    upgrade_index()
    upgrade_versions()
    upgrade_smoke()
    upgrade_readme()
    write_result()
    print("Applied cf-control-mcp v1.2.0 ProxyHarvest tool upgrade")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
