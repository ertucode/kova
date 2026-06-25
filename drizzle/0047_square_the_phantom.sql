PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_websocket_example_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`example_id` text NOT NULL,
	`direction` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`mime_type` text,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`timestamp` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_websocket_example_messages`("id", "example_id", "direction", "body", "mime_type", "size_bytes", "timestamp", "created_at") SELECT "id", "example_id", "direction", "body", "mime_type", "size_bytes", "timestamp", "created_at" FROM `websocket_example_messages`;--> statement-breakpoint
DROP TABLE `websocket_example_messages`;--> statement-breakpoint
ALTER TABLE `__new_websocket_example_messages` RENAME TO `websocket_example_messages`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `websocket_example_messages_example_id_idx` ON `websocket_example_messages` (`example_id`);--> statement-breakpoint
CREATE INDEX `websocket_example_messages_timestamp_idx` ON `websocket_example_messages` (`timestamp`);--> statement-breakpoint
CREATE TABLE `__new_websocket_examples` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`name` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`request_headers` text DEFAULT '' NOT NULL,
	`request_body` text DEFAULT '' NOT NULL,
	`message_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_websocket_examples`("id", "request_id", "name", "position", "request_headers", "request_body", "message_count", "created_at", "updated_at", "deleted_at") SELECT "id", "request_id", "name", "position", "request_headers", "request_body", "message_count", "created_at", "updated_at", "deleted_at" FROM `websocket_examples`;--> statement-breakpoint
DROP TABLE `websocket_examples`;--> statement-breakpoint
ALTER TABLE `__new_websocket_examples` RENAME TO `websocket_examples`;--> statement-breakpoint
CREATE INDEX `websocket_examples_request_id_idx` ON `websocket_examples` (`request_id`);--> statement-breakpoint
CREATE INDEX `websocket_examples_request_position_idx` ON `websocket_examples` (`request_id`,`position`);--> statement-breakpoint
CREATE INDEX `websocket_examples_deleted_at_idx` ON `websocket_examples` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `__new_websocket_history` (
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
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_websocket_history`("id", "request_id", "request_name", "url", "request_headers", "request_variables_json", "history_size_bytes", "connected_at", "disconnected_at", "close_code", "close_reason", "response_error", "created_at") SELECT "id", "request_id", "request_name", "url", "request_headers", "request_variables_json", "history_size_bytes", "connected_at", "disconnected_at", "close_code", "close_reason", "response_error", "created_at" FROM `websocket_history`;--> statement-breakpoint
DROP TABLE `websocket_history`;--> statement-breakpoint
ALTER TABLE `__new_websocket_history` RENAME TO `websocket_history`;--> statement-breakpoint
CREATE INDEX `websocket_history_created_at_idx` ON `websocket_history` (`created_at`);--> statement-breakpoint
CREATE INDEX `websocket_history_request_id_idx` ON `websocket_history` (`request_id`);--> statement-breakpoint
CREATE INDEX `websocket_history_connected_at_idx` ON `websocket_history` (`connected_at`);--> statement-breakpoint
CREATE TABLE `__new_websocket_history_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`history_id` text NOT NULL,
	`direction` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`mime_type` text,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`timestamp` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_websocket_history_messages`("id", "history_id", "direction", "body", "mime_type", "size_bytes", "timestamp", "created_at") SELECT "id", "history_id", "direction", "body", "mime_type", "size_bytes", "timestamp", "created_at" FROM `websocket_history_messages`;--> statement-breakpoint
