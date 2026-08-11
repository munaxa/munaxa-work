# Phase 5 — Employment: completion report

**2026-08-09** · Planning checkpoint: [`phase-5-plan.md`](phase-5-plan.md)

---

## 1. Executive summary

The Employment domain is implemented: the relationship between a person and this tenant's workforce,
its lifecycle, its organizational placement on a timeline, the managerial relationship, contracts and
probation, and the history that makes all of it answerable as at a date.

Six tables, one new module, sixteen endpoints, 132 tests in the module and 15 more at the API, and
the closure of a Phase 3 seam that had been reporting zero since it was built.

**Four decisions shape everything else**, and all four were approved before a line was written:

1. **The employment number is generated here** — tenant-scoped, immutable, never reused, and never
   supplied by a caller. A customer's own number travels beside it (ADR-0039).
2. **The lifecycle is `draft → pending_approval → active → suspended → ended`**, with no `on_leave`
   (Leave's), no `retired` and no `archived` (an end reason and a retention posture, not states)
   (ADR-0040).
3. **Work location is not modelled**, because a unit and a physical place of work are different
   concepts and this product has no authoritative model of the second. No false relationship stands
   in for it (ADR-0041).
4. **No generic idempotency infrastructure was built.** Duplicate creation fails deterministically
   through a natural key and a partial unique index; request-level idempotency is not claimed.

**Phase status: COMPLETE.** Every applicable quality gate passes, including the full pre-existing
suite — 866 tests across the repository, no regression in Phases 0–4.

---

## 2. What was implemented

### Files created

**`packages/modules/employment/`** — the new module (35 source files).

```text
package.json  tsconfig.json  tsconfig.build.json  eslint.config.mjs  vitest.config.ts
locales/en.json  locales/ar.json
src/index.ts

src/domain/
  employment-vocabulary.ts     statuses, transitions, assignment and line types, validators
  employment-rejection.ts      business refusals as values, carrying catalogue keys
  employment-events.ts         the fourteen events this module publishes
  employment-aggregate.ts      the shared base and the checked value helpers
  employment-state.ts          the aggregate's state and its three request shapes
  employment-number.ts         generation, format, and the legacy number beside it
  employment.ts                the Employment aggregate
  employment-checks.ts         creation and amendment checks
  versioned-child.ts           the Versioned Child Entity pattern, on the kernel's Timeline
  employment-assignment.ts     organizational placement
  reporting-line.ts            the managerial relationship, and the cycle walk
  employment-contract.ts       contract terms and probation
  status-record.ts             the append-only status history
  employment.test.ts  timeline.test.ts

src/application/
  employment-ports.ts          stores and the two cross-module ports, declared here
  employment-permissions.ts    thirteen permissions
  employment-context.ts        context to event origin; rejection to pipeline failure
  employment-dependencies.ts   what the use cases need, injected once
  employment-guard.ts          load-writable, employable-person and unit checks
  employment.use-case.ts       create, amend, revise metadata, record a transition
  lifecycle.use-case.ts        change status; end
  assignment.use-case.ts       place; transfer, with back-dating handled properly
  reporting-line.use-case.ts   change manager, with the cycle check
  contract.use-case.ts         record a contract; conclude a probation
  transfer.use-case.ts         bounded import and export
  employment-queries.ts        search, read as at a date, read history
  employment-views.ts          domain state to published view
  employment-module.ts         the module declaration the registry derives from
  in-memory-stores.ts          fakes with the tenant filter the SQL has
  employment-test-harness.ts   the shared harness, and the two cross-module fakes
  employment-lifecycle.test.ts  employment-assignment.test.ts  employment-authorization.test.ts

src/infrastructure/
  row-writer.ts  employment-row.ts  employment-search.ts  employment.repository.ts
  child.repository.ts  child-tables.ts  employment-stores.ts  filled-headcount.ts
  employment-database.fixture.ts
  employment-persistence.integration.test.ts  employment-isolation.integration.test.ts
  employment-search.integration.test.ts

src/contracts/
  index.ts  views.ts
```

**`apps/api/src/employment/`** — `employment.composition.ts`, `employment.module.ts`,
`employment.controller.spec.ts`.

**`apps/admin/src/employment/`** — `api.ts`, `locale.ts`, `sections.tsx`; and
`apps/admin/src/app/employment/page.tsx`.

**`prisma/migrations/20260809120000_employment/migration.sql`.**

**Documentation** — `docs/modules/employment.md`, ADR-0039 to ADR-0042,
`docs/verification/phase-5-plan.md`, this report.

### Files modified

| File | Change |
| ---- | ------ |
| `prisma/schema.prisma` | Six models appended. No existing model touched |
| `apps/api/src/app.module.ts` | `EmploymentModule` mounted |
| `apps/api/src/identity/identity.module.ts` | Employment registered; the three deferred senders consolidated into one provider; Organization given Employment's filled-headcount adapter |
| `apps/api/src/identity/identity.tokens.ts` | `DEFERRED_SENDERS` replaces three sender tokens |
| `apps/api/src/organization/organization.composition.ts` | Takes a `FilledHeadcountPort` instead of constructing `NoAssignmentsYet` |
| `apps/api/package.json`, `apps/admin/package.json` | `@work/employment` dependency |
| `package.json` | `test` runs `turbo run test --concurrency=1` |
| `docs/PHASES.md`, `docs/DOMAIN_OWNERSHIP.md`, `docs/RELEASE_NOTES.md`, `docs/DEVELOPMENT.md`, `docs/adr/README.md`, `ARCHITECTURE.md` | Records updated |

**No file was deleted. No completed module's source was changed** — `NoAssignmentsYet` remains
exactly where Phase 3 put it; the composition root now chooses a different implementation of the port
it was written for.

---

## 3. Database

Six tables, one migration, additive throughout. Row-level security applied by the migration that
creates each table (ADR-0030).

| Table | Purpose |
| ----- | ------- |
| `employment` | The relationship: person, number, status, classification, dates, end reason |
| `employment_status_record` | Every transition, appended and never amended |
| `employment_assignment` | Organizational placement, effective-dated |
| `employment_reporting_line` | Who reported to whom, effective-dated |
| `employment_contract` | Contract terms and probation, effective-dated |
| `employment_number_sequence` | The tenant-scoped counter numbers are drawn from |

### The constraints that carry weight

| Constraint | What it makes impossible |
| ---------- | ------------------------ |
| `employment_one_open_per_person_key` | A second open employment for one person — *under a race*, which is what makes a duplicated create fail deterministically |
| `employment_assignment_one_primary_key` | Two primary assignments in force at once — two answers to "which department is this person in" |
| `employment_reporting_line_one_primary_key` | Two managers at once |
| `employment_number_key` | A reused or duplicated employment number |
| `employment_external_number_key` | A migration carrying one legacy number onto two employments |
| `employment_ended_is_dated_check` / `_is_explained_check` | An ended employment with no end date, or no reason. A settlement can read neither |
| `employment_person_fk` | An employment against a person who does not exist |
| `employment_reporting_line_not_self_check` | Reporting to yourself |
| `employment_contract_outcome_check` | A probation recorded as `failed` — that ends the employment instead |
| `*_period_check` (×3) | A period of no duration, which a timeline cannot answer |

Fourteen indexes, all explicitly named. `employment_assignment_position_unit_idx` exists for exactly
one query: the filled headcount Organization asks for.

---

## 4. Domain

**Aggregates** — `Employment` (root), `EmploymentAssignment`, `ReportingLine`, `EmploymentContract`,
all three children on the kernel's `Timeline`; `StatusRecordState` as an append-only entry.

**Application services** — 11 commands, 4 queries.

```text
create-employment      amend-employment       revise-metadata
change-status          end-employment
create-assignment      change-assignment
change-manager
record-contract        conclude-probation
import-employments
search  read-employment  read-history  export-workforce
```

`change-assignment` is one command rather than the four (`change-position`, `change-location`,
`change-cost-centre`, `transfer`) §38 names, because all four are the same event in the business —
somebody's placement changed on a date. The API still exposes the operations; they resolve here.

**Events** — 14, versioned, published after commit, carrying no personal data and no employment
number. Activation and ending raise a *named* event as well as the generic status change, because
those are the two later modules key off.

---

## 5. API

Sixteen paths under `/api/v1/employments`, all in OpenAPI, all guarded, all Problem Details
(RFC 9457), all with correlation and request identifiers. Listed in
[`docs/modules/employment.md`](../modules/employment.md).

Route ordering is asserted by test: `/employments/export` and `/employments/:id` are the same shape,
and Nest resolves by declaration order.

**No request body accepts an employment number.** `forbidNonWhitelisted` makes an attempt a 400
rather than a silently discarded field — asserted.

---

## 6. Authorization

Thirteen permissions, declared by handlers, derived by the registry, checked centrally, refused by
default.

Three separations are deliberate and each is asserted by test: **status change is not manage**,
**ending is not status change**, and **export is not read**.

The cross-module composition adds a consequence stated rather than discovered: creating an employment
requires `people.person.read` and placing one requires `organization.hierarchy.read`, because the
reference checks go through those modules' published queries on the shared dispatcher (ADR-0042).

---

## 7. UI

`/employment` in the admin portal: the workforce list resolved as at a date, the status and placement
timelines, and a section stating what Employment deliberately does not hold. `@munaxa/ui` only, no
local components, no local tokens. `?lang=ar` switches language and direction together; `?asOf=`
resolves the whole page at a date.

**Read-only**, consistent with the organization and people screens, and for the reason already in the
debt register: write screens are Phase 18/19's, and building them only here would make Employment the
one module with them.

---

## 8. Tests

**866 across the repository, all passing.** 147 are new.

| Suite | Tests | What it proves |
| ----- | ----- | -------------- |
| `domain/employment.test.ts` | 32 | Creation, the status machine **exhaustively over every pair**, ending, amendment, number format |
| `domain/timeline.test.ts` | 25 | Assignment rules, timeline resolution, back-dated supersession, cycle detection, contract and probation rules, status-on-a-date |
| `application/employment-lifecycle.test.ts` | 13 | Number allocation, rehire, the merged-person refusal, status history written in the same transaction, concurrency |
| `application/employment-assignment.test.ts` | 14 | Placement, transfer as a new period, back-dating bounded correctly, the two §13 questions, manager rules |
| `application/employment-authorization.test.ts` | 13 | Every permission separation, and the six §33 tenant-isolation scenarios at the application layer |
| `infrastructure/*.integration.test.ts` | 35 | Against real PostgreSQL: constraints, the partial unique indexes under a real insert, RLS per table, search resolved at a date, filled headcount |
| `apps/api/employment.controller.spec.ts` | 15 | Real dispatcher, real pipeline, real filter: CRUD, 400/401/403/404/409/422, route ordering, Problem Details with no internals |

### Tenant isolation, per §33

Every scenario, per table, against a role that **owns nothing and cannot bypass row-level security**
— asserted by `app_isolation_diagnostics()` in the suite itself, because the same tests run as a
superuser would pass whether or not isolation worked.

| Scenario | Result |
| -------- | ------ |
| Read another tenant's employment | Invisible, on all six tables |
| Read it by its exact identifier | Not found — not forbidden, which would itself disclose |
| Modify it | Zero rows affected; the row is verifiably unchanged |
| Write a row into another tenant | Refused by `with check` |
| Reach it through search | Nothing |
| Reach it through export | Nothing |
| Infer headcount from numbering | Each tenant's counter starts at one |

---

## 9. Quality gates

| Gate | Result |
| ---- | ------ |
| Architecture compliance | **PASS** — 37 models checked, no violations |
| Platform boundary | **PASS** — no Platform capability duplicated; `@munaxa/ui` only in the portal |
| Engineering standards | **PASS** — no violations (file budgets, naming, no suppressions, no TODOs) |
| Localization | **PASS** — 5 catalogue sets complete |
| Dependencies | **PASS** — 422 files, no cycles, no unused dependencies, no unreachable files |
| Format | **PASS** |
| Lint | **PASS** |
| Typecheck | **PASS** |
| Unit + integration + API tests | **PASS** — 866 |
| Migration validation | **PASS** — applied to a clean database and to one already carrying Phases 0–4 |
| Production build | **PASS** — 15 tasks |
| Security findings | None critical. §11 below |
| Fake implementations | None. Every capability claimed is backed by a real one, tested |
| Documentation | Updated |
| OpenAPI | Current — generated from the decorators on every endpoint |
| ADRs | Four written |

---

## 10. Performance

Measured on this machine against a real database seeded with **50,000 employments, 50,000
assignments and 50,000 reporting lines**, through the unprivileged application role with row-level
security in force — which is how the application actually runs.

| Operation | Median | Budget |
| --------- | ------ | ------ |
| Read one employment | 0.08 ms | < 300 ms |
| Workforce list, page of 25 | 0.06 ms | < 500 ms |
| Filter by status, page of 25 | 0.06 ms | < 500 ms |
| One employment's placement timeline | 0.05 ms | — |
| **Who was in this unit on a date** | 2.3 ms | < 500 ms |
| **Filled headcount for a position in a unit** | 0.94 ms | — |
| Page total (`count`) | 22–33 ms | — |
| Search by employment number (`ilike`) | 42–46 ms | < 500 ms |

The two slower rows are the honest ones and both are sequential scans.

**The `count` is inherent.** A page total over 50,000 rows counts 50,000 rows; the alternative is an
estimate, and an estimate on a workforce screen is a number somebody will reconcile against a payroll
run.

**The `ilike` search is the same finding Phase 4 recorded**, for the same reason: `ilike` is not
leakproof, so PostgreSQL refuses to evaluate it as an index condition ahead of the security qual — it
will not use a trigram index while row-level security is in force. That is the database protecting
tenant isolation, and it is the right trade. An index the planner declines to read is pure write
amplification, so **none was shipped**. At 50,000 employments the cost is 46 ms, inside budget and
growing linearly; the answer when it stops being inside it is the Phase 20 projection store.

The two organizational queries — the ones this phase introduced — **do** use their indexes, including
the timeline subquery resolved at a date.

**The authenticated request path remains unmeasured**, for the same reason as in Phases 2, 3 and 4:
it requires Platform's authentication adapter. Carried in the debt register.

---

## 11. Security

| Check | Result |
| ----- | ------ |
| Authentication | Platform's, through a port. This repository authenticates nobody |
| Authorization | 13 permissions, declared by every handler, checked centrally, refused by default |
| Separation of duties | Managing ≠ changing status ≠ ending; reading ≠ exporting |
| Tenant validation | RLS-enforced and proven per table, all six |
| Order of checks | Authorization before validation, in the pipeline and at the transport |
| Personal data | **Almost none.** Employment holds a `person_id` and no name, date of birth or identifier. A person's name reaches a screen through People's query, redacted by People's rules |
| Events | Carry no personal data and no employment number |
| Audit | Actor written by infrastructure from the authenticated context; `recorded_by` on every status transition cannot be supplied by a caller |
| Problem Details | Every error path; no stack trace, SQL or environment detail — asserted |
| Input validation | Every body and every query parameter, at the edge, with `forbidNonWhitelisted` |
| Secrets | None introduced. No new environment variable |

**The known residual from Phase 2 is unchanged and re-asserted here:** an authenticated member of the
tenant who lacks a specific permission and sends a malformed body still gets 400 rather than 403,
because Nest runs the global `ValidationPipe` before the CQRS pipeline's permission check. An
unauthenticated caller gets 401 regardless.

---

## 12. Platform integration

Consumed, never rebuilt: `PlatformAuthenticationPort`, `PlatformPermissionChecker`, the membership
directory that resolves the tenant (ADR-0032), `@munaxa/ui`, `@munaxa/theme`, `@munaxa/tokens`,
`@work/config`, `nestjs-pino` and the correlation middleware.

**No Platform capability is duplicated, and no Platform gap was found.** No Platform repository was
modified.

---

## 13. Technical debt

The register carried forward. Nothing has been quietly dropped.

| Item | Impact | When it must be addressed |
| ---- | ------ | ------------------------- |
| No projection store | Queries read the transactional tables | Phase 20 |
| The rule engine has no arithmetic | It decides, it does not compute | Phase 11.1 |
| `@work/contracts`, `@work/sdk`, `@work/country-packs` are empty | Placeholders | The phases that own them |
| Cache health is `not-configured` | Redis declared, unused | Whenever the first cache consumer arrives |
| No rate limiting | An unauthenticated endpoint could be hammered | Before production exposure, Phase 24 at the latest |
| The Android release build signs with debug keys | A release artefact is not distributable | Phase 19.1 |
| The authenticated request path is unmeasured | The budget is argued structurally for that path | When Platform's authentication adapter lands |
| No scheduled sweep for invitation and delegation expiry | An elapsed invitation still reads `pending` | Phase 24 |
| Portal screens for Workforce Identity are not built | The admin portal does not render the member register | Phase 18/19 |
| Attribute-level as-of history | A person's legal name is historical; other attributes are not | Phase 21 |
| Bulk import is not atomic | A file with one bad row leaves everything before it written | Phase 24. Mitigated: resumable, with a test |
| Import and export are synchronous and bounded | Beyond the limit the command refuses, by name | Phase 24 |
| The admin portal's document shell is `lang="en" dir="ltr"` | Sections mirror correctly; the `<html>` element carries the Phase 0 placeholder | Phase 18/19 |
| ~~The establishment's `filled` count is always zero~~ | **Closed by this phase** | — |
| Erasure is not implemented | A right-to-erasure request cannot be satisfied | Phase 21 |
| The disclosure record is a log, not a ledger | "Who read this passport last year" is unanswered | Phase 21 |
| A merge redirects but does not consolidate | *Narrowed by this phase*: an employment can no longer be created against a merged person, and the refusal names the survivor. Consolidating what other modules recorded is still per-record | Phase 21 |
| Name search does not use an index | 98 ms at 50,000 people, inside budget | Phase 20 |
| `PII_MATCH_SECRET` cannot be rotated without re-recording identifiers | Rotation degrades duplicate detection | When key rotation becomes operational |
| Column-level encryption at rest is not implemented | Identifier values are plaintext columns | When a key management service exists |
| No administration screens for writes | The screens read; every mutation goes through the API | Phase 18/19 |

New in this phase:

| Item | Impact | When it must be addressed |
| ---- | ------ | ------------------------- |
| **Request-level idempotency does not exist** | A retried `POST` is protected only by natural keys. A duplicated employment creation fails deterministically; a duplicated *assignment* or *transfer* at a different effective date would create a second period | Whenever Platform or the kernel provides a standard mechanism. Employment adopts it through the published contract; nothing here needs reshaping |
| **Organization publishes no single-entity read for a position or a cost centre** | Those references are stored unverified. Tenant containment rests on row-level security, so the failure mode is a reference to a row the tenant cannot read | The phase that next needs the read adds it to Organization's contract; `OrganizationDirectoryPort` is where the check then goes (ADR-0042) |
| **Person names are resolved one per row of a page** | A page of 25 employments issues 25 lookups through People's query. Bounded by page size, never by the register's size | A batched `read people by ids` in People, or the Phase 20 projection store. Not done here because it would modify a completed module |
| **The employment-number counter is Employment's own** | A second module needing a gap-free tenant-scoped counter would write a third implementation | Extract to the kernel when the second consumer arrives (ADR-0039) |
| **`pnpm test` now serializes package test tasks** | The whole suite is slower by the sum rather than the max | Whenever suites stop sharing one database — a schema per package, or a container per suite. Phase 24 |

---

## 14. Risks

1. **Platform's authentication adapter still does not exist.** The API serves 401 to every business
   endpoint, including all sixteen added here. The correct failure direction, and it means the
   authenticated path has never run outside a test. Fifth phase carrying this.
2. **Vacancy figures change the day this ships.** Establishments have reported `filled: 0` since
   Phase 3. They will now report real numbers, and a customer reading the old ones will see a
   discontinuity. It is a correction, not a regression, and it is in the release notes — but it is the
   change most likely to generate a support ticket.
3. **The cross-module permission consequence is real.** Creating an employment requires
   `people.person.read`. It is the honest composition (ADR-0042), and a customer whose HR
   administrators were granted employment permissions alone will find creation refused until the role
   is corrected. Documented rather than discovered.
4. **One open employment per person is enforced, and concurrent employments are a stated future.**
   AD-004 requires the *architecture* to support them and the same document marks them future. A
   customer needing a second concurrent contract today cannot have one; enabling it is dropping one
   index, with no data reshaped.
5. **Three timelines on one aggregate must agree.** The kernel's `Timeline` makes overlap
   unrepresentable *within* each; nothing makes placement, reporting and contract consistent *with
   each other*. Nothing in the specification requires it, and the tests assert each independently —
   but a later phase reading two at once should know it is reading two.

---

## 15. Known limitations

- **Work location is not modelled.** Deliberate, approved, and stated on the screen in both languages
  (ADR-0041).
- **Compensation and benefit references are not implemented.** Phases 10 and 12 own them; an empty
  table nothing writes to is the fake completeness §50 forbids.
- **`pending_approval` has no approval engine behind it.** It is a state, and Workflow (Phase 16)
  will drive it.
- **Position and cost-centre references are unverified.** §13 above.
- **The admin screen is read-only**, consistent with Phases 3 and 4.
- **Import is bounded at 2,000 rows and export at 5,000.** Both refuse by name beyond that.

---

## 16. Production readiness

**Ready for the next phase to build on. Not ready for production exposure**, for the same single
reason as Phases 2, 3 and 4: there is no authentication implementation. Everything else the
production-readiness criteria ask for is in place — invariants in the domain, transactional writes
with events after commit, optimistic concurrency on every mutable aggregate, tenant isolation proven
per entity across six tables, Problem Details throughout, structured logs, OpenAPI current, the ER
diagram current in the module document, four ADRs, and the limitations above stated rather than
omitted.

**Rollback path.** The phase is additive: six new tables, one new package, one new portal route, and
no change to any existing table. Reverting means reverting the commit and dropping the six tables.
The one behavioural change outside the new module is the filled-headcount adapter, and reverting
restores `NoAssignmentsYet` — which reports zero, exactly as it did before.

---

## 17. Acceptance criteria

✓ Employment references Person; Person never references Employment (AD-001)
✓ The employment number identifies an employment, not a person, and is generated, unique, immutable
and never reused (AD-002, AD-003, ADR-0039)
✓ A person may hold historical, future and — architecturally — concurrent employments; rehire creates
a new employment with a new number and the same Person (AD-004)
✓ Assignments belong to Employment; organization is referenced through them; Employment stores no
department or position directly (AD-005)
✓ No attendance (AD-006), no leave balance (AD-007), no payroll calculation (AD-008)
✓ Audit, soft delete, effective dating, optimistic concurrency and metadata on every entity (AD-009)
✓ Employment history is permanent; historical records are immutable (AD-010)
✓ Lifecycle `draft → pending_approval → active → suspended → ended`, every transition validated and
audited, with a structured tenant-supplied end reason (ADR-0040)
✓ Effective dating answers *where did this employee belong on this date* and *who was their manager
at that time*, including after a back-dated correction
✓ At most one open primary assignment and one open primary reporting line, enforced in the domain and
by partial unique index
✓ A manager is an employment, never a second identity
✓ Contracts and probation recorded, with no computed statutory rule and no document storage
✓ Country-neutral throughout: every classification, reason and contract type is a tenant or
country-pack code, and nothing branches on one
✓ Thirteen permissions, checked server-side, with ending separately guarded
✓ Six tables, tenant-first, audited, versioned, soft-deleted, UUIDv7, `snake_case`, with row-level
security applied by the migration that creates them (ADR-0030)
✓ Sixteen REST paths, all in OpenAPI, all guarded, Problem Details throughout
✓ Administration UI, bilingual and bidirectional, resolved as at a date
✓ 866 tests including tenant isolation per table, permissions granted and denied, effective dating,
concurrency and localization
✓ Production build passing, `pnpm verify` green
✓ Documentation, module guide, four ADRs, release notes and the debt register updated

**Phase 5 passes.** Awaiting approval before Phase 5.1.
