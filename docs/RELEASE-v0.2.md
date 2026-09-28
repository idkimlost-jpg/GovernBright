# GovernBright v0.2

## Outcome

This release turns the v0.1 API foundation into a sign-in protected application with an administrator-facing dashboard.

## Added

- Email/password authentication using Node's scrypt password derivation
- Opaque 256-bit session tokens stored only as SHA-256 hashes in PostgreSQL
- Secure, HttpOnly, SameSite cookies with production-only Secure enforcement
- Active membership and role resolution from the database on every request
- Login rate limiting and same-origin checks for state-changing browser requests
- Successful-login audit events
- Owner and organization bootstrap command
- Responsive AI governance dashboard
- AI-system metrics, register table, and creation workflow
- Authentication, session, dashboard, and origin-protection tests

## Verification

- TypeScript typecheck: passed
- Automated tests: 9 passed
- Production build: passed
- Production dependency audit: 0 reported vulnerabilities

The current execution environment did not provide Docker or a PostgreSQL server, so the included migrations could not be exercised against a live database here. Run the documented migration and bootstrap commands in the target deployment environment before release approval.

## Remaining deployment gates

- Live PostgreSQL migration and two-tenant integration test
- HTTPS ingress and managed secret configuration
- Automated backups and restore drill
- Monitoring, alerting, and deployment rollback test
- Password reset and optional MFA or enterprise identity federation
