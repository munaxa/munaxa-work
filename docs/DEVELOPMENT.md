# Development guide

## Prerequisites

Node 22, pnpm 10, Docker. Installing needs a GitHub token with `read:packages` on the `munaxa`
org — the shared design system is published to GitHub Packages, not npm:

```bash
pnpm config set "//npm.pkg.github.com/:_authToken" <token>
```

## Setup

```bash
pnpm install
cp .env.example .env
pnpm db:up            # postgres, redis, mailpit
pnpm verify           # standards · architecture · format · lint · typecheck · test · build
```

## Running the applications

| Application | Command | Port |
| ----------- | ------- | ---- |
| API | `pnpm --filter @work/api dev` | 3000 |
| Admin | `pnpm --filter @work/admin dev` | 3001 |
| Employee portal | `pnpm --filter @work/employee-portal dev` | 3002 |
| Manager portal | `pnpm --filter @work/manager-portal dev` | 3003 |
| Mobile | `cd apps/mobile && flutter run` | — |

The mobile application is not a pnpm workspace member and is not built by turbo: it has its own
toolchain and its own CI job.

## The API

| Endpoint | Purpose |
| -------- | ------- |
| `GET /health/live` | Liveness. The process is running |
| `GET /health/ready` | Readiness. It can serve traffic |
| `GET /health` | Health, version, build and dependency status |
| `GET /api/docs` | OpenAPI |

Health probes are deliberately unprefixed and unversioned: an orchestrator's probe URL must not
change when the API version does. Everything else lives under `/api/v1`.

## Workspace layout

```text
apps/api                     # the product API — transport only
apps/admin                   # HR administration
apps/employee-portal         # employee self-service
apps/manager-portal          # manager self-service
apps/mobile                  # Flutter application (own toolchain)
packages/kernel              # Shared Kernel (Phase 1)
packages/modules/<module>    # business modules, layered inside (ADR-0023)
packages/config              # the only place the environment is read
packages/contracts           # cross-module public contracts
packages/sdk                 # typed API client
packages/testing             # shared test infrastructure
packages/country-packs       # statutory content (Phase 11.1)
prisma/                      # schema and migrations
tooling/                     # the engineering standards, as lint and compiler configuration
```

## The rules, and where they are enforced

| Rule | Enforced by |
| ---- | ----------- |
| Complexity, file budgets, naming, layer direction, module independence | `tooling/eslint/standards.mjs` |
| Compiler strictness | `tooling/typescript/standards.json` |
| File naming, suppression markers | `scripts/check-standards.mjs` |
| Tenant, audit, soft delete, versioning, `snake_case` in the schema | `scripts/check-architecture.mjs` |

A rule is changed by an ADR in [`adr/`](adr/), never by a suppression. There is no inline
escape hatch: `noInlineConfig` makes a committed `eslint-disable` inert, and the standards gate
reports it.

## Tenant isolation

Three mechanisms, layered (ADR-0030), because a cross-tenant disclosure cannot be walked back:

1. Every business table carries `tenant_id`, enforced by `scripts/check-architecture.mjs`.
2. PostgreSQL row-level security refuses the query — `prisma/sql/row-level-security.sql`.
3. The application sets `app.tenant_id` per transaction and repositories filter by tenant.

The application role must not be a superuser and must not hold `BYPASSRLS`. A superuser bypasses
every policy in the file while every test still passes, so `app_isolation_diagnostics()` reports
it and startup refuses to serve.

`packages/testing/src/tenant-isolation.integration.test.ts` proves the property against a real
database: reads, inserts, updates and deletes across tenants, and the no-tenant case failing
closed. It skips without a database locally and **refuses to skip in CI**.

```bash
pnpm db:up
TEST_DATABASE_URL=postgresql://work:work@localhost:5432/work pnpm test
```

## Conventions worth knowing before your first commit

**The environment is read once.** `packages/config` validates `process.env` at startup and
exposes a frozen, typed value. Reading `process.env` anywhere else is a lint error. A missing or
invalid variable fails the process immediately rather than surfacing as a confusing error later.

**Errors leave as Problem Details.** RFC 9457, always. A deliberate `HttpException` may carry a
message for the client; anything else returns a generic detail and the real cause goes to the
log. Stack traces, SQL and connection strings never reach a response.

**Every request is traceable.** `x-request-id` is ours and always new; `x-correlation-id` is the
caller's if it sent one. Both are echoed and both appear on every log line.

**Presentation owns no business logic.** The portals consume `@munaxa/ui` and `@munaxa/theme`
from the registry and the API over `/api/v1`. Never rebuild a component here, never hardcode a
colour, and never reach past the API into a domain — the lint layer enforces all three.

**Tests boot the real composition.** `configureApplication` is shared by `main.ts` and the API
tests, so routing, prefixes, validation and the error filter are tested as they actually run.
