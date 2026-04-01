CREATE TABLE `operations` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_type` text NOT NULL,
	`status` text NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`metadata_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	`undone_at` integer,
	CONSTRAINT "operations_status_check" CHECK("operations"."status" in ('active', 'undone', 'failed')),
	CONSTRAINT "operations_type_check" CHECK("operations"."operation_type" in ('delete-folder', 'delete-request'))
);
--> statement-breakpoint
CREATE INDEX `operations_created_at_idx` ON `operations` (`created_at`);--> statement-breakpoint
CREATE INDEX `operations_operation_type_idx` ON `operations` (`operation_type`);--> statement-breakpoint
CREATE INDEX `operations_status_idx` ON `operations` (`status`);