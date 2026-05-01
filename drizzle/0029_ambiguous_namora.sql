CREATE TABLE `tag_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`tag_id` text NOT NULL,
	`item_type` text NOT NULL,
	`item_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "tag_assignments_item_type_check" CHECK("tag_assignments"."item_type" in ('folder', 'request'))
);
--> statement-breakpoint
CREATE INDEX `tag_assignments_tag_id_idx` ON `tag_assignments` (`tag_id`);--> statement-breakpoint
CREATE INDEX `tag_assignments_item_ref_idx` ON `tag_assignments` (`item_type`,`item_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `tag_assignments_tag_item_idx` ON `tag_assignments` (`tag_id`,`item_type`,`item_id`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `tags_deleted_at_idx` ON `tags` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `tags_position_idx` ON `tags` (`position`);