# Phase 16C — Final report

## 1. Phase

**16C — Routing Resolution & Time in Workflow.**

Eleven checkpoints, **all completed**, in order and none started early:

| # | Checkpoint | |
| --- | --- | --- |
| 1 | Definition of Ready | Six contradictions, fourteen blocking decisions, six parameters |
| 2 | Domain | |
| 3 | Schema | |
| 4 | Application | |
| 5 | PostgreSQL repositories | |
| 6 | Identity cross-module contract | |
| 7 | Workflow reporting-line adapter | **Stopped**, two blockers approved, then implemented |
| 8 | API | |
| 9 | Admin UI | |
| 10 | Audit | |
| 11 | Final closure | This document |

**A naming reconciliation, recorded rather than resolved silently.** D-16C-14 approved the split as
*"Phase 16C — Routing Resolution, then Phase 16D — Time in Workflow"*. The closure brief titles this
phase *"Routing Resolution & Time in Workflow"*, which is the title recorded above. The two are
reconciled as follows and the distinction matters: **16C delivered a service-level *target* — a
question a reader may ask — and nothing that acts on time.** Every capability that makes time
*operative* — a scheduler, a timer, an expiry transition, an escalation that fires — remains 16D's
and is not built. 16D keeps its scope and its name; no part of it was absorbed here.

---

## 2. Status

**COMPLETE.**

Phase 16D has **not** started. No 16D domain code, schema, scheduler, API, Admin or escalation
implementation exists anywhere in the tree.

---

## 3. Final commits

Read from `git log c0488c9..HEAD`, in order:

| Checkpoint | Commit |
| --- | --- |
| Definition of Ready | `eaf4fd7` |
| Decision register (stopped on six parameters) | `5a7fb59` |
| 2 — Domain | `8e0b2ba` |
| 3 — Schema | `ea00725` |
| 4 — Application | `afdd8ca` |
| 5 — PostgreSQL repositories | `cff5105` |
| 6 — Identity contract | `a6cf205` |
| 7 — **Stop**, with two blocking findings | `e0e28b7` |
| 7 — B-1 and B-2 recorded in the register | `d986a4c` |
| 7 — Workflow reporting-line adapter | `12ede75` |
| 8 — API | `1412cbf` |
| 9 — Admin UI | `47484aa` |
| 10 — Audit | `e18c39f` |
| 11 — Final closure | this commit |

**Three commits deserve their position in the record.** `5a7fb59` stopped the phase before the domain
because fourteen approved decisions did not determine six parameters the code would have had to
invent. `e0e28b7` stopped it again before the adapter, because composing three approved contracts met
two of the checkpoint's own stop conditions. `d986a4c` precedes `12ede75`: the approvals were written
into the register **before** the code was written, which is why nothing in this phase rests on an
inference.

---

## 4. Scope delivered

Two capabilities, and deliberately no third.

**A step can route to the requester's manager.** The manager is resolved once, when the approval
starts, from three published contracts across two modules, and the answer is copied onto the running
step. A running approval never re-resolves.

**A step can carry a service-level target.** A whole number of hours or days, configured on the
template, copied onto the running step, counted from the instant that step began waiting. Whether it
is overdue is **derived on every read** and stored nowhere.

By the numbers:

| | |
| --- | --- |
| Migrations | **1** added — 23 total |
| Tables | **0** added — 9 total |
| Columns | **5** added |
| Indexes | **0** added |
| Workflow commands | **0** added — 12 total |
| Workflow queries | **0** added — 10 total |
| Routes | **0** added — 22 total |
| Permissions | **0** added — 9 total |
| Admin sections | **0** added — 16 total |
| Identity queries | **2** added, both on an existing permission |
| Cross-module adapters | **1** |
| Localized strings | 228 → **251**, in both languages |

**Nothing was scheduled, escalated, expired, notified, measured, or routed to a role.** `JobPort`
still has no adapter anywhere in this repository.

---

## 5. Manager routing

```
requester membership
  → identity.primary-employment-for-membership     primary, still-linked employment (P-2)
  → employment.read-employment(asOf)               primary line in force on the date (P-3, P-4)
  → identity.active-memberships-for-employment     who may actually sign
  → resolveManager                                 fail-closed, one level
  → a concrete membership
  → workflow_step.approver_membership_id           snapshot
```

