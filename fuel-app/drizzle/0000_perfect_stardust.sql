CREATE TABLE `atz` (
	`id` text PRIMARY KEY NOT NULL,
	`gos_number` text NOT NULL,
	`title` text,
	`remaining_liters` real NOT NULL,
	`is_active` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`source` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shifts` (
	`id` text PRIMARY KEY NOT NULL,
	`atz_id` text NOT NULL,
	`atz_gos_number` text,
	`started_at_client` text NOT NULL,
	`ended_at_client` text,
	`status` text NOT NULL,
	`opening_remaining_liters` real,
	`closing_remaining_liters` real,
	`dispense_count` integer,
	`dispense_liters` real,
	`receipt_liters` real
);
--> statement-breakpoint
CREATE TABLE `sync_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `vehicles` (
	`id` text PRIMARY KEY NOT NULL,
	`gos_number` text NOT NULL,
	`gos_number_norm` text NOT NULL,
	`mark` text,
	`vehicle_type` text,
	`organization_id` text NOT NULL,
	`source` text NOT NULL,
	`is_active` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `vehicles_gos_number_norm_idx` ON `vehicles` (`gos_number_norm`);--> statement-breakpoint
CREATE INDEX `vehicles_organization_id_idx` ON `vehicles` (`organization_id`);