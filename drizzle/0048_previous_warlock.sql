CREATE TABLE `folder_run_history` (
	`id` text PRIMARY KEY NOT NULL,
	`folder_id` text NOT NULL,
	`folder_name` text NOT NULL,
	`run_config_json` text NOT NULL,
	`status` text NOT NULL,
	`summary_json` text NOT NULL,
	`request_count` integer DEFAULT 0 NOT NULL,
	`passed_request_count` integer DEFAULT 0 NOT NULL,
	`failed_request_count` integer DEFAULT 0 NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	CONSTRAINT "folder_run_history_status_check" CHECK("folder_run_history"."status" in ('running', 'completed', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX `folder_run_history_folder_id_idx` ON `folder_run_history` (`folder_id`);--> statement-breakpoint
CREATE INDEX `folder_run_history_started_at_idx` ON `folder_run_history` (`started_at`);--> statement-breakpoint
CREATE INDEX `folder_run_history_status_idx` ON `folder_run_history` (`status`);--> statement-breakpoint
ALTER TABLE `folders` ADD `run_config_json` text DEFAULT '{"selectionMode":"tests-only","selectedRequestIds":[],"executionMode":"sequential","continueOnFailure":true}' NOT NULL;--> statement-breakpoint
ALTER TABLE `request_history` ADD `folder_run_id` text;--> statement-breakpoint
ALTER TABLE `request_history` ADD `folder_run_folder_id` text;--> statement-breakpoint
CREATE INDEX `request_history_folder_run_id_idx` ON `request_history` (`folder_run_id`);--> statement-breakpoint
CREATE INDEX `request_history_folder_run_folder_id_idx` ON `request_history` (`folder_run_folder_id`);