**Five failure outcomes, every one failing closed.** The port's resolution outcome and Workflow's
domain refusal are separate vocabularies, and the distinction is load-bearing: the first is a fact
about the organization, the second is a rule about approvals.

| Port outcome | Domain refusal | Meaning |
| --- | --- | --- |
| `no-primary-employment` | `manager-no-primary-employment` | The requester holds no primary active employment |
| `no-manager` | `manager-not-assigned` | That employment has no manager on the primary line, on the date |
| `manager-not-a-member` | `manager-not-a-member` | Nobody holds the manager's employment |
| `manager-membership-ambiguous` | `manager-membership-ambiguous` | **Two or more** people hold it |
| `resolved`, to the requester | `manager-is-the-requester` | The requester turns out to be their own manager |

The last row is the one where the port succeeds and the **domain** refuses. Who holds an employment
is Identity's fact; whether that person may approve their own request is Workflow's rule, and keeping
them apart is what stops an adapter from making an approvals decision.

`manager-membership-ambiguous` is deliberately **distinct** from `manager-not-a-member`, because they
are opposite problems for different people to fix: one means nobody holds the job, the other means two
people do. Reporting ambiguity as absence would send an administrator to link somebody to an
employment that already has two members linked to it — a mistake that is neither theirs nor real. The
adapter contains no `[0]`, no ordering by identifier or link date, no `is_primary` preference, no
oldest-or-newest rule and no fallback: **it never manufactures a manager.** Reversing the order the
two candidates arrive in produces the same refusal.

**A manager template names nobody.** No membership, no group, and no manager-target column — whose
manager it means is fixed, not configured (P-1). This is enforced by the database:
`workflow_step_template_approver_check` refuses a `manager` row carrying either identifier.

**A running step always names a concrete membership.** `workflow_step_approver_kind_check` permits
`'membership'` and nothing else, so a manager kind cannot survive onto a row somebody is asked to
answer. The two constraints are asymmetric on purpose, and that asymmetry is the whole of manager
routing in the schema.

**Resolution happens once, at instance start**, and reading an approval enters no service grant at
all — which is stronger than "returns the same value": there is no call left to go stale. A reporting
line that moves afterwards does not move a running approval, **and the next approval reaches the new
manager**. Both halves were proved against one reorganization; the first without the second would be
satisfied by a product that had stopped resolving managers altogether.

---

## 6. Service-level behaviour

| | |
| --- | --- |
| Unit | **Elapsed time**, whole hours or whole days (D-16C-05) |
| Count | A whole integer ≥ 1 — refused, never rounded |
| Configured on | The step **template** |
| Copied to | The running **step**, when the instance starts |
| Clock starts | When **that step** becomes `awaiting` (P-5) |
| Parallel branches | Every step in a branch starts its own clock when the branch opens, so they may share an instant |
| Restarts | Never — not on escalation, delegation, retry or a sibling's decision |

**Everything time-dependent is derived on read**, from exactly three inputs — the target, `awaitingAt`
and an **explicit reading instant** the caller supplies:

- `dueAt` — the instant it falls due
- `serviceLevelState` — `none` · `within` · `overdue`
- `overdueByMinutes` — whole minutes, absent while within target

**None of it is persisted.** There is no `due_at`, no `expired`, no `breached`, no `overdue_at` and no
`elapsed_minutes` column. A stored due time would be a second record able to disagree with its own
inputs the moment a target was corrected, and a stored `expired` would need something to write it —
a scheduler this phase does not have (D-16C-01) or a synthetic actor ADR-0045 refuses (D-16C-02).

**Boundaries**, verified at the domain:

| Reading instant | Result |
| --- | --- |
| Due − 1 ms | `within` |
| **Exactly due** | **`within`** — "two hours to approve" means two whole hours |
| Due + 1 ms | `overdue` |
| Due + 3 s | overdue by **0** minutes |
| Due + 59,999 ms | **0** |
| Due + 60,000 ms | **1** |
| Due + 30 days 23 h 0.5 s | **44,580** — the half-second truncated away |

Truncated toward zero, never rounded, never a percentage, never a decimal, never negative. The reading
instant is a parameter and never a clock, so the same step read twice gives the same answer.

**No business-day support is claimed.** A two-day target elapses across a weekend. That is the stated
consequence of D-16C-05, which declined an Organization calendar dependency — not a defect.

