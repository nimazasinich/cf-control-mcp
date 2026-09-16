const SECRET_PATTERNS: RegExp[] = [
	/\b(?:cfut_|ghp_|github_pat_|hf_|sk-|gsk_|AIza)[A-Za-z0-9._\-]{6,}\b/g,
	/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi,
	/\b(api[_ -]?key|token|secret|authorization|credential)\s*[:=]\s*["']?[^,\s;"']{6,}/gi,
];

export function redactText(value: unknown, maxLength = 400): string {
	let text = value instanceof Error ? value.message : String(value ?? "");
	for (const pattern of SECRET_PATTERNS) {
		text = text.replace(pattern, (match) => {
			const eq = match.indexOf("=");
			const colon = match.indexOf(":");
			const split = eq >= 0 ? eq : colon;
			return split >= 0 ? `${match.slice(0, split + 1)}<REDACTED>` : "<REDACTED>";
		});
	}
	if (text.length > maxLength) text = `${text.slice(0, maxLength)}…`;
	return text;
}

export function safeError(value: unknown): string | null {
	if (value === null || value === undefined || value === "") return null;
	return redactText(value);
}
