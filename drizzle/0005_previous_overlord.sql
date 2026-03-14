CREATE TABLE `request_history` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`request_name` text NOT NULL,
	`method` text NOT NULL,
	`url` text NOT NULL,
	`request_headers` text DEFAULT '' NOT NULL,
	`request_body` text DEFAULT '' NOT NULL,
	`request_variables_json` text DEFAULT '{}' NOT NULL,
	`request_body_type` text DEFAULT 'none' NOT NULL,
	`request_raw_type` text DEFAULT 'json' NOT NULL,
	`response_status` integer,
	`response_status_text` text,
	`response_headers` text DEFAULT '' NOT NULL,
	`response_body` text DEFAULT '' NOT NULL,
	`response_body_omitted` integer DEFAULT false NOT NULL,
	`response_error` text,
	`response_duration_ms` integer,
	`response_received_at` integer,
	`script_errors_json` text DEFAULT '[]' NOT NULL,
	`console_entries_json` text DEFAULT '[]' NOT NULL,
	`sent_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `request_history_created_at_idx` ON `request_history` (`created_at`);--> statement-breakpoint
CREATE INDEX `request_history_request_id_idx` ON `request_history` (`request_id`);--> statement-breakpoint
CREATE INDEX `request_history_sent_at_idx` ON `request_history` (`sent_at`);