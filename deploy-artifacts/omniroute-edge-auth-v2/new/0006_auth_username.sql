-- Add an optional, normalized username for browser-admin authentication.
-- Existing users remain valid and can continue signing in by email.
ALTER TABLE `auth_users` ADD COLUMN `username` text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_auth_users_username` ON `auth_users` (`username`) WHERE `username` IS NOT NULL;
