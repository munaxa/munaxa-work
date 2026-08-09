# Phase 5 — Employment & Workforce Assignment: Definition of Ready

**Status: planning checkpoint. No code has been changed.** This document is what
`06_PHASE_5_EMPLOYMENT.md` §51 and `27_DEVELOPMENT_PROTOCOL.md` Step 2 require before
implementation begins: the analysis, the plan, the risks, and the ambiguities that need a decision
before a line is written.

Twelve ambiguities are listed in §12. **Nine of them change business behaviour**, and the
specification is silent or self-contradictory on each. Implementation stops here until they are
answered.

---

## 1. Repository analysis

The repository is real and considerably further along than a phase document alone would suggest.
Everything below was read, not assumed.

### Workspace

```text
apps/       api (NestJS 11), admin (Next.js), employee-portal, manager-portal, mobile (Flutter)
packages/   kernel, config, contracts (empty), persistence, sdk (empty), testing,
            country-packs (empty), modules/{identity, organization, people}
prisma/     schema.prisma (811 lines, 4 migrations), sql/row-level-security.sql
scripts/    check-standards, check-architecture, check-localization, check-dependencies
tooling/    eslint/standards.mjs, typescript/standards.json
```

`pnpm verify` = standards → format → lint → typecheck → test → build.

### What is already built

| Module | Owns | Tables |
| ------ | ---- | ------ |
| `identity` (Phase 2) | Workforce user, tenant membership, invitation, portal access, **employment link**, delegation, business profile, user preference | 8 |
| `organization` (Phase 3) | Unit types, units, placements (effective-dated), legal entity, financial centres, job positions, position establishment, calendars, tenant settings | 10 |
| `people` (Phase 4) | Person, names (effective-dated), identifiers, nationalities, contacts, addresses, emergency contacts, preferences, capabilities, history, tags, notes, duplicate candidates | 13 |

31 tables, all tenant-scoped, all under row-level security applied by the migration that creates
them (ADR-0030). Phase 4 shipped 719 tests.

### The conventions Phase 5 must follow, verbatim

- **Module-first layout** (ADR-0023): `packages/modules/<module>/src/{domain,application,infrastructure,contracts,api}`.
  Layer direction `domain ◄ application ◄ infrastructure ◄ api` is a lint error to violate.
  `domain` and `application` import no framework, no ORM, no transport.
- **CQRS pipeline** in the kernel: handlers declare `commandName` + `permission`; one shared
  `Dispatcher` and one shared `ModuleRegistry` assembled in `apps/api/src/identity/identity.module.ts`.
  Permissions and navigation are *derived* from registered modules — never hand-registered.
- **Stores as application-owned ports**: `<module>-ports.ts` declares interfaces the infrastructure
  implements; every method takes the `Transaction`. This is what lets every use case be tested
  against in-memory fakes with no database.
- **Aggregates** extend a module-local `TenantScopedAggregate`, return `Result`-style
  accept/refuse, and `record(...)` domain events pulled into the transaction and dispatched after
  commit.
- **Effective dating** is the kernel's `Timeline` (non-overlap enforced), wrapped by a module-local
  `VersionedChild` base — People's `versioned-child.ts` is the reference implementation.
- **Rejections carry catalogue keys, never sentences**; `locales/{en,ar}.json` completeness is a CI
  gate.
- **Schema gate**: every model needs `id` (UUIDv7 via `app_uuid_v7()`), `tenant_id`, the six audit
  columns, `version`, and `snake_case` mapping. RLS via `call app_protect_table('<table>')` in the
  same migration.
- **File budgets**: controller 150, use case / service 300, repository 250, everything else 400,
  function 60, complexity 10 (5 in repositories). No `TODO`, no `FIXME`, no `eslint-disable`, no
  `any`.

### Discrepancies between the phase documents and the repository