---

## 7. Cross-module architecture

**Exactly three reads**, and no fourth, no loop, no enumeration, no recursion:

| # | Query | Owner | Permission |
| --- | --- | --- | --- |
| 1 | `identity.primary-employment-for-membership` | Identity | `identity.employment-link.read` |
| 2 | `employment.read-employment(asOf)` | Employment | `employment.employment.read` |
| 3 | `identity.active-memberships-for-employment` | Identity | `identity.employment-link.read` |

**Both permissions already existed and both are employment-scoped.**
**`identity.membership.read` was not granted**, and reaching the requester's employment through
`identity.describe-member` would have handed the approvals engine the tenant's member register in
order to read one identifier — which is precisely why B-2 authorized a second *narrow* query instead.
No wildcard and no prefix grant exists.

Each read **short-circuits**: a requester with no primary employment never reaches Employment, and an
employment with no manager never reaches Identity a second time. Asking a later question after an
earlier one has failed is how a chain acquires a fallback nobody approved.

**No directory capability was created.** There is no `getMembershipsForEmployment` as a tenant
directory, no `listManagerCandidates`, no `findUsers`, no organization-chart read, no paging of tenant
memberships, no role resolution and no recursive manager traversal.

**Ownership is unchanged.** Identity owns which employment a member holds and which member holds an
employment; Employment owns the reporting line. **Workflow owns orchestration and snapshot semantics
only** — it composes three answers and decides nothing about any of them. Workflow's package imports
nothing from `@work/identity`, `@work/employment`, `@work/organization` or `@work/recruitment`,
verified over source so a type-only import would fail too. The adapter in `apps/api` is the single
composition boundary, and an infrastructure failure **raises** rather than becoming a business
refusal: reporting an Identity outage as "you have no manager" would send somebody to fix a reporting
line that is perfectly correct.

---

## 8. Schema

One additive migration, `20260816100000_workflow_routing_resolution`.

| Table | Column | Type |
| --- | --- | --- |
| `workflow_step_template` | `service_level_count` | `integer` |
| `workflow_step_template` | `service_level_unit` | `varchar(8)` |
| `workflow_step` | `service_level_count` | `integer` |
| `workflow_step` | `service_level_unit` | `varchar(8)` |
| `workflow_step` | `awaiting_at` | `timestamptz` |

One check constraint was **replaced by a strictly wider one** — the template's approver kind gained
`manager` — which is the single shape of change that cannot reject a row that was legal before. Both
new `*_service_level_check`s enforce both-or-neither, `count >= 1`, and a unit in `('hours','days')`.
`integer`, never `numeric` or `real`: there is no fractional target for one to survive in.

**Manager routing required no manager-specific column**, because a manager template names nobody and
the resolved person lands in the `approver_membership_id` a step already had.

Explicitly absent, verified by querying every Workflow column against a pattern covering all of them
and getting an empty result:

**no `due_at` · no `expired` · no `breached` · no `manager_employment_id` · no escalation column · no
new table · no new index.**

`awaiting_at` is nullable and **not backfilled**: no approval already running has a target, so there
is nothing for a missing instant to be measured against, and a backfill would change data to no
effect.

**Final migration count: 23.**

---

## 9. Application

- **Manager resolution is part of instance-start planning** — `snapshotManager`, beside the group
  snapshot 16B established, in the same transaction as the rest of the start.
- **It is snapshotted**, onto `approver_membership_id`, and never consulted again.
- **The service-level target is copied** onto the running step, following AD-003 exactly as
  `branch_rule`, `quorum` and `condition` do: an approval under way follows the version it started on,
  and a target edited afterwards must not silently move a due time on a step somebody is answering.
- **Due-ness, state and overdue minutes are derived** in `application/workflow-views.ts` from the
  target, `awaitingAt` and one reading instant.
- **No scheduler**, no timer, no job, no cron and no worker.
- **No clock inside domain logic.** `new Date()`, `Date.now`, `now()` and `CURRENT_DATE` appear in
  none of `domain/service-level.ts`, `domain/manager.ts`, `application/workflow-views.ts`,
  `application/instance-snapshot.ts` or the adapter. The reading instant comes from the injected
  `Clock` port, read once per request, so the instance-start instant, the reading instant and every
  opening step's clock are the **same moment read once**.
