# Phase 16E — Definition of Ready

**Investigation and decision preparation only. No production code was modified.**

**Phase 16E is NOT READY.** The blocker is not a missing contract or a missing capability — it is
that **no Phase 16E specification exists anywhere in this repository**. What 16E *is* has not been
decided, and this document does not decide it.

Investigated at `730502a`, working tree clean, Phase 16D closed.

One document rather than a plan plus a register: every decision below is `OPEN`, none has an
approval to record, and a second file would duplicate the first. A register is worth creating when
approvals start arriving.

---

## 1. The finding that shapes everything else

**There is no Phase 16E.** Not as a specification, not as a roadmap entry, not as scope inherited
from anywhere.

| Evidence | Result |
|---|---|
| `work prompts/` phase specifications | run `17_PHASE_16_WORKFLOW.md` → `18_PHASE_17_COMMUNICATIONS.md`. **No 16E file, and no 16A–16D files either** |
| `docs/PHASES.md` | an **implementation ledger** of completed phases, not a forward roadmap. "16E" appears in exactly one sentence — *"Phase 16E is not started"* — which **I wrote at 16D closure** |
| `grep -rn "16E" docs/ "work prompts/"` | zero hits outside the Phase 16D verification documents |

**16A, 16B, 16C and 16D were carved out of one specification** — `17_PHASE_16_WORKFLOW.md` — during
execution. So the real question is not "what is 16E" but **"is there anything left in Phase 16 that
should be a phase, and is it 16E or something else?"** That is D-16E-01, and it is the owner's to
answer.

### What remains unbuilt in the Phase 16 specification

From its Scope (lines 143–185) and Escalation section (lines 445–461), measured against what ships:

| Named in the spec | State |
|---|---|
| `Escalation Rule` (a configured rule) | **Not built.** 16D built a *human command*, not a rule (D-16C-07) |
| `SLA Rule` (an entity) | **Not built.** 16C built two nullable columns on the step template. D-16D-01 raised this and was never approved |
| Time-based escalation · Configurable SLA | **Not built.** Both need the runner nobody owns |
| Role escalation · HR escalation | **Not built**, and both need the role directory ADR-0001 places with Platform and this product has repeatedly refused |
| Multi-level escalation | **Not built** |
| `Workflow Analytics` | **Not built.** `PHASES.md` records analytics as Phase 20's |
| `Workflow Timeline` · `Approval Queue` | **Built** — history and `workflow.pending-approvals` |

The specification's own **Non Goals** forbid Notifications, Email, SMS and Push outright, so
notification *delivery* was never Phase 16's to build.

---

## 2. Decided versus implemented — the capability table

| Capability | Decision | Implemented | Owner / phase | Evidence |
|---|---|---|---|---|
| **Human escalation** | D-16D-02 A, D-16D-08 (iii) | **YES** | Workflow, 16D | `workflow.escalate-branch`, 8 refusals, migration 24 |
| **Automatic escalation** | **Refused for 16D**; never approved anywhere | **NO** | **Unowned** | 16D plan §7 — all four time-triggered rows "Unowned" |
| **Approval expiry** | D-16C-06 — *observed and derived, never written* | **NO** state, and none intended | Workflow (as a read) | `expired` declared in `APPROVAL_STATES`, absent from `REACHABLE_APPROVAL_STATES`; no command, no column |
| **Business-day SLA** | D-16C-05 — elapsed time only | **NO** | **Unowned**; needs an Organization contract that does not exist | §5 below |
| **Notifications** | D-16D-06 **OPEN** (intent); delivery is Phase 17's | **NO** — Workflow emits none | Phase 17 owns delivery | `NotificationPort` exists; learning + performance emit; Workflow does not |
| **`JobPort` runner** | D-16D-07 **OPEN** — deliberately not assigned | **NO** — zero consumers, zero implementations | **No phase owns one** | §4 below |
| **Admin authentication** | D-16D-10 A — outside 16D | **NO** | Platform (ADR-0001, ADR-0019) | 15 headerless loaders; global guard 401s |
| **Candidate enumeration** | D-16D-16 A — none | **NO** | — | intentional |
| **Candidate picker** | consequence of D-16D-16 + D-16D-11 B | **NO** | — | a predicate cannot produce a list |
| **Portals** | out of Phase 16 scope | **NO** | Phase 18 / 19 | spec "Future Consumers" |
| **Analytics** | out of Phase 16 scope | **NO** | Phase 20 | `PHASES.md:461` |

