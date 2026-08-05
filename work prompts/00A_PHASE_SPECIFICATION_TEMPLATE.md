# 00A_PHASE_SPECIFICATION_TEMPLATE.md

# Munaxa Work
## Phase Specification Template

Version: 1.0

Status: Mandatory

---

# IMPORTANT

Every phase specification follows this template, and every phase implementation produces every
artifact listed here.

A phase specification that omits a section is incomplete. A phase implementation that omits an
artifact is not done, regardless of whether the feature works.

This template exists because a phase that lists nouns is not buildable. A phase that states its
aggregates, invariants, events, API surface, permissions, projections, migrations and tests is.

---

# Required sections of a phase specification

## 1. Purpose

What the phase owns, in one paragraph. What it explicitly does not own.

## 2. Prerequisites

The phases that must be complete first.

## 3. Objectives

## 4. Non Goals

The domains that consume this one, and the responsibilities that stay with them.

## 5. Mandatory Architecture Decisions

Numbered AD-001, AD-002 … Each one is binding. Conflicts stop implementation and are resolved
by an ADR.

## 6. Domain model

For every aggregate:

- Aggregate root name.
- The entities and value objects it owns.
- The identifiers it exposes.
- The invariants it enforces — stated as rules that are always true, not as validation steps.
- What it references by identity only (never by object).

## 7. Ubiquitous language

## 8. Lifecycle and state machine

Every state, every permitted transition, and the actor and permission required for each.
Illegal transitions are named explicitly.

## 9. Domain events

For each event: name, version, trigger, payload fields, and the domains expected to consume it.
Events are immutable, versioned and published after commit.

## 10. Application services

The commands and queries the module exposes, and the permission each requires. This is the only
surface other modules may use.

## 11. Public contracts

The DTOs other modules and the SDK depend on. Contracts are versioned; breaking changes require
an ADR.

## 12. API surface

Every endpoint: method, path under `/api/v1`, request, response, error cases, permission,
idempotency requirement, pagination, filtering and sorting. Every endpoint appears in OpenAPI.

## 13. Permissions

Every permission the module registers, its code, and the operations it guards. Permissions are
registered by the module, never hardcoded in a portal.

## 14. Persistence

Tables, columns, types, indexes, foreign keys and constraints. Every table carries `tenant_id`,
the audit columns, `deleted_at` / `deleted_by` and `version`. Migrations are forward-only and
reversible in effect.

## 15. Projections

Every read model, its source events, its rebuild strategy and its staleness tolerance.
Reporting and dashboards consume projections; they never read transactional tables.

## 16. Configuration

Everything the tenant may configure, its default, and its validation. Nothing business-specific
is hardcoded — no country, currency, calendar, labor rule, leave type, formula or threshold.

## 17. Localization

Every user-visible string is translatable. Every date is calendar-aware. Every screen works in
both directions. See `00B_LOCALIZATION_AND_STATUTORY_FRAMEWORK.md`.

## 18. Integration points

What the module publishes for the Integration Hub, and what it accepts from it. The module never
talks to an external system directly.

## 19. Performance budget

The measured budget for each operation the phase adds, within the platform budgets.

## 20. Test matrix

Every phase delivers, and CI runs:

- Unit tests for domain invariants and value objects.
- Application service tests for every command and query.
- Repository tests, including tenant scoping.
- API tests for every endpoint, including authorization failures.
- Permission tests: every permission, granted and denied.
- Tenant isolation tests: cross-tenant access must fail, for every entity.
- Effective dating and history tests where applicable.
- Concurrency tests: conflicting updates must fail, never overwrite silently.
- Regression tests for every defect fixed.
- Localization tests: both languages, both calendars, both directions.

Critical business logic — anything financial, statutory or entitlement-bearing — additionally
requires golden-case tests with known inputs and approved expected outputs.

## 21. Acceptance criteria

Checkable statements, not aspirations.

## 22. Definition of done

The phase is done when the acceptance criteria are satisfied, the quality gates in
`00_ENGINEERING_STANDARDS.md` all pass, the documentation in
`27_DEVELOPMENT_PROTOCOL.md` step 9 is updated, and approval has been received.

---

# Production readiness

A phase is production ready only when all of the following are true. They are not optional and
they are not deferred to Phase 24.

Correct

- Domain invariants enforced in the domain, not in the controller.
- Every write is transactional; events publish after commit.
- Optimistic concurrency on every mutable aggregate.
- No silent failure anywhere.

Safe

- Every endpoint validates authentication, authorization, tenant and business rules.
- Tenant isolation proven by test for every entity the phase adds.
- PII identified and protected; secrets never in source or logs.
- Problem Details on every error path, with no internal detail leaked.

Operable

- Structured logs with request, correlation, tenant and user identifiers.
- Metrics for every long-running or scheduled operation.
- Health contribution registered where the module owns a dependency.
- Every background job is idempotent, retryable and observable.

Supportable

- OpenAPI current.
- ER diagram current.
- ADRs written for every decision taken during the phase.
- Release notes, developer guide and administrator guide updated.
- Known limitations and technical debt stated explicitly, never omitted.

Reversible

- Migrations reviewed for lock behaviour on large tables.
- Feature-flagged where the change is risky.
- Rollback path stated in the completion report.

---

# End of Phase Specification Template
