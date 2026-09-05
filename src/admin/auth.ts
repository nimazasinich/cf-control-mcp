/**
 * v1.8 Admin Console — auth.
 *
 * Separate layer from /mcp (OAuth/MCP_AUTH_TOKEN as bearer) and /v1
 * (GATEWAY_AUTH_TOKEN). /admin uses MCP_AUTH_TOKEN as the OWNER SECRET
 * (never sent to the browser after login) to sign a short-lived HMAC
 * session cookie — the same "owner-approved secret" trust root already
 * used elsewhere in this project, applied to a session instead of a
 * bearer header so a human can use the dashboard in a normal browser.
 */

import type { AdminEnv } from "./types";

const SESSION_TTL_SECONDS = 12 * 60 * 60; // 12h
const COOKIE_NAME = "admin_session";
const encoder = new TextEncoder();

function base64UrlEncode(bytes: Uint8Array): string {
	let binary = "";
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(input: string): Uint8Array {
	const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
	const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
	const binary = atob(normalized + padding);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
	return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function sign(payload: string, secret: string): Promise<string> {
	const key = await hmacKey(secret);
	const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
	return base64UrlEncode(new Uint8Array(sig));
}

export async function createSessionCookie(env: AdminEnv): Promise<string> {
	const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
	const payload = base64UrlEncode(encoder.encode(JSON.stringify({ exp })));
	const sig = await sign(payload, env.MCP_AUTH_TOKEN);
	const value = `${payload}.${sig}`;
	return `${COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/admin; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function clearSessionCookie(): string {
	return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/admin; Max-Age=0`;
}

function getCookie(request: Request, name: string): string | null {
	const header = request.headers.get("Cookie");
	if (!header) return null;
	for (const part of header.split(";")) {
		const [k, ...rest] = part.trim().split("=");
		if (k === name) return rest.join("=");
	}
	return null;
}

export async function isAuthenticated(request: Request, env: AdminEnv): Promise<boolean> {
	if (!env.MCP_AUTH_TOKEN) return false;
	const cookie = getCookie(request, COOKIE_NAME);
	if (!cookie) return false;
	const [payload, sig] = cookie.split(".");
	if (!payload || !sig) return false;
	const expected = await sign(payload, env.MCP_AUTH_TOKEN);
	if (expected !== sig) return false;
	try {
		const decoded = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload)));
		return typeof decoded.exp === "number" && decoded.exp > Math.floor(Date.now() / 1000);
	} catch {
		return false;
	}
}
