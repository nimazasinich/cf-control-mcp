-- New API-compatible gateways — additive migration for existing v1.8/v3 D1 databases.
-- Adds TaBiToken, GoRouter, and a generic self-hosted "New API" preset as
-- Cloudflare Custom Provider (gateway-custom) profiles. Per
-- AI-Gateway-Master-Report.md, all three share one open-source codebase
-- (QuantumNous/new-api), so the request/response schema, auth headers, and
-- endpoint paths are identical across them — only base URL, key, and the
-- instance's enabled models differ.
--
-- Rows are seeded disabled/NOT_CONFIGURED, same as every other preset in
-- 0003_provider_registry_v3.sql: they become live only once the operator
-- adds a credential through the Admin Providers UI (which provisions the
-- Cloudflare Custom Provider and stores the BYOK secret).
INSERT OR IGNORE INTO providers
(id, display_name, kind, provider_slug, transport, auth_type, base_url, api_path, priority, credential_required, test_model, enabled, health_state)
VALUES
  ('tabitoken', 'TaBiToken (New API gateway)', 'tabitoken', 'custom-tabitoken', 'gateway-custom', 'byok', 'https://tabitoken.com', 'v1/chat/completions', 150, 1, 'gpt-4o-mini', 0, 'NOT_CONFIGURED'),
  ('gorouter', 'GoRouter (New API gateway)', 'gorouter', 'custom-gorouter', 'gateway-custom', 'byok', 'https://gorouter.app', 'v1/chat/completions', 160, 1, 'gpt-4o-mini', 0, 'NOT_CONFIGURED'),
  ('new-api', 'New API (self-hosted / other instance)', 'new-api', 'custom-new-api', 'gateway-custom', 'byok', NULL, 'v1/chat/completions', 170, 1, 'gpt-4o-mini', 0, 'NOT_CONFIGURED');

-- Base URL is a known point of disagreement between sources (root domain vs
-- `api.` subdomain — see Section 3 of the master report). Seeded rows use the
-- root-domain form, since that is what a live fetch of both hosts returned as
-- the New API application. The base_url stays operator-editable through the
-- Admin Providers UI (customizable preset) so it can be switched to the
-- `api.` subdomain form, or tabitoken.cc, if GET /v1/models does not resolve
-- against the seeded default.
