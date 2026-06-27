CREATE TABLE `import_agent_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`plan_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `import_agent_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "import_agent_plans_kind_check" CHECK("import_agent_plans"."kind" in ('draft', 'applied')),
	CONSTRAINT "import_agent_plans_status_check" CHECK("import_agent_plans"."status" in ('active', 'applied', 'superseded'))
);
--> statement-breakpoint
CREATE INDEX `import_agent_plans_session_idx` ON `import_agent_plans` (`session_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `import_agent_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`scope_type` text NOT NULL,
	`target_folder_id` text,
	`title` text NOT NULL,
	`opencode_session_id` text,
	`selected_model` text,
	`status` text DEFAULT 'idle' NOT NULL,
	`latest_error_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`target_folder_id`) REFERENCES `folders`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "import_agent_sessions_scope_type_check" CHECK("import_agent_sessions"."scope_type" in ('workspace', 'folder')),
	CONSTRAINT "import_agent_sessions_status_check" CHECK("import_agent_sessions"."status" in ('idle', 'busy', 'error')),
	CONSTRAINT "import_agent_sessions_scope_target_check" CHECK(("import_agent_sessions"."scope_type" = 'workspace' and "import_agent_sessions"."target_folder_id" is null) or ("import_agent_sessions"."scope_type" = 'folder' and "import_agent_sessions"."target_folder_id" is not null))
);
--> statement-breakpoint
CREATE INDEX `import_agent_sessions_scope_idx` ON `import_agent_sessions` (`scope_type`,`target_folder_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `import_agent_sessions_deleted_at_idx` ON `import_agent_sessions` (`deleted_at`);