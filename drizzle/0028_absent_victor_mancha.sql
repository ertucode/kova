PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_operations` (
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
	CONSTRAINT "operations_status_check" CHECK("__new_operations"."status" in ('active', 'undone', 'failed'))
);
--> statement-breakpoint
INSERT INTO `__new_operations`("id", "operation_type", "status", "title", "summary", "metadata_json", "created_at", "updated_at", "completed_at", "undone_at") SELECT "id", "operation_type", "status", "title", "summary", "metadata_json", "created_at", "updated_at", "completed_at", "undone_at" FROM `operations`;--> statement-breakpoint
DROP TABLE `operations`;--> statement-breakpoint
ALTER TABLE `__new_operations` RENAME TO `operations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `operations_created_at_idx` ON `operations` (`created_at`);--> statement-breakpoint
CREATE INDEX `operations_operation_type_idx` ON `operations` (`operation_type`);--> statement-breakpoint
CREATE INDEX `operations_status_idx` ON `operations` (`status`);