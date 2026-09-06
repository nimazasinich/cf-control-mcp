const PAIZA_BASE_URL = "https://api.paiza.io/runners";
const PAIZA_API_KEY = "guest";
const PAIZA_HTTP_TIMEOUT_MS = 10_000;
const PAIZA_TOTAL_TIMEOUT_MS = 20_000;
const PAIZA_POLL_INTERVAL_MS = 250;

const PAIZA_LANGUAGE_IDS = [
	"bash",
	"c",
	"csharp",
	"cpp",
	"clojure",
	"cobol",
	"coffeescript",
	"d",
	"elixir",
	"erlang",
	"fsharp",
	"go",
	"haskell",
	"java",
	"javascript",
	"kotlin",
	"mysql",
	"nadesiko",
	"objective-c",
	"perl",
	"php",
	"python",
	"python3",
	"r",
	"ruby",
	"rust",
	"scala",
	"scheme",
	"swift",
	"typescript",
	"vb",
] as const;

const PAIZA_LANGUAGE_SET = new Set<string>(PAIZA_LANGUAGE_IDS);

const LANGUAGE_ALIASES: Record<string, string> = {
	py: "python3",
	py3: "python3",
	python: "python3",
	python3: "python3",
	py2: "python",
	python2: "python",
	js: "javascript",
	javascript: "javascript",
	node: "javascript",
	nodejs: "javascript",
	ts: "typescript",
	typescript: "typescript",
	sh: "bash",
	shell: "bash",
	bash: "bash",
	"c++": "cpp",
	cpp: "cpp",
	c: "c",
	"c#": "csharp",
	csharp: "csharp",
	cs: "csharp",
	objc: "objective-c",
	"objective-c": "objective-c",
	go: "go",
	golang: "go",
	rust: "rust",
	java: "java",
	kotlin: "kotlin",
	scala: "scala",
	swift: "swift",
	ruby: "ruby",
	php: "php",
	perl: "perl",
	haskell: "haskell",
	erlang: "erlang",
	clojure: "clojure",
	elixir: "elixir",
	coffee: "coffeescript",
	coffeescript: "coffeescript",
	fsharp: "fsharp",
	"f#": "fsharp",
	vb: "vb",
	visualbasic: "vb",
	cobol: "cobol",
	d: "d",
	mysql: "mysql",
	scheme: "scheme",
	nadesiko: "nadesiko",
	r: "r",
};

interface PaizaCreateResponse {
	id?: string | number;
	status?: string;
	error?: string | null;
}

interface PaizaStatusResponse {
	id?: string | number;
	status?: string;
	error?: string | null;
}

