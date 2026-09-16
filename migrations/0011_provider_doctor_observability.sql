-- Provider Doctor observability tables.
-- Safe metadata/evidence only. NEVER store provider credentials or raw request bodies.

CREATE TABLE IF NOT EXISTS provider_doctor_runs (
  run_id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('RUNNING','COMPLETED','PARTIAL','FAILED')),
  provider_count INTEGER NOT NULL DEFAULT 0,
  probed_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS provider_doctor_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES provider_doctor_runs(run_id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,
  model_id TEXT,
  state TEXT NOT NULL,
  diagnosis TEXT NOT NULL,
  latency_ms INTEGER,
  http_status INTEGER,
  gateway_verified INTEGER NOT NULL DEFAULT 0,
  gateway_log_id TEXT,
  gateway_step TEXT,
  cf_ray TEXT,
  correlation_id TEXT,
  error_message TEXT,
  tested_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_provider_doctor_runs_started
  ON provider_doctor_runs(started_at DESC);

CREATE INDEX IF NOT EXISTS idx_provider_doctor_results_run
  ON provider_doctor_results(run_id, id);

CREATE INDEX IF NOT EXISTS idx_provider_doctor_results_provider
  ON provider_doctor_results(provider_id, tested_at DESC);
