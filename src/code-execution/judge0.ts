export interface Judge0Env {
	JUDGE0_BASE_URL?: string;
	JUDGE0_API_KEY?: string;
	JUDGE0_AUTH_HEADER?: string;
	JUDGE0_API_HOST?: string;
}

const DEFAULT_RAPIDAPI_BASE_URL = "https://judge0-ce.p.rapidapi.com";
const REQUEST_TIMEOUT_MS = 10_000;
const TOTAL_EXEC_TIMEOUT_MS = 25_000;
const POLL_INTERVAL_MS = 300;

type Judge0Language = { id: number; name: string };

type Judge0Config = {
	baseUrl: string;
	headers: Record<string, string>;
};

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeBody(body: unknown): string {
	if (typeof body === "string") return body.slice(0, 2_000);
	try {
		return JSON.stringify(body).slice(0, 2_000);
	} catch {
		return "<unserializable response>";
	}
}

function normalizeBaseUrl(value: string): string {
	const trimmed = value.trim().replace(/\/+$/, "");
	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		throw new Error("JUDGE0_BASE_URL must be a valid absolute URL");
	}
	if (parsed.protocol !== "https:") throw new Error("JUDGE0_BASE_URL must use https");
	return trimmed;
}

export function judge0Config(env: Judge0Env): Judge0Config {
	const baseUrl = normalizeBaseUrl(env.JUDGE0_BASE_URL || DEFAULT_RAPIDAPI_BASE_URL);
	const headers: Record<string, string> = { Accept: "application/json" };
	const key = env.JUDGE0_API_KEY?.trim();
	if (key) {
		const host = new URL(baseUrl).hostname;
		const headerName = (env.JUDGE0_AUTH_HEADER || (host.endsWith(".rapidapi.com") ? "X-RapidAPI-Key" : "X-Auth-Token")).trim();
		if (!headerName || /[\r\n:]/.test(headerName)) throw new Error("JUDGE0_AUTH_HEADER is invalid");
		headers[headerName] = key;
		if (host.endsWith(".rapidapi.com")) headers["X-RapidAPI-Host"] = (env.JUDGE0_API_HOST || host).trim();
	} else if (new URL(baseUrl).hostname.endsWith(".rapidapi.com")) {
		throw new Error("JUDGE0_API_KEY is not configured for the RapidAPI Judge0 backend");
	}
	return { baseUrl, headers };
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, label: string): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetch(url, { ...init, signal: controller.signal });
	} catch (err) {
		if (err instanceof Error && err.name === "AbortError") throw new Error(`${label} timed out after ${timeoutMs}ms`);
		throw err;
	} finally {
		clearTimeout(timer);
	}
}

async function judge0Request(env: Judge0Env, path: string, init: RequestInit = {}): Promise<any> {
	const config = judge0Config(env);
	const response = await fetchWithTimeout(
		`${config.baseUrl}${path}`,
		{
			...init,
			headers: {
				...config.headers,
				...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
				...(init.headers ?? {}),
			},
		},
		REQUEST_TIMEOUT_MS,
		`Judge0 ${init.method || "GET"} ${path}`,
	);
	const contentType = response.headers.get("content-type") ?? "";
	const body = contentType.includes("application/json") ? await response.json() : await response.text();
	if (!response.ok) throw new Error(`Judge0 API error (${response.status}) on ${path}: ${safeBody(body)}`);
	return body;
}

function extractVersion(name: string): string {
	const match = name.match(/(?:\(|\s)(\d+(?:\.\d+){0,3})(?:\)|\s|$)/);
	return match?.[1] ?? "";
}

function canonicalLanguage(name: string): string {
	const n = name.toLowerCase();
	if (n.includes("typescript")) return "typescript";
	if (n.includes("javascript") || n.includes("node.js")) return "javascript";
	if (n.includes("python")) return "python";
	if (n.startsWith("bash") || n.includes("shell")) return "bash";
	if (n.startsWith("c++") || n.includes("g++")) return "cpp";
	if (/^c\s|^c\(/.test(n) || n.includes("gcc")) return "c";
	if (n.includes("c#") || n.includes("mono")) return "csharp";
	if (n.startsWith("go ") || n.startsWith("go(")) return "go";
	if (n.includes("rust")) return "rust";
	if (n.startsWith("java ") || n.startsWith("java(")) return "java";
	if (n.includes("kotlin")) return "kotlin";
	if (n.includes("swift")) return "swift";
	if (n.includes("ruby")) return "ruby";
	if (n.includes("php")) return "php";
	return name.split("(")[0].trim().toLowerCase().replace(/\s+/g, "-");
}

function versionParts(version: string): number[] {
	return version.split(".").map((part) => Number(part) || 0);
}

function compareVersionsDesc(a: string, b: string): number {
	const aa = versionParts(a);
	const bb = versionParts(b);
	for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
		const diff = (bb[i] || 0) - (aa[i] || 0);
		if (diff !== 0) return diff;
	}
	return 0;
}

