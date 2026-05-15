PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_folder_explorer_tabs` (
	`id` text PRIMARY KEY NOT NULL,
	`item_type` text NOT NULL,
	`item_id` text NOT NULL,
	`request_meta_tab` text,
	`position` integer DEFAULT 0 NOT NULL,
	`is_pinned` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "folder_explorer_tabs_item_type_check" CHECK("__new_folder_explorer_tabs"."item_type" in ('folder', 'request', 'example')),
	CONSTRAINT "folder_explorer_tabs_request_meta_tab_check" CHECK("__new_folder_explorer_tabs"."request_meta_tab" is null or "__new_folder_explorer_tabs"."request_meta_tab" in ('overview', 'body', 'search-params', 'headers', 'auth', 'path-params', 'scripts', 'response-visualizer'))
);
--> statement-breakpoint
INSERT INTO `__new_folder_explorer_tabs`("id", "item_type", "item_id", "request_meta_tab", "position", "is_pinned", "is_active", "created_at", "updated_at") SELECT "id", "item_type", "item_id", NULL, "position", "is_pinned", "is_active", "created_at", "updated_at" FROM `folder_explorer_tabs`;--> statement-breakpoint
DROP TABLE `folder_explorer_tabs`;--> statement-breakpoint
ALTER TABLE `__new_folder_explorer_tabs` RENAME TO `folder_explorer_tabs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `folder_explorer_tabs_position_idx` ON `folder_explorer_tabs` (`position`);--> statement-breakpoint
CREATE INDEX `folder_explorer_tabs_item_ref_idx` ON `folder_explorer_tabs` (`item_type`,`item_id`);--> statement-breakpoint
CREATE INDEX `folder_explorer_tabs_active_idx` ON `folder_explorer_tabs` (`is_active`);
