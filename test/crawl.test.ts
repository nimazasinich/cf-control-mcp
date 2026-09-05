import test from "node:test";
import assert from "node:assert/strict";
import { crawl } from "../src/internet/crawl";
import { _clearRobotsCache } from "../src/internet/robots";

/**
 * Mock fetch that serves a robots.txt for /robots.txt and a plain-text body
 * for any other path. Using text/plain avoids the HTMLRewriter dependency, so
 * these robots-gating integration tests run under plain Node. Each response's
 * URL is echoed back so redirect-free finalUrl is correct.
 */
function mockSite(robotsBody: string, robotsStatus = 200): () => { fetches: string[] } {
	const orig = globalThis.fetch;
	const fetches: string[] = [];
	(globalThis as any).fetch = async (input: any) => {
		const url = typeof input === "string" ? input : input.url;
		fetches.push(url);
		if (url.endsWith("/robots.txt")) {
			return new Response(robotsBody, {
				status: robotsStatus,
				headers: { "content-type": "text/plain" },
			});
		}
		return new Response("plain body, not html", {
			status: 200,
			headers: { "content-type": "text/plain; charset=utf-8" },
		});
	};
	const restore = () => {
		(globalThis as any).fetch = orig;
	};
	(restore as any).fetches = fetches;
	return () => {
		restore();
		return { fetches };
	};
}

test("web_crawl skips a robots-denied start URL (ROBOTS_DENIED, not fetched)", async () => {
	_clearRobotsCache();
	const done = mockSite("User-agent: *\nDisallow: /");
	try {
		const res = await crawl({ url: "https://denied.example/start", maxPages: 3 });
		assert.equal(res.respectRobots, true);
		assert.equal(res.pages.length, 1);
		const page = res.pages[0];
		assert.equal(page.robotsAllowed, false);
		assert.equal(page.skippedReason, "ROBOTS_DENIED");
		assert.equal(page.status, null);
		assert.equal(res.stats.robotsDenied, 1);
	} finally {
		const { fetches } = done();
		// The page body itself must NOT have been fetched — only robots.txt.
		assert.ok(fetches.every((u) => u.endsWith("/robots.txt")), "only robots.txt fetched");
	}
});

test("web_crawl fetches an allowed page when robots permits it", async () => {
	_clearRobotsCache();
	const done = mockSite("User-agent: *\nDisallow: /private");
	try {
		const res = await crawl({ url: "https://ok.example/public", maxPages: 1, maxDepth: 0 });
		assert.equal(res.pages.length, 1);
		const page = res.pages[0];
		assert.equal(page.robotsAllowed, true);
		assert.equal(page.status, 200);
		assert.equal(res.stats.fetched, 1);
	} finally {
		const { fetches } = done();
		assert.ok(fetches.some((u) => u === "https://ok.example/public"), "page was fetched");
	}
});

test("respect_robots:false bypasses robots gating entirely", async () => {
	_clearRobotsCache();
	const done = mockSite("User-agent: *\nDisallow: /");
	try {
		const res = await crawl({ url: "https://denied.example/start", maxPages: 1, maxDepth: 0, respect_robots: false });
		assert.equal(res.respectRobots, false);
		assert.equal(res.pages.length, 1);
		assert.equal(res.pages[0].status, 200);
		assert.equal(res.pages[0].robotsAllowed, undefined);
	} finally {
		const { fetches } = done();
		// With robots disabled, we should never fetch robots.txt.
		assert.ok(fetches.every((u) => !u.endsWith("/robots.txt")), "robots.txt not fetched");
	}
});

test("oversized Crawl-delay stops crawling that origin (bounded)", async () => {
	_clearRobotsCache();
	const done = mockSite("User-agent: *\nCrawl-delay: 300");
	try {
		const res = await crawl({ url: "https://slow.example/start", maxPages: 2, maxDepth: 0 });
		assert.equal(res.pages.length, 1);
		assert.equal(res.pages[0].skippedReason, "ROBOTS_CRAWL_DELAY_EXCEEDED");
		assert.equal(res.stats.fetched, 0);
	} finally {
		done();
	}
});

test("robots unavailable → crawl proceeds gracefully", async () => {
	_clearRobotsCache();
	const done = mockSite("", 404);
	try {
		const res = await crawl({ url: "https://norobots.example/start", maxPages: 1, maxDepth: 0 });
		assert.equal(res.pages.length, 1);
		assert.equal(res.pages[0].status, 200);
		assert.equal(res.stats.fetched, 1);
	} finally {
		done();
	}
});
