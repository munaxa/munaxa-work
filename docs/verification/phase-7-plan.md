# Phase 7 — Onboarding: Definition of Ready

**Status: planning checkpoint. No code, no schema, no migration.** The only repository change this
checkpoint makes is this file.

**Sources read.** `00_MASTER_INSTRUCTIONS.md`, `00_ENGINEERING_STANDARDS.md`,
`00B_LOCALIZATION_AND_STATUTORY_FRAMEWORK.md`, `26_ARCHITECTURE_DECISION_RECORDS.md`,
`27_DEVELOPMENT_PROTOCOL.md`, `08_PHASE_7_ONBOARDING.md` and the Phase 0–6 specifications; the
verification reports for Phases 1.1, 2, 3, 4, 5 and 6; ADR-0021 through ADR-0046 (26 in
`docs/adr/`, the rest in the ADR register); the Platform packages resolved in this workspace; and
the repository itself.

**Where a phase document and the repository disagree, the repository is authoritative**, and every
such disagreement is named in §33 and §34 rather than reconciled silently. There is one material
disagreement, and it is the most important thing in this document: the in-repo Phase 7 v1.0
specification has **Onboarding create the Person and the Employment** (its AD-002 and AD-003).
Phase 6 already does both, in a tested saga (ADR-0046). Section 4 sets out the consequence.

---

## 1. Repository analysis

### 1.1 What exists

| | |
| --- | --- |
| Modules | `identity` (2), `organization` (3), `people` (4), `employment` (5), `recruitment` (6) |
| Packages | `kernel`, `persistence`, `config`, `testing`, `contracts` (empty), `sdk` (empty), `country-packs` (empty) |
| Applications | `api` (Nest), `admin` (Next), `employee-portal`, `manager-portal` (shells), `mobile` |
| Prisma models | 48, in 6 migrations, the newest `20260809170000_recruitment` |
| Tests | 954, all passing |
| Gates | `check-standards`, `check-architecture`, `check-localization`, `check-dependencies`, then `format:check`, `lint`, `typecheck`, `test`, `build` — all clean |

### 1.2 The mechanisms Phase 7 will build on

- **Module-first layout** (ADR-0023): `packages/modules/<module>/src/{domain,application,infrastructure,contracts,api}`, with the direction `domain ◄ application ◄ infrastructure ◄ api` enforced by `tooling/eslint/standards.mjs`.
- **CQRS pipeline** in `@work/kernel`: one `Dispatcher`, one `ModuleRegistry`, handlers declaring `commandName`/`queryName` and a `permission`. Assembled in `apps/api/src/identity/identity.module.ts`.
- **Tenancy**: AsyncLocalStorage context, tenant resolved from `tenant_membership` (ADR-0032), row-level security applied by the migration that creates each table (ADR-0030) via `call app_protect_table(...)`.
- **`PostgresUnitOfWork.execute`**: fresh connection, one transaction, `set_config('app.tenant_id', …, true)`, events dispatched **only after commit**.
- **Bounded service grant** (ADR-0043): `runWithServiceGrant` + `GrantAwarePermissionChecker`, wired in the composition root with the logger as elevation observer.
- **Effective dating**: `packages/kernel/src/effective/effective-dated.ts`, and Employment's `Timeline`/versioned-child pattern.
- **Standards budgets**: controller 150 lines, repository 250, `*.use-case.ts` 300, everything else 400; complexity ≤ 10 (5 in repositories); no `any`, no `eslint-disable`, no `TODO`.

### 1.3 Facts that constrain the design, discovered in the repository rather than assumed

1. **No module publishes its domain event names or payloads.** `RecruitmentEvents` and
   `EmploymentEvents` are internal constants; neither `contracts/index.ts` exports them. There is
   today **no published contract for subscribing to another module's events.** (§4, §26, §34 D-1.)
2. **Event delivery is in-process and post-commit, with no outbox.** `InProcessEventDispatcher`
   invokes handlers after `commit`; a handler failure throws to the caller *after* the write is
   durable, and the event is then gone. Event delivery is therefore **at-most-once and not
   durable** — nothing may depend on an event alone for correctness. (§4, §26.)
3. **No `DocumentPort` adapter exists anywhere**, and neither `AutoApprovingPort` nor
   `RecordingNotificationPort` is wired into `apps/api`. The three kernel ports are declared
   contracts with no live implementation in this repository. (§17, §18.)
4. **Identity's `link-employment` and `grant-portal` take a `membershipId`**, which exists only
   after somebody accepts an invitation. A new hire has no workforce user until then, so onboarding
   can *request* an invitation and cannot complete portal provisioning synchronously. (§4.4, §33.)
5. **Organization publishes no single-entity read for a position or a cost centre** (Phase 5 debt),
   and publishes no calendar/working-day query. Due dates computed in working days would need a
   read Organization does not offer. (§11.4, §33.)
6. **`@work/contracts` and `@work/sdk` are still empty placeholders.** Cross-module contracts are
   consumed as `@work/<module>/contracts`, not through a shared contracts package.

---

## 2. Phase 0–6 compatibility analysis

