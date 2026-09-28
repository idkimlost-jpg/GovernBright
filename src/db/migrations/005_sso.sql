-- One OpenID Connect connection per organization (Google Workspace, Microsoft Entra, Okta, ...).
CREATE TABLE sso_connections (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  issuer text NOT NULL,
  client_id text NOT NULL CHECK (length(client_id) BETWEEN 1 AND 500),
  client_secret text NOT NULL,           -- sealed with APP_ENCRYPTION_KEY
  enforce boolean NOT NULL DEFAULT false, -- members on these domains must use SSO (owners keep a password fallback)
  auto_provision_role membership_role,    -- when set, first-time SSO users join with this role
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Email domains routed to an organization's connection; a domain belongs to one organization.
CREATE TABLE sso_domains (
  domain text PRIMARY KEY CHECK (domain = lower(domain) AND domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  organization_id uuid NOT NULL REFERENCES sso_connections(organization_id) ON DELETE CASCADE
);
CREATE INDEX sso_domains_organization_idx ON sso_domains (organization_id);

-- Links an identity-provider subject to a GovernBright user.
CREATE TABLE user_identities (
  issuer text NOT NULL,
  subject text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (issuer, subject)
);

-- In-flight sign-ins: CSRF state, OIDC nonce and PKCE verifier, valid for ten minutes.
CREATE TABLE sso_login_states (
  state_hash text PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  nonce text NOT NULL,
  code_verifier text NOT NULL,
  expires_at timestamptz NOT NULL
);
