# GovernBright

GovernBright is a multi-tenant AI governance application. This first build establishes the security-sensitive foundation and the AI-system register described in the implementation plan.

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

Normal use authenticates through the dashboard. The development header adapter remains available only outside production when `ALLOW_DEV_AUTH=true`.

## API

- `GET /health`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`
- `GET /api/v1/ai-systems`
- `GET /api/v1/ai-systems/:id`
- `POST /api/v1/ai-systems`

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
