CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`key_hash` text NOT NULL,
	`key_prefix` text NOT NULL,
	`name` text NOT NULL,
	`role` text DEFAULT 'gateway' NOT NULL,
	`revoked` integer DEFAULT false NOT NULL,
	`last_used_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`timestamp` integer NOT NULL,
	`actor_key_id` text,
	`actor_name` text DEFAULT 'unknown' NOT NULL,
	`action` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text,
	`detail` text
);
--> statement-breakpoint
CREATE TABLE `models` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`model_name` text NOT NULL,
	`capabilities` text DEFAULT '[]' NOT NULL,
	`context_window` integer DEFAULT 8192 NOT NULL,
	`input_cost` real DEFAULT 0 NOT NULL,
	`output_cost` real DEFAULT 0 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `policies` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`action` text DEFAULT 'deny' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `providers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT 'openai_compatible' NOT NULL,
	`base_url` text NOT NULL,
	`api_key_encrypted` text,
	`enabled` integer DEFAULT true NOT NULL,
	`priority` integer DEFAULT 1 NOT NULL,
	`health_status` text DEFAULT 'offline' NOT NULL,
	`latency_ms` integer,
	`success_rate` real DEFAULT 1 NOT NULL,
	`cost_per_token` real DEFAULT 0 NOT NULL,
	`last_health_check` integer,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `requests` (
	`id` text PRIMARY KEY NOT NULL,
	`timestamp` integer NOT NULL,
	`client_id` text NOT NULL,
	`request_type` text DEFAULT 'chat' NOT NULL,
	`requested_model` text,
	`selected_model` text,
	`provider_id` text,
	`latency_ms` integer DEFAULT 0 NOT NULL,
	`tokens_input` integer DEFAULT 0 NOT NULL,
	`tokens_output` integer DEFAULT 0 NOT NULL,
	`cost` real DEFAULT 0 NOT NULL,
	`routing_reason` text,
	`status` text DEFAULT 'success' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `routing_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`timestamp` integer NOT NULL,
	`request_type` text NOT NULL,
	`selected_provider_id` text,
	`selected_model_id` text,
	`score` real,
	`reasons` text DEFAULT '[]' NOT NULL,
	`candidates` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `security_events` (
	`id` text PRIMARY KEY NOT NULL,
	`timestamp` integer NOT NULL,
	`event_type` text NOT NULL,
	`severity` text DEFAULT 'medium' NOT NULL,
	`source` text,
	`action` text NOT NULL,
	`detail` text,
	`request_id` text
);
--> statement-breakpoint
CREATE INDEX `idx_requests_timestamp` ON `requests` (`timestamp`);
--> statement-breakpoint
CREATE INDEX `idx_requests_client` ON `requests` (`client_id`);
--> statement-breakpoint
CREATE INDEX `idx_security_events_timestamp` ON `security_events` (`timestamp`);
--> statement-breakpoint
CREATE INDEX `idx_audit_log_timestamp` ON `audit_log` (`timestamp`);
