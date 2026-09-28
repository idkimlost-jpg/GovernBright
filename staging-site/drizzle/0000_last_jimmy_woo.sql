CREATE TABLE `ai_systems` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`purpose` text NOT NULL,
	`vendor` text NOT NULL,
	`owner_name` text NOT NULL,
	`risk_tier` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`next_review_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_ai_systems_org_updated` ON `ai_systems` (`organization_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_events_org_created` ON `audit_events` (`organization_id`,`created_at`);