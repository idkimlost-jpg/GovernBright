-- Organizations must prove they own an email domain (DNS TXT record) before sign-in is routed
-- to their identity provider or SSO is enforced for it. Several organizations may claim a
-- domain while unverified; only one can hold it verified.
ALTER TABLE sso_domains DROP CONSTRAINT sso_domains_pkey;
ALTER TABLE sso_domains ADD PRIMARY KEY (domain, organization_id);
ALTER TABLE sso_domains ADD COLUMN verification_token text NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex');
ALTER TABLE sso_domains ADD COLUMN verified_at timestamptz;
CREATE UNIQUE INDEX sso_domains_verified_idx ON sso_domains (domain) WHERE verified_at IS NOT NULL;
