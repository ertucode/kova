PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_shared_scripts` (
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
	CONSTRAINT "shared_scripts_scope_type_check" CHECK("__new_shared_scripts"."scope_type" in ('workspace', 'folder')),
	CONSTRAINT "shared_scripts_kind_check" CHECK("__new_shared_scripts"."kind" in ('global', 'module', 'expression')),
	CONSTRAINT "shared_scripts_workspace_scope_id_check" CHECK(("__new_shared_scripts"."scope_type" = 'workspace' and "__new_shared_scripts"."scope_id" is null) or ("__new_shared_scripts"."scope_type" = 'folder' and "__new_shared_scripts"."scope_id" is not null))
);
--> statement-breakpoint
INSERT INTO `__new_shared_scripts`("id", "scope_type", "scope_id", "name", "kind", "targets_json", "is_active", "code", "position", "created_at", "updated_at", "deleted_at") SELECT "id", "scope_type", "scope_id", "name", "kind", "targets_json", "is_active", "code", "position", "created_at", "updated_at", "deleted_at" FROM `shared_scripts`;--> statement-breakpoint
DROP TABLE `shared_scripts`;--> statement-breakpoint
ALTER TABLE `__new_shared_scripts` RENAME TO `shared_scripts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `shared_scripts_deleted_at_idx` ON `shared_scripts` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `shared_scripts_scope_idx` ON `shared_scripts` (`scope_type`,`scope_id`,`position`);