- **`resolutionDateOf` is the single UTC conversion** (P-6), one line, tested around midnight.
- **No new permission and no new route.**

**The application boundary is preserved.** Workflow resolves nothing from Identity's or Employment's
repositories: it holds a `ReportingLinePort` and the adapter that implements it lives in `apps/api`,
which is the only place the three modules meet.

---

## 10. API

**Unchanged: 22 routes · 12 commands · 10 queries · 9 permissions.** Recomputed from source, not
copied from the checkpoint report. **No route was added in 16C**, and none of the endpoints the phase
might have grown exists — no `/workflow/me`, `/my-manager`, `/managers`, `/sla`, `/escalations`,
`/expiry`, `/routing` or `/analytics`.

**Every 16C read was already on the wire** before Checkpoint 8 began: the views were published in
Checkpoint 4 and Workflow's controllers return application views untouched. One write shape changed.

**`routeToRequestersManager` is the approved manager configuration capability** — a `boolean`,
deliberately, and not an approver kind. A manager template names nobody, so there is no identifier the
kind could be derived from and it has to be stated; and a boolean carries exactly one capability,
where a free `approverKind` string could be widened by a client into `role` or `external`.

**`approverKind` is not caller-controlled.** It is absent from every body, so `forbidNonWhitelisted`
refuses it outright and 16B's derivation rule is preserved exactly.

**No manager identifier is accepted anywhere**: `managerEmploymentId`, `managerMembershipId`,
`workforceUserId`, `platformUserId` and `roleId` are each **400**, asserted individually.

**Service-level validation is strict.** `@IsInt` + `@Min(1)` and a unit from the domain's own list, so
a fraction, a zero, a negative, a string count, a half-supplied object, `minutes`, `weeks` and
`business-days` are all **400**. Nothing derived is accepted either: `dueAt`, `expiresAt`, `expired`,
`breached`, `overdueByMinutes`, `escalateAfter` and `businessDays` are each 400. There is no `@Max` —
a ceiling would be a policy about how long an approval may take, invented at the edge.

**Actor identity and tenant identity both remain ambient.** No body, query or header anywhere in this
module carries either. There is no `asOf` on any read: a client that could choose the instant its
due-ness is judged against could report any step as within its target.

Ambiguity is a **422** carrying `manager-membership-ambiguous`, leaving no instance, step, history row
or queue entry behind.

---

## 11. Admin

`/workflow` remains **server-rendered and read-only**: no `use client`, `useState`, `useEffect`,
`useRouter`, `onClick` or `window.`, and no `<form>`, `<button>`, `<input>`, `<select>`, `<textarea>`,
`<dialog>`, `onsubmit` or `href=` in the rendered page. **16 sections**, unchanged in number.

It now renders: the manager configuration (the kind, and two deliberately empty approver cells with a
notice explaining that this *is* the configuration rather than missing data); the resolved membership,
**in full**; the snapshot notice; the service-level target in the unit it was configured in; the due
instant; the state; the overdue minutes — beside 16B's groups, branches, tallies, conditions, direct
and delegated decisions, both queues and the timeline.

**The screen does not call the resolved person a manager.** The API says `membership` and gives an
identifier; labelling the row "manager" would be the screen inferring a fact from where the identifier
came from, which is exactly the guess an auditor must not find on a page.

**No manager resolution occurs from the browser.** No request path contains `manager`, `reporting`,
`sla`, `service-level`, `routing`, `escalation`, `expiry`, `asOf` or `now=`, and no request names a
person. No employment, reporting line, department, organizational unit, manager chain, role or
directory information reaches the table.

**No SLA arithmetic occurs in the browser.** The renderer is scanned with prose stripped for `Math.`,
`toFixed`, `parseFloat`, `parseInt`, `Date.now`, `new Date`, ` / `, ` * `, ` % `, ` - `, ` + `,
`width`, `progress`, `setInterval` and `setTimeout`, and contains none. **There is no progress bar**:
a bar is elapsed-over-target rendered as a shape, and the division is the part that does not belong on
a screen — the same rule the branch tally has been held to since 16B.

**No `expired`, no countdown, no timer and no colour that changes on its own.** Two notices moved from
withheld to provided and three were **narrowed rather than deleted**; one test forbids `remind`,
`escalat`, `expire`, `notif`, `automatically`, `business day` and `continuously` inside the *claims*,
and a second **requires** those words inside the *denials* — without which a catalogue that simply
stopped mentioning reminders would pass while leaving an administrator to assume the obvious.

