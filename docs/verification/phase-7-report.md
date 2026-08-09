# Phase 7 — Onboarding: completion report

**Date** 2026-08-10 · **Plan** [`phase-7-plan.md`](phase-7-plan.md) · **Approved decisions** recorded
before any code was written.

Every claim below is marked with what backs it:

- **IMPLEMENTED** — built here, and covered by a test that would fail if it broke.
- **CONTRACT AVAILABLE** — the seam exists and is honoured, but the capability behind it belongs to a
  later phase and does not work today.
- **NOT VERIFIED** — believed correct, not proved by anything in this repository.

---

## 1. What was built

| | |
| --- | --- |
| Tables | 6, all under row-level security applied by the creating migration |
| Domain aggregates | 4 — plan, plan version, onboarding, task (plus two append-only value shapes: the task template and the task-history row) |
| Commands | 18 |
| Queries | 9 |
| Permissions | 14 |
| HTTP endpoints | 25 across 7 controllers |
| Source files | 63 in `@work/onboarding`, plus the API composition and the admin screen |
| Tests | **46** in the module (32 unit/application, 14 integration against PostgreSQL) and **7** more in the API |
| Repository total | 1,007 tests, all passing |

Migration: `prisma/migrations/20260810090000_onboarding/migration.sql`. It creates every table, every
index, every check constraint and the row-level security policy for all six, in one file. No
historical migration was touched, and there is no backfill: existing hires do not receive onboardings
retroactively — they appear in the awaiting-onboarding list and are started deliberately. Inventing
history is not a migration.

---

## 2. The event-delivery limitation, stated plainly

This is the finding the phase turned on, and it is recorded verbatim rather than paraphrased:

> **Current event delivery is post-commit, in-process, at-most-once, with no outbox.**

`PostgresUnitOfWork.execute` commits the transaction and *then* dispatches the events collected during
it. A process that dies between the two loses them. There is no broker, no queue, no retry and nothing
that records an event should have been delivered, so nothing can replay one. Event names are internal
constants; there is no published event contract and no cross-module subscription contract.

Nothing in this phase claims durable event delivery, exactly-once processing or outbox semantics.

**What follows for onboarding.** An onboarding is **never** guaranteed by an event:

- **Event received ≠ onboarding guarantee.**
- **Event not received ≠ onboarding failure.**

The authoritative mechanism is an **idempotent command**, and the guarantee is **reconciliation**
([ADR-0050](../adr/0050-onboarding-starts-by-command-not-by-event.md)). An event may be an
*accelerator* and nothing more. No hire event is subscribed to in this repository today, and Phase 6
was not modified to expose one.

---

## 3. The three reliability properties, and the tests that are their evidence

### 3.1 An onboarding is created when no hire event is delivered · **IMPLEMENTED**

`onboarding-reliability.test.ts` → *creates the onboarding a lost hire event never started, and never
twice*. Nothing in the test publishes or consumes anything: an employment exists, no event is
delivered, no onboarding exists, `GET /reconciliation` names the employment, `POST /reconciliation`
starts one, and a second run reports `started: 0` with one instance and one checklist in the store.

### 3.2 The start command is idempotent · **IMPLEMENTED**

`onboarding-reliability.test.ts` → *returns the same onboarding when the start command is sent twice*,
and `onboarding.controller.spec.ts` → *returns the same onboarding when the start request is retried*.
Both are successes; the second carries `alreadyExisted: true`, the same `onboardingId`, and
`tasksCreated: 0` — so the retry generated no second checklist either.

### 3.3 Two concurrent starts converge on one instance · **IMPLEMENTED**

Proved twice. In memory: `onboarding-reliability.test.ts` → *converges on one onboarding when two
starts race*, against a fake that reproduces the partial unique index **and the SQLSTATE the driver
raises**, so the branch the loser takes is exercised. Against a real database:
`onboarding-isolation.integration.test.ts` → *lets the database decide when two starts overlap, and
keeps one row* — two overlapping transactions, one fulfilled, one rejected, one surviving row.

The boundary itself:

```sql
create unique index onboarding_instance_live_employment_key
  on onboarding_instance (tenant_id, employment_id)
  where state in ('draft', 'preboarding', 'in_progress') and deleted_at is null;
```

A terminal onboarding leaves the index, so a rehire can be onboarded again — asserted by *permits a
new onboarding once the previous one has concluded*.

