-- Fixed-window, authenticated-principal rate limits for expensive/privileged operations.
CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  principal TEXT NOT NULL,
  bucket TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (principal, bucket)
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_updated_at ON rate_limit_buckets(updated_at);
