CREATE TABLE `websocket_example_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`example_id` text NOT NULL,
	`direction` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`mime_type` text,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`timestamp` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`example_id`) REFERENCES `websocket_examples`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "websocket_example_messages_direction_check" CHECK("websocket_example_messages"."direction" in ('sent', 'received'))
);
--> statement-breakpoint
CREATE INDEX `websocket_example_messages_example_id_idx` ON `websocket_example_messages` (`example_id`);--> statement-breakpoint
CREATE INDEX `websocket_example_messages_timestamp_idx` ON `websocket_example_messages` (`timestamp`);--> statement-breakpoint
CREATE TABLE `websocket_examples` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`name` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`request_headers` text DEFAULT '' NOT NULL,
	`request_body` text DEFAULT '' NOT NULL,
	`message_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `websocket_examples_request_id_idx` ON `websocket_examples` (`request_id`);--> statement-breakpoint
CREATE INDEX `websocket_examples_request_position_idx` ON `websocket_examples` (`request_id`,`position`);--> statement-breakpoint
CREATE INDEX `websocket_examples_deleted_at_idx` ON `websocket_examples` (`deleted_at`);