-- Slack incoming webhook (sealed with APP_ENCRYPTION_KEY) and the last reminder digest sent.
ALTER TABLE organizations ADD COLUMN slack_webhook_url text;
ALTER TABLE organizations ADD COLUMN last_digest_at timestamptz;