DROP TABLE `websocket_history_messages`;--> statement-breakpoint
ALTER TABLE `__new_websocket_history_messages` RENAME TO `websocket_history_messages`;--> statement-breakpoint
CREATE INDEX `websocket_history_messages_history_id_idx` ON `websocket_history_messages` (`history_id`);--> statement-breakpoint
CREATE INDEX `websocket_history_messages_timestamp_idx` ON `websocket_history_messages` (`timestamp`);--> statement-breakpoint
CREATE TABLE `__new_websocket_saved_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_websocket_saved_messages`("id", "request_id", "body", "created_at", "updated_at", "deleted_at") SELECT "id", "request_id", "body", "created_at", "updated_at", "deleted_at" FROM `websocket_saved_messages`;--> statement-breakpoint
DROP TABLE `websocket_saved_messages`;--> statement-breakpoint
ALTER TABLE `__new_websocket_saved_messages` RENAME TO `websocket_saved_messages`;--> statement-breakpoint
CREATE INDEX `websocket_saved_messages_request_id_idx` ON `websocket_saved_messages` (`request_id`);--> statement-breakpoint
CREATE INDEX `websocket_saved_messages_deleted_at_idx` ON `websocket_saved_messages` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `__new_request_examples` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`name` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`request_headers` text DEFAULT '' NOT NULL,
	`request_body` text DEFAULT '' NOT NULL,
	`request_body_type` text DEFAULT 'none' NOT NULL,
	`request_raw_type` text DEFAULT 'json' NOT NULL,
	`graphql_query` text DEFAULT '' NOT NULL,
	`graphql_variables` text DEFAULT '' NOT NULL,
	`response_status` integer DEFAULT 200 NOT NULL,
	`response_status_text` text DEFAULT 'OK' NOT NULL,
	`response_headers` text DEFAULT '' NOT NULL,
	`response_body` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_request_examples`("id", "request_id", "name", "position", "request_headers", "request_body", "request_body_type", "request_raw_type", "graphql_query", "graphql_variables", "response_status", "response_status_text", "response_headers", "response_body", "created_at", "updated_at", "deleted_at") SELECT "id", "request_id", "name", "position", "request_headers", "request_body", "request_body_type", "request_raw_type", "graphql_query", "graphql_variables", "response_status", "response_status_text", "response_headers", "response_body", "created_at", "updated_at", "deleted_at" FROM `request_examples`;--> statement-breakpoint
DROP TABLE `request_examples`;--> statement-breakpoint
ALTER TABLE `__new_request_examples` RENAME TO `request_examples`;--> statement-breakpoint
CREATE INDEX `request_examples_request_id_idx` ON `request_examples` (`request_id`);--> statement-breakpoint
CREATE INDEX `request_examples_request_position_idx` ON `request_examples` (`request_id`,`position`);--> statement-breakpoint
CREATE INDEX `request_examples_deleted_at_idx` ON `request_examples` (`deleted_at`);--> statement-breakpoint
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
	`test_script` text DEFAULT '' NOT NULL,
	`response_visualizer` text DEFAULT '' NOT NULL,
	`response_table_accessor` text DEFAULT '' NOT NULL,
	`preferred_response_body_view` text DEFAULT 'raw' NOT NULL,
	`prefers_response_visualizer` integer DEFAULT false NOT NULL,
	`headers` text DEFAULT '' NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`body_type` text DEFAULT 'none' NOT NULL,
	`raw_type` text DEFAULT 'json' NOT NULL,
	`graphql_query` text DEFAULT '' NOT NULL,
	`graphql_variables` text DEFAULT '' NOT NULL,
	`graphql_schema` text DEFAULT '' NOT NULL,
	`websocket_subprotocols` text DEFAULT '' NOT NULL,
	`websocket_on_open_message` text DEFAULT '' NOT NULL,
	`websocket_auto_send_enabled` integer DEFAULT false NOT NULL,
	`websocket_auto_send_message` text DEFAULT '' NOT NULL,
	`websocket_auto_send_interval_seconds` integer DEFAULT 0 NOT NULL,
	`save_to_history` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_requests`("id", "name", "request_type", "method", "url", "path_params", "search_params", "auth_json", "pre_request_script", "post_request_script", "test_script", "response_visualizer", "response_table_accessor", "preferred_response_body_view", "prefers_response_visualizer", "headers", "body", "body_type", "raw_type", "graphql_query", "graphql_variables", "graphql_schema", "websocket_subprotocols", "websocket_on_open_message", "websocket_auto_send_enabled", "websocket_auto_send_message", "websocket_auto_send_interval_seconds", "save_to_history", "created_at", "deleted_at") SELECT "id", "name", "request_type", "method", "url", "path_params", "search_params", "auth_json", "pre_request_script", "post_request_script", "test_script", "response_visualizer", "response_table_accessor", "preferred_response_body_view", "prefers_response_visualizer", "headers", "body", "body_type", "raw_type", "graphql_query", "graphql_variables", '' AS "graphql_schema", "websocket_subprotocols", "websocket_on_open_message", "websocket_auto_send_enabled", "websocket_auto_send_message", "websocket_auto_send_interval_seconds", "save_to_history", "created_at", "deleted_at" FROM `requests`;--> statement-breakpoint
DROP TABLE `requests`;--> statement-breakpoint
ALTER TABLE `__new_requests` RENAME TO `requests`;--> statement-breakpoint
CREATE INDEX `requests_deleted_at_idx` ON `requests` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `requests_request_type_idx` ON `requests` (`request_type`);
