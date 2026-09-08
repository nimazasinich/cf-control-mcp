/**
 * DreamWorker / cf-control-mcp — approved UI page generator.
 *
 * Reads the approved 1368x753 reference documents in ui-reference/ and emits
 * TypeScript modules that reproduce every reference file BYTE FOR BYTE at
 * runtime. The only build-time transformation is de-duplication of the large
 * base64 logo payloads into shared constants, which are concatenated back into
 * the exact same positions when the page is rendered.
 *
 * Regenerate with:  node scripts/generate-approved-pages.mjs
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REFERENCE_DIR = join(ROOT, "ui-reference");
const OUT_DIR = join(ROOT, "src", "admin", "ui", "approved");

/** base64 payload length -> shared asset constant name. */
const SHARED_ASSETS = new Map([
  [526808, "DW_CONSOLE_LOGO_B64"],
  [568576, "DW_AUTH_LOGO_B64"],
]);

const PAGES = [
  ["overview", "OVERVIEW"],
  ["providers", "PROVIDERS"],
  ["models", "MODELS"],
  ["tools", "TOOLS"],
  ["routing", "ROUTING"],
  ["health", "HEALTH"],
  ["audit", "AUDIT"],
  ["settings", "SETTINGS"],
  ["login", "LOGIN"],
  ["loading", "LOADING"],
];

function jsString(value) {
  return JSON.stringify(value).replace(
    /[\u007f-\uffff]/g,
    (ch) => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"),
  );
}

/** Emits a segment as a newline-joined array literal so the source stays reviewable. */
function segmentLiteral(segment) {
  const lines = segment.split("\n");
  if (lines.length === 1) return jsString(lines[0]);
  return "[\n  " + lines.map(jsString).join(",\n  ") + ",\n].join(\"\\n\")";
}

function readManifest() {
  const raw = readFileSync(join(REFERENCE_DIR, "MANIFEST.tsv"), "utf8");
  const map = new Map();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const [name, file] = line.split("\t");
    map.set(name, file);
  }
  return map;
}

const BASE64_RE = /(data:image\/[a-z+]+;base64,)([A-Za-z0-9+/=]{200,})/g;

function splitAssets(html) {
  const segments = [];
  const assets = [];
  let cursor = 0;
  for (const match of html.matchAll(BASE64_RE)) {
    const payload = match[2];
    const constant = SHARED_ASSETS.get(payload.length);
    if (!constant) continue;
    const start = match.index + match[1].length;
    segments.push(html.slice(cursor, start));
    assets.push(constant);
    cursor = start + payload.length;
  }
  segments.push(html.slice(cursor));
  return { segments, assets };
}

function collectSharedAssets(manifest) {
  const found = new Map();
  for (const [name] of PAGES) {
    const html = readFileSync(join(REFERENCE_DIR, manifest.get(name)), "utf8");
    for (const match of html.matchAll(BASE64_RE)) {
      const payload = match[2];
      const constant = SHARED_ASSETS.get(payload.length);
      if (!constant) continue;
      const previous = found.get(constant);
      if (previous && previous !== payload) {
        throw new Error(
          `asset length collision for ${constant}: two different payloads share length ${payload.length}`,
        );
      }
      found.set(constant, payload);
    }
  }
  for (const constant of SHARED_ASSETS.values()) {
    if (!found.has(constant)) throw new Error(`shared asset ${constant} not found in any reference file`);
  }
  return found;
}

function chunk(value, size) {
  const out = [];
  for (let i = 0; i < value.length; i += size) out.push(value.slice(i, i + size));
  return out;
}

function emitAssets(assets) {
  const body = [...assets]
    .map(([constant, payload]) => {
      const parts = chunk(payload, 120).map((line) => "  " + jsString(line));
      return `export const ${constant} =\n${parts.join(" +\n")};\n`;
    })
    .join("\n");
  return `/**
 * GENERATED FILE — do not edit by hand.
 * Run: node scripts/generate-approved-pages.mjs
 *
 * Base64 logo payloads lifted verbatim out of the approved 1368x753 reference
 * documents. Shared here only so the identical bytes are not duplicated across
 * page modules; every page concatenates them back into their original offsets.
 */

${body}`;
}

function emitPage(name, constant, sourceFile, html) {
  const { segments, assets } = splitAssets(html);
  const sha256 = createHash("sha256").update(html, "utf8").digest("hex");

  const pieces = [];
  segments.forEach((segment, index) => {
    pieces.push(segmentLiteral(segment));
    if (index < assets.length) pieces.push(assets[index]);
  });

  const imports = assets.length
    ? `import { ${[...new Set(assets)].sort().join(", ")} } from "./assets";\n\n`
    : "";

  return `/**
 * GENERATED FILE — do not edit by hand.
 * Run: node scripts/generate-approved-pages.mjs
 *
 * Byte-identical reproduction of the approved reference document:
 *   ui-reference/${sourceFile}
 *   bytes  : ${Buffer.byteLength(html, "utf8")}
 *   sha256 : ${sha256}
 *
 * Any edit here breaks the approved-visual contract enforced by
 * test/approved-pages-byte-identity.test.ts.
 */
${imports}export const ${constant}_SHA256 = ${jsString(sha256)};

export const ${constant}_HTML: string =
  ${pieces.join(" +\n  ")};
`;
}

function emitIndex(entries) {
  const imports = entries
    .map(([name, constant]) => `import { ${constant}_HTML, ${constant}_SHA256 } from "./${name}";`)
    .join("\n");
  const reexports = entries
    .map(([, constant]) => `export { ${constant}_HTML, ${constant}_SHA256 };`)
    .join("\n");
  const rows = entries
    .map(([name, constant]) => `  ${name}: { html: ${constant}_HTML, sha256: ${constant}_SHA256 },`)
    .join("\n");

  return `/**
 * GENERATED FILE — do not edit by hand.
 * Run: node scripts/generate-approved-pages.mjs
 */
${imports}

${reexports}

export interface ApprovedPage {
  html: string;
  sha256: string;
}

export const APPROVED_PAGES: Record<string, ApprovedPage> = {
${rows}
};

export type ApprovedPageName = keyof typeof APPROVED_PAGES;
`;
}

function main() {
  const manifest = readManifest();
  mkdirSync(OUT_DIR, { recursive: true });

  const sharedAssets = collectSharedAssets(manifest);
  writeFileSync(join(OUT_DIR, "assets.ts"), emitAssets(sharedAssets), "utf8");

  for (const [name, constant] of PAGES) {
    const sourceFile = manifest.get(name);
    if (!sourceFile) throw new Error(`manifest has no entry for page "${name}"`);
    const html = readFileSync(join(REFERENCE_DIR, sourceFile), "utf8");
    writeFileSync(join(OUT_DIR, `${name}.ts`), emitPage(name, constant, sourceFile, html), "utf8");
    process.stdout.write(`${name.padEnd(10)} ${String(Buffer.byteLength(html, "utf8")).padStart(7)} bytes\n`);
  }

  writeFileSync(join(OUT_DIR, "index.ts"), emitIndex(PAGES), "utf8");
  process.stdout.write(`\nwrote ${PAGES.length} page modules + assets.ts + index.ts to ${OUT_DIR}\n`);
}

main();