interface PaizaDetailsResponse extends PaizaStatusResponse {
	language?: string;
	build_stdout?: string | null;
	build_stderr?: string | null;
	build_exit_code?: number | string | null;
	build_time?: number | string | null;
	build_memory?: number | string | null;
	build_result?: string | null;
	stdout?: string | null;
	stderr?: string | null;
	exit_code?: number | string | null;
	time?: number | string | null;
	memory?: number | string | null;
	result?: string | null;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url: string, init: RequestInit, label: string): Promise<any> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), PAIZA_HTTP_TIMEOUT_MS);
	try {
		const response = await fetch(url, { ...init, signal: controller.signal });
		const contentType = response.headers.get("content-type") ?? "";
		const body = contentType.includes("application/json") ? await response.json() : await response.text();
		if (!response.ok) {
			throw new Error(`paiza.IO API error (${response.status}) during ${label}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
		}
		if (typeof body !== "object" || body === null || Array.isArray(body)) {
			throw new Error(`paiza.IO API returned an invalid ${label} payload`);
		}
		return body;
	} catch (err) {
		if (err instanceof Error && err.name === "AbortError") {
			throw new Error(`paiza.IO ${label} timed out after ${PAIZA_HTTP_TIMEOUT_MS}ms`);
		}
		throw err;
	} finally {
		clearTimeout(timer);
	}
}

function normalizeLanguage(language: string): string {
	const raw = language.trim().toLowerCase();
	if (!raw) throw new Error("language is required");
	const compact = raw.replace(/[\s_.]+/g, "");
	const aliased = LANGUAGE_ALIASES[raw] ?? LANGUAGE_ALIASES[compact];
	if (aliased) return aliased;
	if (PAIZA_LANGUAGE_SET.has(raw)) return raw;
	throw new Error(`paiza.IO does not support language '${language}'. Call list_code_runtimes for supported language ids.`);
}

function stringValue(value: unknown): string {
	return value == null ? "" : String(value);
}

function integerOrNull(value: unknown): number | null {
	if (value === null || value === undefined || value === "") return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function throwApiError(stage: string, error: unknown): void {
	const message = stringValue(error).trim();
	if (message) throw new Error(`paiza.IO ${stage} error: ${message}`);
}

export function paizaRuntimes(): Array<Record<string, unknown>> {
	return PAIZA_LANGUAGE_IDS.map((language) => ({
		language,
		version: null,
		backend: "paiza.io",
		version_policy: "service-managed",
	}));
}

export async function paizaExecute(
	language: string,
	version: string,
	code: string,
	stdin: string,
	args: string[],
): Promise<any> {
	const runtime = normalizeLanguage(language);
	if (version && version !== "*") {
		throw new Error(`paiza.IO manages runtime versions and cannot select version '${version}'. Use version='*' or omit it.`);
	}
	if (args.length > 0) {
		throw new Error("paiza.IO guest API does not support CLI arguments. Use stdin, or use gh_run_code when argv is required.");
	}

	const deadline = Date.now() + PAIZA_TOTAL_TIMEOUT_MS;
	const form = new URLSearchParams({
		source_code: code,
		language: runtime,
		input: stdin || "",
		api_key: PAIZA_API_KEY,
	});
	const created = (await fetchJson(
		`${PAIZA_BASE_URL}/create.json`,
		{
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", Accept: "application/json" },
			body: form.toString(),
		},
		"create",
	)) as PaizaCreateResponse;
	throwApiError("create", created.error);

	const sessionId = created.id;
	if (sessionId === undefined || sessionId === null || String(sessionId).trim() === "") {
		throw new Error("paiza.IO create did not return a session id");
	}

	let status = stringValue(created.status).trim();
	while (status === "running") {
		if (Date.now() >= deadline) throw new Error(`paiza.IO execution timed out after ${PAIZA_TOTAL_TIMEOUT_MS}ms`);
		await delay(PAIZA_POLL_INTERVAL_MS);
		const params = new URLSearchParams({ id: String(sessionId), api_key: PAIZA_API_KEY });
		const state = (await fetchJson(`${PAIZA_BASE_URL}/get_status.json?${params.toString()}`, { headers: { Accept: "application/json" } }, "get_status")) as PaizaStatusResponse;
		throwApiError("status", state.error);
		status = stringValue(state.status).trim();
		if (status !== "running" && status !== "completed") {
			throw new Error(`paiza.IO returned unexpected execution status '${status || "(empty)"}'`);
		}
	}
	if (status && status !== "completed") {
		throw new Error(`paiza.IO returned unexpected execution status '${status}'`);
	}
	if (Date.now() >= deadline) throw new Error(`paiza.IO execution timed out after ${PAIZA_TOTAL_TIMEOUT_MS}ms`);

	const params = new URLSearchParams({ id: String(sessionId), api_key: PAIZA_API_KEY });
	const details = (await fetchJson(`${PAIZA_BASE_URL}/get_details.json?${params.toString()}`, { headers: { Accept: "application/json" } }, "get_details")) as PaizaDetailsResponse;
	throwApiError("details", details.error);
	if (details.status && details.status !== "completed") {
		throw new Error(`paiza.IO details returned unexpected status '${details.status}'`);
	}

	const buildStdout = stringValue(details.build_stdout);
	const buildStderr = stringValue(details.build_stderr);
	const stdout = stringValue(details.stdout);
	const runtimeStderr = stringValue(details.stderr);
	const stderr = [buildStderr, runtimeStderr].filter(Boolean).join("\n");
	const runtimeExit = integerOrNull(details.exit_code);
	const buildExit = integerOrNull(details.build_exit_code);
	const resultStatus = stringValue(details.result).trim();
	const codeValue = runtimeExit ?? buildExit ?? (resultStatus === "success" ? 0 : 1);

	return {
		run: {
			stdout,
			stderr,
			code: codeValue,
			signal: null,
		},
		compile: {
			stdout: buildStdout,
			stderr: buildStderr,
			code: buildExit,
			result: details.build_result ?? null,
		},
		backend: "paiza.io",
		language: details.language ?? runtime,
		execution: {
			result: details.result ?? null,
			time: details.time ?? null,
			memory: details.memory ?? null,
		},
	};
}
