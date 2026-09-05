/**
 * v1.8 Admin Console — provider health test.
 *
 * Performs one harmless REAL request through:
 *   Worker → Cloudflare AI Gateway → BYOK → Google AI Studio
 * A credential existing is not sufficient for HEALTHY — this call must
 * actually succeed upstream. Never invents latency/usage numbers.
 */
import type { AdminEnv, HealthState } from "./types";

export interface HealthResult {
	state: HealthState;
	latencyMs: number | null;
	errorMessage: string | null;
}

export async function testGoogleAiStudio(env: AdminEnv): Promise<HealthResult> {
	if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CF_AIG_GATEWAY_SLUG) {
		return { state: "NOT_CONFIGURED", latencyMs: null, errorMessage: "CLOUDFLARE_ACCOUNT_ID or CF_AIG_GATEWAY_SLUG not set" };
	}

	const url = `https://gateway.ai.cloudflare.com/v1/${env.CLOUDFLARE_ACCOUNT_ID}/${env.CF_AIG_GATEWAY_SLUG}/compat/chat/completions`;
	const started = Date.now();

	try {
		const res = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model: "google-ai-studio/gemini-2.0-flash",
				messages: [{ role: "user", content: "ping" }],
				max_tokens: 1,
			}),
		});
		const latencyMs = Date.now() - started;

		if (res.ok) {
			return { state: "HEALTHY", latencyMs, errorMessage: null };
		}
		if (res.status === 401 || res.status === 403) {
			return { state: "AUTH_ERROR", latencyMs, errorMessage: `upstream ${res.status}` };
		}
		if (res.status === 429) {
			return { state: "RATE_LIMITED", latencyMs, errorMessage: `upstream ${res.status}` };
		}
		const text = await res.text().catch(() => "");
		return { state: "UPSTREAM_ERROR", latencyMs, errorMessage: `upstream ${res.status}: ${text.slice(0, 300)}` };
	} catch (err) {
		return {
			state: "UPSTREAM_ERROR",
			latencyMs: Date.now() - started,
			errorMessage: err instanceof Error ? err.message : String(err),
		};
	}
}
