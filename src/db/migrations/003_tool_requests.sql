CREATE TYPE tool_request_status AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE tool_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  requester_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool_key text NOT NULL CHECK (tool_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  tool_name text NOT NULL CHECK (length(tool_name) BETWEEN 1 AND 120),
  business_purpose text NOT NULL CHECK (length(business_purpose) BETWEEN 1 AND 2000),
  data_description text NOT NULL DEFAULT '' CHECK (length(data_description) <= 2000),
  status tool_request_status NOT NULL DEFAULT 'pending',
  decided_by uuid REFERENCES users(id) ON DELETE SET NULL,
  decision_notes text NOT NULL DEFAULT '' CHECK (length(decision_notes) <= 1000),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  CHECK ((status = 'pending') = (decided_at IS NULL))
);
CREATE INDEX tool_requests_organization_idx ON tool_requests (organization_id, status, requested_at DESC);
CREATE INDEX tool_requests_requester_idx ON tool_requests (requester_user_id, requested_at DESC);
