CREATE TABLE `request_examples` (
  `id` text PRIMARY KEY NOT NULL,
  `request_id` text NOT NULL,
  `name` text NOT NULL,
  `position` integer DEFAULT 0 NOT NULL,
  `request_headers` text DEFAULT '' NOT NULL,
  `request_body` text DEFAULT '' NOT NULL,
  `request_body_type` text DEFAULT 'none' NOT NULL,
  `request_raw_type` text DEFAULT 'json' NOT NULL,
  `response_status` integer DEFAULT 200 NOT NULL,
  `response_status_text` text DEFAULT 'OK' NOT NULL,
  `response_headers` text DEFAULT '' NOT NULL,
  `response_body` text DEFAULT '' NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `request_examples_request_id_idx` ON `request_examples` (`request_id`);
--> statement-breakpoint
CREATE INDEX `request_examples_request_position_idx` ON `request_examples` (`request_id`,`position`);
--> statement-breakpoint
CREATE INDEX `request_examples_deleted_at_idx` ON `request_examples` (`deleted_at`);
