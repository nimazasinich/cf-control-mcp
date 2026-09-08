-- Optional Google relay provider.
--
-- This is intentionally separate from the native google-ai-studio provider.
-- It seeds a disabled Cloudflare AI Gateway Custom Provider profile only; no
-- models or public routing aliases are registered until an operator supplies a
-- relay URL, credential, and real health/callability evidence.
INSERT OR IGNORE INTO providers
(id, display_name, kind, provider_slug, transport, auth_type, base_url, api_path, priority, credential_required, test_model, enabled, health_state)
VALUES
  ('google-relay', 'Google via Relay', 'google-relay', 'google-relay', 'gateway-custom', 'byok', NULL, 'v1/chat/completions', 20, 1, 'gemini-3.6-flash', 0, 'NOT_CONFIGURED');