---

## 4. The approved decisions, and what each produced

### D-1 and D-2 — refused · **HONOURED**

Recruitment was **not** modified to publish its hire event, and no one-off cross-module event contract
was created. The event-architecture gaps are recorded in §8 and left to Phase 16/17. Onboarding's own
events exist but are **not exported** from its contracts, for the same reason.

### D-3 — Onboarding creates no Person and no Employment · **IMPLEMENTED**

`EmploymentDirectoryPort` and `PeopleDirectoryPort` expose reads only; neither has a `create`, in the
port, in the adapter, or anywhere else. `onboarding_instance` carries foreign keys to `employment(id)`
and `person(id)`, both absent from the update set. The integration suite asserts the structural half —
*refuses an instance pointing at an employment that does not exist* — so even a defect that fabricated
an identifier could not produce an onboarding for a person who does not exist. The hire saga is not
duplicated. The in-repo Phase 7 v1.0 AD-002/AD-003 are obsolete
([ADR-0047](../adr/0047-onboarding-owns-no-employment-fact.md)).

### D-4 — the reduced aggregate set · **IMPLEMENTED**

Four aggregates. No `TaskAssignment`, no `ApprovalStep`, no `ProgressTracker`: an assignment is a
column and a history row, an approval is a task kind, and progress is two aggregate queries computed
when asked.

### D-5 — completion changes no employment · **IMPLEMENTED**

`onboarding-lifecycle.test.ts` → *cancels the open tasks with the onboarding, and ends no employment*
asserts the employment is untouched. There is no path from this module to an employment write, because
the port has none.

### D-6 — notifications and documents ship as NOT VERIFIED · **HONOURED** (§5)

### D-7 — the task-kind set is closed at five · **IMPLEMENTED**

`checklist`, `acknowledgement`, `document`, `approval`, `external`, enforced by a check constraint. A
sixth is a schema change ([ADR-0049](../adr/0049-onboarding-is-not-a-workflow-engine.md)).

**No D-4 to D-7 decision conflicted with the repository's architecture or with a completed phase's
contract, so nothing was stopped and reported.**

### Plan versioning · **IMPLEMENTED**

A published version never changes, and an instance copies its tasks with owners and due dates already
resolved ([ADR-0048](../adr/0048-plan-versions-are-immutable.md)). Asserted by *copies the published
version at creation, with due dates resolved* and by the domain suite's *refuses to publish a version
holding no tasks*.

---

## 5. Kernel ports and external capabilities: what is real and what is not

| Capability | Status |
| --- | --- |
| `ApprovalPort` | **Deliberately not consumed.** An auto-approving adapter is not evidence a human approved anything (ADR-0045). An `approval`-kind task records a decision by a named human, here. `onboarding_task.approval_reference` is reserved for Phase 16 and is null today |
| `NotificationPort` | **CONTRACT AVAILABLE, not consumed. Notification delivery is NOT VERIFIED.** *Reason:* the kernel's contract addresses a workforce user, and a joiner in their preboarding week may not have one yet. No notification is sent by this phase, no notification infrastructure was built, and no screen claims a message was delivered. Onboarding raises domain events; Communications (Phase 17) subscribes when it can address a recipient |
| `DocumentPort` | **NOT VERIFIED — document storage and upload do not work.** *Reason: the `DocumentPort` adapter is not currently available or wired.* No implementation of it exists anywhere in this repository. A `document` task records a validated *reference* and names the document type it wants; no endpoint in this module accepts bytes, and no second document infrastructure was built |
| Scheduling / background jobs | **Not built.** Reconciliation is an endpoint, not a job. Phase 7 introduces no job or event infrastructure, deliberately |
| Employee Self-Service | **CONTRACT AVAILABLE, not routed.** `onboarding.read-my-tasks` and `onboarding.complete-own-task` are implemented, permissioned and tested, and deliberately have no HTTP route: both need the caller's *own* employment, and this product has no edge that resolves an authenticated member to one. Mounting them now would mean taking the employment from the request, which is precisely how somebody closes another person's task |

No duplicate approval, notification or document infrastructure was created.

---

## 6. Platform boundary

Onboarding consumes Platform through published contracts and duplicates none of it: authentication,
authorization infrastructure, tenant context, tenant isolation, security primitives, UI, tokens,
theme, configuration and observability are all used as they are. Nothing here reimplements any of
them.

