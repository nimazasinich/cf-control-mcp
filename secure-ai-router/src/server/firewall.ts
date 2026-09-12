export type FirewallVerdict = 'ALLOW' | 'WARN' | 'BLOCK';

export interface FirewallResult {
  verdict: FirewallVerdict;
  eventType?: 'prompt_injection' | 'secret_leakage' | 'suspicious_instruction' | 'abuse_pattern';
  severity: 'low' | 'medium' | 'high' | 'critical';
  detail?: string;
}

const INJECTION_PATTERNS: RegExp[] = [
  /ignore (all|any|the) (previous|prior|above) instructions?/i,
  /disregard (all|any|the) (previous|prior|above) (instructions?|rules?|prompts?)/i,
  /you are now (in )?(dan|developer mode|jailbreak)/i,
  /pretend (you have|to have) no (restrictions|filters|rules)/i,
  /reveal (your |the )?(system prompt|hidden instructions)/i,
  /act as if you have no (guidelines|restrictions|safety)/i,
  /forget (everything|all) (you('ve| have) been told|above)/i,
  /\bsystem prompt\b.*\b(show|print|reveal|output)\b/i,
];

const SECRET_PATTERNS: RegExp[] = [
  /sk-[a-zA-Z0-9]{20,}/,            // OpenAI-style keys
  /AKIA[0-9A-Z]{16}/,               // AWS access key id
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAIza[0-9A-Za-z\-_]{35}\b/,     // Google API key
  /\bghp_[A-Za-z0-9]{36}\b/,        // GitHub PAT
  /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/, // Slack token
];

const SUSPICIOUS_PATTERNS: RegExp[] = [
  /base64\s*decode/i,
  /execute (shell|system) command/i,
  /rm\s+-rf\s+\//,
  /drop\s+table/i,
  /\bcurl\b.*\|\s*sh\b/i,
];

export function inspectPrompt(text: string): FirewallResult {
  if (!text) return { verdict: 'ALLOW', severity: 'low' };

  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(text)) {
      return {
        verdict: 'BLOCK',
        eventType: 'secret_leakage',
        severity: 'critical',
        detail: 'Prompt appears to contain a credential or secret token',
      };
    }
  }

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      return {
        verdict: 'BLOCK',
        eventType: 'prompt_injection',
        severity: 'high',
        detail: 'Prompt matched a known prompt-injection pattern',
      };
    }
  }

  for (const pattern of SUSPICIOUS_PATTERNS) {
    if (pattern.test(text)) {
      return {
        verdict: 'WARN',
        eventType: 'suspicious_instruction',
        severity: 'medium',
        detail: 'Prompt matched a suspicious-instruction pattern',
      };
    }
  }

  return { verdict: 'ALLOW', severity: 'low' };
}

/** Rate/abuse check based on recent request counts for a client. */
export function checkAbusePattern(recentCount: number, windowSeconds: number, limit: number): FirewallResult {
  if (recentCount > limit) {
    return {
      verdict: 'BLOCK',
      eventType: 'abuse_pattern',
      severity: 'high',
      detail: `Client exceeded ${limit} requests within ${windowSeconds}s (observed ${recentCount})`,
    };
  }
  return { verdict: 'ALLOW', severity: 'low' };
}
