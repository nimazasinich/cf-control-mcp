/*
 * VISUAL_ACCEPTANCE_FIXTURE_ONLY (test-only CI tooling; never imported by the Worker)
 *
 * Deterministic runtime/overflow audit for the Admin UI dashboard fixture.
 *
 * Replaces the previous `--dump-dom` + `--virtual-time-budget` single-shot check.
 * That approach had three problems this script fixes:
 *
 *   1. It exited on the FIRST failing page (`set -euo pipefail` + `exit 1` inside
 *      a loop), so a single bad page hid the state of every other page.
 *   2. On failure it only printed a page name — no actual measurements, no
 *      diagnostic evidence of what overflowed or why the runtime didn't settle.
 *   3. It relied on Chrome's `--virtual-time-budget` to "fast forward" past the
 *      in-page settle timer before taking a `--dump-dom` snapshot. That is a
 *      fixed budget, not a readiness check: if the page hadn't finished setting
 *      `data-visual-runtime` / `data-visual-overflow` by the time the budget
 *      elapsed, the snapshot simply missed it — a race, not a real assertion.
 *
 * This script checks every page, always reports every result together, and
 * uses Puppeteer's `waitForFunction` (real bounded polling against the actual
 * DOM, not a virtual clock) to wait for the in-page fixture script to finish
 * writing `data-visual-runtime` / `data-visual-overflow` on <html>. It never
 * widens the bound to "fix" a flake — a page that doesn't settle within the
 * bound is reported as a failure with full diagnostics, not silently retried
 * with more time.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const puppeteer = require("puppeteer-core");

const VIEWPORT = { width: 1368, height: 753, deviceScaleFactor: 1 };
const MAX_WAIT_MS = Number(process.env.ADMIN_VISUAL_AUDIT_MAX_WAIT_MS || 8000);
const POLL_MS = Number(process.env.ADMIN_VISUAL_AUDIT_POLL_MS || 100);

const outDir = path.resolve(process.argv[2] || "admin-visual-artifacts");
const dashUrl = `file://${path.join(outDir, "dashboard-fixture.html")}`;

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

function buildUrl(page) {
  const params = new URLSearchParams({ visualState: "normal" });
  if (page.settingsView) params.set("settingsView", page.settingsView);
  return `${dashUrl}?${params.toString()}#${page.hash}`;
}

/** Pull every diagnostic we might need, whether the page settled or not. */
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

async function auditPage(browser, page) {
  const url = buildUrl(page);
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
    } catch (waitErr) {
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
    if (d.runtimeErrors.length) {
      lines.push(`  runtime errors captured in-page: ${JSON.stringify(d.runtimeErrors)}`);
    }
    if (r.consoleErrors.length) {
      lines.push(`  uncaught page errors: ${JSON.stringify(r.consoleErrors)}`);
    }
    if (!d.activePageFound) {
      lines.push(`  WARNING: no element matched ".page.active" — active page measurement unavailable`);
    } else {
      const p = d.activePageMeasurement;
      lines.push(
        `  active page: scroll=${p.scrollW}x${p.scrollH} client=${p.clientW}x${p.clientH} overflow=${p.overflowXpx}x${p.overflowYpx}px`
      );
    }
    const doc = d.documentMeasurement;
    lines.push(
      `  document root: scroll=${doc.scrollW}x${doc.scrollH} viewport=${doc.clientW}x${doc.clientH} overflow=${doc.overflowXpx}x${doc.overflowYpx}px`
    );
  } else {
    lines.push(`  no diagnostics collected (navigation/evaluation failed before measurement)`);
  }
  return lines.join("\n");
}

async function main() {
  const executablePath = process.env.CHROME;
  if (!executablePath) {
    console.error("CHROME env var not set — expected the path to a Chrome/Chromium binary");
    process.exit(1);
  }
  if (!fs.existsSync(dashUrl.replace("file://", ""))) {
    console.error(`dashboard fixture not found at ${dashUrl}`);
    process.exit(1);
  }

  const browser = await puppeteer.launch({
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

  const results = [];
  try {
    for (const page of PAGES) {
      // Sequential on purpose: each page gets the full MAX_WAIT_MS budget on
      // its own, and a slow/stuck page can never starve the ones after it.
      // eslint-disable-next-line no-await-in-loop
      const result = await auditPage(browser, page);
      results.push(result);
      console.log(formatResult(result));
    }
  } finally {
    await browser.close().catch(() => {});
  }

  const failed = results.filter((r) => !r.pass);
  const report = {
    exactSha: process.env.EXACT_SHA || null,
    viewport: VIEWPORT,
    maxWaitMs: MAX_WAIT_MS,
    pollMs: POLL_MS,
    totalPages: results.length,
    failedPages: failed.map((r) => r.name),
    results,
  };
  fs.writeFileSync(
    path.join(outDir, "overflow-audit-report.json"),
    JSON.stringify(report, null, 2)
  );

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
