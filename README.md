# GovernBright

 GovernBright AI — A secure platform for managing AI risk, compliance, policies, and employee AI usage. GovernBright is a multi-tenant AI governance application. This first build establishes the security-sensitive foundation and the AI-system register described in the implementation plan.

[![GovernBright CI](https://github.com/idkimlost-jpg/GovernBright/actions/workflows/ci.yml/badge.svg)](https://github.com/idkimlost-jpg/GovernBright/actions/workflows/ci.yml)

## Included in v0.2

- PostgreSQL schema for organizations, users, memberships, AI systems, and append-only audit events
- Five application roles with service-layer permissions
- Organization-scoped AI-system list, detail, and creation endpoints
- Atomic creation plus audit recording
- Security headers, request correlation, safe error responses, and log redaction
- Docker deployment files, migration runner, and authorization/tenant-scope tests
- Database-backed email/password login with scrypt password hashing
- Opaque, hashed server-side sessions in secure HttpOnly cookies
- Active organization membership revalidation on every authenticated request
- Same-origin mutation protection and authentication audit events
- Login rate limiting to reduce automated credential attacks
- Responsive administrator dashboard and AI-system registration workflow

## Added in v0.3

- **Sign-in:** password reset by email, two-factor authentication (authenticator apps, recovery codes, optional org-wide requirement), and company single sign-on over OpenID Connect (Google Workspace, Microsoft Entra ID, Okta) with optional auto-provisioning and enforcement
- **AI tool requests:** employees request tools, owners and admins approve or reject; requests require acceptance of the current AI use policy
- **AI use policy:** versioned policies, per-person sign-off and acceptance tracking
- **Risk assessments:** a scored questionnaire whose required controls cite the EU AI Act, NIST AI RMF, GDPR and ISO/IEC 42001 clauses they support (an indicative mapping, not legal advice)
- **Evidence:** audit log CSV export and a printable AI governance evidence report
- **Shadow AI discovery:** import sign-in grant or expense CSVs to find AI tools already in use and add them to the register
- **AI tool catalog:** shared list of common AI tools; vendor data-practice facts are loaded by the operator with `npm run catalog:import -- facts.json` and must cite a source and review date
- **Slack and reminders:** request, decision and policy notifications, plus a daily digest of due reviews and waiting requests (`npm run reminders`; `node dist/scripts/send-reminders.js` in the container, scheduled once a day)
- **Seat provisioning:** approving a request creates the person's account in the tool over SCIM 2.0; deactivating a member disables it

### Configuration

| Variable | Purpose |
| --- | --- |
| `APP_ENCRYPTION_KEY` | 32 random bytes, base64 (`openssl rand -base64 32`). Encrypts MFA seeds, SSO client secrets, Slack webhooks and SCIM tokens. Required in production; keep it stable, since changing it makes stored secrets unreadable. |
| `SMTP_URL`, `MAIL_FROM` | Outgoing mail for password resets and reminders. Without SMTP, mail is printed to the log in development and dropped in production. |
| `APP_ORIGIN` | Public URL; used for links in emails and Slack, and the SSO redirect URI (`<APP_ORIGIN>/api/v1/auth/sso/callback`). |

## Important security state

The application now has database-backed authentication and membership resolution. Before internet deployment, configure HTTPS, a production database, `APP_ORIGIN`, managed secrets, backups, monitoring, and rate limiting. Real customer data remains blocked until the operational Phase 0 gates are verified.

## Local setup

1. Copy `.env.example` to `.env`.
2. Start PostgreSQL with `docker compose up -d db`.
3. Run `npm install`.
4. Run `npm run db:migrate`.
5. Create the first owner:
   `ADMIN_EMAIL=owner@example.com ADMIN_PASSWORD='use-a-long-unique-password' ADMIN_NAME='Owner Name' ORGANIZATION_NAME='Example Company' npm run admin:create`
6. Run `npm run dev` and open `http://localhost:3000`.

Normal use authenticates through the dashboard. The development header adapter lets any caller impersonate any user, so it is off by default and only works outside production when `ALLOW_DEV_AUTH=true`; the app refuses to start in production with it enabled or without `APP_ORIGIN`.

`docker compose up` runs the `migrate` service (`node dist/db/migrate.js`) before starting the app.

## API

- `GET /health`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`
- `GET /api/v1/ai-systems`
- `GET /api/v1/ai-systems/:id`
- `POST /api/v1/ai-systems`
- `GET /api/v1/tool-requests`: your own requests; owners and admins see the whole organization
- `POST /api/v1/tool-requests`: any member requests an AI tool (`toolName`, `businessPurpose`, optional `dataDescription`)
- `PATCH /api/v1/tool-requests/:id`: owners and admins approve or reject a pending request (`decision`, optional `notes`)
- `GET /api/v1/members`: owners and admins list the organization's members
- `POST /api/v1/members`: owners and admins add a member (`email`, `displayName`, `role`, initial `password`); only owners can add owners
- `PATCH /api/v1/members/:id`: owners and admins change a member's `role` or `active` flag; deactivation ends the member's sessions

All data lives in PostgreSQL (`DATABASE_URL`), so any managed PostgreSQL 16+ service works. Every change to systems, requests and members writes an append-only audit event.

Example body:

```json
{
  "name": "Customer Support Assistant",
  "purpose": "Draft responses for customer support agents",
  "vendor": "Example Vendor",
  "ownerName": "Operations",
  "riskTier": "moderate",
  "status": "draft",
  "nextReviewAt": "2026-12-01"
}
```

## Next build increment

1. Add rate limiting, password reset, optional MFA, and session administration.
2. Add repeatable database integration fixtures for two organizations and all roles.
3. Add update and retirement workflows with optimistic concurrency.
4. Add invitations and membership administration.
5. Add policy versions, controls, evidence metadata, and private file storage.

No claim of compliance, security certification, or patentability is made by this source code.
