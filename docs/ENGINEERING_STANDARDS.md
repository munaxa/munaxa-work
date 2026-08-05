# Munaxa Work — Engineering Standards

**Version 1.0 · Mandatory**

These standards apply to every module, package, application and phase of Munaxa Work. They are
the code-level law serving the architectural law in
[`MASTER_INSTRUCTIONS.md`](MASTER_INSTRUCTIONS.md). No implementation may violate them. If an implementation conflicts with this document, **stop**,
record the conflict, and request approval before continuing — see
[Changing a standard](#changing-a-standard).

This document is the human-readable law. Wherever a standard can be checked by a machine, it
is, and the tooling — not review — is the enforcement point:

| Enforced by                            | What it checks                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `tooling/eslint/standards.mjs`         | Complexity, file budgets, naming, forbidden language features, layer dependency direction, UI ownership |
| `tooling/typescript/standards.json`    | Compiler strictness                                                                                |
| `scripts/check-standards.mjs`          | File and folder naming, file budgets, suppression and unfinished-work markers                      |
| `scripts/check-architecture.mjs`       | Tenant-first schema, audit, versioning, soft delete, identifiers, `snake_case`                      |
| `scripts/check-localization.mjs`       | Every catalogue complete in every required language                                                |
| `scripts/check-dependencies.mjs`       | Circular imports, unused dependencies, unreachable files                                            |
| `.github/workflows/ci.yml`             | The quality gates, on every pull request                                                           |

Run the whole set locally with `pnpm verify`.

## General principles

Code must be simple, readable, maintainable, testable, deterministic, secure, observable and
reusable. No clever code. No hidden behaviour. Explicit over implicit.

## Language

TypeScript strict mode is mandatory. Forbidden: `any`, `@ts-ignore`, `@ts-nocheck`,
`eslint-disable`, and non-null assertions.

`@ts-expect-error` is permitted only with a description of at least 20 characters explaining
why the error is expected — it is a documented, self-removing exception, unlike `@ts-ignore`.

Inline lint directives are configured inert (`noInlineConfig`), so a committed
`eslint-disable` suppresses nothing and is reported as a violation by the standards gate.

## Naming

| Element                     | Convention         |
| --------------------------- | ------------------ |
| Classes, interfaces, types, enums | `PascalCase`  |
| Functions, variables        | `camelCase`        |
| Constants                   | `UPPER_SNAKE_CASE` |
| Files, folders (TypeScript) | `kebab-case`       |
| Files, folders (Dart)       | `snake_case` (ADR-0029) |
| Database objects            | `snake_case`       |

Wire formats — API payloads, database rows, HTTP headers — keep the names their protocol
gives them; they are not ours to rename.

## File standards

Split files *before* the limit is reached. A file at its limit is a file that should already
have been split.

| File                            | Maximum lines |
| ------------------------------- | ------------- |
| Class / general file            | 400           |
| Controller (`*.controller.ts`)  | 150           |
| Service (`*.service.ts`), use case (`*.use-case.ts`) | 300 |
| Repository (`*.repository.ts`)  | 250           |
| Function                        | 60            |

## Complexity

Maximum cyclomatic complexity 10 (5 in repositories). Maximum nesting depth 3. Maximum
parameters 5. Prefer value objects. Prefer composition over inheritance.

## Architecture rules

```text
domain  ◄──  application  ◄──  infrastructure  ◄──  api  ◄──  presentation
```

| Layer            | Contains                                    |
| ---------------- | ------------------------------------------- |
| `domain`         | Business rules only                          |
| `application`    | Use cases                                    |
| `infrastructure` | Persistence and external integrations        |
| `api`            | Transport                                    |
| `presentation`   | UI                                           |

The dependency direction is never violated. `domain` and `application` additionally may not
import any framework, ORM or transport library — those belong outside them, behind ports.

## Repository rules

Repositories never contain business rules, never expose ORM entities, and never call external
services. They return domain models only.

## API standards

Every endpoint supports OpenAPI, Problem Details (RFC 9457), validation, authorization,
correlation ID, request ID and audit. Pagination, filtering, sorting and idempotency apply
wherever they are meaningful. APIs are versioned (`/api/v1`).

## Database standards

PostgreSQL with Prisma. `snake_case` naming, UUIDv7 identifiers, UTC timestamps. Soft delete
via `deleted_at`. Audit columns `created_at`, `created_by`, `updated_at`, `updated_by`,
`deleted_at`, `deleted_by`, and `version` for optimistic concurrency. Indexes and foreign keys
are explicitly defined and explicitly named.

## Validation

Validate input, business rules, authorization, tenant and configuration. No silent failures.

## Error handling

Use RFC 9457 Problem Details. Never expose stack traces, internal errors, secrets, SQL or
environment information.

## Logging

Structured JSON logging. Every log carries timestamp, request ID, correlation ID, tenant ID,
user ID (when available) and log level. `console.log` is forbidden outside local development.

## Security

Mandatory: OWASP Top 10, input validation, output encoding, rate limiting, secure headers,
secret management, encryption in transit, encryption at rest where required, PII protection,
audit logging, least privilege.

## UI standards

Use Platform UI (`@munaxa/ui`) only — a competing design system is the failure this
architecture exists to prevent, and importing one is a lint error. Every screen supports
loading states, skeletons, error states, empty states, confirmation dialogs, responsive
design, RTL and LTR, keyboard navigation and WCAG 2.2 AA. No duplicate components.

## Performance budgets

| Operation           | Budget            |
| ------------------- | ----------------- |
| API response        | < 300 ms          |
| Search              | < 500 ms          |
| Dashboard load      | < 2 s             |
| Initial page load   | < 2 s             |
| Large import/export | Background job    |

## Testing standards

Every module requires unit, integration, application, API, permission, tenant-isolation and
regression tests. Critical business logic must be covered by automated tests.

## Quality gates

Mandatory before a phase is complete, all `PASS`:

architecture review · engineering standards · TypeScript · ESLint · unit tests · integration
tests · production build · migration validation · security scan · documentation

## Documentation standards

Every phase updates the README, architecture, OpenAPI, ER diagram, ADRs, release notes,
developer guide and administrator guide. No undocumented behaviour.

## Git standards

Small commits. Meaningful commit messages. No generated files unless required. No
commented-out code. No `TODO` or `FIXME` left in production code.

## Forbidden

Duplicating business logic · duplicating Platform functionality · hardcoding tenant data ·
hardcoding business rules · bypassing application services · accessing repositories across
module boundaries · circular dependencies · disabling lint rules · suppressing type errors ·
ignoring failing tests.

## Adopting the standards in a package

Every app and package wires both layers on top of the Platform config:

```js
// apps/<app>/eslint.config.mjs
import base from '@munaxa/config-eslint/base.js';
import standards from '../../tooling/eslint/standards.mjs';

export default [...base, ...standards];
```

```jsonc
// apps/<app>/tsconfig.json — the standards overlay is listed last so it wins
{
  "extends": ["@munaxa/config-typescript/nestjs.json", "../../tooling/typescript/standards.json"]
}
```

## Changing a standard

A standard is changed by an ADR in [`docs/adr/`](adr/), never by a lint suppression and never
silently. The ADR states the decision, the reason, the consequences, the alternatives
considered, the date, the author and the approval status. Once it is accepted, this document
and the tooling that enforces it are updated in the same change.

## Definition of engineering success

Architecture compliant · CI green · production build successful · quality gates passed ·
security validated · performance budgets achieved · documentation complete · no critical
technical debt.
