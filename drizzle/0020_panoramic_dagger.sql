CREATE TABLE `app_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`warn_before_request_after_seconds` integer DEFAULT 10 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `environments` ADD `warn_on_request` integer DEFAULT false NOT NULL;