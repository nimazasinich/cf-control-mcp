-- 1. Disable shutdown Gemini 2.0 models
UPDATE models SET enabled = 0, public_alias = NULL WHERE id = 'gemini-2.0-flash';

-- 2. Disable Gemini 2.5 models as upstream unavailable on this route
UPDATE models SET enabled = 0, public_alias = NULL WHERE id IN ('gemini-2.5-flash', 'gemini-2.5-pro');

-- 3. Upsert verified active models
INSERT INTO models (id, provider_id, public_alias, enabled)
VALUES 
  ('gemini-3.6-flash', 'google-ai-studio', NULL, 1),
  ('gemini-3.8-flash', 'google-ai-studio', NULL, 1),
  ('gemini-3.7-flash', 'google-ai-studio', NULL, 1),
  ('gemini-3.5-flash', 'google-ai-studio', NULL, 1)
ON CONFLICT(id) DO UPDATE SET
  public_alias = excluded.public_alias,
  enabled = excluded.enabled;

-- 4. Upsert production aliases in routing rules
INSERT INTO routing_rules (public_alias, model_id, updated_at)
VALUES
  ('fast', 'gemini-3.6-flash', datetime('now')),
  ('coding', 'gemini-3.8-flash', datetime('now')),
  ('research', 'gemini-3.8-flash', datetime('now'))
ON CONFLICT(public_alias) DO UPDATE SET
  model_id = excluded.model_id,
  updated_at = datetime('now');

-- 5. Ensure provider is enabled with default alias
UPDATE providers 
SET enabled = 1, byok_alias = 'default', updated_at = datetime('now')
WHERE id = 'google-ai-studio';
