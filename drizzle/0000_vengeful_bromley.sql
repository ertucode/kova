CREATE TABLE `folders` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`parent_id`) REFERENCES `folders`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "folders_parent_id_not_self" CHECK("folders"."parent_id" is null or "folders"."parent_id" <> "folders"."id")
);
--> statement-breakpoint
CREATE INDEX `folders_parent_id_idx` ON `folders` (`parent_id`);--> statement-breakpoint
CREATE INDEX `folders_parent_position_idx` ON `folders` (`parent_id`,`position`);--> statement-breakpoint
CREATE INDEX `folders_deleted_at_idx` ON `folders` (`deleted_at`);