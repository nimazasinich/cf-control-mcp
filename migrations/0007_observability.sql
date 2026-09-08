-- End-to-end operational correlation for health evidence.
ALTER TABLE health_checks ADD COLUMN correlation_id TEXT;
CREATE INDEX IF NOT EXISTS idx_health_checks_correlation_id ON health_checks(correlation_id);
