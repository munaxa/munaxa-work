# Phase 5.3 · Checkpoint 1 — Asset catalogue and inventory · Definition of Ready

*Prepared 2026-08-23 against `3ad9fd7` (`main`), the merge commit of PR #14. **Planning only.** No
`@work/assets` package, no `asset*` table, no migration and no handler exists — verified against the
repository, not inferred from a ledger.*

*Decisions are recorded in [`phase-5.3-register.md`](./phase-5.3-register.md). Nothing here is
approved, and readiness is not authorization.*

---

## 1. Checkpoint identity

| | |
|---|---|
| Phase | 5.3 — Assets & Custody |
| Checkpoint | 1 of 4 — **Asset catalogue and inventory** |
| Module | `@work/assets`, new |
| Depends on | Nothing open. Three of the phase's six decisions are settled by evidence; the three that remain OPEN block Checkpoints 2–4, not this one |
| Cross-module dependencies | **None.** No port, no service grant, no other module's query |
| Platform dependencies | **None** |

## 2. Objective

Give the tenant a catalogue of the kinds of thing it issues, and an inventory of the individual things
it owns. Nothing is issued to anybody in this checkpoint.

That is deliberately the smallest useful slice: it is the half of Assets that has no custodian, so it
has no employment boundary, no acknowledgement, no condition, no incident, no deduction and no
approval — and therefore no dependency on any decision the owner has not taken.

## 3. Business value

Today there is nothing. A laptop issued to somebody who leaves lives in a spreadsheet. After this
checkpoint a company can say *what it owns*, *what kind of thing each item is*, and *whether the item
is in service* — and Checkpoint 2 has something to attach custody to.

Standing alone, it is already the asset register the product does not have.

## 4. Starting state — verified, not assumed

| Claim | How it was checked |
|---|---|
| Phase 5.2 is closed and merged | `3ad9fd7` on `main`; `5c8b0de`, `b0020a1`, `be8ea9e`, `9fb8c61`, `2e00e61` are ancestors |
| No Assets code exists | The only match for "asset" in `packages/` is a comment in `employment/src/application/lifecycle.use-case.ts` |
| No Assets schema exists | 29 migration directories, none matching `asset`; no `asset*` model in `prisma/schema.prisma` |
| `DOMAIN_OWNERSHIP.md` reserves the module | *"Asset, custody assignment · `assets` · Phase 5.3"*, line 51 |
| `PHASES.md` row 5.3 | "Not started" — correct, unlike most rows in that column |
| Prerequisites (0–5, 4.1) built | `employment` and `documents` are substantial modules with full lifecycles |
| The standards scripts need no change for a new module | `check-standards`, `check-architecture`, `check-dependencies` and `check-localization` discover packages from `git ls-files`; none enumerates module names |

## 5. Scope

Two tables, five commands, three reads, four permissions, one migration.

* **`asset_category`** — the kinds of thing a tenant issues. Tenant configuration: code, localized
  name, ordering, active.
* **`asset`** — the individual items. Category, tag, serial number, description, location note,
  purchase reference, status.
* Registering an asset, amending it, moving it through the in-service statuses, retiring it.
* Reading the catalogue; reading and searching the inventory.

## 6. Explicit non-goals

Each of these is **asserted absent**, not merely omitted.

| Not built | Why |
|---|---|
| **Custody, in any form** | Checkpoint 2. No `asset_custody` table, no assignment, no holder column on `asset` |
| **Any reference to an employment** | Follows from the above. `asset` has no `employment_id`, and the module has no Employment port |
| **The condition scale** | D-5.3-05 is OPEN, and nothing in this checkpoint records a condition. Creating it here would ship configuration no code reads — the `repeat_window_days` mistake, knowingly repeated |
| **Acknowledgement and return requirements** on the category | Same argument. They configure custody, and custody is Checkpoint 2 |
| **Valuation basis for deduction** | D-5.3-03 is OPEN, and this checkpoint authorizes no deduction |
| **Document references** | Settled *how* (D-5.3-04), but an identifier column nothing reads is ADR-0070's stored flag. It arrives with the incident that cites it |
| **Incidents, loss, damage, liability, waiver** | Checkpoint 3 |
| **The clearance projection** | Checkpoint 4; Offboarding (11.2) owns the consumer |
| **Onboarding provisioning** | Phase 7 owns it |
| **Fixed-asset accounting, depreciation, procurement, value** | Non-goals of the phase. No amount column of any kind |
| **Domain events** | The specification names eight. Delivery is in-process and at-most-once with no outbox (ADR-0053/0064); nothing in this checkpoint has a consumer, and an event nobody receives is a promise |

