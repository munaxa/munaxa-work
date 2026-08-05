# Munaxa Work — Master Instructions

**Version 1.0 · Mandatory**

These are the permanent architectural rules for Munaxa Work. Every implementation phase
follows them, and they override implementation preference. If a phase conflicts with this
document, **stop**, explain the conflict, and do not continue until it is resolved — a
resolution is an ADR in [`docs/adr/`](adr/), never a workaround.

This document is the architectural law; [`ENGINEERING_STANDARDS.md`](ENGINEERING_STANDARDS.md)
is the code-level law that serves it. Where a rule can be checked by a machine, it is:

| Enforced by                       | Which rules                                                                             |
| --------------------------------- | --------------------------------------------------------------------------------------- |
| `tooling/eslint/standards.mjs`    | Layer direction, module independence, Platform ownership, deployment agnosticism, externalized configuration |
| `scripts/check-architecture.mjs`  | Tenant-first schema, audit, versioning, soft delete, UUID identifiers, `snake_case`, PostgreSQL |
| `scripts/check-standards.mjs`     | Naming, file budgets, suppression markers                                                 |
| `.github/workflows/ci.yml`        | All of the above, plus product isolation, on every pull request                           |

## Product

**Munaxa Work** — enterprise Human Capital Management (HCM). Cloud SaaS, single codebase,
multi-tenant, API-first, mobile-first, web-first.

It is not a traditional HR system. It competes with Menaitech, Workday, SAP SuccessFactors,
Oracle HCM and BambooHR on a cleaner architecture and a better user experience.

## Platform

Munaxa Work consumes the shared platform repository. Platform owns authentication,
authorization, the design system, design tokens, the RBAC framework, shared components,
shared utilities and shared infrastructure.

**Munaxa Work never duplicates Platform functionality, and never modifies Platform.** If
something shared is missing, it is added to
[munaxa-platform](https://github.com/munaxa/munaxa-platform). Importing a competing design
system is a lint error; importing another product is a CI failure.

## Technology stack

Frontend Next.js · TypeScript · React. Backend Node.js · TypeScript · Prisma · PostgreSQL.
Styling comes from the Platform UI package — no second design system.

## Architecture

Domain Driven Design · Clean Architecture · CQRS where appropriate · Event Driven
Architecture · Modular Monolith · deployment-agnostic · future microservice ready.

```text
domain  ◄──  application  ◄──  infrastructure  ◄──  api  ◄──  presentation
```

The direction is never violated. `domain` and `application` are pure: no framework, no ORM,
no transport, no cloud SDK.

## Deployment

The application runs without business code changes on cloud, on-premises, hybrid,
containers, Kubernetes and a single server. **Infrastructure never affects business logic** —
cloud SDKs are confined to the infrastructure layer, behind ports.

## Multi-tenancy

The system is tenant-first. Every business entity belongs to exactly one tenant unless
explicitly documented otherwise. Tenant isolation is mandatory and there is no cross-tenant
data leakage.

Every Prisma model carries `tenant_id`. A model that is genuinely global — a country list, a
currency table — declares itself so with a `/// @global` doc comment stating why, and the
schema gate accepts it. Nothing else is exempt.

## Single source of truth

Every concept has exactly one owner: Person owns identity, Employment owns employment,
Attendance owns attendance, Leave owns leave, Payroll owns payroll. Business ownership is
never duplicated. The registry is [`DOMAIN_OWNERSHIP.md`](DOMAIN_OWNERSHIP.md), and a phase
that introduces a concept records its owner there.

## Shared architectural patterns

Mandatory, and no future phase introduces a competing pattern:

versioned child entity · timeline projection · projection read models · application services ·
domain services · optimistic concurrency · soft delete · audit · effective dating ·
domain events

## Module independence

Modules communicate only through application services, public contracts and domain events —
never through direct repository access. A repository is reachable only from within the
infrastructure layer that owns it, and `@prisma/client` appears nowhere else. Presentation
applications consume contracts and the SDK; they contain no business logic.

## Coding standards

SOLID · DDD · composition over inheritance · dependency inversion · explicit interfaces ·
pure domain models.

Avoid: god objects, fat controllers, business logic in controllers or repositories, global
mutable state, hardcoded values. The measurable limits are in
[`ENGINEERING_STANDARDS.md`](ENGINEERING_STANDARDS.md).

## Configuration

Configuration is externalized. No environment-specific business logic, no hardcoded tenant
configuration, no hardcoded countries, currencies or labor laws. Everything is configurable.

`process.env` is read only inside the configuration package, which validates it and exposes a
typed value; reading it anywhere else is a lint error.

## Internationalization

The architecture supports multiple languages, time zones, calendars and currencies, and both
RTL and LTR. Nothing assumes a country.

## Security

Authentication and authorization come from Platform. Business authorization belongs to Munaxa
Work. Every endpoint validates authentication, authorization, tenant, business rules and
audit.

## API

REST first, versioned at `/api/v1`. OpenAPI required. Problem Details (RFC 9457) required.
Idempotency where appropriate.

## Database

PostgreSQL · Prisma · UTC timestamps · UTF-8 · soft delete · audit · versioning · effective
dating · optimistic concurrency.

Every model carries, and the schema gate enforces:

| Column                       | Purpose                 |
| ---------------------------- | ----------------------- |
| `id`                         | UUIDv7 primary key      |
| `tenant_id`                  | Tenant ownership        |
| `created_at`, `created_by`   | Audit                   |
| `updated_at`, `updated_by`   | Audit                   |
| `deleted_at`, `deleted_by`   | Soft delete             |
| `version`                    | Optimistic concurrency  |

## Events

Events are immutable, versioned, and published only after the transaction commits. Every
event carries `eventId`, `tenantId`, `occurredAt`, `actor`, `correlationId` and `payload`.

## UI

Consume Platform UI only. Never duplicate a component. Never modify Platform. Munaxa Work
owns business screens only.

## Performance targets

Interactive APIs < 300 ms · search < 300 ms · page load < 2 s · large imports as background
jobs. No blocking long-running requests.

## Testing

Every phase requires unit, integration, application service, repository, permission,
tenant-isolation, API and regression tests, plus a production build. CI must pass before the
next phase begins.

## Documentation

Every phase updates the architecture, ER diagram, API documentation, OpenAPI, ADRs, developer
guide, administrator guide and release notes.

## Definition of done

A phase is complete only when the architecture is respected, tests pass, CI passes, the
production build passes, documentation is updated, ADRs are written, no critical issues
remain, and the implementation is production ready.

## Implementation order

Phases are implemented strictly in order. No phase begins before the previous one satisfies
its acceptance criteria. Skipping a phase is prohibited. Changing completed architecture
requires an ADR and explicit approval.

The ledger of phase status is [`PHASES.md`](PHASES.md), and the workflow each phase follows is
[`work prompts/27_DEVELOPMENT_PROTOCOL.md`](../work%20prompts/27_DEVELOPMENT_PROTOCOL.md).
