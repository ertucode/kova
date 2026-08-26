ALTER TABLE `app_settings` ADD `tls_verification_mode` text DEFAULT 'strict' NOT NULL;--> statement-breakpoint
ALTER TABLE `requests` ADD `tls_verification_mode` text DEFAULT 'inherit' NOT NULL;