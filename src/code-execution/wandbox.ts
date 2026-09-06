const WANDBOX_BASE_URL = "https://wandbox.org/api";
const WANDBOX_TIMEOUT_MS = 25_000;

export interface WandboxCompiler {
	name: string;
	version?: string;
	language?: string;
	"display-name"?: string;
	"runtime-option-raw"?: boolean;
	[key: string]: unknown;
}

interface WandboxCompileResult {
	status?: string | number;
	signal?: string;
	compiler_output?: string;
	compiler_error?: string;
	compiler_message?: string;
	program_output?: string;
	program_error?: string;
	program_message?: string;
	permlink?: string;
	url?: string;
	[key: string]: unknown;
}

async function fetchWithTimeout(url: string, init: RequestInit, label: string): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), WANDBOX_TIMEOUT_MS);
	try {
		return await fetch(url, { ...init, signal: controller.signal });
	} catch (err) {
		if (err instanceof Error && err.name === "AbortError") {
			throw new Error(`${label} timed out after ${WANDBOX_TIMEOUT_MS}ms`);
		}
		throw err;
	} finally {
		clearTimeout(timer);
	}
}

function normalized(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9+#]+/g, "");
}

const LANGUAGE_ALIASES: Record<string, string[]> = {
	python: ["python", "python3"],
	python3: ["python", "python3"],
	javascript: ["javascript", "node", "nodejs"],
	node: ["javascript", "node", "nodejs"],
	nodejs: ["javascript", "node", "nodejs"],
	typescript: ["typescript"],
	bash: ["bash", "bashscript", "shell"],
	shell: ["bash", "bashscript", "shell"],
	go: ["go", "golang"],
	golang: ["go", "golang"],
	rust: ["rust"],
	java: ["java"],
	c: ["c"],
	cpp: ["c++", "cpp"],
	"c++": ["c++", "cpp"],
	csharp: ["c#", "csharp"],
	"c#": ["c#", "csharp"],
	ruby: ["ruby"],
	php: ["php"],
	perl: ["perl"],
	lua: ["lua"],
	haskell: ["haskell"],
	scala: ["scala"],
	swift: ["swift"],
	kotlin: ["kotlin"],
};

function compilerScore(compiler: WandboxCompiler, requestedVersion: string): number {
	const name = String(compiler.name ?? "").toLowerCase();
	const displayName = String(compiler["display-name"] ?? "").toLowerCase();
	const version = String(compiler.version ?? "").toLowerCase();
	let score = 0;
	if (requestedVersion && requestedVersion !== "*") {
		const wanted = requestedVersion.toLowerCase();
		if (version === wanted || name === wanted) score += 1000;
		else if (version.includes(wanted) || name.includes(wanted)) score += 500;
		else score -= 500;
	}
	if (name.includes("head") || displayName.includes("head")) score += 100;
	if (name.includes("latest") || displayName.includes("latest")) score += 80;
	return score;
}

export async function wandboxRuntimes(): Promise<WandboxCompiler[]> {
	const res = await fetchWithTimeout(`${WANDBOX_BASE_URL}/list.json`, { headers: { Accept: "application/json" } }, "Wandbox list runtimes");
	if (!res.ok) throw new Error(`Wandbox API error (${res.status}) listing runtimes`);
	const body = await res.json();
	if (!Array.isArray(body)) throw new Error("Wandbox API returned an invalid runtimes payload");
	return body as WandboxCompiler[];
}

export function resolveWandboxCompiler(compilers: WandboxCompiler[], language: string, version = "*"): WandboxCompiler {
	const requested = language.trim();
	if (!requested) throw new Error("language is required");

	const exactByName = compilers.find((compiler) => String(compiler.name ?? "").toLowerCase() === requested.toLowerCase());
	if (exactByName) return exactByName;

	const key = normalized(requested);
	const aliases = LANGUAGE_ALIASES[key] ?? [requested];
	const aliasSet = new Set(aliases.map(normalized));
	const candidates = compilers.filter((compiler) => {
		const languageName = normalized(String(compiler.language ?? ""));
		const compilerName = normalized(String(compiler.name ?? ""));
		return [...aliasSet].some((alias) => languageName === alias || languageName.includes(alias) || compilerName.includes(alias));
	});

	if (candidates.length === 0) {
		throw new Error(`Wandbox does not currently expose a compiler matching language '${language}'`);
	}

	return [...candidates].sort((a, b) => compilerScore(b, version) - compilerScore(a, version))[0];
}

function asString(value: unknown): string {
	return typeof value === "string" ? value : value == null ? "" : String(value);
}

export async function wandboxExecute(
	language: string,
	version: string,
	code: string,
	stdin: string,
	args: string[],
): Promise<any> {
	const compilers = await wandboxRuntimes();
	const compiler = resolveWandboxCompiler(compilers, language, version);
	if (args.length > 0 && compiler["runtime-option-raw"] !== true) {
		throw new Error(`Wandbox compiler '${compiler.name}' does not support runtime arguments`);
	}

	const payload: Record<string, unknown> = {
		compiler: compiler.name,
		code,
		stdin: stdin || "",
		save: false,
	};
	if (args.length > 0) payload["runtime-option-raw"] = args.join("\n");

	const res = await fetchWithTimeout(
		`${WANDBOX_BASE_URL}/compile.json`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json", Accept: "application/json" },
			body: JSON.stringify(payload),
		},
		"Wandbox execute",
	);
	const contentType = res.headers.get("content-type") ?? "";
	const body: WandboxCompileResult | string = contentType.includes("application/json") ? await res.json() : await res.text();
	if (!res.ok) {
		throw new Error(`Wandbox API error (${res.status}): ${typeof body === "string" ? body : JSON.stringify(body)}`);
	}
	if (typeof body !== "object" || body === null) throw new Error("Wandbox API returned an invalid execution payload");

	const rawStatus = Number((body as WandboxCompileResult).status ?? 0);
	const compilerError = asString((body as WandboxCompileResult).compiler_error);
	const programError = asString((body as WandboxCompileResult).program_error);
	const codeValue = Number.isFinite(rawStatus) ? (rawStatus === 0 && compilerError ? 1 : rawStatus) : compilerError || programError ? 1 : 0;

	return {
		run: {
			stdout: asString((body as WandboxCompileResult).program_output),
			stderr: programError || compilerError,
			code: codeValue,
			signal: asString((body as WandboxCompileResult).signal) || null,
		},
		compile: {
			stdout: asString((body as WandboxCompileResult).compiler_output),
			stderr: compilerError,
		},
		backend: "wandbox",
		compiler: {
			name: compiler.name,
			language: compiler.language ?? null,
			version: compiler.version ?? null,
			display_name: compiler["display-name"] ?? null,
		},
	};
}