| # | Discrepancy | Resolution proposed |
| - | ----------- | ------------------- |
| D1 | The task prompt is `05_PHASE_5_EMPLOYMENT.md` **v2.0**; the repository holds `work prompts/06_PHASE_5_EMPLOYMENT.md` **v1.0, "Approved"**. They differ materially (lifecycle, scope). | Treat v2.0 as the governing instruction and the in-repo v1.0 as the approved architecture it must not contradict. Where they conflict, §12 asks. |
| D2 | `docs/PHASES.md` records Phase 4 as *Awaiting approval*, though PR #7 is merged. | Cosmetic; corrected as part of Phase 5's documentation update if approved. |
| D3 | §40 of the prompt says "use the established idempotency mechanism". **There is none.** The kernel has an `idempotencyKey` on the notification and job *ports* only. | Ambiguity A9. |
| D4 | §10 says preserve an existing employee-number policy. **None exists.** Phase 4's `person_number` is caller-supplied with a uniqueness check; the in-repo Phase 5 spec (AD-003) instead implies a generated `EMP-2026-000001`. | Ambiguity A1 — the most consequential. |

---

## 2. Phase 0–4 architecture compatibility analysis

Phase 5 is compatible with everything built, and three seams were left open *for it* by name:

1. **`identity.employment_link`** (Phase 2) already stores `employment_id` with a deliberate
   absence of a foreign key, documented as "Employment's identifier (Phase 5). Referenced by
   identity only — a foreign key here would couple this module's schema to another module's."
   Phase 5 must not add that foreign key.
2. **`FilledHeadcountPort`** (Phase 3) is implemented by `NoAssignmentsYet`, which returns zero and
   whose doc comment says Phase 5 supplies the real adapter. Phase 3's establishment projection
   reports `filled = 0` today; the Phase 4 debt register lists this as "must be addressed: Phase 5".
3. **`JobPosition`** has no occupant column, by decision (AD-006): "people occupy positions through
   Employment assignments."

Constraints inherited that shape the design:

- **A person's legal name is a join, not a column** (ADR-0037). Phase 4's own risk register warns:
  "Employment, payroll and letters will all resolve names, and each will pay the join." Employment
  must resolve names through `PersonView` with an `asOf` and must never cache one. This drives
  ambiguity A11.
- **Country comes from the legal entity, never the tenant** (ADR-0035, 00B). Employment's legal
  entity is therefore resolved *through its assignment's organizational unit*, and Employment
  itself must branch on no country code.
