import legacyWorker, { tools, type Env } from "./index";
import { handleProviderGateway } from "./provider-gateway/router";
import { handleAdmin } from "./admin/router";
import { preLoginLoadingHtml } from "./admin/ui/prelogin";

/**
 * OAuth 2.1 / MCP authorization wrapper around the existing stateless MCP server.
 *
 * Goals:
 * - Keep the existing static MCP_AUTH_TOKEN path working for legacy/desktop clients.
 * - Offer standards-based OAuth discovery, dynamic client registration, PKCE/S256,
 *   explicit human consent, access tokens, and refresh tokens.
 * - OAuth-connected clients get the same full read/write/destructive access as
 *   the legacy static-token path, once the owner approves the connection via
 *   the /authorize consent page (which states this plainly).
 *
 * The existing MCP_AUTH_TOKEN is used only as the owner's approval secret and as
 * the HMAC root key for stateless OAuth artifacts. Rotating MCP_AUTH_TOKEN revokes
 * all registered clients, authorization codes, access tokens, and refresh tokens.
 */

const OAUTH_SCOPES = ["mcp:read", "offline_access"] as const;
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const AUTH_CODE_TTL_SECONDS = 5 * 60;
const FORM_TTL_SECONDS = 10 * 60;
const MAX_CLIENT_NAME_LENGTH = 120;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface SignedPayload {
  exp: number;
  iat?: number;
  [key: string]: unknown;
}

interface ClientPayload extends SignedPayload {
  kind: "client";
  redirect_uris: string[];
  client_name: string;
}

interface AuthorizationCodePayload extends SignedPayload {
  kind: "authorization_code";
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  scope: string;
  aud: string;
  jti: string;
}

interface AccessTokenPayload extends SignedPayload {
  kind: "access_token";
  client_id: string;
  scope: string;
  aud: string;
  jti: string;
}

interface RefreshTokenPayload extends SignedPayload {
  kind: "refresh_token";
  client_id: string;
  scope: string;
  aud: string;
  jti: string;
  family_id: string;
}

interface ConsentFormPayload extends SignedPayload {
  kind: "consent_form";
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  scope: string;
  state?: string;
  resource?: string;
}

interface OAuthAuthContext {
  mode: "legacy" | "oauth";
  scopes: Set<string>;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return base64UrlEncode(bytes);
}

async function hashJti(jti: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(jti)));
  return Array.from(digest).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function base64UrlEncode(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? encoder.encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(input: string): Uint8Array {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(normalized + padding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  if (!secret) throw new Error("MCP_AUTH_TOKEN is not configured");
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function signValue(prefix: string, payload: SignedPayload, secret: string): Promise<string> {
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const unsigned = `${prefix}.${encodedPayload}`;
  const key = await importHmacKey(secret);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(unsigned)));
  return `${unsigned}.${base64UrlEncode(signature)}`;
}

async function verifyValue<T extends SignedPayload>(
  token: string,
  expectedPrefix: string,
  secret: string,
): Promise<T | null> {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== expectedPrefix) return null;

  let signature: Uint8Array;
  let payloadBytes: Uint8Array;
  try {
    payloadBytes = base64UrlDecode(parts[1]);
    signature = base64UrlDecode(parts[2]);
  } catch {
    return null;
  }

  const key = await importHmacKey(secret);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    signature,
    encoder.encode(`${parts[0]}.${parts[1]}`),
  );
  if (!valid) return null;

  try {
    const payload = JSON.parse(decoder.decode(payloadBytes)) as T;
    if (!payload || typeof payload.exp !== "number" || payload.exp <= nowSeconds()) return null;
    return payload;
  } catch {
    return null;
  }
}

async function secretMatches(provided: string, expected: string): Promise<boolean> {
  if (!provided || !expected) return false;
  const message = encoder.encode("cf-control-mcp-owner-approval");
  const expectedKey = await importHmacKey(expected);
  const expectedMac = await crypto.subtle.sign("HMAC", expectedKey, message);
  const providedKey = await importHmacKey(provided);
  return crypto.subtle.verify("HMAC", providedKey, expectedMac, message);
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, MCP-Protocol-Version, Mcp-Session-Id",
    "Access-Control-Expose-Headers": "WWW-Authenticate, MCP-Protocol-Version, Mcp-Session-Id",
  };
}

