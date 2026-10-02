CREATE TABLE `folder_run_iterations` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`iteration_index` integer NOT NULL,
	`status` text NOT NULL,
	`summary_json` text NOT NULL,
	`requests_json` text DEFAULT '[]' NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
CREATE INDEX `folder_run_iterations_run_id_idx` ON `folder_run_iterations` (`run_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `folder_run_iterations_run_index_idx` ON `folder_run_iterations` (`run_id`,`iteration_index`);--> statement-breakpoint
ALTER TABLE `request_history` ADD `folder_run_iteration_id` text;--> statement-breakpoint
CREATE INDEX `request_history_folder_run_iteration_id_idx` ON `request_history` (`folder_run_iteration_id`);