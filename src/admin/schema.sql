-- Current Admin/D1 metadata schema for fresh installations.
-- This file represents the post-migration shape of 0002 -> 0009.
-- NEVER store raw provider credentials here. Credentials live in Cloudflare
-- Secrets Store / AI Gateway BYOK; D1 stores only safe metadata and lifecycle state.

CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  kind TEXT NOT NULL,
  provider_slug TEXT NOT NULL DEFAULT 'google-ai-studio',
  transport TEXT NOT NULL DEFAULT 'gateway-native',
  auth_type TEXT NOT NULL DEFAULT 'byok',
  base_url TEXT,
  api_path TEXT,
  priority INTEGER NOT NULL DEFAULT 100,
  credential_required INTEGER NOT NULL DEFAULT 1,
  custom_provider_id TEXT,
  test_model TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  byok_alias TEXT,
  health_state TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
  last_success_at TEXT,
  last_error_at TEXT,
  last_error_message TEXT,
  last_latency_ms INTEGER,
  last_http_status INTEGER,
  last_gateway_log_id TEXT,
  last_gateway_step TEXT,
  last_cf_ray TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id),
  public_alias TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  free_tier INTEGER NOT NULL DEFAULT 0,
  display_name TEXT,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS routing_rules (
  public_alias TEXT PRIMARY KEY,
  model_id TEXT NOT NULL REFERENCES models(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS health_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id TEXT NOT NULL REFERENCES providers(id),
  checked_at TEXT NOT NULL DEFAULT (datetime('now')),
  state TEXT NOT NULL,
  latency_ms INTEGER,
  error_message TEXT,
  http_status INTEGER,
  gateway_log_id TEXT,
  gateway_step TEXT,
  cf_ray TEXT,
  model_id TEXT,
  correlation_id TEXT
);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  actor TEXT NOT NULL DEFAULT 'admin',
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT
);

-- OAuth replay/rotation state. Raw authorization codes and refresh tokens are
-- never persisted; only random identifiers and token hashes are stored.
CREATE TABLE IF NOT EXISTS oauth_codes (
  code_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);

CREATE TABLE IF NOT EXISTS refresh_token_families (
  family_id TEXT PRIMARY KEY,
  current_token_hash TEXT NOT NULL,
  client_id TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revoked_at INTEGER
);

-- Durable provider/credential lifecycle evidence. Safe metadata only.
CREATE TABLE IF NOT EXISTS provider_operations (
  operation_id TEXT PRIMARY KEY,
  operation_type TEXT NOT NULL,
  provider_id TEXT,
  external_custom_provider_id TEXT,
  step TEXT NOT NULL,
  state TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 1,
  error_summary TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  principal TEXT NOT NULL,
  bucket TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (principal, bucket)
);

