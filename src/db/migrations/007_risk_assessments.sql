CREATE TYPE assessment_decision AS ENUM ('approved', 'conditional', 'prohibited');

-- Every completed assessment is kept; the newest per system is the current one.
CREATE TABLE risk_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ai_system_id uuid NOT NULL REFERENCES ai_systems(id) ON DELETE CASCADE,
  assessor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  responses jsonb NOT NULL,
  score integer NOT NULL CHECK (score BETWEEN 0 AND 100),
  calculated_tier ai_risk_tier NOT NULL,
  decision assessment_decision NOT NULL,
  required_controls jsonb NOT NULL,
  review_notes text NOT NULL DEFAULT '' CHECK (length(review_notes) <= 2000),
  completed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX risk_assessments_system_idx ON risk_assessments (ai_system_id, completed_at DESC);
CREATE INDEX risk_assessments_organization_idx ON risk_assessments (organization_id, completed_at DESC);
