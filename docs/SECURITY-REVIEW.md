# Security review — September 2026

An internal code review of the GovernBright backend (`src/`), dashboard (`public/`) and deployment files, done before publishing the repository. It is not a substitute for an independent penetration test, which is still recommended before production customer data is stored.

## Scope

- Authentication: passwords, sessions, password reset, TOTP two-factor, OpenID Connect single sign-on
- Authorization and tenant isolation across every service and route
- Outbound requests the server makes on an admin's behalf (identity providers, SCIM, Slack)
- Input handling: CSV import, report and CSV export, HTML rendering in the dashboard and evidence report
- Secrets at rest, configuration defaults, `docker compose` and CI

## Findings and fixes

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | High | **Cross-organization SSO lockout.** Password sign-in checked for *any* organization enforcing SSO on the user's email domain, so one organization's admin could block password sign-in for another organization's members. | Enforcement now applies only when the user's own organization enforces SSO for that domain. |
| 2 | High | **Unverified domain claims.** Any organization could claim any email domain for SSO. That routed the domain's "Sign in with SSO" to the claimer's identity provider (a phishing path) and blocked the real owner from claiming it. | Domains must be verified with a DNS TXT record (`_governbright-verification.<domain>`) before sign-in is routed or SSO is enforced. Unverified claims block no one, and only one organization can hold a domain verified. |
| 3 | High | **Server-side request forgery.** Admin-supplied identity provider and SCIM URLs could point the server at internal addresses (private networks, cloud metadata at 169.254.169.254, localhost). | Every outbound call to an admin-supplied URL resolves the host and refuses private, loopback, link-local, carrier-grade NAT and unique-local addresses. Plain http is refused; local http is only allowed in tests. SCIM re-checks on every call. Slack is limited to `hooks.slack.com`. |
| 4 | Medium | **Database exposed by default.** `docker compose` published Postgres on every network interface with the password `governbright`. | Postgres now binds to `127.0.0.1` only, and `POSTGRES_PASSWORD` is a required setting. |
| 5 | Medium | **Rate limits behind a proxy.** Without proxy trust, every request behind a load balancer shared one IP, so login rate limits applied to all users together. | New `TRUST_PROXY` setting (`true`, a hop count, or proxy addresses). |
| 6 | Low | **Password-reset abuse.** The reset form could flood a person's inbox, and response timing revealed which emails have accounts. | One reset email per account every two minutes; mail is sent in the background so responses take the same time. |
| 7 | Low | **Reflected text on the sign-in page.** The SSO error page displayed `error_description` from the URL, which anyone can craft (for example "call this number"). | Only a short, validated error code is shown. |
| 8 | Low | **Catalog links.** Operator-imported catalog URLs accepted any scheme, including `javascript:`. | Only `https://` URLs are accepted. |

Each fix has an automated test (70 tests in total, including database integration tests run in CI).

## Checked and found sound

- Passwords use scrypt with per-user salts. Unknown emails take as long as wrong passwords.
- Session, reset, challenge and recovery tokens are random 256-bit values stored only as SHA-256 hashes.
- Session cookies are HttpOnly and SameSite=Strict, and Secure in production.
- TOTP matches the RFC 6238 test vectors. Codes can't be replayed, and each login challenge allows five attempts.
- SSO uses PKCE, a browser-bound state cookie and a nonce. ID tokens are checked for signature (RS256/ES256 via JWKS), issuer, audience and expiry.
- Every query is scoped to the caller's organization, and roles are checked in the service layer; integration tests cover cross-tenant access.
- Secrets at rest (MFA seeds, SSO client secrets, Slack webhooks, SCIM tokens) use AES-256-GCM with a random IV.
- The dashboard escapes all server data before inserting HTML. The evidence report escapes all values. CSV exports quote cells and neutralize spreadsheet formulas.
- Front-end files are served from a fixed directory with a strict name pattern (no path traversal).
- State-changing requests require the configured origin (`APP_ORIGIN`, mandatory in production).
- Production refuses to start without `APP_ORIGIN` or `APP_ENCRYPTION_KEY`, or with development header authentication enabled.
- `npm audit --omit=dev` reports no known vulnerabilities in production dependencies.

## Remaining risks and recommendations

- **Commission an independent penetration test** before storing real customer data.
- **Per-account login throttling:** rate limits are per IP address, so a distributed guessing attack against one account is only slowed by password strength. Consider per-account backoff or lockout.
- **DNS rebinding:** outbound destinations are checked when resolved, and a hostile DNS server could change the answer between check and connection. Pinning the resolved address, or an egress proxy, would close this.
- **Adding existing accounts:** an admin can add a person who already has an account in another organization without that person's consent. They gain no access to that other organization, but consider an invitation flow.
- **Missing account features:** there is no in-app password change and no "sign out other sessions". Password reset and member deactivation do revoke sessions.
- **The staging site** (`staging-site/`) trusts identity headers injected by its hosting platform; see `staging-site/STAGING.md`. It was reviewed separately and is not covered here.
- **Reporting vulnerabilities:** add a `SECURITY.md` explaining how to report them before the repository goes public.
