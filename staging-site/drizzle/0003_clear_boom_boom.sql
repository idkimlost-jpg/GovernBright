CREATE TABLE `tool_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`requester_user_id` text NOT NULL,
	`requester_email` text NOT NULL,
	`tool_key` text NOT NULL,
	`tool_name` text NOT NULL,
	`business_purpose` text NOT NULL,
	`data_description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`decided_by` text,
	`decision_notes` text DEFAULT '' NOT NULL,
	`requested_at` text NOT NULL,
	`decided_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_tool_requests_org_status` ON `tool_requests` (`organization_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_tool_requests_requester` ON `tool_requests` (`requester_user_id`,`requested_at`);