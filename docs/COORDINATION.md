# Coordination

Two AI assistants work on this repository for the owner: Claude (Claude Code, branches `claude/*`) and ChatGPT (Codex, branches `codex/*`). They can't message each other, so this file is how they stay in step. Read it before starting work, and update it in the same pull request as the work.

## Rules

1. Work on your own branch and open a pull request. Don't push to `main` or to the other assistant's branches.
2. Before starting, add a line under **In progress** naming the files you expect to change. If the other assistant already lists those files, pick other work or ask the owner.
3. Don't reverse a decision listed below. Ask the owner if you think one should change.
4. When `main` moves, merge it into your branch (no force-pushing) and rerun the checks.
5. Checks before pushing: `npm run typecheck` and `npm test`. With a PostgreSQL `DATABASE_URL` set, `npm test` also runs the integration tests, as CI does.

## Decisions

| Date | Decision | Where |
|---|---|---|
| 2026-09-29 | GovernBright is source-available under FSL-1.1-ALv2, not Apache 2.0. Don't open another license pull request. | #8 merged, #7 closed |
| 2026-09-29 | Focus: one polished buyer demo — employee request → live admin popup → approval → ChatGPT launch → audit record. Don't expand the compliance dashboard until buyers have seen it. | #6 |
| 2026-09-29 | Hosting: Render with managed PostgreSQL. Email: Postmark. | Waiting on accounts and API keys from the owner |
| 2026-09-29 | Anything that changes state or writes an audit event is a same-origin `POST` (or `PATCH`/`PUT`/`DELETE`), never a `GET`. Link prefetching and scanners fetch GETs and would create false audit events. Launching an approved tool follows this: `POST /api/v1/tool-requests/:id/launch`. | Found by ChatGPT in #6; fixed in #6 |
| 2026-09-29 | GovernBright is described as **source-available**, not open source. The repository went public on 2026-09-29, after the application pull requests were merged and the credential scan was clean. | Owner |

## In progress

| Who | Work | Files | Pull request |
|---|---|---|---|
| Claude | Home navigation: the logo and a Home button return to the home page; signed-in people go straight back to their workspace | `public/index.html`, `public/app.js`, `public/js/landing.js`, `public/styles.css` | this PR |

Also merged: #10 (notes update), #11 (Render settings fixes), #12 (services section and contact form), #13 (demo video). Merged on 2026-09-29, in order: #9 (these notes), #4 (landing page), #5 (admin email on new requests), #6 (live request-to-launch demo). After merging, the full test suite (72 tests) and the two-browser demo passed on the combined code.

The full-history credential scan was clean again after these merges (gitleaks 8.28.0, all branches). Public with the repository: commit author emails, and the staging hosting project ID in `staging-site/.openai/hosting.json`, which is an identifier, not a credential.

## Known issues not yet assigned

From the production-readiness review; fix these before storing real customer data.

- **Audit log can be emptied.** A trigger blocks `UPDATE` and `DELETE` on `audit_events`, but not `TRUNCATE`, and the app's database user owns the table. Add a `TRUNCATE` trigger and run the app as a database role that doesn't own the tables.
- **Admin-chosen passwords.** Admins set a new member's password, and there's no in-app password change. Needs an invitation link or a forced change at first sign-in.
- **`compose.yaml`** hard-codes `APP_ORIGIN` and doesn't pass `SMTP_URL`, `MAIL_FROM` or `TRUST_PROXY` through.
- **Approved tools aren't added to the AI system register**, so the evidence report can show zero systems while tools are in use.
