CREATE TABLE `cookies` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`value` text DEFAULT '' NOT NULL,
	`domain` text NOT NULL,
	`path` text DEFAULT '/' NOT NULL,
	`host_only` integer DEFAULT true NOT NULL,
	`secure` integer DEFAULT false NOT NULL,
	`http_only` integer DEFAULT false NOT NULL,
	`same_site` text,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "cookies_name_not_empty" CHECK(length(trim("cookies"."name")) > 0),
	CONSTRAINT "cookies_domain_not_empty" CHECK(length(trim("cookies"."domain")) > 0),
	CONSTRAINT "cookies_path_not_empty" CHECK(length(trim("cookies"."path")) > 0),
	CONSTRAINT "cookies_same_site_check" CHECK("cookies"."same_site" is null or "cookies"."same_site" in ('strict', 'lax', 'none'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cookies_identity_idx` ON `cookies` (`name`,`domain`,`path`,`host_only`);--> statement-breakpoint
CREATE INDEX `cookies_domain_idx` ON `cookies` (`domain`);--> statement-breakpoint
CREATE INDEX `cookies_expires_at_idx` ON `cookies` (`expires_at`);