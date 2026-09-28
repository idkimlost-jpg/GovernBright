CREATE TABLE `approved_users` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`email` text NOT NULL,
	`user_id` text,
	`display_name` text,
	`role` text DEFAULT 'employee' NOT NULL,
	`status` text DEFAULT 'approved' NOT NULL,
	`approved_by` text NOT NULL,
	`approved_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_approved_users_org_email` ON `approved_users` (`organization_id`,`email`);--> statement-breakpoint
CREATE INDEX `idx_approved_users_user` ON `approved_users` (`user_id`);--> statement-breakpoint
CREATE TABLE `launch_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`email` text NOT NULL,
	`destination` text NOT NULL,
	`result` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_launch_events_org_created` ON `launch_events` (`organization_id`,`created_at`);