ALTER TABLE `environments` ADD `position` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE INDEX `environments_position_idx` ON `environments` (`position`);
