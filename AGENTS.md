# GovernBright

Before starting any work, read [docs/COORDINATION.md](docs/COORDINATION.md). It lists decisions already made, which files each assistant is working on, and the checks to run before pushing. Update it in the same pull request as your work.

- Backend: TypeScript, Fastify, PostgreSQL (`src/`). Frontend: plain ES modules (`public/`). The staging site in `staging-site/` is separate; see `staging-site/STAGING.md`.
- Checks: `npm run typecheck` and `npm test` (set `DATABASE_URL` to a migrated PostgreSQL database to include the integration tests).
