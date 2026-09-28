CREATE TABLE password_reset_tokens (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_reset_tokens_user_idx ON password_reset_tokens (user_id);

-- TOTP seed sealed with APP_ENCRYPTION_KEY. totp_enabled_at is set once the user proves a code;
-- totp_last_step blocks replaying a code inside its validity window.
ALTER TABLE users ADD COLUMN totp_secret text;
ALTER TABLE users ADD COLUMN totp_enabled_at timestamptz;
ALTER TABLE users ADD COLUMN totp_last_step bigint;

CREATE TABLE mfa_recovery_codes (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  used_at timestamptz,
  PRIMARY KEY (user_id, code_hash)
);

-- A password-verified login waiting for its second factor.
CREATE TABLE login_challenges (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- When set, members who sign in with a password must enroll in MFA before using the app.
-- Single sign-on sessions are exempt: the identity provider enforces its own factors.
ALTER TABLE organizations ADD COLUMN require_mfa boolean NOT NULL DEFAULT false;
ALTER TABLE sessions ADD COLUMN auth_method text NOT NULL DEFAULT 'password';
