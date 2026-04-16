ALTER TABLE `requests` ADD `websocket_on_open_message` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `requests` ADD `websocket_auto_send_message` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `requests` ADD `websocket_auto_send_interval_seconds` integer DEFAULT 0 NOT NULL;