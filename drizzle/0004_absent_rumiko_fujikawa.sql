CREATE TABLE `environments` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`variables` text DEFAULT '' NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `environments_deleted_at_idx` ON `environments` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `environments_priority_idx` ON `environments` (`priority`);