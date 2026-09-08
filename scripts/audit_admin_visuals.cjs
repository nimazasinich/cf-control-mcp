/*
 * VISUAL_ACCEPTANCE_FIXTURE_ONLY (test-only CI tooling; never imported by the Worker)
 *
 * Deterministic runtime/overflow audit for the Admin UI dashboard fixture.
 * The fixture is served from a loopback-only ephemeral HTTP origin so browser
 * History API calls such as replaceState('/admin/...') behave like production.
 */
"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const puppeteer = require("puppeteer-core");

const VIEWPORT = { width: 1368, height: 753, deviceScaleFactor: 1 };
const MAX_WAIT_MS = Number(process.env.ADMIN_VISUAL_AUDIT_MAX_WAIT_MS || 8000);
const POLL_MS = Number(process.env.ADMIN_VISUAL_AUDIT_POLL_MS || 100);

const outDir = path.resolve(process.argv[2] || "admin-visual-artifacts");
const dashFile = path.join(outDir, "dashboard-fixture.html");

const PAGES = [
  { name: "overview", hash: "overview" },
  { name: "providers", hash: "providers" },
  { name: "models", hash: "models" },
  { name: "routing", hash: "routing" },
  { name: "mcp-tools", hash: "mcp-tools" },
  { name: "health", hash: "health" },
  { name: "usage", hash: "usage" },
  { name: "audit", hash: "logs" },
  { name: "settings-environment", hash: "settings", settingsView: "environment" },
  { name: "settings-security", hash: "settings", settingsView: "security" },
  { name: "settings-session", hash: "settings", settingsView: "session" },
  { name: "settings-boundary", hash: "settings", settingsView: "boundary" },
];

function startFixtureServer() {
  const html = fs.readFileSync(dashFile);
  const server = http.createServer((req, res) => {
    let pathname = "/";
    try {
      pathname = new URL(req.url || "/", "http://127.0.0.1").pathname;
    } catch {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("bad request");
      return;
    }

    if (pathname === "/dashboard-fixture.html" || pathname === "/admin" || pathname.startsWith("/admin/")) {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Length": html.length,
      });
      res.end(html);
      return;
    }

    if (pathname === "/favicon.ico") {
      res.writeHead(204, { "Cache-Control": "no-store" });
      res.end();
      return;
    }

    res.writeHead(404, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify({ ok: false, error: "fixture_route_not_found" }));
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("failed to resolve loopback fixture server address"));
        return;
      }
      resolve({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

function buildUrl(origin, page) {
  const params = new URLSearchParams({ visualState: "normal" });
  if (page.settingsView) params.set("settingsView", page.settingsView);
  return `${origin}/dashboard-fixture.html?${params.toString()}#${page.hash}`;
}

async function collectDiagnostics(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const active = document.querySelector(".page.active");

    const measure = (scrollW, clientW, scrollH, clientH) => ({
      scrollW,
      clientW,
      scrollH,
      clientH,
      overflowXpx: Math.max(0, scrollW - clientW),
      overflowYpx: Math.max(0, scrollH - clientH),
    });

    return {
      runtimeStatus: root.dataset.visualRuntime || "unset",
      overflowStatus: root.dataset.visualOverflow || "unset",
      scenario: root.dataset.visualScenario || null,
      runtimeErrors: Array.isArray(window.__visualErrors) ? window.__visualErrors.slice() : [],
      documentMeasurement: measure(
        root.scrollWidth,
        window.innerWidth,
        root.scrollHeight,
        window.innerHeight
      ),
      activePageMeasurement: active
        ? measure(active.scrollWidth, active.clientWidth, active.scrollHeight, active.clientHeight)
        : null,
      activePageFound: !!active,
    };
  });
}

