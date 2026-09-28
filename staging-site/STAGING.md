# GovernBright private staging adapter

This directory contains the hosting-compatible version deployed at the private GovernBright staging Site.

It preserves the dashboard and AI-system register while adapting infrastructure for the staging platform:

- Platform-provided private identity replaces the standalone email/password login.
- Managed D1 storage replaces the PostgreSQL TCP connection.
- Records are scoped server-side to the Site's organization, and only approved administrators can manage the AI-system register, run risk assessments, approve employees, and decide tool requests.
- AI-system creation writes an accompanying audit event.

The primary Fastify/PostgreSQL application remains at the repository root. This adapter is for private staging and product demonstrations; changes should be intentionally synchronized when shared behavior evolves.

## Security requirements

- **Serve the Site only through the Sites dispatch layer.** Identity comes from the `oai-authenticated-user-*` headers that dispatch injects. Any path that reaches the Worker without passing through dispatch would let a caller forge those headers.
- **Bootstrap the first administrator explicitly.** On an empty database nobody is an administrator until the account whose email matches the `GOVERNBRIGHT_BOOTSTRAP_ADMIN_EMAIL` Worker variable signs in. Without that variable the Site cannot be claimed, so a random first visitor can no longer take it over. Once an administrator exists the variable is ignored.
- **Membership binds to the first account.** An approved email is bound to the first platform user ID that signs in with it; a different account presenting the same email is treated as a non-member.
- **State-changing API calls must be same-origin JSON.** Mutating routes reject cross-site requests (Fetch Metadata) and non-JSON bodies.