---

## 12. Security and tenancy

**Nine protected Workflow tables.** Row-level security **enabled and forced** on all nine, exactly
**one permissive `ALL` policy** each, with **both** `USING (tenant_id = app_current_tenant())` and
`WITH CHECK (tenant_id = app_current_tenant())` — read from `pg_policies` at closure rather than
asserted from a migration.

Every conclusion was reached under a role proved **`rolsuper = false`** and **`rolbypassrls = false`**
*before* any isolation result was believed. A superuser bypasses every policy there is, so a suite
connected as one would report that isolation holds without ever having given a policy the chance to
refuse.

**Cross-tenant reads, writes and totals are blocked** for definitions, versions, instances, steps,
decisions, history, approval groups, group members and step templates — through the production
repositories, using identifiers the two tenants deliberately share, so the boundary is tested rather
than the values. The neighbour's history total is 0 and its subject search returns its own single row.

**Composite tenant-aware foreign keys are preserved**, and this is the property they exist for:
PostgreSQL checks a foreign key without consulting row-level security, so a single-column reference
would let one tenant's row point at another's list. A member of tenant B attached to tenant A's list is
refused by `workflow_approval_group_member_group_fk`, and a step template of B naming A's list by
`workflow_step_template_group_fk`.

**No caller-supplied tenant identifier**, anywhere — not in a URL, query, body or header. The adapter
refuses outside a tenant context before asking anybody.

---

## 13. Performance

Measured in Checkpoint 10 against real PostgreSQL on an isolated database: production repositories and
mappers, the unprivileged benchmark role, RLS enabled and forced, `vacuum analyze` before measuring,
no sleeps and no fake timers. **Two tenants at every tier**, holding the same volume and the same
membership identifiers, so every read pays the cost of excluding the neighbour. Budgets are Phases
13–15', unchanged — **no budget was invented or moved.**

The fixture now carries 16C's shape: manager templates naming nobody, targets on both step tables, and
awaiting instants spread so that a mixture of steps is within and past target.

Rows per tenant at tier C: 100,000 instances · 220,000 steps · 140,000 decisions · 320,000 history.

| Workload | Budget | A (500) | B (10k) | C (100k) |
| --- | --- | --- | --- | --- |
| definition listing (active) | 100 | 24.2 | 15.7 | 15.2 |
| definition lookup by id / code | 100 | 2.3 / 2.0 | 1.7 / 1.8 | 1.4 / 1.5 |
| versions for one definition | 100 | 4.2 | 3.1 | 2.5 |
| current published version | 100 | 1.9 | 1.5 | 1.6 |
| step templates for one version | 100 | 2.7 | 2.4 | 1.8 |
| **instance listing (all)** | 100 | 6.3 | 15.9 | **124.0 — missed** |
| instance listing (running) | 100 | 4.0 | 4.0 | 13.8 |
| instances by subject | 100 | 2.9 | 2.6 | 2.3 |
| open approval for a subject | 100 | 1.9 | 1.6 | 1.5 |
| instance lookup by id | 150 | 1.6 | 1.5 | 1.3 |
| instance detail (4 reads) | 150 | 4.2 | 4.0 | 4.5 |
| steps for one approval | 150 | 1.7 | 1.6 | 1.6 |
| timeline for one approval | 150 | 3.1 | 2.4 | 3.0 |
| **pending queue for one member** | 100 | 2.5 | 4.3 | **3.8** |
| decided approvals for one member | 100 | 2.4 | 3.3 | 6.8 |
| approval status (3 reads) | 150 | 3.2 | 3.2 | 3.3 |
| approval group listing | 100 | 5.4 | 2.9 | 3.7 |
| group lookup by code / id | 100 | 1.8 / 3.1 | 1.4 / 1.3 | 1.7 / 2.3 |
| members of one group | 100 | 2.4 | 2.2 | 2.6 |
| `membersOfAll` (one statement) | 100 | 4.3 | 5.0 | 3.2 |
| steps of a branched approval | 150 | 2.0 | 3.3 | 2.0 |
| branched approval detail (3 reads) | 150 | 3.6 | 4.0 | 2.8 |
| queue for a branch approver | 100 | 2.4 | 5.9 | 4.9 |
| cohort: 200 subjects | 2k / 10k / 60k | 126.9 | 149.9 | 112.2 |