| Phase | What Phase 7 consumes | What Phase 7 must not touch |
| --- | --- | --- |
| 1 — Foundation | `Dispatcher`, `ModuleRegistry`, `UnitOfWork`, `Repository`, RLS helper, ports, `Result`/`HandlerFailure`, effective dating, paging, localization catalogue | The kernel's shape. One addition is proposed in §34 D-2 and needs approval |
| 2 — Identity | `identity.invite-member`, `identity.link-employment`, `identity.grant-portal`, `identity.describe-member` | The membership model, the invitation lifecycle |
| 3 — Organization | `organization.unit-ancestry` (existence), `organization.tenant-settings` (language, calendar, time zone) | Units, positions, calendars |
| 4 — People | `people.read-person`, `people.search` | Person identity, identifiers, the protections of ADR-0038 |
| 5 — Employment | `employment.read-employment`, `employment.search`, and — only where an onboarding task genuinely completes an employment fact — `employment.change-status` | Employment status, assignments, employee number, contracts, reporting lines. **Phase 5 is not modified** |
| 6 — Recruitment | `recruitment.read-application` and the hire outcome | The hire saga, candidate model, offers. **Phase 6 is not modified, and not reopened** |

Nothing in Phases 0–6 requires modification for the design in this plan **except** the two items
raised for approval in §34 (publishing Recruitment's hire event as a contract, and the kernel
addition that would let it be consumed). Both are additive; neither changes existing behaviour. If
either is refused, §4.3 gives the fallback that needs no change to any completed phase.

---

## 3. Platform contract analysis

Resolved in this workspace: `@munaxa/platform@1.0.0` (tokens, themes, typography, icons, UI
primitives, patterns, layouts), re-exported through `@munaxa/ui@1.0.0` and `@munaxa/theme@1.0.0`,
plus `@munaxa/config-eslint` and `@munaxa/config-typescript`.

- **Platform supplies design and standards. It supplies no business capability.** There is no
  Platform workflow engine, document service, notification service, scheduler or task queue in the
  packages this repository consumes.
- Consequently **every A5/A6/A7 capability that "uses an existing Platform contract" resolves to a
  *kernel port*, not to a Platform package** — and those ports have no live adapter (§1.3.3).
- The admin screens will use `@munaxa/ui` components, `@munaxa/theme` tokens and the shell/layout
  exports, exactly as the Organization, People and Employment screens do.
- Authentication remains `UnauthenticatedPort` until Platform supplies an adapter (ADR-0032), so
  every Phase 7 endpoint answers 401 in this repository. That is stated, never worked around.

---

## 4. Recruitment integration analysis (A2)

### 4.1 What Phase 6 actually leaves behind

The hire saga ends with, in one transaction: `recruitment_application.status = 'hired'`,
`hire_state = 'completed'`, `employment_id` set (write-once, unique),
`recruitment_candidate.person_id` set (write-once, unique), the requisition's `headcount_filled`
incremented, and one event raised — `recruitment.candidate.hired`, carrying exactly
`{ applicationId, candidateId, vacancyId, personId, employmentId }`.

That payload is precisely what an onboarding instance needs. Two problems stand between it and
Phase 7, both established in §1.3: the event name is **not published**, and event delivery is
**not durable**.

### 4.2 The proposed transition — a command, with the event as an accelerator

**Onboarding starts by an idempotent command, not by an event.**

```
recruitment.hire-candidate  ──commits──►  application.hire_state = 'completed'
                                              │
        (a) event recruitment.candidate.hired ─┼─► onboarding.start-onboarding   (fast path)
        (b) reconciliation query / operator ───┘        (idempotent, converging)
```

- `onboarding.start-onboarding { applicationId?, employmentId, personId, planId?, plannedStartDate }`
  is the single entry point. It is **idempotent on `employment_id`**: a unique index means one
  onboarding instance per employment, and a second call returns the existing instance rather than
  creating a second or failing.
- The **fast path** is an event handler that sends that command. If the event is lost, nothing is
  wrong — only late.
- The **safety net** is a query: hired applications with no onboarding instance. Exposed as a
  filter on the onboarding search (`?awaitingOnboarding=true`) and answerable in one indexed read.
- **No duplicate Person or Employment can be created by this path**, because Onboarding creates
  neither (§5) — it references the identifiers the hire already produced.
- Tenant scope, audit and retry safety come from the ordinary pipeline: the command is tenant-scoped
  like every other, the actor is the authenticated human or the system context of the event handler,
  and RLS bounds every read.

### 4.3 If publishing the event is refused

Then the event handler is not built, and the fast path is simply absent: onboarding is started by
an HR user from the "awaiting onboarding" list, or by an operator running the same command. Every
guarantee above survives; only the latency changes. **This is the fallback that requires no change
to any completed phase**, and the plan is deliberately written so the phase can ship on it.

### 4.4 What Onboarding does *not* do at the transition

