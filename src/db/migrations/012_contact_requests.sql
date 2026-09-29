-- Enquiries sent from the public landing page. They belong to the operator, not to any customer
-- organization, so they are only listed from the server (npm run contacts).
CREATE TABLE contact_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  company text NOT NULL DEFAULT '' CHECK (char_length(company) <= 200),
  email text NOT NULL CHECK (char_length(email) <= 320),
  message text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 5000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX contact_requests_created_at ON contact_requests (created_at DESC);
