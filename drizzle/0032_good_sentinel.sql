CREATE TABLE `script_packages` (
	`id` text PRIMARY KEY NOT NULL,
	`package_name` text NOT NULL,
	`package_version` text NOT NULL,
	`types_package_name` text,
	`types_package_version` text,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	CONSTRAINT "script_packages_name_not_empty" CHECK(length(trim("script_packages"."package_name")) > 0),
	CONSTRAINT "script_packages_version_not_empty" CHECK(length(trim("script_packages"."package_version")) > 0),
	CONSTRAINT "script_packages_types_pair_check" CHECK(("script_packages"."types_package_name" is null and "script_packages"."types_package_version" is null) or ("script_packages"."types_package_name" is not null and "script_packages"."types_package_version" is not null))
);
--> statement-breakpoint
CREATE INDEX `script_packages_deleted_at_idx` ON `script_packages` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `script_packages_name_version_idx` ON `script_packages` (`package_name`,`package_version`);--> statement-breakpoint
CREATE UNIQUE INDEX `script_packages_unique_active_idx` ON `script_packages` (`package_name`,`package_version`,`types_package_name`,`types_package_version`,`deleted_at`);