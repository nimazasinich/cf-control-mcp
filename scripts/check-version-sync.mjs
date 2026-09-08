#!/usr/bin/env node
// P0-04 / P5-06: package.json is the single authority for the project version.
// This script fails (non-zero exit) if README.md's version badge drifts from
// package.json.version, so the badge can't silently go stale on the next release.
//
// Usage: node scripts/check-version-sync.mjs
// Exit codes: 0 = in sync, 1 = drift detected, 2 = could not parse either source.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

function readPackageVersion() {
	const pkgPath = join(rootDir, "package.json");
	const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
	if (!pkg.version || typeof pkg.version !== "string") {
		throw new Error(`package.json is missing a string "version" field`);
	}
	return pkg.version;
}

function readReadmeBadgeVersion() {
	const readmePath = join(rootDir, "README.md");
	const readme = readFileSync(readmePath, "utf8");
	// Matches: badge/version-1.8.0-B8860B (shields.io "version-<value>-<color>" badge convention)
	const match = readme.match(/badge\/version-([0-9]+\.[0-9]+\.[0-9]+)-/);
	if (!match) {
		throw new Error(
			"Could not find a version badge in README.md matching /badge\\/version-X.Y.Z-/"
		);
	}
	return match[1];
}

function main() {
	let pkgVersion;
	let badgeVersion;
	try {
		pkgVersion = readPackageVersion();
		badgeVersion = readReadmeBadgeVersion();
	} catch (err) {
		console.error(`[check-version-sync] ${err.message}`);
		process.exit(2);
	}

	if (pkgVersion !== badgeVersion) {
		console.error(
			`[check-version-sync] Version drift detected: package.json is "${pkgVersion}" but README.md badge is "${badgeVersion}".`
		);
		console.error(
			`[check-version-sync] Update the README badge to match package.json (the single authority).`
		);
		process.exit(1);
	}

	console.log(
		`[check-version-sync] OK — package.json and README.md badge both report ${pkgVersion}.`
	);
	process.exit(0);
}

main();
