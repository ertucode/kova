ALTER TABLE `folders` ADD `description` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `folders` ADD `pre_request_script` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `folders` ADD `post_request_script` text DEFAULT '' NOT NULL;