ALTER TABLE `environments` ADD `folder_id` text;--> statement-breakpoint
CREATE INDEX `environments_folder_id_idx` ON `environments` (`folder_id`);