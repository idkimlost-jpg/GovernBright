# GovernBright private staging adapter

This directory contains the hosting-compatible version deployed at the private GovernBright staging Site.

It preserves the dashboard and AI-system register while adapting infrastructure for the staging platform:

- Platform-provided private identity replaces the standalone email/password login.
- Managed D1 storage replaces the PostgreSQL TCP connection.
- Records remain scoped server-side to the authenticated Site user.
- AI-system creation writes an accompanying audit event.

The primary Fastify/PostgreSQL application remains at the repository root. This adapter is for private staging and product demonstrations; changes should be intentionally synchronized when shared behavior evolves.