async function auditPage(browser, origin, page) {
  const url = buildUrl(origin, page);
  const started = Date.now();
  const tab = await browser.newPage();
  await tab.setViewport(VIEWPORT);

  const consoleErrors = [];
  tab.on("pageerror", (err) => consoleErrors.push(String(err)));

  let settled = false;
  let timedOut = false;
  let navigationError = null;

  try {
    await tab.goto(url, { waitUntil: "load", timeout: MAX_WAIT_MS });
    try {
      await tab.waitForFunction(
        () => document.documentElement.dataset.visualRuntime !== "pending",
        { timeout: MAX_WAIT_MS, polling: POLL_MS }
      );
      settled = true;
    } catch {
      timedOut = true;
    }
  } catch (gotoErr) {
    navigationError = String((gotoErr && gotoErr.message) || gotoErr);
  }

  let diagnostics = null;
  if (!navigationError) {
    try {
      diagnostics = await collectDiagnostics(tab);
    } catch (diagErr) {
      navigationError = `diagnostics collection failed: ${String((diagErr && diagErr.message) || diagErr)}`;
    }
  }

  const waitedMs = Date.now() - started;
  await tab.close().catch(() => {});

  const runtimeOk = !!diagnostics && diagnostics.runtimeStatus === "ok";
  const overflowOk = !!diagnostics && diagnostics.overflowStatus === "ok";
  const pass = !navigationError && settled && runtimeOk && overflowOk;

  return {
    name: page.name,
    url,
    pass,
    waitedMs,
    settled,
    timedOut,
    navigationError,
    consoleErrors,
    diagnostics,
  };
}

function formatResult(r) {
  const lines = [];
  lines.push(`--- ${r.name} ${r.pass ? "PASS" : "FAIL"} (waited ${r.waitedMs}ms) ---`);
  if (r.navigationError) {
    lines.push(`  navigation error: ${r.navigationError}`);
    return lines.join("\n");
  }
  lines.push(`  settled before timeout: ${r.settled}${r.timedOut ? " (TIMED OUT waiting for runtime to leave 'pending')" : ""}`);
  if (r.diagnostics) {
    const d = r.diagnostics;
    lines.push(`  data-visual-runtime="${d.runtimeStatus}"  data-visual-overflow="${d.overflowStatus}"`);
    if (d.runtimeErrors.length) lines.push(`  runtime errors captured in-page: ${JSON.stringify(d.runtimeErrors)}`);
    if (r.consoleErrors.length) lines.push(`  uncaught page errors: ${JSON.stringify(r.consoleErrors)}`);
    if (!d.activePageFound) {
      lines.push(`  WARNING: no element matched ".page.active" — active page measurement unavailable`);
    } else {
      const p = d.activePageMeasurement;
      lines.push(`  active page: scroll=${p.scrollW}x${p.scrollH} client=${p.clientW}x${p.clientH} overflow=${p.overflowXpx}x${p.overflowYpx}px`);
    }
    const doc = d.documentMeasurement;
    lines.push(`  document root: scroll=${doc.scrollW}x${doc.scrollH} viewport=${doc.clientW}x${doc.clientH} overflow=${doc.overflowXpx}x${doc.overflowYpx}px`);
  } else {
    lines.push("  no diagnostics collected (navigation/evaluation failed before measurement)");
  }
  return lines.join("\n");
}

async function main() {
  const executablePath = process.env.CHROME;
  if (!executablePath) {
    console.error("CHROME env var not set — expected the path to a Chrome/Chromium binary");
    process.exit(1);
  }
  if (!fs.existsSync(dashFile)) {
    console.error(`dashboard fixture not found at ${dashFile}`);
    process.exit(1);
  }

  const { server, origin } = await startFixtureServer();
  console.log(`Admin visual fixture origin: ${origin}`);

  let browser = null;
  const results = [];
  try {
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--force-color-profile=srgb",
        "--hide-scrollbars",
      ],
    });

    for (const page of PAGES) {
      // Sequential on purpose: every page receives the same bounded budget.
      // eslint-disable-next-line no-await-in-loop
      const result = await auditPage(browser, origin, page);
      results.push(result);
      console.log(formatResult(result));
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
  }

  const failed = results.filter((r) => !r.pass);
  const report = {
    exactSha: process.env.EXACT_SHA || null,
    fixtureOrigin: origin,
    viewport: VIEWPORT,
    maxWaitMs: MAX_WAIT_MS,
    pollMs: POLL_MS,
    totalPages: results.length,
    failedPages: failed.map((r) => r.name),
    results,
  };
  fs.writeFileSync(path.join(outDir, "overflow-audit-report.json"), JSON.stringify(report, null, 2));

  console.log("\n=== SUMMARY ===");
  console.log(`${results.length - failed.length}/${results.length} pages passed`);
  if (failed.length) {
    console.log(`FAILED: ${failed.map((r) => r.name).join(", ")}`);
    console.log(`Full report: ${path.join(outDir, "overflow-audit-report.json")}`);
    process.exitCode = 1;
  } else {
    console.log("All pages settled with data-visual-runtime=ok and data-visual-overflow=ok");
  }
}

main().catch((err) => {
  console.error("Audit script crashed:", err);
  process.exit(1);
});
