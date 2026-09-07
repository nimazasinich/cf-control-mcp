/**
 * DreamWorker / cf-control-mcp — richer SAFE Admin settings summary.
 *
 * Optional read-only backend extension.
 * Never returns raw Worker secrets, provider credentials, or session signatures.
 */
import type { AdminEnv } from "./types";

export function getAdminSettingsSummary(env: AdminEnv) {
  return {
    gatewaySlug: env.CF_AIG_GATEWAY_SLUG || "cf-control-mcp",
    accountIdMasked: env.CLOUDFLARE_ACCOUNT_ID
      ? `${env.CLOUDFLARE_ACCOUNT_ID.slice(0, 6)}...${env.CLOUDFLARE_ACCOUNT_ID.slice(-4)}`
      : "not configured",
    d1Database: "DM_DB",
    hasCfToken: Boolean(env.CLOUDFLARE_API_TOKEN),
    hasGatewayAuth: Boolean(env.GATEWAY_AUTH_TOKEN),
    hasMcpAuth: Boolean(env.MCP_AUTH_TOKEN),
    version: "1.8.0",

    // Static source-contract metadata: safe to expose, contains no secret material.
    sessionPolicy: {
      cookieName: "admin_session",
      ttlSeconds: 12 * 60 * 60,
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
      path: "/admin",
      signingKeySource: "MCP_AUTH_TOKEN",
    },

    securityBoundary: {
      d1StoresRawProviderCredentials: false,
      cloudflareApiTokenBrowserReadable: false,
      ownerAuthBrowserReadable: false,
      providerCredentialStorage: "Cloudflare Secrets Store / AI Gateway BYOK",
      d1Role: "metadata-only",
    },

    capabilities: {
      settingsRead: true,
      settingsWrite: false,
      modelEnableDisable: true,
      providerEnableDisable: true,
      providerHealthTest: true,
      providerCredentialSetDelete: true,
      logout: true,
      rawSecretRead: false,
    },
  };
}
