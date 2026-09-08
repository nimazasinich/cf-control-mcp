-- Provider Registry v3 — additive migration for existing v1.8 D1 databases.
-- Raw credentials remain outside D1.
ALTER TABLE providers ADD COLUMN provider_slug TEXT NOT NULL DEFAULT 'google-ai-studio';
ALTER TABLE providers ADD COLUMN transport TEXT NOT NULL DEFAULT 'gateway-native';
ALTER TABLE providers ADD COLUMN auth_type TEXT NOT NULL DEFAULT 'byok';
ALTER TABLE providers ADD COLUMN base_url TEXT;
ALTER TABLE providers ADD COLUMN api_path TEXT;
ALTER TABLE providers ADD COLUMN priority INTEGER NOT NULL DEFAULT 100;
ALTER TABLE providers ADD COLUMN credential_required INTEGER NOT NULL DEFAULT 1;
ALTER TABLE providers ADD COLUMN custom_provider_id TEXT;
ALTER TABLE providers ADD COLUMN test_model TEXT;
ALTER TABLE providers ADD COLUMN last_http_status INTEGER;
ALTER TABLE providers ADD COLUMN last_gateway_log_id TEXT;
ALTER TABLE providers ADD COLUMN last_gateway_step TEXT;
ALTER TABLE providers ADD COLUMN last_cf_ray TEXT;
ALTER TABLE models ADD COLUMN free_tier INTEGER NOT NULL DEFAULT 0;
ALTER TABLE health_checks ADD COLUMN http_status INTEGER;
ALTER TABLE health_checks ADD COLUMN gateway_log_id TEXT;
ALTER TABLE health_checks ADD COLUMN gateway_step TEXT;
ALTER TABLE health_checks ADD COLUMN cf_ray TEXT;
ALTER TABLE health_checks ADD COLUMN model_id TEXT;

UPDATE providers
SET provider_slug = 'google-ai-studio', transport = 'gateway-native', auth_type = 'byok', credential_required = 1
WHERE id = 'google-ai-studio';

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

INSERT OR IGNORE INTO models (id, provider_id, public_alias, enabled, free_tier)
VALUES
  ('@cf/zai-org/glm-4.7-flash', 'workers-ai', NULL, 1, 1),
  ('@cf/google/gemma-4-26b-a4b-it', 'workers-ai', NULL, 1, 1),
  ('@cf/nvidia/nemotron-3-120b-a12b', 'workers-ai', NULL, 1, 1);

INSERT OR IGNORE INTO routing_rules (public_alias, model_id)
VALUES
  ('free', '@cf/zai-org/glm-4.7-flash'),
  ('auto', '@cf/zai-org/glm-4.7-flash');

CREATE INDEX IF NOT EXISTS providers_priority_idx ON providers(priority, id);
CREATE INDEX IF NOT EXISTS models_provider_idx ON models(provider_id, enabled, id);

-- Never assume an undocumented native Antigravity transport. Existing preview rows are reset fail-closed.
UPDATE providers SET display_name='Google Antigravity / custom endpoint', provider_slug='custom-google-antigravity', transport='gateway-custom', base_url=NULL, custom_provider_id=NULL, test_model=NULL, enabled=0, health_state='NOT_CONFIGURED' WHERE id='google-antigravity';

UPDATE providers SET api_path='v1/chat/completions' WHERE id='openrouter';
