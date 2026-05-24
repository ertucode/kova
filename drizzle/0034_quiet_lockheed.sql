CREATE TABLE `views` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`code` text DEFAULT '' NOT NULL,
	`layout_mode` text DEFAULT 'horizontal' NOT NULL,
	`split_ratio` integer DEFAULT 50 NOT NULL,
	`remember_requests` integer DEFAULT false NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	CONSTRAINT "views_name_not_empty" CHECK(length(trim("views"."name")) > 0),
	CONSTRAINT "views_layout_mode_check" CHECK("views"."layout_mode" in ('horizontal', 'vertical')),
	CONSTRAINT "views_split_ratio_check" CHECK("views"."split_ratio" >= 15 and "views"."split_ratio" <= 85)
);
--> statement-breakpoint
CREATE INDEX `views_deleted_at_idx` ON `views` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `views_position_idx` ON `views` (`position`);