**One workload missed its budget**: the unfiltered instance listing at tier C, 124.0 ms against 100 ms,
which counts the whole tenant to produce an exact total. It is the same workload 16B recorded at
91.4 ms and flagged as debt — "met, but only just". **Not caused by 16C**: `workflow_instance` gained
no column this phase. Carried forward as debt, unfixed, in §16.

**The manager-routing query path** had no plan coverage in any module before this phase closed;
Checkpoint 10 captured it. All three reads reach an index with the **tenant inside the index
condition** rather than filtered above the scan, with no sequential scan, no `Materialize` on the one
join, and — the assertion that makes the other three mean anything — **no node reading
`never executed`**, which is what a plan captured outside a tenant context silently produces.

**16C's own cost is not visible at any tier.** The three columns ride on rows the same reads already
fetched, and manager resolution cannot happen during listing: the membership is already on the step.

---

## 14. Testing

Final uncached, serial, repository-wide run:

| Package | Tests |
| --- | --- |
| **workflow** | **672** |
| **api** | **717** |
| **admin** | **246** |
| **identity** | **171** |
| **employment** | **132** |
| **recruitment** | **74** |
| organization · people · career · learning | 141 · 168 · 294 · 235 |
| performance · compensation · payroll · leave | 127 · 122 · 80 · 71 |
| attendance · documents · onboarding · letters | 95 · 92 · 46 · 77 |
| kernel · config · persistence · testing | 150 · 20 · 20 · 23 |

**47/47 tasks · 0 failed · 0 skipped · uncached · serial.**

**No `.only` · no `any` · no disabled lint rules · no unhandled errors.** The only `it.only` and
`describe.only` strings in the repository are inside the two suites that *forbid* them, and a suite
skips only for a missing database, never for a failing assertion.

---

## 15. Defects and findings

Classified by the Checkpoint 10 audit. Findings from earlier checkpoints are not re-counted here.

### Production defects — **0**

No defect was found in the domain, application, repositories, schema, API, Admin, Identity or
Employment. Nothing in this phase's closure required a production change.

### Benchmark defects — **2**, fixed during the audit

1. `measure-workflow-performance.mjs` declared the template approver-kind vocabulary as
   `['membership','group']`; the database says `['membership','group','manager']`. The harness
   **refused to run**. That is the parity check working exactly as designed — it declined to measure a
   database whose vocabulary had moved under it — which is why the drift was caught rather than
   shipped.
2. The benchmark seeded no manager template, no target and no awaiting instant, so it measured a
   pre-16C schema and never read the three new columns back. A benchmark that seeds three columns and
   never reads one times a query over data the mapper may drop, and reports the phase as costing
   nothing because it does.

### Test-coverage gaps — **3**, closed during the audit

1. **The snapshot rule's second half.** Every suite proved a running approval keeps its manager;
   none proved a *newly started* approval reaches the **new** one. The first claim on its own is
   satisfied by a product that has stopped resolving managers altogether.
2. **The negative-space scanner had no positive control.** A broken strip or an empty file list would
   have made every absence assertion pass forever.
3. **The manager path had no query-plan coverage** in any module — three cross-module reads on every
   approval start, unplanned.

### Documentation discrepancy — **1**, documented

The Checkpoint 10 brief named `1412cbf` (Checkpoint 8) as the last implementation commit; it is
`47484aa` (Checkpoint 9). Recorded in the audit; the tree audited was the correct one.

### Earlier-checkpoint defects, for completeness

Each was found and fixed inside the checkpoint that raised it and is recorded in that checkpoint's
document: a stale `dist` masking DTO changes (CP8), a plan assertion pinning a planner tie-break
rather than a property (CP8, with a reverted intermediate attempt recorded because it was wrong), and
two files shipped unformatted because `format:check` was not among Checkpoint 4's gates (CP5).

---

## 16. Technical debt

1. **Tier C unfiltered instance listing: 124.0 ms against a 100 ms budget.** Carried from 16B, where
   it measured 91.4 ms. The cost is the exact total over the whole tenant. Two ways out exist —
   keyset pagination, or an approximate total for an unfiltered listing — and both are decisions
   rather than fixes, so neither was taken.