**Nothing in the "decision" column has been converted into delivery.** Four Phase 16D decisions —
D-16D-01, D-16D-03, D-16D-06, D-16D-07 — remain **OPEN and unbuilt**, and two of them
(notification intent, `JobPort` ownership) are direct inputs to any 16E.

---

## 3. Automatic execution — the chain, stage by stage

| Stage | Existing contract | Owner | Implementation | Blocker |
|---|---|---|---|---|
| **Trigger** | none | **none** | none | **D-16E-03, D-16E-04.** No scheduler, cron, worker, queue, outbox or broker exists anywhere in production — the only `setTimeout` in the repository is a health-check race in `packages/persistence/src/database-health.ts:30` |
| **Due evaluation** | **yes** — `dueAt`, `serviceLevelState`, `overdueByMinutes` | Workflow | **built** (16C) | none — but it is a *read*, see §6 |
| **Command** | the shape exists | Workflow | escalation is written to ADR-0071's shape and is callable unchanged by a future runner | none |
| **Transaction** | `PostgresUnitOfWork` | kernel | built | none |
| **Persistence** | Workflow stores | Workflow | built | none |
| **History** | 9 events, append-only, closed check constraint | Workflow | built | **D-16E-12** — an automatic act needs an event, and the constraint is closed |
| **Notification intent** | `NotificationPort`; two modules emit through their own narrow `NotificationIntentPort` | kernel + module | Workflow emits **none** | **D-16E-07** (= D-16D-06, still open) |
| **Background delivery** | `RecordingNotificationPort` records and delivers nothing | Phase 17 | **not built** | Phase 17's, by its own Objectives |

**The chain breaks at the first stage and at the actor, not in the middle.**

---

## 4. `JobPort` — investigated as §5 required

1. **Defined:** `packages/kernel/src/ports/index.ts:61-74`. `enqueue(request)` and
   `schedule(request, cron)`; `JobRequest` carries `name`, `payload`, `tenantId`, `correlationId`, a
   **caller-supplied `idempotencyKey`** and an optional `runAt`.
2. **Contract guarantees:** none. The file header states the ports are *"interfaces only… No
   implementation exists yet, deliberately."*
3. **Consumers:** **zero.** The only non-comment reference in the repository is the type re-export at
   `packages/kernel/src/index.ts:127`. Every other mention — across letters, documents, learning,
   career, performance, workflow and the Prisma schema — is a **comment explaining its absence**, or a
   string in a test's forbidden-word list.
4. **Does Workflow consume it?** No.
5. **Adapter:** none. `grep -rn "implements JobPort"` → zero.
6. **Any scheduler elsewhere?** None. No `@nestjs/schedule`, `node-cron`, `bullmq`, `amqplib` or
   `kafkajs` in any `package.json`.
