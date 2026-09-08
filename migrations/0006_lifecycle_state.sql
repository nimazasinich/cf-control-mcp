-- Durable provider/credential lifecycle evidence. This table intentionally
-- stores only safe metadata; raw credentials are never persisted here.
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

CREATE INDEX IF NOT EXISTS idx_provider_operations_provider ON provider_operations(provider_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_provider_operations_state ON provider_operations(state, updated_at DESC);
