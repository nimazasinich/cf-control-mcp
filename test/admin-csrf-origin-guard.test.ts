import test from "node:test";
import assert from "node:assert/strict";
import { createSessionCookie } from "../src/admin/auth";
import { handleAdmin } from "../src/admin/router";
import type { AdminEnv } from "../src/admin/types";

/**
 * P1-07: CSRF / Same-Origin Protection for Admin Mutations.
 *
 * `SameSite=Lax` gives partial protection only; these tests lock in the
 * explicit Origin/Referer check layered on top of it in src/admin/router.ts.
 */

function minimalDb() {
	return {
		prepare(sql: string) {
			const ops = {
				async first() {
					return null;
				},
				async all() {
					return { results: [] };
				},
				async run() {
					return { meta: { changes: 1 } };
				},
				bind(..._args: any[]) {
					return ops;
				},
			};
			return ops;
		},
	} as unknown as D1Database;
}

async function envWithCookie(): Promise<{ env: AdminEnv; cookie: string }> {
	const env = { MCP_AUTH_TOKEN: "owner-secret", DM_DB: minimalDb() } as unknown as AdminEnv;
	const cookie = (await createSessionCookie(env)).split(";")[0];
	return { env, cookie };
}

test("P1-07: same-origin mutation (matching Origin) succeeds", async () => {
	const { env, cookie } = await envWithCookie();
	const res = await handleAdmin(
		new Request("https://example.com/admin/api/models/some-model", {
			method: "PATCH",
			headers: { "Content-Type": "application/json", Cookie: cookie, Origin: "https://example.com" },
			body: JSON.stringify({ enabled: true }),
		}),
		env,
	);
	// 404 (unknown model) proves the request reached the handler past the CSRF
	// guard — a 403 here would mean the guard wrongly rejected a same-origin call.
	assert.notEqual(res.status, 403);
});

test("P1-07: cross-origin mutation (foreign Origin) is rejected with 403 even with a valid session cookie", async () => {
	const { env, cookie } = await envWithCookie();
	const res = await handleAdmin(
		new Request("https://example.com/admin/api/models/some-model", {
			method: "PATCH",
			headers: { "Content-Type": "application/json", Cookie: cookie, Origin: "https://evil.example.com" },
			body: JSON.stringify({ enabled: true }),
		}),
		env,
	);
	assert.equal(res.status, 403);
	const body = (await res.json()) as { ok: boolean };
	assert.equal(body.ok, false);
});

test("P1-07: missing Origin falls back to a strict same-origin Referer check (matching Referer succeeds)", async () => {
	const { env, cookie } = await envWithCookie();
	const res = await handleAdmin(
		new Request("https://example.com/admin/api/models/some-model", {
			method: "PATCH",
			headers: { "Content-Type": "application/json", Cookie: cookie, Referer: "https://example.com/admin/models" },
			body: JSON.stringify({ enabled: true }),
		}),
		env,
	);
	assert.notEqual(res.status, 403);
});

test("P1-07: missing Origin with a foreign Referer is rejected", async () => {
	const { env, cookie } = await envWithCookie();
	const res = await handleAdmin(
		new Request("https://example.com/admin/api/models/some-model", {
			method: "PATCH",
			headers: { "Content-Type": "application/json", Cookie: cookie, Referer: "https://evil.example.com/attack" },
			body: JSON.stringify({ enabled: true }),
		}),
		env,
	);
	assert.equal(res.status, 403);
});

test("P1-07: missing Origin AND missing Referer fails closed (rejected, not assumed same-origin)", async () => {
	const { env, cookie } = await envWithCookie();
	const res = await handleAdmin(
		new Request("https://example.com/admin/api/models/some-model", {
			method: "PATCH",
			headers: { "Content-Type": "application/json", Cookie: cookie },
			body: JSON.stringify({ enabled: true }),
		}),
		env,
	);
	assert.equal(res.status, 403);
});

test("P1-07: GET / read-only routes are unaffected by the Origin check", async () => {
	const { env, cookie } = await envWithCookie();
	// No Origin, no Referer, GET method — must not be rejected by the CSRF guard.
	const res = await handleAdmin(new Request("https://example.com/admin/api/models", { headers: { Cookie: cookie } }), env);
	assert.notEqual(res.status, 403);
});

test("P1-07: X-Forwarded-* headers are never trusted for the same-origin decision", async () => {
	const { env, cookie } = await envWithCookie();
	const res = await handleAdmin(
		new Request("https://example.com/admin/api/models/some-model", {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Cookie: cookie,
				Origin: "https://evil.example.com",
				// An attacker-controlled forwarded-host claiming to be legitimate
				// must not override the real Origin check.
				"X-Forwarded-Host": "example.com",
				"X-Forwarded-Proto": "https",
			},
			body: JSON.stringify({ enabled: true }),
		}),
		env,
	);
	assert.equal(res.status, 403);
});

test("P1-07: login and logout are covered by the same guard", async () => {
	const { env } = await envWithCookie();
	const loginRes = await handleAdmin(
		new Request("https://example.com/admin/login", {
			method: "POST",
			headers: { "Content-Type": "application/json", Origin: "https://evil.example.com" },
			body: JSON.stringify({ token: "owner-secret" }),
		}),
		env,
	);
	assert.equal(loginRes.status, 403);

	const logoutRes = await handleAdmin(
		new Request("https://example.com/admin/logout", {
			method: "POST",
			headers: { Origin: "https://evil.example.com" },
		}),
		env,
	);
	assert.equal(logoutRes.status, 403);
});
