-- v1.8 Admin Console — D1 metadata schema.
-- NEVER store raw provider credentials here. Credentials live in
-- Cloudflare Secrets Store / AI Gateway BYOK; this DB only stores
-- metadata (which alias is configured, health state, timestamps).

CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  kind TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  byok_alias TEXT,
  health_state TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
  last_success_at TEXT,
  last_error_at TEXT,
  last_error_message TEXT,
  last_latency_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id),
  public_alias TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
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
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  actor TEXT NOT NULL DEFAULT 'admin',
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT
);

-- Seed the first real provider (disabled until credential is configured).
INSERT OR IGNORE INTO providers (id, display_name, kind, enabled, health_state)
VALUES ('google-ai-studio', 'Google AI Studio', 'google-ai-studio', 0, 'NOT_CONFIGURED');
