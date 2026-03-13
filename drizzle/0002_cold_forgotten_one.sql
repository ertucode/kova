CREATE TABLE `requests` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`method` text DEFAULT 'GET' NOT NULL,
	`url` text DEFAULT '' NOT NULL,
	`pre_request_script` text DEFAULT '' NOT NULL,
	`post_request_script` text DEFAULT '' NOT NULL,
	`headers` text DEFAULT '[]' NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`body_type` text DEFAULT 'none' NOT NULL,
	`raw_type` text DEFAULT 'json' NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	CONSTRAINT "requests_body_type_check" CHECK("requests"."body_type" in ('raw', 'form-data', 'x-www-form-urlencoded', 'none')),
	CONSTRAINT "requests_raw_type_check" CHECK("requests"."raw_type" in ('json', 'text'))
);
--> statement-breakpoint
CREATE INDEX `requests_deleted_at_idx` ON `requests` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `tree_items` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_folder_id` text,
	`item_type` text NOT NULL,
	`item_id` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`parent_folder_id`) REFERENCES `folders`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "tree_items_item_type_check" CHECK("tree_items"."item_type" in ('folder', 'request'))
);
--> statement-breakpoint
CREATE INDEX `tree_items_parent_folder_id_idx` ON `tree_items` (`parent_folder_id`);--> statement-breakpoint
CREATE INDEX `tree_items_parent_position_idx` ON `tree_items` (`parent_folder_id`,`position`);--> statement-breakpoint
CREATE INDEX `tree_items_deleted_at_idx` ON `tree_items` (`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `tree_items_item_ref_idx` ON `tree_items` (`item_type`,`item_id`);