CREATE INDEX IF NOT EXISTS providers_priority_idx ON providers(priority, id);
CREATE INDEX IF NOT EXISTS models_provider_idx ON models(provider_id, enabled, id);
CREATE INDEX IF NOT EXISTS idx_oauth_codes_expires_at ON oauth_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_refresh_token_families_client_id ON refresh_token_families(client_id);
CREATE INDEX IF NOT EXISTS idx_provider_operations_provider ON provider_operations(provider_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_provider_operations_state ON provider_operations(state, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_health_checks_correlation_id ON health_checks(correlation_id);
CREATE INDEX IF NOT EXISTS idx_rate_limit_updated_at ON rate_limit_buckets(updated_at);

-- Final state of the Google provider after migration 0002 + provider registry v3.
INSERT OR IGNORE INTO providers
(id, display_name, kind, provider_slug, transport, auth_type, priority, credential_required, enabled, byok_alias, health_state)
VALUES
('google-ai-studio', 'Google AI Studio', 'google-ai-studio', 'google-ai-studio', 'gateway-native', 'byok', 100, 1, 1, 'default', 'NOT_CONFIGURED');

-- Provider Registry v3 presets. All non-Google providers remain disabled until
-- the operator explicitly configures the required credential/binding.
INSERT OR IGNORE INTO providers
(id, display_name, kind, provider_slug, transport, auth_type, priority, credential_required, test_model, enabled, health_state)
VALUES
  ('workers-ai', 'Workers AI', 'workers-ai', 'workers-ai', 'workers-ai-binding', 'cloudflare-binding', 10, 0, '@cf/zai-org/glm-4.7-flash', 0, 'NOT_CONFIGURED'),
  ('google-antigravity', 'Google Antigravity / custom endpoint', 'google-antigravity', 'custom-google-antigravity', 'gateway-custom', 'byok', 30, 1, NULL, 0, 'NOT_CONFIGURED'),
  ('openai', 'OpenAI', 'openai', 'openai', 'gateway-native', 'byok', 40, 1, NULL, 0, 'NOT_CONFIGURED'),
  ('anthropic', 'Anthropic', 'anthropic', 'anthropic', 'gateway-native', 'byok', 50, 1, NULL, 0, 'NOT_CONFIGURED'),
  ('deepseek', 'DeepSeek', 'deepseek', 'deepseek', 'gateway-native', 'byok', 60, 1, NULL, 0, 'NOT_CONFIGURED'),
  ('openrouter', 'OpenRouter', 'openrouter', 'openrouter', 'gateway-native', 'byok', 70, 1, NULL, 0, 'NOT_CONFIGURED'),
  ('groq', 'Groq', 'groq', 'groq', 'gateway-native', 'byok', 80, 1, NULL, 0, 'NOT_CONFIGURED'),
  ('mistral', 'Mistral AI', 'mistral', 'mistral', 'gateway-native', 'byok', 90, 1, NULL, 0, 'NOT_CONFIGURED'),
  ('xai', 'xAI', 'xai', 'xai', 'gateway-native', 'byok', 100, 1, NULL, 0, 'NOT_CONFIGURED'),
  ('perplexity', 'Perplexity', 'perplexity', 'perplexity-ai', 'gateway-native', 'byok', 110, 1, NULL, 0, 'NOT_CONFIGURED'),
  ('cerebras', 'Cerebras', 'cerebras', 'cerebras', 'gateway-native', 'byok', 120, 1, NULL, 0, 'NOT_CONFIGURED'),
  ('cohere', 'Cohere', 'cohere', 'cohere', 'gateway-native', 'byok', 130, 1, NULL, 0, 'NOT_CONFIGURED'),
  ('huggingface', 'Hugging Face', 'huggingface', 'huggingface', 'gateway-native', 'byok', 140, 1, NULL, 0, 'NOT_CONFIGURED');

INSERT OR IGNORE INTO providers
(id, display_name, kind, provider_slug, transport, auth_type, base_url, api_path, priority, credential_required, test_model, enabled, health_state)
VALUES
  ('google-relay', 'Google via Relay', 'google-relay', 'google-relay', 'gateway-custom', 'byok', NULL, 'v1/chat/completions', 20, 1, 'gemini-3.6-flash', 0, 'NOT_CONFIGURED');

-- OpenAI-compatible custom gateway presets introduced by migration 0004.
INSERT OR IGNORE INTO providers
(id, display_name, kind, provider_slug, transport, auth_type, base_url, api_path, priority, credential_required, test_model, enabled, health_state)
VALUES
  ('tabitoken', 'TaBiToken (New API gateway)', 'tabitoken', 'custom-tabitoken', 'gateway-custom', 'byok', 'https://tabitoken.com', 'v1/chat/completions', 150, 1, 'gpt-4o-mini', 0, 'NOT_CONFIGURED'),
  ('gorouter', 'GoRouter (New API gateway)', 'gorouter', 'custom-gorouter', 'gateway-custom', 'byok', 'https://gorouter.app', 'v1/chat/completions', 160, 1, 'gpt-4o-mini', 0, 'NOT_CONFIGURED'),
  ('new-api', 'New API (self-hosted / other instance)', 'new-api', 'custom-new-api', 'gateway-custom', 'byok', NULL, 'v1/chat/completions', 170, 1, 'gpt-4o-mini', 0, 'NOT_CONFIGURED');

UPDATE providers SET api_path='v1/chat/completions' WHERE id='openrouter';

-- Current Google model registry after migration 0002.
INSERT OR IGNORE INTO models (id, provider_id, public_alias, enabled, free_tier)
VALUES
  ('gemini-3.6-flash', 'google-ai-studio', NULL, 1, 0),
  ('gemini-3.8-flash', 'google-ai-studio', NULL, 1, 0),
  ('gemini-3.7-flash', 'google-ai-studio', NULL, 1, 0),
  ('gemini-3.5-flash', 'google-ai-studio', NULL, 1, 0),
  ('@cf/zai-org/glm-4.7-flash', 'workers-ai', NULL, 1, 1),
  ('@cf/google/gemma-4-26b-a4b-it', 'workers-ai', NULL, 1, 1),
  ('@cf/nvidia/nemotron-3-120b-a12b', 'workers-ai', NULL, 1, 1);

INSERT OR IGNORE INTO routing_rules (public_alias, model_id)
VALUES
  ('fast', 'gemini-3.6-flash'),
  ('coding', 'gemini-3.8-flash'),
  ('research', 'gemini-3.8-flash'),
  ('free', '@cf/zai-org/glm-4.7-flash'),
  ('auto', '@cf/zai-org/glm-4.7-flash');