function normalizeLanguageAlias(value: string): string {
	const v = value.trim().toLowerCase();
	const aliases: Record<string, string> = {
		js: "javascript",
		node: "javascript",
		nodejs: "javascript",
		ts: "typescript",
		py: "python",
		sh: "bash",
		golang: "go",
		"c++": "cpp",
		cs: "csharp",
		"c#": "csharp",
	};
	return aliases[v] || v;
}

export async function judge0Runtimes(env: Judge0Env): Promise<Array<{ id: number; language: string; version: string; name: string; provider: "judge0" }>> {
	const languages = await judge0Request(env, "/languages/");
	if (!Array.isArray(languages)) throw new Error("Judge0 languages response is not an array");
	return languages
		.filter((row): row is Judge0Language => Boolean(row && Number.isInteger(row.id) && typeof row.name === "string"))
		.map((row) => ({ id: row.id, language: canonicalLanguage(row.name), version: extractVersion(row.name), name: row.name, provider: "judge0" as const }));
}

async function resolveLanguage(env: Judge0Env, language: string, version: string): Promise<{ id: number; language: string; version: string; name: string }> {
	const runtimes = await judge0Runtimes(env);
	const raw = language.trim();
	if (/^\d+$/.test(raw)) {
		const byId = runtimes.find((row) => row.id === Number(raw));
		if (byId) return byId;
	}
	const wanted = normalizeLanguageAlias(raw);
	let candidates = runtimes.filter((row) => row.language === wanted);
	if (version && version !== "*") {
		const exactVersion = candidates.filter((row) => row.version === version || row.name.includes(version));
		if (exactVersion.length > 0) candidates = exactVersion;
	}
	candidates.sort((a, b) => compareVersionsDesc(a.version, b.version) || b.id - a.id);
	if (candidates.length === 0) {
		const sample = runtimes.slice(0, 20).map((row) => `${row.language}${row.version ? `@${row.version}` : ""}`).join(", ");
		throw new Error(`Judge0 language not found: ${language}${version && version !== "*" ? `@${version}` : ""}. Available sample: ${sample}`);
	}
	return candidates[0];
}

function quoteArg(value: string): string {
	if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export async function judge0Execute(
	env: Judge0Env,
	language: string,
	version: string,
	code: string,
	stdin: string,
	args: string[],
): Promise<any> {
	const started = Date.now();
	const selected = await resolveLanguage(env, language, version);
	const submission = await judge0Request(env, "/submissions?base64_encoded=false&wait=false", {
		method: "POST",
		body: JSON.stringify({
			source_code: code,
			language_id: selected.id,
			stdin: stdin || "",
			...(args.length > 0 ? { command_line_arguments: args.map(quoteArg).join(" ") } : {}),
		}),
	});
	const token = typeof submission?.token === "string" ? submission.token : "";
	if (!token) throw new Error("Judge0 submission did not return a token");

	for (;;) {
		if (Date.now() - started >= TOTAL_EXEC_TIMEOUT_MS) throw new Error(`Judge0 execute timed out after ${TOTAL_EXEC_TIMEOUT_MS}ms`);
		const result = await judge0Request(
			env,
			`/submissions/${encodeURIComponent(token)}?base64_encoded=false&fields=stdout,stderr,compile_output,message,status,time,memory,exit_code,exit_signal`,
		);
		const statusId = Number(result?.status?.id ?? 0);
		if (statusId >= 3) {
			const stderrParts = [result?.stderr, result?.compile_output, statusId === 3 ? null : result?.message]
				.filter((value) => typeof value === "string" && value.length > 0);
			const exitCode = Number.isInteger(result?.exit_code) ? result.exit_code : statusId === 3 ? 0 : 1;
			return {
				language: selected.language,
				version: selected.version || version || "*",
				provider: "judge0",
				judge0: {
					language_id: selected.id,
					language_name: selected.name,
					status: result?.status ?? null,
					time: result?.time ?? null,
					memory: result?.memory ?? null,
					token,
				},
				run: {
					stdout: typeof result?.stdout === "string" ? result.stdout : "",
					stderr: stderrParts.join("\n"),
					code: exitCode,
					signal: Number.isInteger(result?.exit_signal) ? result.exit_signal : null,
				},
			};
		}
		await sleep(POLL_INTERVAL_MS);
	}
}
