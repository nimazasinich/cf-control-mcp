-- CP04: add request_attempts table for failover evidence
CREATE TABLE IF NOT EXISTS `request_attempts` (
  `id` text PRIMARY KEY NOT NULL,
  `request_id` text NOT NULL REFERENCES `requests`(`id`) ON DELETE CASCADE,
  `attempt_number` integer NOT NULL,
  `provider_id` text NOT NULL,
  `model_name` text NOT NULL,
  `started_at` integer NOT NULL,
  `latency_ms` integer DEFAULT 0 NOT NULL,
  `result` text NOT NULL,
  `failure_category` text,
  `http_status` integer,
  `error_detail` text
);
