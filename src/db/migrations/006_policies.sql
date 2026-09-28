-- Versioned AI acceptable-use policies. The highest version is the current one.
CREATE TABLE ai_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  title text NOT NULL CHECK (length(title) BETWEEN 2 AND 200),
  body text NOT NULL CHECK (length(body) BETWEEN 10 AND 50000),
  published_by uuid REFERENCES users(id) ON DELETE SET NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, version)
);

CREATE TABLE policy_acceptances (
  policy_id uuid NOT NULL REFERENCES ai_policies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (policy_id, user_id)
);