function json(body: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...corsHeaders(),
  });
  new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  return new Response(JSON.stringify(body), { status, headers });
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function oauthError(error: string, description: string, status = 400): Response {
  return json({ error, error_description: description }, status);
}

function resourceUrl(origin: string): string {
  return `${origin}/mcp`;
}

function protectedResourceMetadata(origin: string): Record<string, unknown> {
  return {
    resource: resourceUrl(origin),
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
    scopes_supported: [...OAUTH_SCOPES],
    resource_name: "CF Control MCP",
    resource_documentation: "https://github.com/nimazasinich/cf-control-mcp",
  };
}

function authorizationServerMetadata(origin: string): Record<string, unknown> {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/authorize`,
    token_endpoint: `${origin}/token`,
    registration_endpoint: `${origin}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: [...OAUTH_SCOPES],
    service_documentation: "https://github.com/nimazasinich/cf-control-mcp",
  };
}

function normalizeScope(requested: string | null): string {
  if (!requested) return OAUTH_SCOPES.join(" ");
  const requestedScopes = requested.split(/\s+/).filter(Boolean);
  const allowed = requestedScopes.filter((scope) => OAUTH_SCOPES.includes(scope as (typeof OAUTH_SCOPES)[number]));
  if (!allowed.includes("mcp:read")) allowed.unshift("mcp:read");
  return [...new Set(allowed)].join(" ");
}

function isAllowedRedirectUri(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const replacements: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;",
    };
    return replacements[char];
  });
}

async function registerClient(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return oauthError("invalid_request", "Use POST for dynamic client registration", 405);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return oauthError("invalid_client_metadata", "Registration body must be valid JSON");
  }

  const redirectUris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris.filter((value): value is string => typeof value === "string")
    : [];
  if (redirectUris.length === 0 || redirectUris.some((uri) => !isAllowedRedirectUri(uri))) {
    return oauthError("invalid_redirect_uri", "At least one valid HTTPS redirect URI is required");
  }

  const requestedAuthMethod = body.token_endpoint_auth_method;
  if (requestedAuthMethod !== undefined && requestedAuthMethod !== "none") {
    return oauthError("invalid_client_metadata", "Only public PKCE clients with token_endpoint_auth_method=none are supported");
  }

  const clientName =
    typeof body.client_name === "string" && body.client_name.trim()
      ? body.client_name.trim().slice(0, MAX_CLIENT_NAME_LENGTH)
      : "MCP Client";

  const issuedAt = nowSeconds();
  const clientPayload: ClientPayload = {
    kind: "client",
    redirect_uris: [...new Set(redirectUris)],
    client_name: clientName,
    iat: issuedAt,
    exp: issuedAt + 365 * 24 * 60 * 60,
  };
  const clientId = await signValue("client", clientPayload, env.MCP_AUTH_TOKEN);

  return json(
    {
      client_id: clientId,
      client_id_issued_at: issuedAt,
      client_name: clientName,
      redirect_uris: clientPayload.redirect_uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    201,
  );
}

async function validateClient(clientId: string, env: Env): Promise<ClientPayload | null> {
  const payload = await verifyValue<ClientPayload>(clientId, "client", env.MCP_AUTH_TOKEN);
  if (!payload || payload.kind !== "client" || !Array.isArray(payload.redirect_uris)) return null;
  return payload;
}