Two Platform-side gaps were met and are **documented rather than worked around**:

| | Gap |
| --- | --- |
| **P-1** | **No authenticated member → employment resolution.** The execution context carries a tenant, an actor and a correlation identifier, and nothing else. This is why the two self-service operations are contracts rather than routes (§5) |
| **P-2** | **Every business endpoint returns 401** until Platform's authentication adapter is supplied. This repository authenticates nobody by design (ADR-0032), which is why the admin screen fails closed into its empty state |

---

## 7. Authorization

The Phase 6 bounded service grant is preserved and reused unchanged
([ADR-0043](../adr/0043-bounded-service-grant.md)). Onboarding's composition opens exactly two grants,
each permitting one narrow read:

| Operation | Permits | Why |
| --- | --- | --- |
| `onboarding.start-onboarding` | `employment.employment.read` | Confirm the employment is real and read its start date |
| `onboarding.start-onboarding` | `people.person.read` | Confirm the person was not merged away |
| `onboarding.reconcile` | `employment.employment.read` | Find employments that may be missing an onboarding |

No broad People or Organization permission is granted to any HR role in order to make onboarding work.
Every elevated call keeps the originating actor, the tenant and the correlation identifier — the grant
does not touch the execution context — and every elevation is logged with the operation that caused
it. No general authorization bypass was introduced.

Fourteen permissions, with five separations that are each doing work: publishing is not drafting,
starting is not managing, completing and cancelling are each their own, waiving is not completing, and
completing one's *own* task is a different permission from completing anybody's. Each is asserted by a
test in which a caller holding everything else is refused.

---

## 8. Tenant isolation

Proved as an unprivileged role that owns nothing and holds no `BYPASSRLS` — the only configuration
under which the assertions mean anything.

| Assertion | Where |
| --- | --- |
| Every one of the six tables carries a policy | `onboarding-isolation.integration.test.ts` |
| An onboarding is invisible by read, by identifier and by list to another tenant | same |
| The reconciliation read shows another tenant nothing | same |
| Tasks, their history **and their counts** are invisible across tenants | same |
| The uniqueness boundary is scoped to the tenant, so two tenants may each onboard their own employment | same |
| Cross-tenant reads, searches and writes are refused at the application layer, with 404 rather than 403 | `onboarding-authorization.test.ts` |
| Reconciliation acts only within its own tenant | same |

A count is treated as a disclosure: "how many tasks are open on that onboarding" is a question one
tenant must not be able to ask about another, and the tally assertion is there for that reason.

---

## 9. Performance, measured

`node scripts/measure-onboarding-performance.mjs` (with its dataset in
`scripts/onboarding-benchmark-data.mjs`) seeds one tenant with **100,000 employments, 250
plans, 1,000 plan versions, 20,000 onboarding instances (2,000 live) and 400,000 tasks**, then
measures each read **as the unprivileged application role, under row-level security**. Median of five
runs, on the development database:

| Query | Target | Median |
| --- | --- | --- |
| Live onboarding for one employment — *the read the idempotent start makes* | — | **16.7 ms** |
| HR task queue by role | < 50 ms | **1.9 ms** |
| Task queue for one employment | < 50 ms | **15.4 ms** |
| Overdue required tasks | < 50 ms | **1.7 ms** |
| One onboarding with its tasks | < 50 ms | **1.2 ms** |
| Progress tally for one onboarding | < 50 ms | **0.9 ms** |
| Onboarding search page | < 100 ms | **1.2 ms** |
| Onboardings with an overdue required task | < 100 ms | **1.9 ms** |
| Employments awaiting onboarding — *the reconciliation read* | < 100 ms | **1.1 ms** |

Every target is met, with the slowest measurement at a third of its budget.

**The two ~16 ms figures are honest about what they include, and it is not the module's read.** Both
resolve a benchmark employment by its number first — a lookup over 100,000 employment rows — and then
run the onboarding query. The onboarding half is sub-millisecond in both; the employment lookup is
Employment's read, which in production is a `find` by identifier rather than by number.

The overdue plan is the one worth reading, because it is the design being checked rather than a
number: `Index Scan using onboarding_task_due_idx`, 831 buffer hits, 0.67 ms execution — overdue is
computed from `due_on` against the caller's date, and there is no stored flag and nothing sweeping
one. No N+1 exists: tasks for a page of onboardings are one query, every list is paged, the export is
bounded, and every filter is a SQL predicate rather than a client-side one.