2. **No cohort query.** Two hundred subjects cost two hundred lookups; the benchmark measures what the
   absence costs rather than pretending a filter exists. Carried from 16B.
3. **The benchmark and the repository plan suites must not share a database.** `vacuum analyze` writes
   planner statistics that `truncate` does not remove, so a plan suite run afterwards plans a five-row
   fixture against a hundred thousand rows' worth of statistics. Checkpoint 10 used a separate
   database for exactly this reason; the constraint is documented in the harness and is still manual.
4. **`infrastructure/workflow-seed.ts` uses `now()`** and sits in the production file list although it
   is a seeding utility on no read or resolution path. Harmless, but it is the one place the module's
   "no clock in production" claim needs a footnote.

---

## 17. NOT VERIFIED

None of the following exists in executable code anywhere in the module, and none has a placeholder
control, column, port, route or screen. Each is named in the product's own prose, in both languages,
so the absence is documented rather than left to be inferred.

**Twenty-two**, carried forward from 16B's list item for item so the two are comparable:

business days · escalation · scheduled firing · `JobPort` · durable scheduler · role approvers ·
dynamic role or group directory · external approvers · notification delivery · analytics · approval
expiry · automatic delegation expiry · outbox · broker · worker · self-service portals · routing
intelligence beyond the approved manager resolution · cohort query · tenant-wide branch or tally
aggregates · volumes above 100,000 · concurrency beyond two connections · authentication through the
real Platform adapter.

**16B listed twenty-four.** Exactly two left the list, both **by delivery**: `SLA` — now a configured
target with a derived state — and `manager routing`. **None left by attrition**, and the phrase
"routing intelligence beyond the approved 16B core" is narrowed to "beyond the approved manager
resolution" rather than dropped.

`escalation` and `approval expiry` stay on this list although D-16C-06 and D-16C-07 *decided* their
semantics. A decision about what a capability would mean is not the capability: nothing escalates and
nothing expires, and a reader must not infer otherwise from the fact that the questions were settled.

Three are worth the extra sentence:

- **`expired`** is declared in `ApprovalPort`'s vocabulary and **this product never produces it**. The
  mapping is total so a reader can see the gap; the gap is not an operational state, and the Admin
  screen says so in words.
- **`JobPort`** has existed as a kernel interface since Phase 0 and **still has no adapter anywhere.**
  Its presence is a contract, not a capability.
- **Authentication.** Every business endpoint answers 401 until Platform's adapter is supplied
  (ADR-0032). The suites establish tenancy and permission behaviour against a supplied context; they
  do not establish that a real token resolves to it.

---

## 18. Deferred ownership

Assigned only where the repository or an existing specification already assigns it:

| Capability | Owner |
| --- | --- |
| Notification delivery | **Phase 17** — `communications` |
| Self-service portals | **Phases 18–19** |
| Analytics, tenant-wide aggregates | **Phase 20** |
| External system integration | **Phase 22** — `integration` |
| External approvers | Future, per the existing specification |
| Platform authentication | **ADR-0032** |
| Business-day SLA | **Not 16C.** Requires an approved Organization calendar dependency, which D-16C-05 declined |
| Approval expiry as a written state, escalation execution | **Phase 16D** — Time in Workflow |
| **Durable job runner / scheduler for `JobPort`** | **No phase owns it.** |

The last row is stated rather than resolved. `JobPort` is a **kernel contract with no Workflow
scheduler or runner implementation**, and D-16C-01 placed the durable runner outside 16C without
naming a successor. **It is not assigned to Phase 16D here**, because inventing an ownership decision
is precisely what this closure may not do. Phase 16D can be specified without one — D-16C-06 and
D-16C-07 make expiry a derived read and escalation an application-level command, neither of which
needs a scheduler — but that is 16D's specification to make, not this document's.

---

## 19. 16B invariants preserved

Every one, re-run and re-audited from the final tree:

- **Group snapshot semantics** — a list is resolved into individual steps once, when the approval
  starts; editing it never reaches an approval already running; somebody removed today still decides
  what they were asked yesterday; somebody added today receives no historical step.
- **Branch semantics** — a repeated ordinal is a branch, several steps may await at once
  (`workflow_step_awaiting_idx` remains a **plain** partial index, not a unique one), one decision per
  step, branches isolated.
