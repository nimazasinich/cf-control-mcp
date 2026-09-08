/**
 * Approved-visual contract.
 *
 * Every page served by the Admin console must be byte-for-byte identical to the
 * approved 1368x753 reference document in ui-reference/. This test is the gate:
 * if a rendered page drifts from its reference file by a single byte, it fails.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { APPROVED_PAGES } from "../src/admin/ui/approved/index";
import { adminLoadingHtml, adminLoginHtml, adminPageHtml } from "../src/admin/ui/approved/pages";

const REFERENCE_DIR = join(process.cwd(), "ui-reference");

function manifest(): Map<string, string> {
  const raw = readFileSync(join(REFERENCE_DIR, "MANIFEST.tsv"), "utf8");
  const map = new Map<string, string>();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const [name, file] = line.split("\t");
    map.set(name, file);
  }
  return map;
}

function reference(name: string): string {
  const file = manifest().get(name);
  assert.ok(file, `MANIFEST.tsv has no entry for "${name}"`);
  return readFileSync(join(REFERENCE_DIR, file as string), "utf8");
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const PAGE_NAMES = [
  "overview",
  "providers",
  "models",
  "tools",
  "routing",
  "health",
  "audit",
  "settings",
  "login",
  "loading",
] as const;

for (const name of PAGE_NAMES) {
  test(`approved page "${name}" is byte-identical to its reference document`, () => {
    const expected = reference(name);
    const actual = APPROVED_PAGES[name].html;

    assert.equal(
      Buffer.byteLength(actual, "utf8"),
      Buffer.byteLength(expected, "utf8"),
      `${name}: byte length drifted from the approved reference`,
    );
    assert.equal(sha256(actual), sha256(expected), `${name}: sha256 drifted from the approved reference`);
    assert.equal(actual, expected, `${name}: content drifted from the approved reference`);
  });

  test(`approved page "${name}" carries the recorded sha256`, () => {
    assert.equal(APPROVED_PAGES[name].sha256, sha256(reference(name)));
  });
}

/**
 * The served pages add exactly one <script> block before </body>. Strip that
 * block and the response must be the approved document again, byte for byte.
 */
const SERVED_PAGES: Array<{ page: string; reference: string; html: () => string }> = [
  { page: "overview", reference: "overview", html: () => adminPageHtml("overview") },
  { page: "providers", reference: "providers", html: () => adminPageHtml("providers") },
  { page: "models", reference: "models", html: () => adminPageHtml("models") },
  { page: "tools", reference: "tools", html: () => adminPageHtml("tools") },
  { page: "routing", reference: "routing", html: () => adminPageHtml("routing") },
  { page: "health", reference: "health", html: () => adminPageHtml("health") },
  { page: "usage", reference: "overview", html: () => adminPageHtml("usage") },
  { page: "audit", reference: "audit", html: () => adminPageHtml("audit") },
  { page: "settings", reference: "settings", html: () => adminPageHtml("settings") },
  { page: "login", reference: "login", html: () => adminLoginHtml() },
  { page: "loading", reference: "loading", html: () => adminLoadingHtml() },
];

for (const entry of SERVED_PAGES) {
  test(`served page "${entry.page}" reduces to its approved reference document`, () => {
    const expected = reference(entry.reference);
    const served = entry.html();

    // Exactly one appended block, immediately before the final </body>.
    const close = served.lastIndexOf("</body>");
    assert.ok(close !== -1, `${entry.page}: served document has no </body>`);
    const prefix = served.slice(0, close);
    const suffix = served.slice(close);

    const marker = prefix.lastIndexOf("\n<script>\n");
    assert.ok(marker !== -1, `${entry.page}: no appended adapter block found`);

    const stripped = prefix.slice(0, marker) + suffix;
    assert.equal(
      Buffer.byteLength(stripped, "utf8"),
      Buffer.byteLength(expected, "utf8"),
      `${entry.page}: stripping the adapter did not restore the approved byte length`,
    );
    assert.equal(sha256(stripped), sha256(expected), `${entry.page}: stripped document sha256 mismatch`);
    assert.equal(stripped, expected, `${entry.page}: stripped document content mismatch`);
  });

  test(`served page "${entry.page}" keeps the approved document as its prefix`, () => {
    const expected = reference(entry.reference);
    const served = entry.html();
    const head = expected.slice(0, expected.lastIndexOf("</body>"));
    assert.ok(served.startsWith(head), `${entry.page}: approved markup was modified before </body>`);
  });
}
