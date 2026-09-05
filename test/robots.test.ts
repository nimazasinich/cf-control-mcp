import test from "node:test";
import assert from "node:assert/strict";
import {
	isAllowedByRobots,
	MAX_ROBOTS_CRAWL_DELAY_SECONDS,
	ROBOTS_USER_AGENT,
	_clearRobotsCache,
} from "../src/internet/robots";

/** Install a fetch mock that serves a fixed robots.txt body (200) per call. */
function mockRobots(body: string, status = 200): () => void {
	const orig = globalThis.fetch;
	(globalThis as any).fetch = async () =>
		new Response(body, { status, headers: { "content-type": "text/plain" } });
	return () => {
		(globalThis as any).fetch = orig;
	};
}

test("ROBOTS_USER_AGENT is the bounded crawler identity, not a browser", () => {
	assert.equal(ROBOTS_USER_AGENT, "cf-control-mcp/1.6");
	assert.equal(MAX_ROBOTS_CRAWL_DELAY_SECONDS, 10);
});

test("no robots.txt (404) → allow, robotsFetched:false", async () => {
	_clearRobotsCache();
	const restore = mockRobots("", 404);
	try {
		const r = await isAllowedByRobots("https://no-robots.example/page");
		assert.equal(r.allowed, true);
		assert.equal(r.robotsFetched, false);
	} finally {
		restore();
	}
});

test("wildcard Disallow blocks a matching path", async () => {
	_clearRobotsCache();
	const restore = mockRobots("User-agent: *\nDisallow: /private");
	try {
		const denied = await isAllowedByRobots("https://a.example/private/x");
		assert.equal(denied.allowed, false);
		assert.equal(denied.matchedRule, "/private");
		assert.equal(denied.robotsFetched, true);
	} finally {
		restore();
	}
});

test("wildcard group allows an unlisted path", async () => {
	_clearRobotsCache();
	const restore = mockRobots("User-agent: *\nDisallow: /private");
	try {
		const ok = await isAllowedByRobots("https://b.example/public/x");
		assert.equal(ok.allowed, true);
	} finally {
		restore();
	}
});

test("longest-match: specific Allow overrides broader Disallow", async () => {
	_clearRobotsCache();
	const restore = mockRobots("User-agent: *\nDisallow: /docs\nAllow: /docs/public");
	try {
		const blocked = await isAllowedByRobots("https://c.example/docs/secret");
		assert.equal(blocked.allowed, false);
		const allowed = await isAllowedByRobots("https://c.example/docs/public/page");
		assert.equal(allowed.allowed, true);
		assert.equal(allowed.matchedRule, "/docs/public");
	} finally {
		restore();
	}
});

test("agent-specific group is selected over the wildcard group", async () => {
	_clearRobotsCache();
	const body =
		"User-agent: *\nDisallow: /\n\n" +
		"User-agent: cf-control-mcp\nDisallow: /admin\nAllow: /";
	const restore = mockRobots(body);
	try {
		// Our UA ("cf-control-mcp/1.6") includes the token "cf-control-mcp".
		const ok = await isAllowedByRobots("https://d.example/anything");
		assert.equal(ok.allowed, true);
		const admin = await isAllowedByRobots("https://d.example/admin/panel");
		assert.equal(admin.allowed, false);
	} finally {
		restore();
	}
});

test("path + query is considered when matching", async () => {
	_clearRobotsCache();
	const restore = mockRobots("User-agent: *\nDisallow: /search?q=");
	try {
		const r = await isAllowedByRobots("https://e.example/search?q=secret");
		assert.equal(r.allowed, false);
	} finally {
		restore();
	}
});

test("Crawl-delay is surfaced and clamped to the maximum", async () => {
	_clearRobotsCache();
	const restore = mockRobots("User-agent: *\nCrawl-delay: 3\nDisallow: /x");
	try {
		const r = await isAllowedByRobots("https://f.example/ok");
		assert.equal(r.allowed, true);
		assert.equal(r.crawlDelaySec, 3);
		assert.equal(r.crawlDelayExceeded, false);
	} finally {
		restore();
	}
});

test("oversized Crawl-delay is clamped and flagged as exceeded", async () => {
	_clearRobotsCache();
	const restore = mockRobots("User-agent: *\nCrawl-delay: 120\nDisallow: /x");
	try {
		const r = await isAllowedByRobots("https://g.example/ok");
		assert.equal(r.crawlDelaySec, MAX_ROBOTS_CRAWL_DELAY_SECONDS);
		assert.equal(r.crawlDelayExceeded, true);
	} finally {
		restore();
	}
});

test("malformed / comment lines are ignored without throwing", async () => {
	_clearRobotsCache();
	const body =
		"# a comment\n" +
		"garbage-without-colon\n" +
		"User-agent: *\n" +
		"Disallow: /blocked   # trailing comment\n" +
		"NonsenseField: whatever\n";
	const restore = mockRobots(body);
	try {
		const blocked = await isAllowedByRobots("https://h.example/blocked/thing");
		assert.equal(blocked.allowed, false);
		const ok = await isAllowedByRobots("https://h.example/fine");
		assert.equal(ok.allowed, true);
	} finally {
		restore();
	}
});

test("policy is cached per origin (only one robots.txt fetch)", async () => {
	_clearRobotsCache();
	const orig = globalThis.fetch;
	let calls = 0;
	(globalThis as any).fetch = async () => {
		calls += 1;
		return new Response("User-agent: *\nDisallow: /x", { status: 200, headers: { "content-type": "text/plain" } });
	};
	try {
		await isAllowedByRobots("https://cache.example/a");
		await isAllowedByRobots("https://cache.example/b");
		await isAllowedByRobots("https://cache.example/x/y");
		assert.equal(calls, 1, "robots.txt should be fetched once per origin");
	} finally {
		(globalThis as any).fetch = orig;
	}
});

test("robots fetch error → allow, robotsFetched:false (does not throw)", async () => {
	_clearRobotsCache();
	const orig = globalThis.fetch;
	(globalThis as any).fetch = async () => {
		throw new Error("network down");
	};
	try {
		const r = await isAllowedByRobots("https://err.example/page");
		assert.equal(r.allowed, true);
		assert.equal(r.robotsFetched, false);
	} finally {
		(globalThis as any).fetch = orig;
	}
});