---

## 10. Quality gates

```
pnpm verify   →   standards · format:check · lint · typecheck · test · build
```

| Gate | Result |
| --- | --- |
| `check-standards` | **no violations** — file budgets, naming, no `TODO`, no `eslint-disable`, no `@ts-ignore` |
| `check-architecture` | **54 models checked, no violations** |
| `check-localization` | **7 catalogue sets complete** — every key present in `en` and `ar` |
| `check-dependencies` | **581 source files, no cycles, no unused dependencies, no unreachable files** |
| `format:check` | clean |
| `lint` | clean across every package |
| `typecheck` | clean across every package |
| `test` | **1,007 passing** (onboarding 46, API 92, and the rest of the repository unchanged), including 14 onboarding integration tests against a real PostgreSQL |
| `build` | clean, including the admin portal |

---

## 11. Production completeness

No mock data, no stub API, no fake repository, no hardcoded response, no hardcoded onboarding plan, no
simulated approval, no fake document, no fake notification, no fake event delivery, no fake
reconciliation, no placeholder endpoint and no `TODO` implementation exists in this phase's code. The
in-memory stores and the two cross-module fakes are **test infrastructure**, exported under names that
say so and used only by suites.

**This product ships no onboarding data.** No plan, no task, no reason code, no document type. A
tenant that has configured none gets an onboarding with no tasks and a screen that says so.

What does not work today is listed in §5 and §6, each marked **NOT VERIFIED** with its reason.

---

## 12. Technical debt this phase records

| | Item | Why it was not done here |
| --- | --- | --- |
| **D-1** | **No outbox, and no published event contract.** Delivery is post-commit, in-process and at-most-once | The approved decision was explicit: do not solve the event architecture in a business phase. Onboarding is built so the gap costs nothing — the command is the contract and reconciliation is the guarantee — and Phase 16/17 own the fix |
| **D-2** | **Reconciliation needs something to call it.** There is no scheduler | Phase 7 introduces no job infrastructure. An operator or the deployment's own scheduler calls the endpoint; the outcome comes back in the response rather than into a log |
| **D-3** | `row-writer.ts` is a near-copy of Recruitment's, which is a near-copy of Employment's | Hoisting it into `@work/persistence` changes a package every phase depends on. Third occurrence: the next phase to need it should extract it as its own change |
| **D-4** | **Due dates are calendar days, not working days** | Working days need Organization's calendar, which publishes no read for it. A week-end rule invented here would be country logic in a business module (00B) |
| **D-5** | **Foreign-key indexes lead with `tenant_id`, so hard deletes scan** | Every index that could support an FK check into these tables is `(tenant_id, …)`, and a delete's FK check asks for the child column alone. The product never meets this — it soft-deletes — but a future tenant-offboarding or retention sweep would. Measured while building the benchmark's cleanup, and documented in that script |
| **D-6** | **The overdue instance search is an `exists` subquery** | Correct and fast at the measured volumes (1.9 ms). If it ever is not, the answer is a materialized count, which is a stored derivation and needs its own decision |

## 13. Documentation corrected

`docs/adr/README.md` was missing rows for ADR-0043 to ADR-0046, which exist as files. They are added
alongside 0047–0050. No ADR's content was modified.

---

## 14. What Phase 7 does not include

Attendance, leave, compensation, payroll, benefits, performance, learning, career development,
offboarding, workforce relations, full document management, loans and advances, health and claims,
country compliance packs, government integrations, mobile and AI are all untouched. There is no
employee self-service and no manager self-service UI, as scoped — only the contracts a future phase
will consume. Phases 0 through 6 are unmodified.

---

## 15. Verdict

Phase 7 is complete against its approved decisions. The Onboarding domain is implemented end to end —
schema, domain, application services, persistence, API, portal screen, documentation and tests — with
every quality gate passing, every performance target met, and the phase's central risk answered rather
than described: an onboarding does not depend on an event that this product cannot promise to deliver.
It depends on a command that is safe to retry, a database constraint that decides races, and a
reconciliation that says out loud which joiners have nothing. The capabilities that genuinely do not
work — document storage, notification delivery, self-service routing — are marked **NOT VERIFIED**
with their reasons, rather than approximated by a stub that would make the report read better and the
product worse.
