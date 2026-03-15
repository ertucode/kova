CREATE TABLE `websocket_history` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`request_name` text NOT NULL,
	`url` text NOT NULL,
	`request_headers` text DEFAULT '' NOT NULL,
	`request_variables_json` text DEFAULT '{}' NOT NULL,
	`history_size_bytes` integer DEFAULT 0 NOT NULL,
	`connected_at` integer NOT NULL,
	`disconnected_at` integer,
	`close_code` integer,
	`close_reason` text,
	`response_error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `websocket_history_created_at_idx` ON `websocket_history` (`created_at`);--> statement-breakpoint
CREATE INDEX `websocket_history_request_id_idx` ON `websocket_history` (`request_id`);--> statement-breakpoint
CREATE INDEX `websocket_history_connected_at_idx` ON `websocket_history` (`connected_at`);--> statement-breakpoint
CREATE TABLE `websocket_history_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`history_id` text NOT NULL,
	`direction` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`mime_type` text,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`timestamp` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`history_id`) REFERENCES `websocket_history`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "websocket_history_messages_direction_check" CHECK("websocket_history_messages"."direction" in ('sent', 'received'))
);
--> statement-breakpoint
CREATE INDEX `websocket_history_messages_history_id_idx` ON `websocket_history_messages` (`history_id`);--> statement-breakpoint
CREATE INDEX `websocket_history_messages_timestamp_idx` ON `websocket_history_messages` (`timestamp`);--> statement-breakpoint
CREATE TABLE `websocket_saved_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `websocket_saved_messages_request_id_idx` ON `websocket_saved_messages` (`request_id`);--> statement-breakpoint
CREATE INDEX `websocket_saved_messages_deleted_at_idx` ON `websocket_saved_messages` (`deleted_at`);--> statement-breakpoint
ALTER TABLE `requests` ADD COLUMN `request_type` text DEFAULT 'http' NOT NULL;--> statement-breakpoint
ALTER TABLE `requests` ADD COLUMN `websocket_subprotocols` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `requests` ADD COLUMN `save_to_history` integer DEFAULT true NOT NULL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`request_type` text DEFAULT 'http' NOT NULL,
	`method` text DEFAULT 'GET' NOT NULL,
	`url` text DEFAULT '' NOT NULL,
	`path_params` text DEFAULT '' NOT NULL,
	`search_params` text DEFAULT '' NOT NULL,
	`auth_json` text DEFAULT '{"type":"inherit"}' NOT NULL,
	`pre_request_script` text DEFAULT '' NOT NULL,
	`post_request_script` text DEFAULT '' NOT NULL,
	`headers` text DEFAULT '' NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`body_type` text DEFAULT 'none' NOT NULL,
	`raw_type` text DEFAULT 'json' NOT NULL,
	`websocket_subprotocols` text DEFAULT '' NOT NULL,
	`save_to_history` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	CONSTRAINT "requests_request_type_check" CHECK("__new_requests"."request_type" in ('http', 'websocket')),
	CONSTRAINT "requests_body_type_check" CHECK("__new_requests"."body_type" in ('raw', 'form-data', 'x-www-form-urlencoded', 'none')),
	CONSTRAINT "requests_raw_type_check" CHECK("__new_requests"."raw_type" in ('json', 'text'))
);
--> statement-breakpoint
INSERT INTO `__new_requests`("id", "name", "request_type", "method", "url", "path_params", "search_params", "auth_json", "pre_request_script", "post_request_script", "headers", "body", "body_type", "raw_type", "websocket_subprotocols", "save_to_history", "created_at", "deleted_at") SELECT "id", "name", "request_type", "method", "url", "path_params", "search_params", "auth_json", "pre_request_script", "post_request_script", "headers", "body", "body_type", "raw_type", "websocket_subprotocols", "save_to_history", "created_at", "deleted_at" FROM `requests`;--> statement-breakpoint
DROP TABLE `requests`;--> statement-breakpoint
ALTER TABLE `__new_requests` RENAME TO `requests`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `requests_deleted_at_idx` ON `requests` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `requests_request_type_idx` ON `requests` (`request_type`);