- **Assigned denominator** — the approvers snapshotted at start; a non-response is outstanding and
  never subtracted.
- **Majority arithmetic** — `floor(assigned / 2) + 1`, strictly more than half, so a tie is not an
  approval. The only division in the module, floored immediately.
- **Quorum** — a whole number of responses, never a proportion; gates a rejection exactly as it gates
  an approval; approves nothing by itself; leaves the branch awaiting when unreachable.
- **First-response** — deterministic.
- **Delegated votes** — one delegated decision is one vote; the actor and the authority never collapse.
- **Condition refusals** — `all-of` only, five operators, instance context only; a missing key is not
  `false`; an unsupported or mismatched operand remains a refusal; an unevaluable condition never
  completes an approval.
- **Append-only decisions and history** — both triggers present and enforced; update, delete and
  restore all refused.
- **Tenant isolation** — nine tables, RLS forced, one policy each, both predicates.
- **No cross-module foreign keys** — eleven foreign keys, every one inside Workflow.

No weight, percentage, proportion or floating-point value is computed anywhere in the module, and 16C
added none.

---

## 20. Documentation reconciliation

| File | Change |
| --- | --- |
| `docs/PHASES.md` | Phase 16C paragraph added; the 16B paragraph's forward-looking sentence corrected |
| `docs/RELEASE_NOTES.md` | Phase 16C entry added at the top |
| `docs/DOMAIN_OWNERSHIP.md` | One row split into a delivered row and a still-unowned row |

**The correction in `PHASES.md` matters and is not cosmetic.** The 16B paragraph described 16C as
*"manager routing, SLA, escalation and approval expiry"*. Two of those four were **decided against**:
D-16C-06 made expiry observed and derived rather than written, and D-16C-07 defined escalation as a
future bounded command. Leaving the sentence would have described a phase that was never approved.
This is contradiction **C-5**, which the Definition of Ready recorded at Checkpoint 1 and closure is
the right place to resolve.

**In `DOMAIN_OWNERSHIP.md`**, the row reading *"SLA, escalation, scheduled firing, manager routing,
role approvers — not owned; no module implements any of them"* was factually wrong after this phase.
It is split: the service-level target and manager-routing orchestration are `workflow`'s as of 16C,
with the reporting line remaining `employment`'s and the membership `identity`'s; escalation,
scheduled firing, approval expiry and role approvers remain unowned.

**No completed 16A or 16B record was rewritten** beyond that one forward-looking sentence, and no
unrelated history was touched.

---

## 21. Phase 16D boundary

**Phase 16D has not begun.** No 16D domain code, schema, migration, scheduler, API, Admin or
escalation implementation exists anywhere in the tree, and none was created by this closure.

16D — **Time in Workflow** — retains its name and its scope from D-16C-14. What 16C delivered is a
*target*: a question a reader may ask, answered from two instants and an integer, every time it is
asked, and stored nowhere. What 16D would make operative is time that **acts** — an expiry that
transitions, an escalation that fires, something that runs when nobody is looking.

Any future work must respect the invariants this phase established:

1. **Snapshot at instance start.** A running approval never changes authority because organizational
   data changed later (D-16C-08).
2. **Nothing derived is persisted.** Due-ness, state and overdue minutes are computed per read from an
   explicit instant, and a second record able to disagree with the decisions must not appear.
3. **Fail closed.** An approver that cannot be resolved is a named refusal, never a silent skip.
4. **Nothing terminal fires without a human request** (D-16C-02). No synthetic actor.
5. **No completed-module change** without its own approval, by name, before implementation.
6. **The reading instant is always a parameter**, never a clock a domain function reaches for.

---

## 22. Final gates

| Gate | Result |
| --- | --- |
| `pnpm standards` | no violations · 176 models · 17 catalogues · 1,710 files, no cycles |
| `pnpm format:check` | clean |
| `pnpm lint` | 47/47 |
| `pnpm typecheck` | 47/47 |
| `pnpm build` | 27/27 |
| `prisma validate` | valid |
| `prisma migrate status` | **23 migrations**, up to date |
| `turbo run test --force --concurrency=1` | uncached · serial · **47/47** · 0 failed · 0 skipped |

0 `.only` · 0 `any` · 0 disabled lint rules · 0 unhandled errors.

---

**Phase 16C is complete. Phase 16D has not started.**
