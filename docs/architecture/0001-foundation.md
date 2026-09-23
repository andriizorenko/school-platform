# Foundation v1

Implemented foundation:

- pnpm/Turborepo monorepo
- PostgreSQL + Redis local infrastructure
- Drizzle database package
- migrations 0001-0005
- users and opaque server-side sessions
- RBAC roles + permissions + temporary scoped grants
- append-only application audit table
- transactional outbox table
- NestJS API bootstrap
- login/logout/me endpoints
- global session guard with public-route decorator
- request ID propagation

## Authentication

The browser receives an opaque random session token in an HttpOnly cookie. Only a SHA-256 hash of that token is stored in PostgreSQL. Passwords are expected to be Argon2id hashes.

## Current vertical slice boundary

Family/student/teacher/scheduling tables are intentionally not yet in the database. They belong to the next migration batch so the first foundation can stay reviewable.