## 7. Decisions required before implementation

**None.** All three OPEN decisions are outside this checkpoint's scope:

| Decision | Blocks | Why not this checkpoint |
|---|---|---|
| D-5.3-01 — custody when an employment ends | Checkpoint 2 | No custody exists to outlive anything |
| D-5.3-03 — how a deduction reaches Payroll | Checkpoint 4, if in scope | Nothing is deducted, and no amount is stored |
| D-5.3-05 — the condition scale | Checkpoint 2 | Excluded from §6 precisely so it does not block this one |

The three that were settled during the investigation — D-5.3-02 (acknowledgement recorded on behalf,
Career D-9), D-5.3-04 (document references by identifier through `DocumentReferencePort`), D-5.3-06
(Assets records its own named-human decisions in `ApprovalPort`'s shape) — apply to Checkpoints 2–3 and
need nothing here.

**One authorization is required: permission to implement this checkpoint.** Readiness is not it.

## 8. Decisions not required, and why

Every one of these is settled by evidence already in the repository, named in the register's closing
table: the AD-004 partial unique index (ADR-0071), custody-history immutability, RLS via
`app_protect_table` (ADR-0030), the bounded service grant (ADR-0043), `(sequence, code)` ordering
(D-5.2-07), civil dates named in every select, and whether reads are audited.

Two are load-bearing *here* and are restated in §12 and §18.

## 9. Domain ownership and module skeleton

A new package, `packages/modules/assets`, following ADR-0023 and matching `@work/relations` file for
file: `src/{domain,application,infrastructure,contracts,api}`, `src/index.ts`, `locales/{en,ar}.json`,
`package.json`, `tsconfig.json`, `tsconfig.build.json`, `eslint.config.mjs`, `vitest.config.ts`.
Transport belongs to `apps/api`, and `apps/api/src/assets/` composes the module.

Nothing here belongs to an existing module. Employment owns the relationship, Documents owns files,
Payroll owns money, Organization owns units — **none of them owns a laptop.**

## 10. Data model

### `asset_category` — tenant configuration, mutable

```
id, tenant_id, code varchar(64), name jsonb, sequence integer, active boolean,
metadata jsonb, created_at/by, updated_at/by, deleted_at/by, version
```

| Constraint | Shape |
|---|---|
| `asset_category_code_shape_check` | `code ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'` — the repository's code shape, unchanged |
| `asset_category_sequence_check` | `sequence >= 0` |
| `asset_category_code_idx` | partial unique on `(tenant_id, code) where deleted_at is null` |

`name` is localized `jsonb`, as every tenant catalogue in this repository is. There is deliberately **no
`severity`-shaped free string and no closed vocabulary** on this table: neither is needed until
something reads one.

### `asset` — the individual item, mutable

```
id, tenant_id, asset_category_id uuid, asset_tag varchar(64), serial_number varchar(128) null,
description varchar(500) null, location_note varchar(255) null, purchase_reference varchar(128) null,
status varchar(24), metadata jsonb, created_at/by, updated_at/by, deleted_at/by, version
```

| Constraint | Shape |
|---|---|
| `asset_category_fk` | `asset_category_id references asset_category (id)` |
| `asset_tag_shape_check` | non-empty, trimmed |
| `asset_status_check` | `status in ('registered', 'available', 'under_repair', 'retired')` — see §12 |
| `asset_tag_idx` | partial unique on `(tenant_id, asset_tag) where deleted_at is null` |
| `asset_serial_idx` | partial unique on `(tenant_id, serial_number) where serial_number is not null and deleted_at is null` |
| `asset_category_ref_idx` | plain index on `(tenant_id, asset_category_id) where deleted_at is null` |

`location_note` and `purchase_reference` are **free text and explicitly not references**: Organization
owns units and no Finance module exists, so a foreign key here would be inventing a boundary. Both are
read back by the read model, so neither is a flag nothing maintains.

**No effective dating on either table.** AD-007 lists it, but an asset does not have a value that
differs by date in this checkpoint. Adding the columns would be scaffolding.

## 11. Asset identity

`asset_tag` is the tenant's own identifier, **required and unique per tenant** — the thing written on
the sticker. `serial_number` is the manufacturer's, **optional and unique per tenant when present** —
a chair has none, two laptops must never share one.

That asymmetry is the whole of the decision, and it is a partial unique index rather than a read: a
`select` followed by an `insert` is not idempotent under concurrency (ADR-0071), and two administrators
registering the same serial number at the same instant is exactly the case the index exists for.

## 12. Asset status — persisted versus derived

The specification's lifecycle is *Registered → Available → Issued → In Custody → Returned → Under
Repair → Retired.* **Three of those seven are not asset statuses; they are facts about custody**, and
persisting them would put a second, staler answer next to the authority.

Persisted, closed at the database:

| Status | Meaning |
|---|---|
| `registered` | Known to exist; not yet in service |
| `available` | In service and not held by anybody |
| `under_repair` | Out of service, expected back |
| `retired` | Out of service permanently. **Terminal** |

Transitions: `registered → available | retired` · `available → under_repair | retired` ·
`under_repair → available | retired` · `retired → ∅`.

`issued`, `in_custody` and `returned` are **derived from `asset_custody`** when Checkpoint 2 creates it.
This is not a new judgement: ADR-0070 says a stored flag that nothing maintains is worse than no flag,
and D-5.2-16 chose a derived read over a persisted projection for the same reason. It is recorded in the
register's closing table as a non-decision with both precedents named.

## 13. Commands

| Command | Permission | Notes |
|---|---|---|
| `assets.define-category` | `assets.category.manage` | |
| `assets.amend-category` | `assets.category.manage` | `code` is absent from the request — identity does not change, as `amendDisciplinaryRule` refuses to change a threshold |
| `assets.register-asset` | `assets.asset.manage` | Status is `registered`; the caller does not choose it |
| `assets.amend-asset` | `assets.asset.manage` | Description, location note, purchase reference, serial number. **Not** category, **not** tag, **not** status |
| `assets.change-asset-status` | `assets.asset.manage` | The only path that moves status, validated against the transition table |

Every command carries `expectedVersion`. No command carries a tenant identifier — execution context
determines it (ADR-0030/0032), and a command that accepted one would be the tenant-spoofing seam.
Actors come from `currentActor()`, never from the request.

## 14. Queries

| Query | Permission | Notes |
|---|---|---|
| `assets.list-categories` | `assets.category.read` | Ordered `(sequence, code)` — D-5.2-07 |
| `assets.read-asset` | `assets.asset.read` | `not_found` for another tenant's identifier, which RLS answers before the handler does |
| `assets.search-assets` | `assets.asset.read` | Paged; filters on category, status and active |

Every date column is **named in its select and projected with `to_char(…, 'YYYY-MM-DD')`** where it is
a civil date. Reaching a date through `select *` is the Checkpoint 3 defect and it is not repeated.

## 15. Permissions

Four, per resource per capability:

```
assets.category.read · assets.category.manage · assets.asset.read · assets.asset.manage
```

**No `assets.admin`, no `assets.manage`, no `assets.write-all`, no wildcard, and no permission for a
capability this checkpoint does not build** — asserted, not promised. Custody, incident and waiver
permissions arrive with custody, incidents and waivers; Phase 5.2 showed that inventing them early is
how a grant over nothing appears.

Authorization failure behaves as **not found**, never as a distinguishable permission error, so an
identifier cannot be probed for existence.

## 16. API

`apps/api/src/assets/`, transport only.

```
POST /v1/assets/categories
POST /v1/assets/categories/:assetCategoryId      amend
GET  /v1/assets/categories
POST /v1/assets
POST /v1/assets/:assetId                          amend
POST /v1/assets/:assetId/status
GET  /v1/assets/:assetId
GET  /v1/assets
```

**No `PUT`, `PATCH` or `DELETE`.** Amendment is a `POST` to the resource, matching the Relations
catalogue's own `amend`; things leave service by retirement, and history is appended to. The existing
architecture assertion that no module publishes those verbs stays true without amendment.

## 17. RLS and tenancy

`call app_protect_table('asset_category');` and `call app_protect_table('asset');` — RLS **enabled and
forced** (ADR-0030), so no role short of superuser bypasses it and the application role does not.

**No `BYPASSRLS`. No service-level tenant bypass. No tenant identifier in any command or query** — the
execution context already determines it, and accepting one from a client is the failure this rule
exists to prevent.

Verified in integration as an unprivileged role, in **both directions**: a tenant sees its own rows, and
sees none of its neighbour's.

## 18. Audit

`created_by` / `updated_by` / `version` on both tables, with `deleted_at` / `deleted_by` for soft
delete — AD-007, and the repository's standard shape.

**Reads are not audited, and there is no access-trail table.** Relations audits reads because a
violation is an allegation about a person; an asset register is a list of laptops. Blanket read auditing
is precisely the mechanism D-5.2-05 rejected, and this checkpoint does not reintroduce it. If custody
turns out to warrant it — a custody row does name a person — that is a Checkpoint 2 judgement made on
Checkpoint 2's evidence.

## 19. Immutability

**Nothing in this checkpoint is immutable, and no immutability trigger is created.** A catalogue and an
inventory are mutable by design: a description is corrected, a serial number is entered late, an asset
is retired.

Stated explicitly because the phase's AD-003 is about *custody history*, and it would be easy to read
the pattern from Phase 5.2 across to the wrong table. The append-only table with the unconditional
trigger arrives in Checkpoint 2, on `asset_custody`, where the invariant actually lives.

## 20. Concurrency

* **Optimistic concurrency** on every amendment through `expectedVersion`; the repository appends
  `version = version + 1` and the domain never pre-increments it.
* **Uniqueness by partial unique index**, never by a read-then-write (ADR-0071): duplicate `code`,
  duplicate `asset_tag`, duplicate `serial_number`.
* A soft-deleted row does not block its replacement — the indexes are partial for exactly that.

Proved against **real PostgreSQL with two real connections**, contending. **No sleeps and no timing
assumptions.**

## 21. Localization

`packages/modules/assets/locales/en.json` and `ar.json`, both complete or `check-localization.mjs`
fails. Every refusal key the domain can produce is present in both, and no key is present that nothing
can produce — the unproducible-key cleanup Checkpoint 3 had to do is avoided by writing the files from
the refusal list rather than from the plan.

## 22. Cross-module contracts

**None. This is the checkpoint's most valuable property and it is asserted, not stated.**

No Employment port, no Documents port, no Identity port, no Workflow, no Payroll, no Organization, no
service grant, no `runWithServiceGrant` call, no import of another module's package anywhere in
`packages/modules/assets`. The module's `package.json` depends on `@work/kernel` and `@work/persistence`
and nothing else in the workspace.

Checkpoint 2 adds exactly one: a bounded grant asking Employment whether an employment exists, returning
the least it can, on the `RelationsEmploymentDirectory` template.

## 23. Negative space

Asserted in a boundaries suite, in the shape Phase 5.2's `relations-lifecycle-boundaries.test.ts` took:

no Payroll write, no Payroll command, no amount column of any kind · no Employment mutation and no
Employment reference · **no Person reference** (AD-001) · no Documents reference and no storage adapter
· no Workflow subject, instance or `ApprovalPort` consumption · no Platform scheduler and nothing
scheduled · no fixed-asset accounting, depreciation, valuation or procurement · no invented country
rules and no country-pack claim · no wildcard permission and no permission over an unbuilt capability ·
no persisted derived state, and specifically no `issued`, `in_custody`, `returned`, `holder_id`,
`current_custody_id` or `is_issued` anywhere in the module · no domain event and no subscription.

## 24. Migration plan

**One additive migration**, `prisma/migrations/2026xxxxxxxxxx_assets_catalogue/migration.sql`:
two `create table`, their constraints and indexes, two `call app_protect_table(...)`. Plus the two
models in `prisma/schema.prisma`, with the back-relation on `AssetCategory` that Checkpoint 4 of
Phase 5.2 had to add after the fact.

**No existing table, constraint, trigger, index or migration is modified.** No `document_source` change
(D-5.3-04 makes it unnecessary), no permission-implementation change, no Prisma change outside the two
new models. `pnpm prisma:validate` and `pnpm db:migrate` must both be clean with **no drift**.

## 25. Test plan, verification gates and risks

**Tests.** Domain rules in isolation — code shape, status transitions, identity immutability under
amendment. Application behaviour through the **real dispatcher and real handlers**, including that every
handler declares a permission and that a missing one behaves as `not_found`. **Real PostgreSQL** for
RLS in both directions, the three partial unique indexes under contention, soft delete not blocking a
replacement, and the civil-date projection actually returning a string.

**Gates**, in this order and with no pipe that discards an exit status:

1. `pnpm standards` — check-standards, check-architecture, check-localization, check-dependencies
   (`git add -A` first; it reads `git ls-files`)
2. `pnpm format:check`
3. `pnpm prisma:validate` and `pnpm db:migrate`
4. `pnpm exec turbo run build lint typecheck test --force --concurrency=1` — ~12 minutes, so it must be
   **backgrounded**; the reported status is Turbo's own exit code and nothing else

No lint suppression, no `any`, no audit ignore, no weakened test, no budget exemption. Budgets are met
by splitting at natural seams — controller 150 lines, repository 250, `*.use-case.ts` 300, others 400,
complexity ≤ 10, function ≤ 60 lines, ≤ 5 parameters.

**Risks.**

| Risk | Mitigation |
|---|---|
| A new package is the first since Relations; workspace wiring is the usual place a gate fails late | Copy `@work/relations`'s eight config files verbatim and change the name; run `pnpm standards` before writing a handler |
| Pressure to add the condition scale "while the table is open" | It is excluded in §6 with a named decision and a named precedent. A column added early is D-5.3-05 answered by accident |
| Pressure to add `holder_id` "for Checkpoint 2" | §23 asserts its absence |
| A derived status looking like a gap to a reviewer | §12 states the reasoning and both precedents; the checkpoint report should repeat it |
| Rollback | The migration is purely additive and creates only new objects, so reverting the commit and dropping two tables is complete. Nothing existing is altered, so nothing existing needs restoring |

---

## Definition of Ready checklist

| # | Item | State |
|---|---|---|
| 1 | Starting state verified against the repository, not a report | ✅ §4 |
| 2 | Six decisions resolved from evidence; three settled, three OPEN with recommendations | ✅ register |
| 3 | No decision approved by me | ✅ |
| 4 | Checkpoint 1 confirmed to depend on no OPEN decision | ✅ §7 |
| 5 | Scope minimal and independently useful | ✅ §2, §5 |
| 6 | Non-goals explicit and asserted, not merely omitted | ✅ §6, §23 |
| 7 | No placeholder table, column, permission or route for a future capability | ✅ §6, §15, §23 |
| 8 | Data model complete, nothing speculative | ✅ §10–§12 |
| 9 | Permissions per resource per capability, no wildcard | ✅ §15 |
| 10 | RLS enabled and forced; no tenant identifier from a client | ✅ §17 |
| 11 | Concurrency by index, not by read-then-write | ✅ §20 |
| 12 | No cross-module dependency | ✅ §22 |
| 13 | Migration additive; nothing existing modified | ✅ §24 |
| 14 | Gates named, with the exit-status rule | ✅ §25 |
| 15 | **Owner authorization to implement** | ⏳ **Pending** |

## Authorization boundary

**This document is a statement of readiness. It is not permission to implement.**

Checkpoint 1 depends on no open decision, which means it *could* begin — not that it *may*. Nothing in
`packages/modules/assets`, `apps/api/src/assets`, `prisma/schema.prisma` or `prisma/migrations` should
be created until the owner authorizes this checkpoint explicitly.

---

## 26. As built — what changed between the plan and the implementation

*Added after Checkpoint 1 was implemented and verified. The plan above is left unedited: it is the
record of what was intended, and this section is the record of where reality differed.*

### 26.1 The plan was accurate, and three details tightened during implementation

**§10's data model shipped unchanged** — two tables, the same columns, the same constraints, the same
indexes. **§13's five commands, §14's three queries, §15's four permissions and §16's eight routes all
shipped exactly as written.** §24 predicted one additive migration that modifies nothing existing, and
that is what `20260823150000_assets_catalogue` is.

Three things the plan did not spell out, decided during implementation on existing precedent:

1. **`asset_serial_shape_check`.** The plan named the partial unique index on `serial_number` but not a
   shape constraint. Without one, a blank string would be a value the index treats as real, and every
   unserialled item would collide with every other. The domain already stored a blank as *absent*; the
   CHECK makes the database agree, which is the same "stated twice, in the two places somebody might
   try" argument Phase 5.2 used for its immutability rule.

2. **Both `byId` reads override `Repository.findRow`.** §14 required every select to name its columns;
   the base class issues `select *`, so honouring §14 meant overriding it. Neither table holds a date,
   so nothing is currently wrong — the convention is adopted before there is a defect rather than after
   one, which is the opposite of how Phase 5.2 met it.

3. **A ninth copy of `row-writer.ts`**, and the smallest of the nine: the helpers this module does not
   need — `asBigInt`, `civilDateColumn`, the filter `operator` — are absent rather than carried across,
   so nothing in it is dead code waiting for a caller. The shared-helper debt is unchanged and restated.

### 26.2 §6 grew one exclusion that the plan implied but did not state

The plan excluded the condition scale, the requirements and the valuation basis from `asset_category`.
It did not say explicitly that **`registered` must not be settable by a caller**. It is not: the domain
assigns the initial status and the command has no field for it, because a caller who could choose would
register an asset directly as `retired` — a disposal nobody recorded.

### 26.3 Three of my own boundary assertions were too blunt, and were made exact rather than deleted

Each failed on the module's own legitimate code, and each was replaced with a more precise statement of
the same boundary — never removed.

| Assertion | Why it failed | What replaced it |
|---|---|---|
| "no `valuation` anywhere" | matched a Swagger description *saying* no valuation basis exists | a second projection, `IDENTIFIERS`, that strips string literals as well as comments — so a concept scan reads code, and the scans that read command and query *names* keep using the raw source, where the string is the thing under test |
| "no `dispatcher.ask`" | matched `AssetsDispatcher`, the module's own Nest wrapper | an assertion that a dispatcher may appear in **exactly one file** — `api/assets-dispatcher.ts` — so a handler or an adapter holding one still fails |
| "no `tenant_id:` anywhere" | matched infrastructure writing `tenant_id` from `transaction.tenantId`, which is the design | the same scan restricted to `application` and `api`, where a caller's request actually arrives, and widened from `tenantId:` to `tenantId` |

The third is stricter than the original in the layers that matter and correct in the one it was wrong
about, which is the point of replacing rather than deleting.

### 26.4 One file budget was met by splitting, not by exemption

`assets-lifecycle.test.ts` reached 472 lines against a 400-line budget. It was split at the seam that
was already in it — the catalogue in one file, the inventory in `assets-inventory.test.ts` — with no
assertion lost and no rule exempted.
