-- OAuth replay/rotation state. Raw authorization codes and refresh tokens are
-- never persisted; only random JTIs and SHA-256 token hashes are stored.

CREATE TABLE IF NOT EXISTS oauth_codes (
  code_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_oauth_codes_expires_at ON oauth_codes(expires_at);

CREATE TABLE IF NOT EXISTS refresh_token_families (
  family_id TEXT PRIMARY KEY,
  current_token_hash TEXT NOT NULL,
  client_id TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_refresh_token_families_client_id ON refresh_token_families(client_id);
