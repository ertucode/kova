ALTER TABLE `request_history` ADD `test_run_json` text DEFAULT 'null' NOT NULL;--> statement-breakpoint
ALTER TABLE `requests` ADD `test_script` text DEFAULT '' NOT NULL;