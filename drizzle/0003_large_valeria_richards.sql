PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`method` text DEFAULT 'GET' NOT NULL,
	`url` text DEFAULT '' NOT NULL,
	`pre_request_script` text DEFAULT '' NOT NULL,
	`post_request_script` text DEFAULT '' NOT NULL,
	`headers` text DEFAULT '' NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`body_type` text DEFAULT 'none' NOT NULL,
	`raw_type` text DEFAULT 'json' NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	CONSTRAINT "requests_body_type_check" CHECK("__new_requests"."body_type" in ('raw', 'form-data', 'x-www-form-urlencoded', 'none')),
	CONSTRAINT "requests_raw_type_check" CHECK("__new_requests"."raw_type" in ('json', 'text'))
);
--> statement-breakpoint
INSERT INTO `__new_requests`("id", "name", "method", "url", "pre_request_script", "post_request_script", "headers", "body", "body_type", "raw_type", "created_at", "deleted_at") SELECT "id", "name", "method", "url", "pre_request_script", "post_request_script", "headers", "body", "body_type", "raw_type", "created_at", "deleted_at" FROM `requests`;--> statement-breakpoint
DROP TABLE `requests`;--> statement-breakpoint
ALTER TABLE `__new_requests` RENAME TO `requests`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `requests_deleted_at_idx` ON `requests` (`deleted_at`);