CREATE TABLE `view_cache_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`view_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`view_id`) REFERENCES `views`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "view_cache_entries_key_not_empty" CHECK(length(trim("view_cache_entries"."key")) > 0)
);
--> statement-breakpoint
CREATE INDEX `view_cache_entries_view_id_idx` ON `view_cache_entries` (`view_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `view_cache_entries_view_key_idx` ON `view_cache_entries` (`view_id`,`key`);