- It does not create a Person (Phase 6 did, through People's service).
- It does not create an Employment (Phase 6 did, through Employment's service).
- It does not re-run matching, or read Recruitment's tables.
- It does not create a workforce user. It may *request an invitation* through
  `identity.invite-member`; the membership only exists once the human accepts, so linking and
  portal grant are a **later**, separately triggered step, not part of starting onboarding. The
  in-repo spec's "Portal Access Provisioned" stage is therefore modelled as a **task with an
  external completion**, not as a synchronous orchestration step.

---

## 5. Employment integration analysis (A1)

**The ownership line, stated field by field.**

| Fact | Owner | How Onboarding uses it |
| --- | --- | --- |
| Employment identity, employee number | Employment | Referenced by `employment_id`. Never copied |
| Employment status (`draft`→`active`→…) | Employment | Read. An onboarding task may *request* activation through `employment.change-status`; onboarding never writes the status itself and never activates automatically on completion |
| Assignment (unit, position, cost centre, FTE) | Employment | Read as at a date, for display |
| Manager / reporting line | Employment | Read, to resolve who a manager-owned task belongs to |
| Contract, probation | Employment | Read. Onboarding stores no contract terms |
| Original hire date, start date | Employment | Read. **Onboarding never overwrites an Employment date** (A13) |
| Person identity, names, identifiers | People | Referenced by `person_id`. No copy, no cache |
| Organization hierarchy | Organization | Referenced by identifier; existence checked through the published query |

**Onboarding owns exactly four things**: the onboarding *instance* (the process for one employment),
the *plan* and its versions (what has to happen), the *tasks* of a running instance (what remains,
who owns it, when it is due, whether it is done), and the *record of completion or cancellation*.

An onboarding instance is deliberately **not** a second employment record: it carries no status
column that shadows Employment's, no unit column, no manager column and no employee number. What it
carries is a `plannedStartDate` — onboarding's own planning date — and pointers.

---

## 6. Domain boundary

**Owns.** Onboarding plan; plan version; task template; onboarding instance; onboarding task; task
assignment; task completion; instance completion; instance cancellation; onboarding progress.

**References, never owns.** Person, employment, organizational unit, position, manager, candidate,
application, workforce membership, document, notification, approval.

**Never becomes.** A general workflow engine (§16), a document management system (§17), a messaging
system (§18), a scheduler, a second permission system, or the owner of any fact another module
already owns.

**Explicitly out of Phase 7**: Attendance, Leave, Payroll, Benefits, Performance, Learning,
Offboarding, ESS UI, MSS UI, mobile, AI, and any country-specific onboarding requirement (a
statutory onboarding step is a country pack's, Phase 11.1's — Onboarding ships no country logic and
no shipped task list, per 00B).

---

## 7. Aggregate model

Five aggregates. The in-repo spec lists six roots including `TaskAssignment`, `ApprovalStep` and
`ProgressTracker`; this plan reduces those, and §33 records why.

| Aggregate | Root of | Why it is a root |
| --- | --- | --- |
| **OnboardingPlan** | plan identity, code, name, status | Independently created, versioned and retired. Referenced by instances that must not change when it does |
| **OnboardingPlanVersion** | the frozen definition: task templates, ordering, dependencies, offsets, required flags | Immutable once published. It is what a running instance was copied from, and what an auditor reads (§10) |
| **Onboarding** (the instance) | one process for one employment: plan version reference, planned start date, state, completion, cancellation | The consistency boundary for "is this onboarding complete", which depends on its tasks |
| **OnboardingTask** | one unit of work in one instance: owner, due date, status, completion, note | Completed independently and concurrently by different people; making it part of the instance aggregate would serialize a task list ten people work on at once |
| **OnboardingTaskEvent** | append-only history of a task's movements | Not an aggregate — an append-only child, like Recruitment's `application_event` |

**Not aggregates, deliberately:** `TaskAssignment` is a *field* on a task (owner kind + reference) plus
a history row — an assignment with a lifecycle of its own is a table nobody queries.
`ProgressTracker` is a **projection over tasks**, never a stored row: a stored progress counter is a
second answer that goes stale the first time a task moves. `ApprovalStep` belongs to Workflow
(§16) — Onboarding records that an approval-kind task was decided, and by whom.

---

## 8. Onboarding lifecycle

```
        (hire completed in Recruitment)
                    │
                    ▼
   draft ─────► preboarding ─────► in_progress ─────► completed
     │               │                  │
     └───────────────┴──────────────────┴──────────► cancelled
```

| State | Means | Entered by |
| --- | --- | --- |
| `draft` | The instance exists, tasks have been generated, nothing has been sent to anybody | `start-onboarding` |
| `preboarding` | Work is live *before* the employment start date (§13) | `begin-preboarding`, or automatically at start when the plan has preboarding tasks |
| `in_progress` | On or after the actual employment start date | `begin-onboarding`, or the first task completed on/after the start date |
| `completed` | Every **required** task is in a terminal state and completion was recorded (§14) | `complete-onboarding` |
| `cancelled` | The onboarding will not finish (§15) | `cancel-onboarding` |

Transitions are a closed table checked in the domain and by a check constraint, exactly as
Recruitment's statuses are. `completed` and `cancelled` are terminal; reopening is a new instance,
not an edit. **No transition here changes an Employment status.**

---

## 9. Plan model (A3)

```
OnboardingPlan (code, name, status: draft|active|retired)
   └── OnboardingPlanVersion (versionNumber, publishedAt, publishedBy, status)
          └── OnboardingTaskTemplate (sequence, code, title, ownerKind, kind,
                                      required, dueOffsetDays, dueAnchor,
                                      dependsOnTemplateCode?, documentTypeCode?)
```

- A plan is **tenant-configurable and nothing is shipped** (AD-005, 00B). No task list, no plan and
  no code is seeded by this product; a tenant with no plan gets an onboarding instance with no tasks
  and a screen that says so.
- `dueOffsetDays` + `dueAnchor` (`plan_start` | `employment_start`) is how a template says "three days
  before the start date" without hardcoding a date.
- `dependsOnTemplateCode` expresses a dependency **within one version** as a single predecessor.
  A general dependency graph is refused: it is a workflow engine in disguise (§16), and one
  predecessor covers "you cannot collect the signed contract before it is issued".
- `required` is the flag completion depends on (§14). `optional` tasks never block.
- Bilingual `title`/`description` (`en` + `ar`) enforced in the domain and by a check constraint, as
  every authored text in this product is.

## 10. Plan versioning

**A running instance is never changed by editing a plan.** Two mechanisms together:

1. **Versions are immutable once published.** Editing a published version is refused; the operation
   is "create the next version", which copies the previous one as a starting point.
2. **An instance copies its tasks at creation.** Tasks are rows on the instance, generated from the
   version's templates and thereafter independent. The instance also *records which plan version it
   came from*, so "what were we asking of joiners last March" is answerable.

Consequences, stated because they are the trade-off: a correction to a published version does not
reach instances already running — a deliberate task, `add-task`, adds one to a running instance and
is audited as such. There is **no** "re-sync instance with plan" operation; it is exactly the
behaviour A3 forbids.

## 11. Task model (A11's inputs, A3's tasks)

### 11.1 Shape

`onboarding_task`: instance, template code (nullable — an ad-hoc task has none), sequence, title
and description (bilingual), `kind`, `owner_kind` + `owner_ref`, `required`, `due_on` (civil date),
`status`, `completed_at`, `completed_by`, `completion_note`, `document_reference?`,
`approval_reference?`, metadata, plus tenant/audit/version.

### 11.2 Status

`pending → in_progress → done`, with `blocked` (a predecessor is not done), `waived` (an authorized
person decided it does not apply, with a reason) and `cancelled` (the instance was cancelled).
`overdue` is **not a status** — it is `due_on < today && status not terminal`, computed in the
query. A stored overdue flag needs a sweeper and is wrong between sweeps.

### 11.3 Kinds (A5)

| Kind | Meaning | Completion |
| --- | --- | --- |
| `checklist` | Somebody does a thing and says so | A human marks it done |
| `acknowledgement` | The employee confirms they have read something | Recorded with actor and instant; ESS supplies the surface later (§19) |
| `document` | A document must be provided | A **document reference** is recorded (§17) |
| `approval` | A decision is needed | Recorded as a decision with a named actor. **Routed by Workflow in Phase 16** (§16) |
| `external` | Something outside this product must happen (a laptop, a badge, a bank mandate) | A human records the outcome |

### 11.4 Due dates

Computed once at generation from the anchor and offset, stored as a civil date, and changeable only
through an audited `reschedule-task`. **Working-day arithmetic is out of scope**: Organization
publishes no calendar query (§1.3.5), and inventing a week-end rule here would be country logic in a
business module (00B). Recorded as an ambiguity (§33 Q-5) and as debt.

## 12. Task ownership (A4)

Owners are `(ownerKind, ownerRef)`:

| `ownerKind` | `ownerRef` | Resolution |
| --- | --- | --- |
| `employee` | the instance's own `employment_id` | Implicit; the new joiner |
| `manager` | the manager's `employment_id`, resolved from Employment's reporting line at generation | Snapshotted onto the task so a later reorganization does not silently move history; a `reassign-task` moves it deliberately |
| `employment` | a specific `employment_id` | Verified through Employment's read, under a grant (as Phase 6 verifies interviewers) |
| `role` | a permission-bearing role code — `hr`, `it`, `finance` | A **queue**, not a person: anybody holding the matching permission may complete it |
| `unit` | an organizational unit identifier | A queue for that unit's holders |

Two things this deliberately does not do: it does not create a generic assignment engine, and it
does not invent a group/team entity. `role` and `unit` are queues resolved by permission at query
time, which is what makes "the IT onboarding queue" work without a new directory.

## 13. Preboarding model (A10)

**Yes, preboarding exists — and it changes nothing about employment.**

```
hire completed ──► onboarding (draft) ──► preboarding ──► [employment start date] ──► in_progress
```

- Preboarding is a **state of the onboarding instance**, not a state of the employment. The
  employment stays exactly as Employment left it; nothing in Phase 7 activates it.
- A task template may be anchored to `employment_start` with a negative offset, which is what makes
  it a preboarding task. The instance enters `preboarding` only when at least one such task exists.
- **The person is not an employee because preboarding began**, and no legal rule about when
  employment commences is invented here: the only date this product treats as authoritative for the
  employment relationship is Employment's `start_date`.
- A preboarding task owned by the joiner cannot be completed by them until they have a workforce
  identity (§4.4). Until then it is completed on their behalf by HR, recorded with the real actor.

## 14. Completion model (A11)

`complete-onboarding` is an **explicit, permissioned command**, never an automatic consequence.

It refuses unless **every required task is terminal** (`done` or `waived`). Optional tasks may be
anything; overdue required tasks block it, because "complete with three overdue mandatory tasks" is
the state that makes a completion record meaningless.

The instance records `completed_on` (civil date), `completed_at` (instant) and `completed_by`.

Published on the instance view, separately, because they are different questions:

- `requiredTotal` / `requiredDone` / `requiredOverdue`
- `optionalTotal` / `optionalDone`
- `employeeOutstanding`, `managerOutstanding`, `hrOutstanding` — counts by owner kind, which is what
  "the manager has finished but HR has not" means concretely.

**Completion changes no Employment fact.** It does not activate, amend or end an employment. If a
tenant wants activation on completion, that is an `approval`- or `checklist`-kind task whose
completion sends `employment.change-status` explicitly, audited as its own act.

## 15. Cancellation model (A12)

One command, `cancel-onboarding`, with a **reason code** (tenant/country-pack data, not a shipped
list) covering: hire withdrawn, offer rescinded before start, no-show, employment ended before
onboarding finished, and superseded.

- Cancelling sets every non-terminal task to `cancelled`; nothing is deleted.
- Cancellation is terminal. Restarting is a new instance, which the `employment_id` uniqueness
  permits only when the previous one is terminal (a partial unique index over live states).
- **Onboarding never ends an employment.** Termination is Employment's, and the exit process is
  Offboarding's (Phase 11.2). A cancelled onboarding leaves an employment exactly as it was, and the
  screen says so rather than implying the person has been removed.
- If Employment ends first, `employment.employment.ended` may cancel the instance — via the same
  event-then-command shape as §4, with the same caveat that the event is an accelerator and the
  reconciliation query is the guarantee.

## 16. Workflow boundary (A5)

**No second workflow engine.** The boundary drawn in one line: *Onboarding owns the checklist;
Workflow owns the routing.*

| Onboarding does | Workflow (Phase 16) will do |
| --- | --- |
| Hold the list of what must happen | Decide *who* approves and in what order |
| Record that an `approval` task was decided, by whom, when | Route, delegate, escalate, remind |
| Refuse completion while a required task is open | Nothing about checklists |

**Migration path, made concrete now so it is not rediscovered later.** The `approval`-kind task
carries a nullable `approval_reference` column, unused in Phase 7 exactly as
`recruitment_requisition.approval_id` is (ADR-0045). When Phase 16 lands: the task's transition to
`in_progress` calls `ApprovalPort.request`, stores the returned identifier, and the module's existing
`complete-task` command is invoked from the `ApprovalDecided` event. **No table change, no state
change, no new command.**

`AutoApprovingPort` is **not** consumed. Following ADR-0045: an approval nobody made is not evidence
of an approval, and an onboarding approval is exactly the record somebody will later rely on.

## 17. Document integration (A6)

The four things the prompt asks to be distinguished, with this repository's honest status:

| | Status here |
| --- | --- |
| **Document reference** | **IMPLEMENTED in Phase 7.** A validated opaque reference stored on a `document`-kind task, the same shape Recruitment validates |
| **Document metadata** | **Minimal.** A task carries a `document_type_code` (what was asked for) and the reference recorded. No file name, size or content type is stored — that is the document system's |
| **Actual document storage** | **NOT VERIFIED.** `DocumentPort` is declared in the kernel and **no adapter implements it anywhere in this repository**. Phase 7 stores no bytes and will not claim upload works |
| **Document signing** | **NOT AVAILABLE.** No contract for signing exists in the kernel or in any Platform package. A signed contract is modelled as an `acknowledgement` or `document` task whose completion is recorded by a human — which is a record that somebody said it happened, not a signature |

Phase 7 builds **no** document storage, no upload endpoint and no viewer. If Phase 4.1 lands first
and supplies an adapter, Onboarding consumes `DocumentPort` through the same seam with no model
change.

## 18. Communications integration (A7)

**No onboarding-specific messaging infrastructure.** The kernel's `NotificationPort` addresses a
`userId` — a workforce user.

- A **new joiner is not a workforce user** until an invitation is accepted (§4.4). Welcome messages
  and task reminders addressed to them therefore **cannot be delivered** by the current contract.
  This is the same limitation Phase 6 documented for candidates, and it is documented again rather
  than worked around.
- A **manager or HR owner is an employment**, and an employment carries no user identity in the
  current model — the same gap Phase 6 recorded for interviewers.
- Therefore Phase 7 **raises domain events** (§26) and consumes no notification port. Communications
  (Phase 17) subscribes when it can address a recipient.
- **NOT VERIFIED**: welcome messages, task reminders, deadline notifications, manager and HR
  notifications. None of them work in this repository, and the completion report will say so.

## 19. Employee Self-Service integration (A8)

No ESS UI is built. What Phase 7 must publish so Phase 18 needs no change to this module:

| ESS needs | Contract Phase 7 publishes |
| --- | --- |
| My onboarding checklist | `onboarding.read-my-tasks` — tasks whose owner resolves to the caller's own employment |
| My progress | `OnboardingProgressView`, already computed for the admin screen |
| Complete a task | `onboarding.complete-task`, with a permission an employee can hold for *their own* tasks |
| Acknowledge | The `acknowledgement` kind, recorded with actor and instant |
| Submit a document | `onboarding.record-task-document`, taking a reference |
| Required forms | Task list filtered by kind |

The self-ownership rule is designed now and enforced from the first commit: a caller holding only
`onboarding.task.complete-own` may complete a task **whose `owner_ref` resolves to their own
employment**, and nothing else. Resolving "the caller's employment" needs `identity.describe-member`
plus the employment link — available today, and used under a grant.

## 20. Manager Self-Service integration (A9)

No MSS UI. What Phase 19 will consume: `onboarding.search-tasks?ownerKind=manager&ownerRef=<their
employment>` for their queue; `onboarding.search?managerEmploymentId=` for their joiners' progress;
and the same overdue filter the admin dashboard uses. Managers see **their own reports' onboarding
only** — enforced by resolving the reporting line, not by a UI filter.

## 21. Database plan (A18)

**One new migration.** No historical migration is modified. No existing model is changed. Six new
tables, all tenant-first, audited, versioned, soft-deleted, snake_case, RLS-protected by the same
migration (ADR-0030), with `app_uuid_v7()` identifiers.

| Table | Notes |
| --- | --- |
| `onboarding_plan` | unique `(tenant_id, code)` where not deleted |
| `onboarding_plan_version` | unique `(tenant_id, plan_id, version_number)`; immutable once `published` |
| `onboarding_task_template` | child of a version; unique `(tenant_id, plan_version_id, code)` |
| `onboarding_instance` | FK to nothing outside the module; `employment_id`, `person_id`, `application_id?` as identifiers. **Partial unique index on `(tenant_id, employment_id)` where state is not terminal** — one live onboarding per employment (§4.2) |
| `onboarding_task` | child of an instance; index `(tenant_id, owner_kind, owner_ref, status)` for queues and `(tenant_id, due_on, status)` for overdue |
| `onboarding_task_event` | append-only history; no update path in code |

**Foreign keys.** Following ADR-0042: within the module, real foreign keys. Across modules, an
identifier without a key **except** where the key points *backward* to a module Onboarding already
depends on and the reference is mandatory — `onboarding_instance.employment_id → employment(id)` and
`person_id → person(id)` qualify on exactly the reasoning that admitted
`recruitment_candidate.person_id`. `application_id` is nullable and stays keyless, because an
onboarding may exist without a recruitment application (a direct hire, a migration).

**No entity is duplicated**: nothing here restates a person, an employment, a unit, a position, a
candidate or a membership.

## 22. API plan (A19)

`/api/v1/onboarding/...`, versioned, DTO-validated with `class-validator` under the global
`ValidationPipe` (`forbidNonWhitelisted`), failures mapped by one `unwrapOrThrow` — 400 malformed,
403 with the permission named, **404 for another tenant's record**, 409 stale version or conflict,
422 refused business rule. Controllers ≤ 150 lines; specific routes declared before parameterized
ones.

| Area | Endpoints |
| --- | --- |
| Plans | list, read, create, amend, retire |
| Plan versions | list, read, create next version, add/amend/remove template (draft only), publish |
| Instances | search (incl. `awaitingOnboarding`, `overdue`, `state`, `planId`, `managerEmploymentId`), read (instance + tasks + progress), start, begin preboarding, begin onboarding, complete, cancel |
| Tasks | search (owner queue, kind, status, overdue), read, complete, waive, reassign, reschedule, add ad-hoc, record document reference, record acknowledgement |
| Progress | included in the instance read and as a dashboard summary query |

Every mutating body carries `expectedVersion`. No endpoint returns a document's bytes.

## 23. Authorization plan (A15)

Permissions, all `onboarding.*`, with the separations that matter:

```
onboarding.plan.read / .manage / .publish        publishing a version ≠ editing a draft
onboarding.read / .manage                        seeing an onboarding ≠ starting one
onboarding.start                                 the act that creates an instance
onboarding.complete / .cancel                    each its own, and neither is .manage
onboarding.task.read / .manage                   managing the list
onboarding.task.complete                         completing somebody else's task
onboarding.task.complete-own                     completing one's own (ESS, §19)
onboarding.task.waive                            deciding a required task does not apply
onboarding.task.reassign
onboarding.export
```

**No broad People or Organization permission is required of an HR user.** Every cross-module read
runs under a **bounded service grant** (ADR-0043), continuing Phase 6's principle exactly:

| Operation | Grant permits | Why |
| --- | --- | --- |
| `onboarding.start-onboarding` | `employment.employment.read`, `people.person.read` | Confirm the employment and person exist in this tenant |
| generating manager-owned tasks | `employment.employment.read` | Resolve the reporting line once, at generation |
| `onboarding.assign-task` (employment owner) | `employment.employment.read` | Confirm the owner is an employment in this tenant |
| a task that requests portal access | `identity.invitation.manage` | Issue the invitation the joiner needs |
| a task that activates employment | `employment.employment.manage` | Only for the explicit activation task, never automatically |

No second authorization framework: the same `GrantAwarePermissionChecker`, the same pipeline, the
same permission vocabulary. Grants are explicit lists, cannot nest, and are logged.

## 24. Tenant isolation plan (A14)

RLS on all six tables, applied by the creating migration. Proved by an integration suite run **as an
unprivileged role that cannot bypass a policy**, mirroring Phases 5 and 6:

1. Cross-tenant instance read by identifier → not found.
2. Cross-tenant task update → refused (the read that precedes it returns nothing; a direct write
   with a foreign `tenant_id` is refused by the policy's `with check`).
3. Cross-tenant employment reference at `start-onboarding` → refused, because the Employment read
   runs in the caller's tenant.
4. Cross-tenant plan access, including "use tenant B's plan for tenant A's instance" → not found.
5. Cross-tenant export → returns only the caller's tenant, totals included.
6. **Background/scheduled work** — there is no scheduler in Phase 7 (§30). The one place the
   question arises is the event handler of §4.2, which runs inside the raising request's tenant
   context; a test asserts an event raised in tenant A creates nothing in tenant B.
7. A table-coverage test asserts **every** `onboarding_%` table has a policy, so a future table
   cannot be added without one.

## 25. Audit plan (A16)

Existing infrastructure only: `created_by`/`updated_by` written by `Repository`/`insertRow` from the
authenticated context, `version` for concurrency, soft delete, plus append-only history where the
sequence itself is the evidence.

| Action | Where the evidence lives |
| --- | --- |
| Plan created / amended / retired | Audit columns on `onboarding_plan` |
| Plan version created / published | `published_at`, `published_by`, immutable thereafter |
| Onboarding created | Audit columns + `OnboardingCreated` event |
| Task assigned / reassigned | `onboarding_task_event` row, naming both owners |
| Task completed / waived | `completed_by`, `completed_at`, reason for a waiver, + history row |
| Due date changed | History row with the old and new date |
| Required-flag change on a running instance | History row; changing it on a *published version* is impossible by construction |
| Cancellation / completion | Instance columns + history + event |
| Administrative override | Not a separate concept: every override is one of the operations above, performed by an actor holding the permission, and recorded with their name |

The actor is always taken from the authenticated context, never from a command.

## 26. Domain events (A17)

Only those with an identifiable consumer (Communications 17, Workflow 16, ESS 18, MSS 19, analytics
20):

| Event | Payload | Consumer |
| --- | --- | --- |
| `onboarding.instance.created` | instance, employment, person, plan version, planned start | 17, 20 |
| `onboarding.instance.started` | instance, state entered | 17 |
| `onboarding.instance.completed` | instance, employment, completed on | 17, 20 |
| `onboarding.instance.cancelled` | instance, employment, reason code | 17, 20 |
| `onboarding.task.assigned` | task, instance, owner kind + ref | 17, 19 |
| `onboarding.task.completed` | task, instance, kind | 17, 20 |

**`OnboardingTaskOverdue` is deliberately not published.** Overdue is derived from a date; nothing
computes it at the moment it becomes true, so an event would need a sweeper — and a sweeper is
Phase 24's. Reminders come from Communications reading the overdue *query*.

**No event carries a person's name, a document reference, an acknowledgement's text or a task note.**
Events reach consumers this module does not know and end up in their logs — the rule Phase 6 set.

## 27. UI plan (A20)

Admin only, read-first, `@munaxa/ui` + `@munaxa/theme`, bilingual with direction following language,
consistent with the Organization, People, Employment and Recruitment screens.

| Screen | Shows |
| --- | --- |
| Onboarding dashboard | Counts by state, overdue required tasks, joiners starting this week, hires awaiting onboarding |
| Plans | Plan list with active version |
| Plan version | The template list, read-only for a published version |
| Onboarding instance | State, planned and actual start dates, the plan version it came from, progress by owner kind, task list |
| Task list / detail | Owner, due date, status, history |
| Overdue tasks | The queue, filterable by owner kind |
| Timeline | The instance's task history, oldest first |

A **boundaries panel**, as every module's screen carries: what onboarding does not hold — no
employment status, no documents, no messages sent.

Write screens are Phase 18/19's; mutations go through the API. **No ESS or MSS screen is built.**

## 28. Testing plan

| Layer | What it proves |
| --- | --- |
| Domain (fakes, milliseconds) | Lifecycle transitions exhaustively; required-vs-optional completion; a published version refusing edits; due-date computation from anchor and offset; waiver requiring a reason; cancellation cascading to tasks |
| Application (through the real `Dispatcher`) | Every permission separation in §23; the self-ownership rule; idempotent `start-onboarding` returning the same instance; tasks generated from the version, not the plan; editing a plan after an instance exists changing nothing on that instance |
| Cross-module (fakes with real refusals) | Start refused for an unknown employment; manager resolution; the invitation request; the activation task calling `employment.change-status` — and **nothing** activating without it |
| Tenant isolation (real PostgreSQL, unprivileged role) | The seven assertions of §24 |
| Persistence (real PostgreSQL) | One live onboarding per employment; append-only history; civil dates surviving a round trip; a required task blocking completion at the constraint level |
| API | Route ordering, 400/403/404/409/422 mapping, `forbidNonWhitelisted` |
| Performance | §30, measured and reported |

Target: no fewer tests per unit of behaviour than Phase 6 (69 module + 8 API).

## 29. Security and privacy plan (A22)

- **Onboarding stores no personal data of its own.** No name, no address, no identifier, no date of
  birth. It stores identifiers, task text a tenant authored, and completion records.
- **A task note is the risk surface**, and it is treated as one: length-bounded, never in an event,
  never in an export that a task-queue permission alone can reach.
- **Seeing an onboarding instance does not entitle you to its documents** (A22, explicitly). A
  document reference is returned only to a caller holding `onboarding.task.read`, and the bytes are
  not obtainable through this module at all (§17).
- **Reading a task queue is not reading the joiner's record.** The queue view carries the task and
  the employment identifier — no name is joined in. Resolving a name is People's, behind People's
  permission.
- 404 rather than 403 for another tenant's record, so an identifier is not confirmed to exist.
- Export is separately permissioned and bounded, refusing by name beyond the limit.

## 30. Performance plan (A21)

Benchmarks to be measured at: **100,000 employments**, **250 plans / 1,000 published versions**,
**20,000 onboarding instances (2,000 live)**, **400,000 tasks**.

| Query | Target | Design |
| --- | --- | --- |
| HR task queue by owner | < 50 ms | `(tenant_id, owner_kind, owner_ref, status)` index |
| Overdue required tasks | < 50 ms | `(tenant_id, due_on, status)` index, `required` in the predicate |
| One instance with its tasks and progress | < 50 ms | Two reads; progress aggregated in SQL, never in the API |
| Instance search page | < 100 ms | Indexed filters, count with the same predicate |
| Dashboard counts | < 100 ms | Aggregate queries, not row loads |
| Hires awaiting onboarding | < 100 ms | Indexed anti-join on `employment_id` |

Forbidden and tested against: N+1 (tasks for a page of instances fetched in one query), unbounded
reads (every list paged, export bounded), and client-side filtering (every filter is a SQL
predicate). Measured as the unprivileged role under RLS, as Phase 6 was, with the numbers — and any
miss — in the completion report.

## 31. Migration plan

1. One migration, `2026xxxxxxxxxx_onboarding`, creating six tables, their indexes, their check
   constraints and `call app_protect_table(...)` for each. No historical migration touched.
2. `prisma/schema.prisma` gains six models; `check-architecture` must pass on all 54.
3. Backfill: **none**. Existing hires do not get onboarding instances retroactively; they appear in
   "awaiting onboarding" and are started deliberately. Inventing history is not a migration.
4. Rollback: the migration is additive; dropping the six tables removes the feature and touches
   nothing else.
5. Module registration in the composition root; the admin route added to navigation.

## 32. Risks

| | Risk | Mitigation |
| --- | --- | --- |
| R-1 | **Onboarding drifts into a workflow engine.** Dependencies, routing and escalation are each one plausible request away | §16's line, one predecessor only, `approval_reference` reserved, and the migration path written before the code |
| R-2 | **It becomes a second employment record.** A "status" here that shadows Employment's is the classic failure | §5's field-by-field table; no status, unit, manager or number column on the instance; a test asserting completion changes no employment |
| R-3 | **The event-driven start silently does nothing** — no outbox, at-most-once delivery | §4.2: the command is the contract, the event is an accelerator, the reconciliation query is the guarantee, and it is a first-class filter rather than an operations script |
| R-4 | **Notifications look implemented and are not** | §18 marks them NOT VERIFIED, no port is consumed, and no screen claims a message was sent |
| R-5 | **Documents look implemented and are not** | §17: references only, no adapter exists, no upload endpoint is built |
| R-6 | **A plan edit changes a running onboarding** | §10: immutable published versions plus copy-at-creation, with a test that edits a plan and asserts the instance is unchanged |
| R-7 | **Task queues leak personal data** | §29: queues carry identifiers, not names |
| R-8 | **Scope creep into ESS/MSS** | §19–§20 publish contracts only; no portal screen is built |
| R-9 | **Plan/version/template/task is four levels of configuration** — the shape most likely to be over-built | Templates are a flat list with one optional predecessor; no conditions, no branching, no expressions |

## 33. Ambiguities

| | Ambiguity | How this plan proceeds |
| --- | --- | --- |
| Q-1 | The in-repo spec's AD-002/AD-003 have **Onboarding** create the Person and the Employment; Phase 6 already does both | Treated as superseded by the repository. Onboarding references. Raised as **D-3** for explicit confirmation |
| Q-2 | The spec lists `TaskAssignment`, `ApprovalStep` and `ProgressTracker` as aggregate roots | Reduced to a field, a Workflow concern and a projection (§7). Raised as **D-4** |
| Q-3 | "Portal Access Provisioned" as a lifecycle stage | Modelled as a task, because provisioning cannot complete synchronously (§4.4) |
| Q-4 | Whether an onboarding may exist without a recruitment application (direct hire, migration) | Assumed **yes**: `application_id` is nullable. A migrated workforce has no applications |
| Q-5 | Due dates in working days | Out of scope: no calendar query exists and week-end rules are country data (§11.4). Debt |
| Q-6 | Whether one employment may ever have two onboardings (a rehire, a transfer programme) | Assumed **one live at a time**, historical ones retained. A rehire is a new employment and gets its own |
| Q-7 | Whether an overdue instance should be visible to the joiner | Deferred to Phase 18 with the ESS contract; Phase 7 publishes the data either way |

## 34. Decisions requiring approval

**D-1 — Publish Recruitment's hire event as a contract (additive, touches Phase 6).**
`recruitment.candidate.hired` is the natural trigger for onboarding, but no module publishes event
names today. Approving this means adding an export of the event name and payload type to
Recruitment's `contracts/index.ts` — additive, no behaviour change, no schema change. *Refusing it
is fully supported*: §4.3's fallback ships the phase with an HR-initiated start and the
reconciliation list, with no change to any completed phase. **Recommendation: refuse for now**, take
the fallback, and let Phase 16/17 establish a general published-event contract for every module at
once rather than one module at a time.

**D-2 — If D-1 is approved, a published event-payload convention in the kernel.** Otherwise each
module invents its own way of exporting event types. Small, additive, and better decided once.
**Recommendation: only with D-1.**

**D-3 — Confirm Onboarding does not create Person or Employment**, superseding the in-repo Phase 7
v1.0 AD-002/AD-003 (Q-1). **Recommendation: confirm.** Phase 6 owns the hire, it is tested, and
duplicating it would create exactly the second path A2 forbids.

**D-4 — Confirm the reduced aggregate set** (Q-2): no `TaskAssignment`, `ApprovalStep` or
`ProgressTracker` aggregate. **Recommendation: confirm** (A7 asks for minimal aggregates).

**D-5 — Confirm that onboarding completion never changes employment status**, and that activation is
an explicit task a tenant may add. **Recommendation: confirm** (A11 requires it; stated because
"activate on completion" is the first thing a customer will ask for).

**D-6 — Confirm notifications and document storage ship as NOT VERIFIED**, with no adapter written
in this phase. **Recommendation: confirm.**

**D-7 — Confirm the task-kind set** (`checklist`, `acknowledgement`, `document`, `approval`,
`external`) as closed for this phase. **Recommendation: confirm** — five kinds cover the examples in
the specification, and a sixth is a schema change, not a configuration change.

## 35. Definition of Done

Phase 7 is complete when all of the following hold.

**Scope**
1. Plans, versions and templates: create, amend, version, publish, retire — nothing shipped as data.
2. Onboarding instances: start (idempotent per employment), preboarding, in progress, complete, cancel.
3. Tasks: generated from a version, completed, waived, reassigned, rescheduled, added ad hoc, with document references and acknowledgements recorded.
4. Progress computed, never stored.
5. Admin screens per §27; **no ESS/MSS UI**.

**Boundaries**
6. `@work/onboarding` depends on **no** sibling module package; every cross-module read goes through a published application service under a bounded grant.
7. No Person, Employment, Organization, Identity or Recruitment fact is duplicated; a test asserts completion changes no employment.
8. Phases 0–6 unmodified, except any change explicitly approved under §34.

**Quality**
9. `pnpm verify` clean: standards, architecture, localization, dependencies, format, lint, typecheck, test, build.
10. Tenant isolation proved by the seven assertions of §24, as an unprivileged role.
11. Performance measured at the §30 volumes, reported with real numbers, including any miss.
12. Both locale catalogues complete; every rejection has a bilingual message.

**Honesty**
13. No mock data, hardcoded plan, simulated approval, fake document or simulated notification.
14. Notifications and document storage marked **NOT VERIFIED**, with the reason.
15. `docs/modules/onboarding.md`, the ADRs this phase needs, `DOMAIN_OWNERSHIP.md`, `PHASES.md`, `ARCHITECTURE.md`, `RELEASE_NOTES.md` and the debt register updated.
16. `docs/verification/phase-7-report.md` distinguishing **IMPLEMENTED**, **CONTRACT AVAILABLE** and **NOT VERIFIED**, with the carried-forward debt register.