function authorizationInputFromUrl(url: URL): Record<string, string> {
  const keys = ["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "scope", "state", "resource"];
  return Object.fromEntries(keys.map((key) => [key, url.searchParams.get(key) ?? ""]));
}

async function validateAuthorizationInput(
  input: Record<string, string>,
  env: Env,
  origin: string,
): Promise<{ client: ClientPayload; scope: string } | Response> {
  if (input.response_type !== "code") return oauthError("unsupported_response_type", "Only response_type=code is supported");
  if (!input.client_id || !input.redirect_uri) return oauthError("invalid_request", "client_id and redirect_uri are required");
  if (!input.code_challenge || input.code_challenge_method !== "S256") {
    return oauthError("invalid_request", "PKCE with code_challenge_method=S256 is required");
  }
  if (input.resource && input.resource !== resourceUrl(origin)) {
    return oauthError("invalid_target", "The requested OAuth resource does not match this MCP server");
  }

  const client = await validateClient(input.client_id, env);
  if (!client) return oauthError("invalid_client", "Unknown or expired client_id", 401);
  if (!client.redirect_uris.includes(input.redirect_uri)) {
    return oauthError("invalid_request", "redirect_uri is not registered for this client");
  }

  return { client, scope: normalizeScope(input.scope || null) };
}

function consentPage(clientName: string, redirectUri: string, scope: string, formToken: string, error?: string): Response {
  const scopeRows = scope
    .split(/\s+/)
    .filter(Boolean)
    .map((item) => `<li><code>${escapeHtml(item)}</code></li>`)
    .join("");
  const errorMarkup = error ? `<div class="error">${escapeHtml(error)}</div>` : "";

  return html(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Approve CF Control MCP</title>
<style>
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#111827;background:#f8fafc}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}.card{width:min(560px,100%);background:#fff;border:1px solid #e5e7eb;border-radius:18px;box-shadow:0 18px 50px rgba(15,23,42,.08);padding:28px}h1{font-size:24px;margin:0 0 8px}p{line-height:1.55;color:#475569}.meta{background:#f8fafc;border-radius:12px;padding:14px;margin:16px 0}.meta strong{display:block;color:#111827;margin-bottom:4px}.meta code{word-break:break-all;font-size:12px}.error{background:#fef2f2;color:#991b1b;border:1px solid #fecaca;border-radius:10px;padding:10px 12px;margin:14px 0}label{display:block;font-weight:600;margin:16px 0 6px}input{box-sizing:border-box;width:100%;padding:12px;border:1px solid #cbd5e1;border-radius:10px;font:inherit}button{width:100%;margin-top:18px;padding:12px 14px;border:0;border-radius:10px;background:#111827;color:#fff;font-weight:700;cursor:pointer}.note{font-size:12px;color:#64748b;margin-top:14px}ul{padding-left:22px;color:#334155}
</style>
</head>
<body>
<main class="card">
<h1>Approve Cloudflare connection</h1>
<p><strong>${escapeHtml(clientName)}</strong> is requesting full read/write access to your private CF Control MCP server, including destructive actions (delete DNS records, purge cache, modify Workers/KV, and arbitrary Cloudflare API calls).</p>
${errorMarkup}
<div class="meta"><strong>Redirect URI</strong><code>${escapeHtml(redirectUri)}</code></div>
<div class="meta"><strong>Scopes</strong><ul>${scopeRows}</ul></div>
<form method="post" action="/authorize">
<input type="hidden" name="form_token" value="${escapeHtml(formToken)}">
<label for="approval_token">Owner approval token</label>
<input id="approval_token" name="approval_token" type="password" autocomplete="current-password" required autofocus>
<button type="submit">Approve connection</button>
</form>
<p class="note">The approval token is never sent to the MCP client. OAuth access and refresh tokens are issued only after this approval.</p>
</main>
</body>
</html>`);
}

async function authorize(request: Request, env: Env, origin: string): Promise<Response> {
  if (request.method === "GET") {
    const input = authorizationInputFromUrl(new URL(request.url));
    const validated = await validateAuthorizationInput(input, env, origin);
    if (validated instanceof Response) return validated;

    const formPayload: ConsentFormPayload = {
      kind: "consent_form",
      client_id: input.client_id,
      redirect_uri: input.redirect_uri,
      code_challenge: input.code_challenge,
      scope: validated.scope,
      state: input.state || undefined,
      resource: input.resource || undefined,
      iat: nowSeconds(),
      exp: nowSeconds() + FORM_TTL_SECONDS,
    };
    const formToken = await signValue("form", formPayload, env.MCP_AUTH_TOKEN);
    return consentPage(validated.client.client_name, input.redirect_uri, validated.scope, formToken);
  }

  if (request.method !== "POST") return oauthError("invalid_request", "Use GET or POST for /authorize", 405);

  const form = await request.formData();
  const formToken = String(form.get("form_token") ?? "");
  const approvalToken = String(form.get("approval_token") ?? "");
  const formPayload = await verifyValue<ConsentFormPayload>(formToken, "form", env.MCP_AUTH_TOKEN);
  if (!formPayload || formPayload.kind !== "consent_form") {
    return oauthError("invalid_request", "The approval form expired or is invalid");
  }

  const client = await validateClient(formPayload.client_id, env);
  if (!client || !client.redirect_uris.includes(formPayload.redirect_uri)) {
    return oauthError("invalid_client", "The OAuth client is no longer valid", 401);
  }

  if (!(await secretMatches(approvalToken, env.MCP_AUTH_TOKEN))) {
    const retryToken = await signValue(
      "form",
      { ...formPayload, iat: nowSeconds(), exp: nowSeconds() + FORM_TTL_SECONDS },
      env.MCP_AUTH_TOKEN,
    );
    return consentPage(client.client_name, formPayload.redirect_uri, formPayload.scope, retryToken, "Approval token is incorrect.");
  }

  const issuedNow = nowSeconds();
  const codePayload: AuthorizationCodePayload = {
    kind: "authorization_code",
    client_id: formPayload.client_id,
    redirect_uri: formPayload.redirect_uri,
    code_challenge: formPayload.code_challenge,
    scope: normalizeScope(formPayload.scope),
    aud: resourceUrl(origin),
    jti: randomId(),
    iat: issuedNow,
    exp: issuedNow + AUTH_CODE_TTL_SECONDS,
  };
  await env.DM_DB.prepare(
    "INSERT INTO oauth_codes (code_id, client_id, redirect_uri, issued_at, expires_at) VALUES (?, ?, ?, ?, ?)",
  ).bind(codePayload.jti, codePayload.client_id, codePayload.redirect_uri, issuedNow, codePayload.exp).run();
  const code = await signValue("code", codePayload, env.MCP_AUTH_TOKEN);
  const redirect = new URL(formPayload.redirect_uri);
  redirect.searchParams.set("code", code);
  if (formPayload.state) redirect.searchParams.set("state", formPayload.state);
  return Response.redirect(redirect.toString(), 302);
}

async function pkceMatches(verifier: string, expectedChallenge: string): Promise<boolean> {
  if (!verifier || verifier.length < 43 || verifier.length > 128) return false;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(verifier)));
  return base64UrlEncode(digest) === expectedChallenge;
}

async function issueTokens(
  env: Env,
  origin: string,
  clientId: string,
  scope: string,
  refreshOverride?: { familyId: string; jti: string },
): Promise<Record<string, unknown>> {
  const normalizedScope = normalizeScope(scope);
  const issuedAt = nowSeconds();
  const common = {
    client_id: clientId,
    scope: normalizedScope,
    aud: resourceUrl(origin),
    iat: issuedAt,
  };

  const accessToken = await signValue(
    "access",
    {
      kind: "access_token",
      ...common,
      jti: randomId(),
      exp: issuedAt + ACCESS_TOKEN_TTL_SECONDS,
    } as AccessTokenPayload,
    env.MCP_AUTH_TOKEN,
  );

  const tokenResponse: Record<string, unknown> = {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    scope: normalizedScope,
  };

  if (normalizedScope.split(/\s+/).includes("offline_access")) {
    let familyId: string;
    let refreshJti: string;
    if (refreshOverride) {
      familyId = refreshOverride.familyId;
      refreshJti = refreshOverride.jti;
    } else {
      familyId = randomId();
      refreshJti = randomId();
      const tokenHash = await hashJti(refreshJti);
      await env.DM_DB.prepare(
        "INSERT INTO refresh_token_families (family_id, current_token_hash, client_id, issued_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ).bind(familyId, tokenHash, clientId, issuedAt, issuedAt).run();
    }
    tokenResponse.refresh_token = await signValue(
      "refresh",
      {
        kind: "refresh_token",
        ...common,
        jti: refreshJti,
        family_id: familyId,
        exp: issuedAt + REFRESH_TOKEN_TTL_SECONDS,
      } as RefreshTokenPayload,
      env.MCP_AUTH_TOKEN,
    );
  }

  return tokenResponse;
}

async function tokenEndpoint(request: Request, env: Env, origin: string): Promise<Response> {
  if (request.method !== "POST") return oauthError("invalid_request", "Use POST for /token", 405);

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/x-www-form-urlencoded")) {
    return oauthError("invalid_request", "Token requests must use application/x-www-form-urlencoded");
  }

  const form = await request.formData();
  const grantType = String(form.get("grant_type") ?? "");
  const clientId = String(form.get("client_id") ?? "");
  const client = await validateClient(clientId, env);
  if (!client) return oauthError("invalid_client", "Unknown or expired client_id", 401);

  if (grantType === "authorization_code") {
    const code = String(form.get("code") ?? "");
    const redirectUri = String(form.get("redirect_uri") ?? "");
    const verifier = String(form.get("code_verifier") ?? "");
    const payload = await verifyValue<AuthorizationCodePayload>(code, "code", env.MCP_AUTH_TOKEN);
    if (!payload || payload.kind !== "authorization_code") return oauthError("invalid_grant", "Authorization code is invalid or expired");
    if (payload.client_id !== clientId || payload.redirect_uri !== redirectUri || payload.aud !== resourceUrl(origin)) {
      return oauthError("invalid_grant", "Authorization code does not match the client or redirect URI");
    }
    if (!client.redirect_uris.includes(redirectUri)) return oauthError("invalid_grant", "redirect_uri is not registered for this client");
    if (!(await pkceMatches(verifier, payload.code_challenge))) return oauthError("invalid_grant", "PKCE verification failed");
    // D1 one-time-use: atomically mark the code consumed; changes=0 means already used or expired.
    const consumeResult = await env.DM_DB.prepare(
      "UPDATE oauth_codes SET consumed_at = ? WHERE code_id = ? AND client_id = ? AND redirect_uri = ? AND consumed_at IS NULL AND expires_at > ?",
    ).bind(nowSeconds(), payload.jti, clientId, redirectUri, nowSeconds()).run();
    if (!consumeResult.meta.changes || consumeResult.meta.changes < 1) {
      return oauthError("invalid_grant", "Authorization code has already been used");
    }
    return json(await issueTokens(env, origin, clientId, payload.scope));
  }

  if (grantType === "refresh_token") {
    const refreshToken = String(form.get("refresh_token") ?? "");
    const payload = await verifyValue<RefreshTokenPayload>(refreshToken, "refresh", env.MCP_AUTH_TOKEN);
    if (!payload || payload.kind !== "refresh_token") return oauthError("invalid_grant", "Refresh token is invalid or expired");
    if (!payload.scope.split(/\s+/).includes("offline_access")) return oauthError("invalid_grant", "Refresh access was not granted");
    if (payload.client_id !== clientId || payload.aud !== resourceUrl(origin)) {
      return oauthError("invalid_grant", "Refresh token does not match this client or resource");
    }
    // D1 refresh-token rotation: verify current hash and rotate atomically.
    const presentedHash = await hashJti(payload.jti);
    const issuedAt = nowSeconds();
    const successorJti = randomId();
    const successorHash = await hashJti(successorJti);
    const rotateResult = await env.DM_DB.prepare(
      "UPDATE refresh_token_families SET current_token_hash = ?, updated_at = ? WHERE family_id = ? AND client_id = ? AND current_token_hash = ? AND revoked_at IS NULL",
    ).bind(successorHash, issuedAt, payload.family_id, clientId, presentedHash).run();
    if (!rotateResult.meta.changes || rotateResult.meta.changes < 1) {
      // Hash mismatch or family revoked — this token has already been rotated or the family is revoked.
      // Revoke the entire family (token reuse detected).
      await env.DM_DB.prepare(
        "UPDATE refresh_token_families SET revoked_at = ?, updated_at = ? WHERE family_id = ? AND client_id = ? AND revoked_at IS NULL",
      ).bind(issuedAt, issuedAt, payload.family_id, clientId).run();
      return oauthError("invalid_grant", "Refresh token has already been used; token family has been revoked");
    }
    return json(await issueTokens(env, origin, clientId, payload.scope, { familyId: payload.family_id, jti: successorJti }));
  }

  return oauthError("unsupported_grant_type", "Supported grants: authorization_code, refresh_token");
}

async function authenticateMcp(request: Request, env: Env, origin: string): Promise<OAuthAuthContext | null> {
  const authorization = request.headers.get("Authorization") ?? "";
  const bearer = authorization.replace(/^Bearer\s+/i, "");
  if (!bearer) return null;

  if (await secretMatches(bearer, env.MCP_AUTH_TOKEN)) {
    return { mode: "legacy", scopes: new Set(["mcp:read", "mcp:write", "offline_access"]) };
  }

  const payload = await verifyValue<AccessTokenPayload>(bearer, "access", env.MCP_AUTH_TOKEN);
  if (!payload || payload.kind !== "access_token" || payload.aud !== resourceUrl(origin)) return null;
  const scopes = new Set(payload.scope.split(/\s+/).filter(Boolean));
  if (!scopes.has("mcp:read")) return null;
  return { mode: "oauth", scopes };
}

function oauthUnauthorized(origin: string): Response {
  return json(
    { error: "unauthorized", message: "OAuth authorization is required for this MCP endpoint." },
    401,
    {
      "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
    },
  );
}

async function proxyMcp(request: Request, env: Env, origin: string): Promise<Response> {
  const auth = await authenticateMcp(request, env, origin);
  if (!auth) return oauthUnauthorized(origin);
  // Legacy (static owner-token) clients keep full, unrestricted tool access,
  // matching pre-OAuth behaviour. OAuth clients are scoped below to exactly
  // what the owner approved on the /authorize consent page.
  if (auth.mode === "legacy") return legacyWorker.fetch(request, env);

  // For OAuth mode, the request's Authorization header carries the signed
  // OAuth access token, not the raw MCP_AUTH_TOKEN secret. The inner legacy
  // worker only knows how to check a bearer against env.MCP_AUTH_TOKEN, so
  // swap that in for this call so its check passes. It also enforces the
  // granted scopes as MCP capabilities, so an OAuth client only sees and
  // can call tools within what the owner actually approved in /authorize.
  const authorization = request.headers.get("Authorization") ?? "";
  const bearer = authorization.replace(/^Bearer\s+/i, "");
  const legacyEnv: Env = {
    ...env,
    MCP_AUTH_TOKEN: bearer,
    MCP_AUTHZ_MODE: "oauth",
    MCP_AUTHZ_SCOPES: [...auth.scopes].join(" "),
  };
  return legacyWorker.fetch(request, legacyEnv);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/favicon.svg" && request.method === "GET") {
      return new Response('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="8" y1="8" x2="56" y2="56"><stop stop-color="#2b79ef"/><stop offset=".55" stop-color="#25bfe7"/><stop offset="1" stop-color="#3bd1b8"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="#f7fbff"/><path d="M12 16 32 7l20 9v18c0 10-7 17-20 23C19 51 12 44 12 34Z" fill="none" stroke="url(#g)" stroke-width="4"/><path d="m21 33 8 8 15-18" fill="none" stroke="url(#g)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>', { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" } });
    }
    const origin = url.origin;

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });

    if (url.pathname === "/.well-known/oauth-protected-resource" || url.pathname === "/.well-known/oauth-protected-resource/mcp") {
      if (request.method !== "GET") return oauthError("invalid_request", "Use GET for protected resource metadata", 405);
      return json(protectedResourceMetadata(origin));
    }

    if (url.pathname === "/.well-known/oauth-authorization-server") {
      if (request.method !== "GET") return oauthError("invalid_request", "Use GET for authorization server metadata", 405);
      return json(authorizationServerMetadata(origin));
    }

    if (url.pathname === "/register") return registerClient(request, env);
    if (url.pathname === "/authorize") return authorize(request, env, origin);
    if (url.pathname === "/token") return tokenEndpoint(request, env, origin);
    if (url.pathname === "/mcp") return proxyMcp(request, env, origin);

    // Provider Gateway — OpenAI-compatible /v1/* endpoints for Google Gemini.
    // Uses a separate GATEWAY_AUTH_TOKEN; MCP_AUTH_TOKEN is never involved.
    if (url.pathname.startsWith("/v1/")) return handleProviderGateway(request, env);

    // v1.8 Admin Console — owner-only, session-cookie auth signed with
    // MCP_AUTH_TOKEN (never protected by GATEWAY_AUTH_TOKEN alone).
    if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) return handleAdmin(request, env, tools);

    if (url.pathname === "/" && request.method === "GET") {
      return new Response(preLoginLoadingHtml(), {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "private, no-store",
        },
      });
    }

    return legacyWorker.fetch(request, env);
  },
};
