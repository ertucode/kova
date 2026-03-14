CREATE TABLE `folder_explorer_tabs` (
	`id` text PRIMARY KEY NOT NULL,
	`item_type` text NOT NULL,
	`item_id` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`is_pinned` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "folder_explorer_tabs_item_type_check" CHECK("folder_explorer_tabs"."item_type" in ('folder', 'request', 'example'))
);
--> statement-breakpoint
CREATE INDEX `folder_explorer_tabs_position_idx` ON `folder_explorer_tabs` (`position`);--> statement-breakpoint
CREATE INDEX `folder_explorer_tabs_item_ref_idx` ON `folder_explorer_tabs` (`item_type`,`item_id`);--> statement-breakpoint
CREATE INDEX `folder_explorer_tabs_active_idx` ON `folder_explorer_tabs` (`is_active`);