- **A merged person redirects but does not consolidate** (Phase 4 debt: "Revisit when Employment
  exists — Phase 5"). Employment must refuse to attach to a person carrying
  `mergedIntoPersonId`.
- **Nothing in the product authenticates yet.** Every business endpoint returns 401 until
  Platform's adapter lands. Phase 5 inherits that, unchanged, and cannot measure the authenticated
  path — the same limitation Phases 2, 3 and 4 recorded.

---

## 3. Platform dependency analysis

Consumed, never rebuilt:

| Capability | Source | How Phase 5 uses it |
| ---------- | ------ | ------------------- |
| Authentication | `PlatformAuthenticationPort` (kernel port, `UnauthenticatedPort` default) | Untouched. No new auth code. |
| Authorization | `PlatformPermissionChecker` in `apps/api` + the CQRS pipeline's central check | Employment *declares* permissions; Platform decides who holds them. |
| Tenant context | `tenant_membership` → `TenantMembershipDirectory` → `runInContext` (ADR-0032) | Employment reads `currentTenant()`; it never accepts a tenant from a caller. |
| Design system | `@munaxa/ui`, `@munaxa/tokens`, `@munaxa/theme`, `@munaxa/icons` | Admin screens only. No local components, no local tokens. |
| Configuration | `@work/config` (only place `process.env` is read) | No new variable expected. |
| Observability | `nestjs-pino`, correlation middleware | Reused as-is. |

**No Platform gap is anticipated.** Every capability Phase 5 needs is Work-specific business
behaviour or already exists. If one is discovered mid-implementation, work stops and the gap is
documented rather than duplicated (§3 of the prompt).

---

## 4. Existing model reuse analysis

**Nothing in this list is re-created.** Employment stores the relationship and references the owner.

| Concept | Owner | How Employment refers to it |
| ------- | ----- | --------------------------- |
| Person | `people` | `employment.person_id` + `PersonDirectoryPort` for the view |
| Organizational unit (department, branch, division — every level) | `organization` | `employment_assignment.unit_id` |
| Position | `organization` | `employment_assignment.position_id` |
| Cost centre | `organization` | `employment_assignment.cost_center_id` (a `financial_center` of kind `cost`) |
| Legal entity, country | `organization` | Resolved *through* the assignment's unit. No column on Employment. |
| Work location | — | **See ambiguity A6.** `organization` has no location entity; it has units and calendars. |
| Manager | `employment` (this phase) | A manager is an *employment*, not a new identity — `employment_reporting_line.manager_employment_id` |
| Tenant membership / portal access | `identity` | Untouched; linked via the existing `employment_link` |
| Calendar | `organization` | Referenced by later phases (Attendance/Leave), not by Employment |

Deliberately **not** built here: attendance, leave balances, payroll amounts, benefits enrolment,
documents, letters, disciplinary actions, loans, claims, country rules, offboarding workflow.

---

## 5. Database implementation plan

One new migration, `prisma/migrations/20260809HHMMSS_employment/migration.sql`. Additive only; no
existing table altered. Every table: UUIDv7 id, `tenant_id`, six audit columns, `version`,
explicit named indexes and foreign keys, `call app_protect_table(...)` in the same file.

### Tables

**`employment`** — the aggregate root.

```text
id, tenant_id, person_id, employment_number, status, employment_type_code,
employment_category_code, employment_class_code,
original_hire_date (date), start_date (date), end_date (date),
end_reason_code, metadata, + audit/version
```

- `person_id` FK → `person(id)`. This is the one cross-module foreign key proposed, and §37 of the
  prompt asks for it explicitly ("Employment must reference an existing Person"). It is *within the
  same schema and the same tenant*, unlike `identity.employment_link` where the reference points
  the other way. **Flagged as A12** because it is a boundary judgement.
- `employment_type_code` etc. are **tenant/country-pack codes, never enumerations this product
  ships** — consistent with `gender_code`, `relationship_code`, `identifier_type` in Phase 4 and
  required by 00B. "Full Time / Part Time / Contract" are examples in the spec, not a shipped list.
- `status` is a closed set with a `check` constraint — a lifecycle is product behaviour, not tenant
  data. Which set: **ambiguity A2.**
- Unique index `(tenant_id, employment_number) where deleted_at is null`.
- Indexes: `(tenant_id, person_id)`, `(tenant_id, status)`, `(tenant_id, start_date)`.

**`employment_status_history`** — every transition, append-only.

```text
id, tenant_id, employment_id, from_status, to_status, reason_code, note,
effective_from (date), recorded_at, recorded_by, + audit/version
```

Explicit table rather than "replay the events", because §22 requires history be *reconstructable*
and §50 forbids deriving a capability from something not built. Events are for consumers; this is
the record.

**`employment_assignment`** — effective-dated organizational placement (Versioned Child).

```text
id, tenant_id, employment_id, unit_id, position_id, cost_center_id,
work_location_* (see A6), assignment_type ('primary' | 'secondary'),
fte (decimal 5,4), reason_code, effective_from, effective_to, + audit/version
```

- Non-overlap by the kernel `Timeline` in the domain, **plus** a database guarantee: partial unique
  index preventing two open primary assignments —
  `unique (tenant_id, employment_id) where assignment_type = 'primary' and effective_to is null and deleted_at is null`.
  §15 and §37 both require this, and §37 requires it at the database as well as the domain.
- Same-tenant integrity for `unit_id`/`position_id`/`cost_center_id` is enforced in the application
  (the referenced module owns those tables) **and** by RLS, which makes a cross-tenant id
  unreadable in the first place. A cross-schema composite FK would reach into another module's
  table and is refused on boundary grounds.

**`employment_reporting_line`** — effective-dated managerial relationship.

```text
id, tenant_id, employment_id, manager_employment_id, line_type, effective_from, effective_to, ...
```

Manager is an employment, never a new identity (§16). Self-reference refused by check constraint.
Cycle prevention is a domain rule (bounded walk), not a database one. Whether more than one
concurrent line is permitted: **ambiguity A5.**

**`employment_contract`** — effective-dated legal agreement, with probation.

```text
id, tenant_id, employment_id, contract_number, contract_type_code,
start_date, end_date, probation_end_date, probation_status,
notice_period_days, working_hours_per_week, document_reference,
effective_from, effective_to, ...
```

In the in-repo approved spec's aggregate list; absent from the v2.0 prompt. **Ambiguity A4.**
Carries no money and no country rule — `notice_period_days` is a *recorded term*, never a computed
statutory one (that is Phase 11.1).

**`employment_number_sequence`** — only if numbers are generated (**A1**).

```text
tenant_id, series_key, next_value, + audit/version
```

Allocated with `select ... for update` inside the same transaction as the employment insert.

Excluded from this phase pending A4/A8: compensation and benefit reference tables.

### Prisma + gates

`prisma/schema.prisma` gains the corresponding models with `@@map` and named `@@index`.
`pnpm prisma:validate`, `pnpm db:migrate` on a clean database, and `pnpm db:reset` all run before
the phase is claimed.

---

## 6. API implementation plan

`packages/modules/employment/src/api/`, mounted by `apps/api/src/employment/employment.module.ts`,
dispatching through the **existing shared** `Dispatcher`. No second pipeline, no second framework.
All under `/api/v1`, all with OpenAPI decorators, Problem Details, validation, correlation id.

Controllers split to stay inside the 150-line budget:

| Controller | Endpoints |
| ---------- | --------- |
| `employments.controller.ts` | `POST /employments`, `GET /employments` (search), `GET /employments/:id` |
| `employment-lifecycle.controller.ts` | `POST /:id/activate`, `POST /:id/status`, `POST /:id/end` |
| `assignments.controller.ts` | `GET/POST /:id/assignments`, `POST /:id/assignments/:assignmentId/change` |
| `reporting-line.controller.ts` | `GET/POST /:id/reporting-lines` |
| `contracts.controller.ts` | `GET/POST /:id/contracts` (subject to A4) |
| `employment-history.controller.ts` | `GET /:id/history`, `GET /:id/timeline?asOf=` |
| `transfer.controller.ts` | `GET /employments/export`, `POST /employments/import` (bounded, as Phase 4) |

Route-order hazard noted from Phase 4: `/employments/export` must be declared before
`/employments/:id`, with a test asserting it — the same trap `people.controller.spec.ts` guards.

Search: server-side only, paginated with the kernel's `pagedResult`, filters on
`status`, `employmentTypeCode`, `unitId`, `positionId`, `costCenterId`, `managerEmploymentId`,
`asOf`, `term` (employment number). Person-name search is **A11**.

Changes to assignment/status/manager are `POST` sub-resource commands rather than `PATCH` of a
mutable row, because history is never overwritten (§12, §22, AD-010).

---

## 7. UI implementation plan

`apps/admin/src/employment/{api.ts, locale.ts, sections.tsx}` and
`apps/admin/src/app/employment/page.tsx`, mirroring the Phase 3 and Phase 4 screens exactly:
Server Components, typed from `@work/employment/contracts` (never module internals — a lint rule),
`@munaxa/ui` only, `?lang=` switching language *and* direction together, `?asOf=` for the historical
view, failing closed to the empty state while authentication does not exist.

Screens: employment list + server-side search; employment detail with status, current assignment,
organizational placement, manager, position, cost centre, location; assignment history timeline;
status history.

All eight states from §42 handled: loading, empty, success, validation error, authorization error,
not found, server error, conflict. WCAG 2.2 AA, keyboard navigation, RTL/LTR, responsive.

**Read-only, consistent with Phases 3 and 4** — every mutation goes through the API, and the write
screens are Phase 18/19's, as already recorded in the debt register. **Ambiguity A10** asks whether
that remains acceptable, since §41 lists screens without saying they must write.

---

## 8. Authorization plan

Declared by handlers, derived by the registry, checked centrally, refused by default. No parallel
RBAC. Following Phase 4's precedent that read granularity matters:

```text
employment.employment.read            employment.employment.manage
employment.employment.status.change   employment.employment.end
employment.assignment.read            employment.assignment.manage
employment.reporting-line.read        employment.reporting-line.manage
employment.contract.read              employment.contract.manage
employment.history.read
employment.import                     employment.export
```

`status.change` and `end` are separate from `manage` because ending an employment is the single most
consequential act in this domain and is what payroll's final settlement will later consume.
`export` is separate from `read` for the same reason it is in People.

---

## 9. Testing plan

Mirrors Phase 4's shape (719 tests) and the §46 matrix. Deterministic fixtures, no production data.

- **Domain** — status machine (every legal transition and every refused one), assignment
  non-overlap, single open primary assignment, date validity (end before start refused, effective
  ranges), probation, manager self-reference and cycle refusal, employment number immutability,
  rehire producing a second employment for one person.
- **Application** — every command against in-memory stores; authorization granted *and* denied per
  handler; tenant scope; optimistic concurrency (two conflicting updates, second refused with
  `ConcurrencyException`); refusal to attach to a merged person; refusal when a referenced unit,
  position or cost centre does not exist in this tenant.
- **Persistence (integration, real PostgreSQL)** — repository round-trips, the partial unique index
  actually refusing a second open primary assignment, indexes present, tenant filtering per table.
- **API** — 401 unauthenticated, 403 unpermitted, 400 invalid, CRUD, search, pagination, 404
  cross-tenant, 409 conflict, route ordering.
- **Security** — the six scenarios in §33 proven per table: read, modify, id inference, search,
  export, background job.
- **Regression** — the full existing suite; Phase 5 breaks nothing in Phases 0–4.
- **Performance** — measured against a seeded database (target 50,000 employments) through the
  unprivileged role with RLS in force, as Phase 4 did: list/search < 500 ms, detail < 300 ms, no
  N+1, no full-table scan on the common paths. Numbers reported as measured, including any that
  disappoint.

---

## 10. Migration plan

1. Author `prisma/migrations/<timestamp>_employment/migration.sql`. **No historical migration is
   touched.**
2. Tables, constraints, indexes, comments and `app_protect_table` in that one file, in that order.
3. `pnpm prisma:validate` → `pnpm db:reset` → `pnpm db:migrate` on a clean database, then again on a
   database already carrying Phases 0–4 data.
4. `node scripts/check-architecture.mjs` must pass on the updated schema.
5. **Rollback**: the phase is purely additive — new tables, one new package, one new portal route.
   Reverting the commit and dropping the new tables restores the previous state exactly. The one
   change outside the new module is swapping `NoAssignmentsYet` for the real filled-headcount
   adapter in `apps/api`; reverting restores zero, which is what the establishment projection
   reports today.

---

## 11. Risks

1. **No authentication implementation exists.** Every new endpoint will return 401 in a running
   deployment, and the authenticated path — including every authorization decision — will be proven
   by test only. Fourth phase running with this risk; it is the product's largest open item.
2. **Person name resolution is a join every employment screen pays** (Phase 4's own recorded risk).
   An employment list of 50 rows that resolves 50 names one at a time is an N+1 by construction.
   Mitigation depends on A11.
3. **The filled-headcount adapter changes a Phase 3 number that is currently always zero.** The
   moment it becomes real, vacancy figures change for anyone already reading them. Correct, but it
   is a visible behavioural change in a completed module.
4. **Effective-dated assignments plus a status timeline plus contracts is three timelines on one
   aggregate.** Getting "where did this person belong on this date, and who was their manager" right
   means all three agreeing. The kernel `Timeline` makes overlap unrepresentable per timeline; it
   does not make the three consistent with each other, and that is domain-rule work.
5. **Employment is the backbone every later phase consumes.** A contract published here that is
   wrong is expensive to change from Phase 6 onward. This argues for publishing a *narrow* contract
   now and widening it later rather than the reverse.
6. **Scope pressure toward Phase 10/11.** Contracts, probation and compensation references sit right
   at the boundary of Compensation and Payroll. The plan holds the line at *references without
   amounts*; A4/A8 confirm it.

---

## 12. Ambiguities requiring approval

**Nine of these change business behaviour. Implementation is stopped until they are answered.**

### A1 — Employee number policy *(highest impact)*

§10 of the prompt says preserve an existing policy and, if none exists, do **not** invent one. None
exists. The in-repo spec's AD-003 says every employment gets a unique, immutable number and shows
`EMP-2026-000001`, which leaves undefined: who allocates it, whether the year is the hire year or
the issue year, the width, whether it resets annually, whether a number is ever reused after
termination, and whether a tenant may supply its own or bring numbers from a legacy system.

- **(a) Caller-supplied, uniqueness enforced** — exactly Phase 4's `person_number`. Consistent,
  supports migration from a legacy HR system on day one, and invents nothing.
- **(b) System-generated** from a per-tenant sequence with a fixed `EMP-{YYYY}-{000000}` pattern,
  matching the spec's example literally. Requires the sequence table and forbids legacy numbers.
- **(c) Recommended: generated by default, caller override permitted, never reused, immutable
  once set.** Satisfies AD-003, keeps migration possible, and the pattern becomes tenant
  configuration rather than a product opinion. Note this puts a configuration item in
  `organization`'s `tenant_settings` (ADR-0036) — a change to a completed module, which needs
  explicit approval on its own.

### A2 — Which lifecycle *(the two specifications disagree)*

| Prompt v2.0 §11 | In-repo v1.0 (Approved) |
| --------------- | ----------------------- |
| Draft → Active → Suspended → **On Leave** → Ended | Draft → **Pending Approval** → Active → Suspended → **Terminated → Retired → Archived** |

Three separate problems:

- **"On Leave" as an employment status duplicates Leave's ownership (Phase 9).** Two modules
  answering "is this person on leave" produce two answers — precisely what `DOMAIN_OWNERSHIP.md`
  exists to prevent. **Recommendation: do not implement it as an employment status.**
- **"Pending Approval" implies Workflow (Phase 16)**, which is an explicit non-goal. It can exist as
  a status the domain refuses to leave without an explicit command, with no approval engine behind
  it — or be omitted.
- **"Ended" vs "Terminated / Retired / Archived"**: one terminal state with an `end_reason_code`, or
  three statuses. **Recommendation: one terminal state `ended` plus a tenant-supplied reason code**,
  because "retired" is a reason with statutory meaning that differs by country, and a shipped
  `retired` status is a product opinion about labour law (00B forbids it).

**Recommended set: `draft`, `pending_approval`, `active`, `suspended`, `ended`.** Needs approval —
it is neither document's set exactly.

### A3 — Concurrent employments

AD-004 requires the architecture to support concurrent employments; the same document's Business
Vision marks them "(future)". Does Phase 5 *permit* a person to hold two `active` employments now,
or model for it and refuse it?
**Recommendation: model supports it; a second active employment is refused unless the command
carries an explicit acknowledgement** — the same shape Phase 4 used for duplicate people, which is
proven and consistent.

### A4 — Contracts and probation: in or out?

The in-repo approved spec lists Contract and Probation in the aggregate; the v2.0 prompt never
mentions them and §24 says do not build document management. A contract *record* (term dates,
probation end, notice period) is not a document store.
**Recommendation: implement the contract record and probation; store a document *reference* only,
never bytes.**

### A5 — How many managers?

§16 requires manager changes and history. It does not say whether an employment may have more than
one concurrent reporting line (solid-line plus dotted-line/functional is ordinary in an enterprise).
**Recommendation: exactly one open `primary` line enforced by partial unique index, plus optional
`functional` lines** — the same shape as primary/secondary assignments, so one rule is learned once.

### A6 — Work location has no owner

§18 says "use the existing organization/location model" and §14 lists Work Location as an assignment
attribute. **`organization` has no location entity.** It has units (which can be typed as a branch or
site) and calendars.

- **(a) Recommended: the assignment's `unit_id` *is* the work location** when the unit's type is a
  physical one. Nothing new, nothing duplicated.
- **(b)** A `work_location_code` on the assignment — a tenant code, uninterpreted.
- **(c)** A real location entity — but that belongs to `organization`, is a change to a completed
  module, and needs its own ADR.

Duplicating addresses inside Employment is forbidden by §18 and is not offered.

### A7 — Filled-headcount adapter changes Phase 3 behaviour

Supplying the real `FilledHeadcountPort` adapter is required by the port's own documentation and the
debt register, but it changes a number a completed module reports (0 → actual) and touches
`apps/api`'s composition.
**Recommendation: supply it** — Phase 3 designed the seam for exactly this. Confirming, because §1
forbids modifying unrelated domains.

### A8 — Compensation and benefit references

Listed in the in-repo spec's scope; Compensation is Phase 10 and Benefits is Phase 12, both
non-goals.
**Recommendation: omit both from Phase 5.** An empty reference table nothing writes to is the "fake
completeness" §50 forbids, and Phase 10 will know the shape it needs.

### A9 — Idempotency has no established mechanism

§40 says use the established one. There is none.

- **(a) Recommended: natural-key conflict refusal** — a duplicate create is refused by the unique
  employment number, exactly as Phase 4 refuses a duplicate person number. Deterministic, no new
  infrastructure, and it is what protects a retried create today.
- **(b)** Build an `Idempotency-Key` header + storage table in Employment — but that is
  cross-cutting infrastructure landing inside one business module, which is how a second framework
  starts.

If (a) is chosen, the gap is recorded in the debt register against Phase 24, stated rather than
implied.

### A10 — Admin UI: read-only or read-write?

Phases 3 and 4 shipped read-only screens with "no administration screens for writes" recorded as
debt against Phase 18/19. §41 lists Employment screens without saying they must write.
**Recommendation: read-only, consistent with the two phases before it.** Building write screens here
would make Employment the only module with them and pre-empt Phase 18/19's design.

### A11 — Resolving person names on the employment list

Employment lists must show who somebody is; a name is an effective-dated join in `people`
(ADR-0037), and `people` publishes no batched resolver.

- **(a) Recommended: add one batched query to `people`** (`read people by ids as at a date`) —
  additive, no contract broken, but it is a change to a completed module.
- **(b)** Resolve one person at a time — an N+1 on the product's most-used list. Rejected.
- **(c)** Show no names on the list, only employment numbers. Honest, and unusable.

### A12 — A foreign key from `employment.person_id` to `person`

§37 requires "Employment must reference an existing Person" and §36 asks for explicit foreign keys.
But `identity` deliberately omitted the FK on `employment_link`, calling it schema coupling between
modules.

The two cases differ — `person_id` points at the module Employment already depends on, in the same
tenant, and the reference is Employment's own invariant — so **recommendation: keep the foreign
key**, and record the distinction in an ADR so the next module does not read the two decisions as
inconsistent.

---

## Proposed ADRs, if this plan is approved

| ADR | Subject |
| --- | ------- |
| ADR-0039 | Employment number policy — allocation, immutability, non-reuse (settles A1) |
| ADR-0040 | Employment lifecycle states, and why "on leave" is Leave's and not Employment's (A2) |
| ADR-0041 | Assignment as the sole organizational placement; work location resolved through the unit (A6) |
| ADR-0042 | Cross-module foreign keys: when a reference carries one and when it must not (A12) |

---

## What happens next

**Nothing, until §12 is answered.** On approval the sequence is: schema and migration → domain →
application → infrastructure → API → admin screens → tests at every layer → `pnpm verify` →
performance measurement against a seeded database → documentation, ADRs, module guide, ER diagram,
release notes, debt register → completion report → stop.
