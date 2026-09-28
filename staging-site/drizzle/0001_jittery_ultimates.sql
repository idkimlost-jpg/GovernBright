CREATE TABLE `risk_assessments` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`ai_system_id` text NOT NULL,
	`assessor_user_id` text NOT NULL,
	`responses` text NOT NULL,
	`score` integer NOT NULL,
	`calculated_tier` text NOT NULL,
	`decision` text NOT NULL,
	`required_controls` text NOT NULL,
	`review_notes` text DEFAULT '' NOT NULL,
	`completed_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_risk_assessments_system` ON `risk_assessments` (`organization_id`,`ai_system_id`);--> statement-breakpoint
CREATE INDEX `idx_risk_assessments_org_completed` ON `risk_assessments` (`organization_id`,`completed_at`);