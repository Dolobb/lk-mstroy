CREATE TABLE `outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`shift_id` text,
	`happened_at_client` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`last_attempt_at` text,
	`conflict_code` text,
	`last_error` text
);
--> statement-breakpoint
CREATE INDEX `outbox_status_idx` ON `outbox` (`status`);--> statement-breakpoint
CREATE INDEX `outbox_shift_id_idx` ON `outbox` (`shift_id`);--> statement-breakpoint
CREATE TABLE `photo_queue` (
	`receipt_id` text PRIMARY KEY NOT NULL,
	`local_uri` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`last_attempt_at` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `photo_queue_status_idx` ON `photo_queue` (`status`);