7. **Which specs mention a runner:** Phase 0 (*"Prepare abstraction. No jobs implemented."*), Phase 1
   (*"Create abstractions… No concrete jobs implemented."*), Phase 4.1 (*"a projection with a
   scheduled evaluation"*), Phase 20 (*"Scheduled reports execute in background jobs"*), Phase 24
   (*"Background Job Optimization"*), ADR-0020 (*"Large exports execute in background jobs"*).
   **No specification names `JobPort`** — `grep -ric "jobport" "work prompts"` → **0**.
8. **Ownership or assumption?** Phase 0 and Phase 1 create *the abstraction only*, explicitly. Every
   later mention **assumes** a runner and states behaviour depending on it. **Phase 20 assigns the
   reports, not the runner.** No phase owns one.
9. **A Platform background-execution contract?** None beyond `JobPort` itself.
10. **Would a Workflow-specific runner violate ownership?** On the evidence, yes — it would put
    scheduling infrastructure inside a business module, and `DOMAIN_OWNERSHIP.md` records the runner
    as owned by nobody rather than by Workflow.

**Carried forward as D-16E-04, and not assigned.**

---

## 5. Cross-module dependencies

| Dependency | Existing contract | Permission | Port | Adapter | Missing |
|---|---|---|---|---|---|
| **Identity — membership standing** | `identity.membership-standing` | `identity.membership.read` | `MembershipStandingPort` | `WorkflowMembershipStanding` | nothing |
| **Identity — delegation** | `identity.active-delegations-for` | `identity.delegation.read` | `DelegationPort` | `WorkflowDelegations` | nothing |
| **Employment — reporting line** | `employment.read-employment` | `employment.employment.read` | `ReportingLinePort` | `WorkflowReportingLine` | nothing |
| **Organization — calendar / holidays** | **NONE** | — | — | — | **the query itself** |
| **Notification** | `NotificationPort` (kernel) | — | not held by Workflow | `RecordingNotificationPort` delivers nothing | **D-16E-07**, and delivery is Phase 17's |
| **Platform authentication** | **NONE** | — | — | — | **the whole contract** (D-16D-10) |
| **Background execution** | `JobPort`, unimplemented | — | — | **none** | **an owner** |

### Business days — the specific finding §11 asked for

**Organization publishes no calendar query today.** It *stores* calendars and days —
`organization_calendar` with a `working_days Int[]` weekday array, and `organization_calendar_day`
with `kind ∈ {holiday, working, non-working}` — and exposes **four write commands and no GET route**.
Its eleven registered queries contain no calendar, holiday or working-day query.
`OrganizationCalendarView` and `CalendarDayView` are declared in its contracts; **`CalendarDayView`
has zero producers anywhere in production code.** The only way calendars leave the module is inside
the whole-organization `organization.export-structure` snapshot, which carries calendars but **not
days**.

**No module reads Organization's calendar.** Business-day counting exists only in Attendance, from
schedules and rosters (`attendance.expected-working-days`), and reaches Leave through
`WorkingDayPort`. Leave's own port documentation says it *"does not read Organization's calendar"*.
Payroll takes a working-day count as an input it never computes.

So `workingDays`, `calendarView` and holiday support **do not exist as a contract**, exactly as §11
warned they might not. Business-day SLA is blocked on an Organization change that is not authorized.

---

## 6. Service level — what exists, and what 16E would actually add

**Implemented (16C), verified unchanged:**

configured `count` + `unit` (`hours` | `days`, integer ≥ 1) · `awaitingAt` = the instant **that step**
became awaiting (P-5) · `dueAt = awaitingSince + span` in exact milliseconds · state
`none | within | overdue`, where **exactly on the boundary is `within`** · `overdueByMinutes`
truncated, not rounded · an **explicit reading instant** threaded from handler → mapper → domain,
never a clock read inside the domain and **never client-supplied** (no `asOf` on any DTO) · **nothing
derived is persisted** — no `due_at`, no `expired`, no `breached`, and an integration test fails the
build if such a column appears · no business-day semantics.

**The distinction that matters.** All of the above is a **read-time calculation**. What does not
exist is **an action caused by crossing the target** — and the two are separated by the entire §3
chain, not by a small addition. Turning the read model into an execution mechanism would need a
trigger, an actor, an idempotency identity and a history event, none of which exists.

**16E would add nothing to the calculation.** If 16E has SLA content at all, it is the *action*
(D-16E-05), not the arithmetic.

---

## 7. Expiry — status

- `expired` is declared in `APPROVAL_STATES` and **deliberately excluded** from
  `REACHABLE_APPROVAL_STATES`, so the port mapping is total and the gap is visible.
- **No expiry command exists** (`grep` for `workflow.expire` → zero).
- **No expiry column exists** on any Workflow model.
- **D-16C-06 approved: expiry is observed and derived, never written.**
- `workflow.cancel-instance` already covers the human half: its own permission, a required reason,
  optimistic concurrency, steps moved out of `awaiting` before the instance, and history for each. It
  is the only act that ends an undecided approval, and it needs a human.
- D-16D-03 raised "expiry beyond what exists" and was **never approved**.

**Nothing about expiry should be built merely because the word appears in a NOT VERIFIED list.**

---

## 8. The actor problem — a blocking finding

§15 asked who the actor is for an automatic action. The repository answers more sharply than
expected.

- `SystemContext { system: true; reason; correlationId }` exists
  (`packages/kernel/src/tenancy/tenant-context.ts:47-63`) — **and it has no `actor` field at all.**
- **Every consumer rejects it.** `assertTenantScoped` in the CQRS pipeline
  (`packages/kernel/src/cqrs/pipeline.ts:143-148`) **throws `TenantIsolationException`** when the
  context is a system context: *"reaching a business handler from it means a job forgot to adopt a
  tenant."* The permission checker returns `false` for it; the API guard 401s.
- `'system:auto-approval'` is **forbidden by domain guards and by database check constraints** in
  learning and career.
- **No production command anywhere runs with a non-human actor.** The one `system:` actor string in
  production is `system:payroll`, written into *audit columns* by a repository batch insert — not an
  execution context for a command.
- There is **no ADR** about synthetic or system actors. The refusal is recorded as **D-16C-02**,
  citing ADR-0045 (*"a requisition approval is made by a named human, not by an adapter"*).

**An automatic Workflow action cannot reach a business handler today**, and the mechanism that stops
it is the pipeline itself. This is not a gap to fill casually — it is a deliberate control, and
changing it is a kernel-level decision.

---

## 9. Idempotency, if automatic execution is ever approved

The pattern to follow already exists and is proven twice in this phase. **ADR-0071**: *a `select`
followed by an `insert` is not idempotent under concurrency.* Escalation's guarantee is
`workflow_step_escalation_idx`, a **partial** unique index on
`(tenant_id, instance_id, ordinal, approver_membership_id) where escalated_at is not null and
deleted_at is null`.

So the design question is not "how do we lock" but **"what is the durable identity of one automatic
action?"** — the tuple a partial unique index would be built on. That must be answered *before* a
scheduler is proposed, not after. `JobPort` already anticipates this with a caller-supplied
`idempotencyKey`, but the key is the caller's to choose and nothing validates it.

---

## 10. Invariants — verified intact, and locked

Re-verified at `730502a` and unchanged by this investigation: group snapshot · branch semantics ·
snapshotted assigned denominator · `floor(n/2)+1` majority · quorum as a precondition ·
`first-response` · delegated votes · condition refusals · append-only history · tenant isolation ·
no cross-module foreign keys · **escalation adds rather than replaces** · escalated steps excluded
from the assigned denominator · `unanimous` refuses escalation · escalation is human-triggered ·
escalation uniqueness by partial index · **no automatic behaviour of any kind**.

**Any 16E proposal that would violate one of these requires its own amendment decision, approved on
its own, before implementation.** None is proposed here.

---

## 11. Decision register — all `OPEN`

> **Canonical numbering lives in [`phase-16e-register.md`](phase-16e-register.md).** That register
> was written after this document and renumbers these decisions: the actor problem below is raised
> here as its own D-16E-05, and the register folds it into **D-16E-02**, shifting the capability
> decisions by one and making idempotency **D-16E-09**. The register carries the crosswalk. Nothing
> was dropped, and no finding changed meaning — this section is preserved as written.

No option is recommended; none was requested. Decisions are tiered because they are not independent —
answering a lower tier before its higher tier would be answering a question whose premise is undecided.

### Tier 1 — the root

#### D-16E-01 — Does Phase 16E exist, and what does it deliver? · `OPEN`

*Question.* Is there a Phase 16E at all, and if so what is its scope?

*Evidence.* §1. No specification, no roadmap entry; the name appears only in a closure sentence.
Phase 16's remaining unbuilt scope is `EscalationRule`, `SLARule`, time-based escalation, configurable
SLA, role/HR/multi-level escalation, and analytics — of which analytics is Phase 20's and the role
variants need a directory this product refuses.

*Options.* **(a)** No 16E; Phase 16 is complete and the remainder moves to a later phase with the
runner. **(b)** 16E = automatic execution (escalation and/or SLA action), conditional on an owner for
the runner. **(c)** 16E = the two entity decisions left open (`SLARule`, `EscalationRule`) with no
automatic behaviour. **(d)** 16E = something else the owner names.

*Constraints.* The scope may not be inferred from the phase name. Nothing may be built that needs the
runner until D-16E-03 resolves.

*Dependencies.* None inbound. **Blocks everything below.**

*Consequences.* (a) closes Workflow for now. (b) requires Tier 2 in full. (c) is schema-and-domain
work with no infrastructure, and is the only option implementable today.

### Tier 2 — the gates on automatic execution

#### D-16E-02 — Does the phase introduce automatic actions at all? · `OPEN`
*Evidence.* §3, §8. *Options.* yes · no · intent-only (emit, never act). *Depends on* D-16E-01.
**If no, Tier 4 disappears entirely.**

#### D-16E-03 — Who owns background execution? · `OPEN`
*Evidence.* §4. Four phases assume a runner; none builds one. *Options.* a new infrastructure phase ·
Platform · an existing phase, amended · nobody, and automatic behaviour stays unbuilt.
*Constraint.* **Naming an owner is the owner's act, not this document's.** Carries D-16D-07 forward.

#### D-16E-04 — `JobPort`: consume, implement, replace, or leave? · `OPEN`
*Evidence.* §4. *Constraint.* A Workflow-hosted scheduler would put infrastructure in a business
module. *Depends on* D-16E-03.

#### D-16E-05 — The actor for an automatic action · `OPEN` ⛔
*Evidence.* §8. The CQRS pipeline **throws** on a system context; `system:auto-approval` is refused by
domain guards and database constraints; D-16C-02 refuses a synthetic actor.
*Options.* a system actor with a kernel amendment · a nullable actor with dedicated history
provenance · a separate command outside the tenant pipeline · no automatic action.
*Constraint.* **Do not set `actorMembershipId` to a system value, and do not reuse an administrator's
identity.** *This is the sharpest blocker after D-16E-01.*

### Tier 3 — capability questions, each answerable on its own

#### D-16E-06 — What happens when a step becomes overdue? · `OPEN`
*Evidence.* §6. *Options.* nothing (status quo — it is shown) · notification intent only · an
automatic act. *Note.* The read model already answers "is it overdue"; only the *action* is open.

#### D-16E-07 — Expiry · `OPEN`
*Evidence.* §7. *Options.* nothing further (D-16D-03 (a), never approved) · a distinct human command
· automatic expiry — **which D-16C-06 refuses without an amendment.**

#### D-16E-08 — Notification intent from Workflow · `OPEN`
*Evidence.* §3, §5. Carries **D-16D-06** forward unchanged. *Options.* none · intent on approved
events, delivered by Phase 17 · intent plus delivery — **which Phase 16's Non Goals and Phase 17's
scope both forbid.** *Constraint.* No Workflow-specific notification system.

#### D-16E-09 — Business-day SLA · `OPEN`
*Evidence.* §5. **Organization publishes no calendar query and `CalendarDayView` has zero producers.**
*Options.* remain out of scope (D-16C-05 stands) · authorize an Organization calendar query, built and
verified on its own side first · reuse Attendance's `expected-working-days`, which is
employment-scoped and may not fit an approval.
*Constraint.* **Never by duplicating a calendar inside Workflow.**

### Tier 4 — design questions that **arise only if D-16E-02 approves automatic actions**

Raised so they are not discovered late; **not** raised as work.

| ID | Question | Anchor |
|---|---|---|
| D-16E-10 | What is the durable identity of one automatic action? | §9 — ADR-0071, partial unique index |
| D-16E-11 | What happens when two workers attempt the same action? | must be the same answer as D-16E-10 |
| D-16E-12 | What is the approved behaviour when an attempt fails? | at-least-once vs exactly-once must be *stated*, not assumed |
| D-16E-13 | Which automatic actions write history, and under which event? | the check constraint is closed at nine values |
| D-16E-14 | What authorizes an automatic action? | a human permission, a system authorization, or neither |
| D-16E-15 | Does Admin display automatic execution state? | also gated by **D-16D-10**, which remains outside scope |

---

## 12. Dependencies between decisions

```text
D-16E-01  (does 16E exist, and what is it?)          ROOT
    │
    ├── D-16E-02  automatic actions at all?
    │       ├── D-16E-03  who owns the runner?  ──> D-16E-04  JobPort
    │       ├── D-16E-05  the actor            ⛔  (pipeline refuses one today)
    │       └── Tier 4: D-16E-10 … D-16E-15    (only if D-16E-02 = yes)
    │
    ├── D-16E-06  overdue action      ──depends on── D-16E-02
    ├── D-16E-07  expiry              ──D-16C-06 amendment if automatic──
    ├── D-16E-08  notification intent (independent of automation; = D-16D-06)
    └── D-16E-09  business days       ──needs an Organization contract that does not exist──
```

**D-16E-08 is the only decision implementable today without any of the others**, because notification
*intent* is a synchronous port call inside an existing human command — the precedent learning and
performance already set.

---

## 13. Testing strategy — defined, not implemented

If automatic execution is ever approved, the suite must cover: duplicate delivery of the same job ·
two concurrent workers on the same action · tenant isolation under an unprivileged role · transaction
atomicity (nothing written on failure) · stale work (the approval decided or cancelled between
scheduling and execution) · the exact due boundary, where **on the boundary is `within`** ·
explicitly-stated exactly-once **or** approved at-least-once history semantics · retry behaviour ·
notification intent emitted once · **no action before due** · **no action after a decision or
cancellation** · determinism across repeated runs against identical state.

**None of this is implemented, and none may be claimed.**

---

## 14. Definition-of-Ready blockers

1. **D-16E-01** — no Phase 16E specification exists. Scope is undecided and may not be inferred.
2. **D-16E-03 / D-16E-04** — no owner for background execution; four phases assume a runner, none
   builds one (carries D-16D-07).
3. **D-16E-05** — no actor model for a non-human act; the CQRS pipeline actively refuses one.
4. **D-16E-09** — Organization publishes no calendar contract, so business days cannot be computed
   without a completed-module change that is not authorized.
5. **D-16D-10** — Platform authentication remains outside scope, so any Admin surface for automatic
   behaviour is blocked independently.

---

## 15. Files changed

`docs/verification/phase-16e-plan.md` — this document. **Nothing else.** No production or test file
was modified.

---

## 16. Status

**Phase 16E is NOT READY — awaiting explicit approval on: D-16E-01, D-16E-02, D-16E-03, D-16E-04,
D-16E-05, D-16E-06, D-16E-07, D-16E-08 and D-16E-09.**

D-16E-10 through D-16E-15 arise only if D-16E-02 approves automatic actions, and are recorded rather
than asked.

**Checkpoint 2 must not begin.** No implementation is authorized.
