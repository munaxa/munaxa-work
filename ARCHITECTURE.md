# Munaxa Work — architecture rules

## Dependency direction

```text
munaxa-platform  ──►  munaxa-work
```

That is the only edge. This repository must never depend on Munaxa School, Munaxa Work,
Munaxa Docs or Munaxa Corporate, and the platform must never depend on this repository.
CI enforces the first half of that in the `boundaries` job.

## What this repository owns

Business logic, the API, the database and its Prisma schema and migrations, routing,
domain models, permissions, workflows, and every Munaxa Work-specific feature.

## What it does not own

The design system. Components, tokens, themes, icons and typography are installed:

| Need                        | Package                |
| --------------------------- | ---------------------- |
| Components, patterns, hooks | `@munaxa/ui`           |
| Design tokens               | `@munaxa/tokens`       |
| Themes                      | `@munaxa/theme`        |
| Icons                       | `@munaxa/icons`        |
| Typography                  | `@munaxa/typography`   |
| Shared helpers              | `@munaxa/utils`        |

If something shared is missing, add it to
[munaxa-platform](https://github.com/tam2om/munaxa-platform) — never rebuild it here. A
component copied into a product is the failure mode this whole architecture exists to
prevent.

## Modules

Business code is module-first (ADR-0023). A module is the unit that could one day be extracted
to a service, which is only true if everything it needs is inside it:

```text
packages/modules/<module>/
├── domain/           business rules — no framework, no ORM, no transport
├── application/      use cases: command and query handlers
├── infrastructure/   repositories and adapters — the only place a driver appears
├── contracts/        the public surface other modules may depend on
└── api/              transport: controllers, DTOs, OpenAPI
```

Exactly three things cross a module boundary: its **application services**, its **public
contracts**, and its **domain events**. Its repositories, its tables and its Prisma client are
private, and the lint layer enforces that rather than a review comment.

| Module | Owns | Phase |
| ------ | ---- | ----- |
| [`identity`](docs/modules/identity.md) | Workforce identity: tenant membership, invitations, portal access, employment links, delegation | 2 |
| [`organization`](docs/modules/organization.md) | The enterprise's structure: units of any depth, legal entities and the country each operates under, cost and profit centres, positions and their establishment, calendars, tenant settings | 3 |
| [`people`](docs/modules/people.md) | The master registry of human identity: one permanent Person per human being, their names over time, government identifiers, citizenships, contacts, addresses and history | 4 |
| [`employment`](docs/modules/employment.md) | The relationship between a person and the workforce: employment identity and lifecycle, organizational assignment on a timeline, the managerial relationship, contracts and probation | 5 |
| [`recruitment`](docs/modules/recruitment.md) | Hiring: requisitions and their approval, vacancies, candidates, applications and their pipeline, interviews and feedback, offers, and the transition that turns an accepted offer into a Person and an Employment | 6 |
| [`onboarding`](docs/modules/onboarding.md) | The induction: configurable plans and their immutable versions, the onboarding of one employment, tasks with owners and due dates, completion and cancellation, and the reconciliation that guarantees a joiner has one | 7 |

### Acting inside another module

A module reaches another through its application service, and inherits that service's permission
check — which is correct for a read the *user* is really making, and wrong for one the module makes on
their behalf. A **bounded service grant** covers the second case: the module holds a named, explicitly
listed permission for the duration of one operation, the user is still checked for the operation they
asked for, grants cannot nest, the acting human stays on every audit column, and every use is logged.
It is a decorator on the one permission checker, not a second authorization framework
([ADR-0043](docs/adr/0043-bounded-service-grant.md)).

## Layers inside a module

Layers live inside a module, never above it, and the dependency direction is one-way:

```text
domain  ◄──  application  ◄──  infrastructure  ◄──  api  ◄──  presentation
```

`domain` holds business rules and depends on nothing — no framework, no ORM, no transport.
`application` holds use cases. `infrastructure` holds persistence and external integrations.
`api` is transport, `presentation` is UI. Violating the direction is a lint error, not a review
comment: the rules live in [`tooling/eslint/standards.mjs`](tooling/eslint/standards.mjs) and
the full standard in [`docs/ENGINEERING_STANDARDS.md`](docs/ENGINEERING_STANDARDS.md).

## Tenancy

Every request's tenant comes from a stored `tenant_membership` row, keyed on the principal
Platform authenticated — never from a header, a path segment or a body (ADR-0032). Underneath
that, PostgreSQL row-level security refuses the query even if the application were wrong
(ADR-0030). Authentication and authorization themselves belong to Platform; this repository holds
the seams they plug into and no implementation of either.

## Branding

Branding is configuration, not code. The only visual difference between this product and
the others is the theme it imports:

```css
/* apps/<app>/src/app/globals.css */
@import 'tailwindcss';
@import '@munaxa/theme/css/work';
@source '../../node_modules/@munaxa/platform/dist';
```

Never hardcode a colour, a font, a radius or a shadow. The Munaxa Work palette is authored in
the platform, and retuning it there updates this product with no change here.

## Expected layout

```text
munaxa-work/
├── apps/
│   ├── api/        # the product API
│   ├── admin/      # the product's web client
│   └── mobile/     # the product's mobile client
├── packages/       # domain, contracts, utils, i18n — this product's own
├── prisma/         # this product's schema and migrations, shared with no one
└── infra/          # database roles, load tests
```

## Status

No application code has been written yet. This repository was separated out of the AXA
monorepo carrying the product's README and its history; the workspace, task graph, lint and
TypeScript configuration, engineering standards, registry auth and CI above are real and run
today, so the first app added here is checked from its first commit.
