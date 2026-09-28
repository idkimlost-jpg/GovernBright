-- SCIM 2.0 connections that create and disable seats in AI tools (per organization and tool).
CREATE TABLE provisioning_connections (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  tool_key text NOT NULL CHECK (tool_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  base_url text NOT NULL,
  token text NOT NULL,          -- sealed with APP_ENCRYPTION_KEY
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, tool_key)
);

CREATE TYPE provisioning_status AS ENUM ('pending', 'active', 'deactivated', 'error');
CREATE TABLE provisioned_accounts (
  organization_id uuid NOT NULL,
  tool_key text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  external_id text,
  desired_active boolean NOT NULL DEFAULT true,
  status provisioning_status NOT NULL DEFAULT 'pending',
  last_error text,
  synced_at timestamptz,
  PRIMARY KEY (organization_id, tool_key, user_id),
  FOREIGN KEY (organization_id, tool_key) REFERENCES provisioning_connections(organization_id, tool_key) ON DELETE CASCADE
);
