CREATE TABLE `__new_import_agent_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`scope_type` text NOT NULL,
	`target_folder_id` text,
	`target_request_id` text,
	`title` text NOT NULL,
	`opencode_session_id` text,
	`selected_model` text,
	`status` text DEFAULT 'idle' NOT NULL,
	`latest_error_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE TABLE `__new_import_agent_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`plan_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_import_agent_sessions`("id", "scope_type", "target_folder_id", "target_request_id", "title", "opencode_session_id", "selected_model", "status", "latest_error_message", "created_at", "updated_at", "deleted_at") SELECT "id", "scope_type", "target_folder_id", null, "title", "opencode_session_id", "selected_model", "status", "latest_error_message", "created_at", "updated_at", "deleted_at" FROM `import_agent_sessions`;--> statement-breakpoint
INSERT INTO `__new_import_agent_plans`("id", "session_id", "kind", "status", "plan_json", "created_at", "updated_at") SELECT "id", "session_id", "kind", "status", "plan_json", "created_at", "updated_at" FROM `import_agent_plans`;--> statement-breakpoint
DROP TABLE `import_agent_plans`;--> statement-breakpoint
DROP TABLE `import_agent_sessions`;--> statement-breakpoint
ALTER TABLE `__new_import_agent_sessions` RENAME TO `import_agent_sessions`;--> statement-breakpoint
ALTER TABLE `__new_import_agent_plans` RENAME TO `import_agent_plans`;--> statement-breakpoint
CREATE INDEX `import_agent_plans_session_idx` ON `import_agent_plans` (`session_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `import_agent_sessions_scope_idx` ON `import_agent_sessions` (`scope_type`,`target_folder_id`,`target_request_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `import_agent_sessions_deleted_at_idx` ON `import_agent_sessions` (`deleted_at`);
