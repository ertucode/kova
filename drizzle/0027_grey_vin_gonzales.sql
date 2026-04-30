CREATE TABLE `shared_scripts` (
	`id` text PRIMARY KEY NOT NULL,
	`scope_type` text NOT NULL,
	`scope_id` text,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`targets_json` text DEFAULT '["pre-request"]' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`code` text DEFAULT '' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`scope_id`) REFERENCES `folders`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "shared_scripts_scope_type_check" CHECK("shared_scripts"."scope_type" in ('workspace', 'folder')),
	CONSTRAINT "shared_scripts_kind_check" CHECK("shared_scripts"."kind" in ('global', 'module')),
	CONSTRAINT "shared_scripts_workspace_scope_id_check" CHECK(("shared_scripts"."scope_type" = 'workspace' and "shared_scripts"."scope_id" is null) or ("shared_scripts"."scope_type" = 'folder' and "shared_scripts"."scope_id" is not null))
);
--> statement-breakpoint
CREATE INDEX `shared_scripts_deleted_at_idx` ON `shared_scripts` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `shared_scripts_scope_idx` ON `shared_scripts` (`scope_type`,`scope_id`,`position`);