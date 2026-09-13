CREATE TABLE `request_batch_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`row_index` integer NOT NULL,
	`variables_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`history_id` text,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `request_batch_rows_batch_id_idx` ON `request_batch_rows` (`batch_id`);--> statement-breakpoint
CREATE INDEX `request_batch_rows_batch_row_index_idx` ON `request_batch_rows` (`batch_id`,`row_index`);--> statement-breakpoint
CREATE INDEX `request_batch_rows_status_idx` ON `request_batch_rows` (`batch_id`,`status`);--> statement-breakpoint
CREATE INDEX `request_batch_rows_history_id_idx` ON `request_batch_rows` (`history_id`);--> statement-breakpoint
CREATE TABLE `request_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`request_name` text NOT NULL,
	`name` text NOT NULL,
	`source_file_name` text NOT NULL,
	`source_type` text NOT NULL,
	`sheet_name` text,
	`columns_json` text DEFAULT '[]' NOT NULL,
	`row_count` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'ready' NOT NULL,
	`concurrency` integer,
	`summary_json` text DEFAULT '{"totalCount":0,"pendingCount":0,"runningCount":0,"completedCount":0,"failedCount":0,"cancelledCount":0}' NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `request_batches_request_id_idx` ON `request_batches` (`request_id`);--> statement-breakpoint
CREATE INDEX `request_batches_created_at_idx` ON `request_batches` (`created_at`);--> statement-breakpoint
CREATE INDEX `request_batches_status_idx` ON `request_batches` (`status`);--> statement-breakpoint
ALTER TABLE `request_history` ADD `batch_id` text;--> statement-breakpoint
ALTER TABLE `request_history` ADD `row_id` text;--> statement-breakpoint
CREATE INDEX `request_history_batch_id_idx` ON `request_history` (`batch_id`);--> statement-breakpoint
CREATE INDEX `request_history_row_id_idx` ON `request_history` (`row_id`);