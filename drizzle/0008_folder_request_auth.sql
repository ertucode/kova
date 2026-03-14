ALTER TABLE `folders` ADD `headers` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `folders` ADD `auth_json` text DEFAULT '{"type":"inherit"}' NOT NULL;
--> statement-breakpoint
ALTER TABLE `requests` ADD `auth_json` text DEFAULT '{"type":"inherit"}' NOT NULL;
