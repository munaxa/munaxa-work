# Phase 16A — Enterprise Workflow & Approvals

## Executive Summary

Phase 16A delivers one module: **Workflow**. It records the approval processes a tenant configures,
raises an approval about a record another module owns, asks one named person at a time to decide it,
and writes down who answered, on whose authority, and when.

**It orchestrates and owns no business data.** An approval is *about* a subject — a
`recruitment.requisition`, a `leave.request` — and Workflow stores that subject as two opaque
strings it never interprets. There is no foreign key out of the module, no import of another
module's package, and no shape in which Workflow could learn what a requisition is.

**Every chain is sequential, and one named member answers each step.** There is no parallel branch,
no majority, no quorum, no first-response and no condition on which a chain forks. There is no role
directory and no group directory: a step names a *membership*, because that is the only thing this
product can resolve.

**Nothing is scheduled and nothing expires.** No `JobPort` has an adapter anywhere in this
repository, so no approval ages out, no delegation lapses on a timer, and no escalation fires. A
delegation is in force if Identity says so **at the instant of the decision**, which is why Workflow
keeps no expiry state of its own.

**"The approvals waiting for me" is answerable here, and it is the first `read-own` in this
repository that is routed and enforced.** An approval is addressed to a membership, and a membership
is exactly what the request resolved before any handler ran. No endpoint, body, query parameter or
command field accepts one, so nobody can read anybody else's queue.

**Recruitment is the single adopted business module**, by write, through a seam Checkpoint 7 stopped
on and the user approved. A terminal decision travels into Recruitment inside the approver's own
request. There is no distributed transaction, no outbox, no broker, no worker and no scheduler, and
this report does not claim atomicity it does not have.

What it deliberately does not deliver: SLA, business days, escalation, scheduling, approval expiry,
automatic delegation expiry, parallel approval, majority, unanimous, quorum, first-response,
conditional branching, roles, groups, manager routing, external approvers, notification delivery,
analytics, asynchronous callbacks, outbox and self-service. **Twenty-two capabilities remain
`NOT VERIFIED`**, each for a stated reason, and none has a placeholder anywhere in the product.

**Final verification: green.** `pnpm standards` and `pnpm verify --force --concurrency=1` both pass,
with **3,206 tests in 315 files, 0 skipped**, no cycles, no unused dependencies and zero prohibited
patterns. Fifty-four benchmark measurements across three tiers, **no misses**.

---

## Scope Delivered

### Domain

Four aggregates across six domain files: **definition** (with its versions and step templates),
**instance** (with its steps), **decision** and **history**. Pure functions over immutable state,
returning refusals as values carrying a catalogue key rather than throwing.

Two vocabularies are worth naming. `WORKFLOW_STEP_STATUSES` distinguishes `pending` (not yet
reached) from `awaiting` (the one step a decision is being asked for) — which is what makes
"sequential" a property of the data rather than of the code that walks it. And `DECISION_AUTHORITIES`
is `assigned` or `delegated`, recorded alongside two membership columns, because *who approved this*
and *whose authority was it* are different questions a year later and one column answers only one of
them.

### Schema

**7 tables**, 7 Prisma models, **22 indexes of which 7 are partial unique**, 31 check constraints,
**9 foreign keys none of which leaves the module**, and two immutability triggers. One migration,
`20260814100000_workflow`, with **no follow-up migration**.

Three partial unique indexes carry invariants the domain would otherwise have to police in
application code:

- `workflow_instance_open_subject_idx` — at most one **running** approval per subject, which is what
  makes two simultaneous requests converge on one chain rather than putting two in front of two
  directors.
- `workflow_step_awaiting_idx` — at most one **awaiting** step per approval.
- `workflow_decision_step_idx` — at most one decision per step.

### Application

**9 commands, 8 queries, 17 handlers, 7 permissions.** Every handler declares exactly one permission
and the pipeline enforces it; no handler checks a permission inside itself.

The permissions separate the acts that ought to be separate: `instance.start` does not imply
`instance.cancel` (the person who raised a request is not thereby the person who may end somebody
else's without a decision), and `approval.read-own` does not imply `approval.decide` (seeing your
queue is not answering from it).

### Persistence

**Six repositories over seven tables.** The counts differ by one because `workflow_step_template` has
no life outside its version — it is an entity of the version aggregate, created while the version is
a draft, frozen when it publishes, and **copied** rather than referenced when an instance starts.
`PostgresVersionRepository` owns both tables, so there is no separate store a handler could use to
reach past the version.

No repository opens a transaction. Each takes the `Transaction` the application layer's unit of work
established, so a command that writes an instance, its steps and its history does all of it or none.

### API

**4 controllers, 17 routes** — one per handler, 8 `GET` and 9 `POST`, no `PUT`, `PATCH` or `DELETE`.

### Admin UI

**11 sections** at `/workflow`, server-rendered, read-only, `?lang=ar` switching language and
direction together. **8 requests maximum**, constant at 0, 1 and 50 rows.

---

## Final Counts

Every figure recounted from the final tree rather than carried from a checkpoint report.

| Figure | Count |
| --- | --- |
| Workflow tables | 7 |
| Prisma models | 7 |
| Indexes | 22 |
| — of which partial unique | 7 |
| Check constraints | 31 |
| Foreign keys | 9 |
| — leaving the module | **0** |
| Immutability triggers | 2 |
| Migrations (repository) | 21 |
| — Workflow migrations | 1 |
| Domain files | 6 (+2 support) |
| Repositories | 6 |
| Commands | 9 |
| Queries | 8 |
| Handlers registered | 17 |
| Permissions | 7 |
| Ports Workflow declares (outbound) | 2 |
| Ports Workflow implements (inbound) | 1 |
| Production adapters | 3 |
| Controllers | 4 |
| Endpoints | 17 |
| Admin sections | 11 |
| Workflow catalogue keys | 152 en / 152 ar |
| Localization catalogue sets (repository) | 17 |
| `@work/workflow` tests | 338 in 30 files |
| Workflow API tests | 146 in 17 files |
| Workflow Admin tests | 53 in 4 files |
| **Repository-wide tests** | **3,206 in 315 files, 0 skipped** |

---

## Architecture

### Ports and adapters

Workflow **declares two outbound ports** and **implements one inbound port**:

| Port | Direction | Adapter | Capability held |
| --- | --- | --- | --- |
| `DelegationPort` | outbound, read | `WorkflowDelegations` | `Asking` — `ask` only |
| `BusinessDecisionPort` | outbound, write | `RecruitmentDecisions` | `Sending` — `ask` + `send` |
| `ApprovalPort` (kernel) | inbound | `WorkflowApprovals` | `Sending` |

**The split is the authorization, and it is a type rather than a convention.** `workflowModuleFor`
takes two parameters — a `reader: Asking` and a `writer: Sending` — because an adapter that only
reads another module must not be able to write to one. `WorkflowDelegations` is constructed from the
reader and has no `send` to reach for; a future edit inside it cannot acquire one without changing
the type it was built from. Asserted structurally, not documented and hoped for.

### The kernel

`packages/kernel/src/ports/approval.ts` is **unchanged since Phase 1** (`506df18`). Its three
methods are `request`, `status` and `cancel`, and Phase 16A altered none of them.

Phase 16A made exactly **one** kernel change: an optional `membershipId?: string` on `TenantContext`,
added in Checkpoint 4. It is additive, it is set by the middleware from stored facts about an
authenticated principal, and it is **never taken from a request body** — a client-supplied value
would let anybody read anybody's approval queue by changing a field. It is optional because a
reconciliation command, a migration and every test fixture construct a context with no membership to
name; a handler therefore has to handle its absence, and "we do not know which member you are" has
exactly one safe answer, which is nothing.

---

## Security

Evidence, from the final tree, under a role asserted unprivileged **before** any security result was
believed.

| Property | Evidence |
| --- | --- |
| RLS enabled | `relrowsecurity = true` on all 7 tables |
| RLS forced | `relforcerowsecurity = true` on all 7 tables |
| One policy each | `select count(*) from pg_policy` = 1 per table |
| Policy name | `tenant_isolation` |
| Policy command | `ALL` (`polcmd = '*'`) |
| Policy kind | permissive |
| Policy roles | `polroles = {0}` — PUBLIC |
| Tenant predicate | `(tenant_id = app_current_tenant())`, on **both** `USING` and `WITH CHECK` |
| Role privilege | `rolsuper = false`, `rolbypassrls = false` |
| Cross-module foreign keys | 0 |

**One policy per table is a security property rather than tidiness.** PostgreSQL ORs permissive
policies together, so a second one on any of these tables would *widen* access rather than narrow it.
The benchmark asserts the count and throws.

**The queue cannot be aimed at somebody else.** `workflow.pending-approvals` and
`workflow.decided-approvals` take no membership, workforce user, platform user, approver or `me`
parameter — there is nothing to get wrong because there is nothing to supply. Attempts on the query
string change nothing; attempts in a body are refused by `forbidNonWhitelisted` as a 400. A request
that resolved no membership gets an empty queue, never everybody's.

**Delegated authority cannot be forged through request data.** No route, body or command field
accepts `onBehalfOf`, `delegateMembershipId` or `authorityMembershipId`. Whether the caller may act
for somebody else is Identity's answer, asked inside the handler at the instant of the decision,
about the membership the request resolved.

**Both benchmark tenants deliberately share their membership and subject identifiers.** A benchmark
whose tenants held disjoint values would pass its isolation assertions whether or not the policy
worked, because every read would be separated by the value rather than by the boundary. With them
shared, the subject both tenants hold resolves to **the reader's own approval and never the
neighbour's**, and the shared approver identifier returns the reader's own queue.

---

## Cross-Module Integration

The complete production dependency graph. Three permissions, three contracts, no wildcard, no prefix
grant, nothing else.

| Module | Contract consumed | Bounded grant | Operation |
| --- | --- | --- | --- |
| Identity | `identity.active-delegations-for` | `identity.delegation.read` | `read-active-delegations` |
| Recruitment | `recruitment.read-requisition` | `recruitment.requisition.read` | `read-requisition-for-reconciliation` |
| Recruitment | `recruitment.decide-requisition` | `recruitment.requisition.approve` | `apply-approval-decision` |

Each is a `runWithServiceGrant` naming the module, the operation, the exact permits and a reason, and
each emits a `ServiceElevation` carrying the tenant, the actor and the correlation identifier of the
request that caused it — asserted, so all three are proved to survive the hop rather than assumed to.

**Workflow cannot write into another module's database.** Every cross-module act is a dispatched
command or query through that module's own handler, under that module's own permission and row-level
security. There is no import between the packages and no repository reach.

**`approvalId` is the Workflow instance identifier**, unchanged, and there is **no second approval
identifier anywhere** — Recruitment stores the same value Workflow generated.

---

## Recruitment Adoption

Recruitment is the **single** adopted business module. Its only change is the approved M-1 seam:
`decide` accepts an optional `approvalId`, records it, and refuses when a different approval already
routed the record.

The final behaviour, each outcome verified against both sides:

1. **Reaches Recruitment** — a terminal decision travels through `BusinessDecisionPort` inside the
   approver's request.
2. **Recruitment accepts** on its own rules, in its own transaction.
3. **Recruitment stores the Workflow `approvalId`** exactly.
4. **Workflow records its decision** — and only then.
5. **Same approval, same outcome → converges.** Recruitment is not asked to move again; no second
   decision row is written.
6. **Same approval, opposite outcome → refuses.**
7. **Different approval → refuses**, and the existing `approvalId` is not rewritten.
8. **Decided directly in Recruitment → distinguished**, answering
   `subject-decided-outside-workflow` rather than claiming the approval did it.
9. **Delegated approval → the deputy is the actor in Recruitment; the approver appears only as
   authority.** The two are never collapsed.
10. **Tenant isolation holds** — a membership from tenant B cannot decide in tenant A, and an
    identical requisition identifier in two tenants stays two records.

**Recruitment is asked first.** A refusal therefore leaves Workflow with nothing written: no
decision, no history entry, and the step still awaiting. That ordering is the design, and it is what
makes a refusal safe.

**There is no distributed transaction, no outbox, no broker, no worker and no scheduler.**
`PostgresUnitOfWork.execute` takes a fresh pooled connection and opens its own transaction on every
call, so two module writes *cannot* share one. The reverse window — Recruitment committed, Workflow's
commit failed — is closed by **reconciling on the approval identifier** when the decision is
retried, not by claiming atomicity. That reconciliation is the accepted mechanism for a
two-transaction seam, and only case 1 above converges; cases 2–4 keep their actual business meaning.

---

## Delegation

**Delegation is Identity's**, and Workflow consumes its published query. No Identity contract was
added, changed or widened.

| Case | Outcome |
| --- | --- |
| Direct approval, no delegation | Decides; Identity is not consulted at all |
| Active delegation | Decides; authority `delegated` |
| Not-yet-active (`scheduled`) | Refused |
| Period ended | Refused |
| Revoked while the period runs | Refused |
| Wrong scope (`leave.request.approve`) | Refused |
| Near-miss wildcards (8 tested) | Refused |
| Literal `*` | Accepted — deliberately, by allowlist |
| Another person's delegation | Refused |
| Delegation from a non-approver | Refused |
| Cross-tenant delegation | Refused |
| Request carries no membership | Refused |
| Membership supplied on the command | Ignored |
| Identity unavailable / refuses / malformed | **Raises** — never approves |

**The scope allowlist is an exact two-element set, not a pattern**: `workflow.approval.decide` and
the literal `*`. `workflow.*`, `workflow.approval.*`, `*.decide`, `workflow.approval.decide.*`,
`workflow.approval.decide-anything`, an uppercase variant, `**` and the empty string are all refused
against real decisions on real approvals.

**Actor and authority semantics, final:** the **delegate is the actor** (`decidedByMembershipId`),
the **original approver is the authority** (`onBehalfOfMembershipId`). Nobody is impersonated — a
delegated decision never writes the delegator into the actor column and calls it an approval they
made. The database enforces the pair: `workflow_decision_delegation_check` makes
`authority = 'delegated'` exactly equivalent to naming an approver, and
`workflow_decision_self_delegation_check` refuses a row where the two are the same person.

**The Workflow behaviour fails closed.** Any non-answer from Identity raises rather than resolving to
"no delegation": an approval is never granted because Identity could not be reached.

---

## API

**9 commands + 8 queries = 17 handlers = 17 routes**, reconciled mechanically against the controller
sources with comments stripped.

| Controller | Prefix | Routes |
| --- | --- | --- |
| `WorkflowDefinitionController` | `workflow/definitions` | 5 |
| `WorkflowVersionController` | `workflow/versions` | 3 |
| `WorkflowInstanceController` | `workflow/instances` | 5 |
| `WorkflowApprovalController` | `workflow/approvals` | 4 |

`GET` and `POST` only. No generic status route — a client reaches a transition by naming it
(`publication`, `archive`, `cancellation`, `decision`, `retirement`), because a status setter is a
route through which the domain's rules about which move is legal never get to run. No `/me`, no
`/my-team`, no roles, groups, manager, SLA, escalation, analytics or scheduling endpoint — absent
structurally, asserted on the wire *and* in the source, since a 404 alone proves only that nobody
wrote the route yet.

Validation semantics:

| Condition | Status |
| --- | --- |
| Malformed identifier in the path | 400 |
| Malformed or undeclared body property | 400 |
| Domain refusal | 422 |
| Missing permission | 403 |
| Tenant-scoped resource not visible | 404 |
| Stale `expectedVersion` | 409 |

Validation runs before authorization, because the pipe precedes the CQRS permission check: a
malformed body from an unauthorized caller is a 400. That is asserted rather than assumed.

---

## Admin UI

`/workflow`, `?lang=en`, `?lang=ar`, unknown language falling back to English. Server-rendered with
**zero** client components, client state, forms, buttons, inputs, selects, dialogs, links or
`onclick` handlers — asserted over the whole rendered route.

**Request budget: 8 maximum**, 4 for an empty tenant, 1 when the service does not answer. Constant at
0, 1 and 50 rows: fifty-row listings produce the same eight requests as one-row listings, with
exactly one detail read per listing. No request carries an identity parameter.

**No browser clock.** Instants render through one function pinned to `timeZone: 'UTC'` — the
established Admin convention — and the regression fixture is `2026-02-28T23:30:00.000Z`, which
without the pin reads as the **1st of March** east of UTC and as 15:30 to the west. Both are asserted
absent. Identifiers stay strings; whole numbers render as `4000`, never `4,000` or `٤٠٠٠`.

**A membership renders in full while every other identifier is shortened to eight characters**, and
the reason is arithmetic: these are UUIDv7, whose leading 48 bits are a millisecond timestamp, so two
memberships created within about four and a half hours share their first eight characters. On the one
screen where the actor and the authority must be told apart, a truncation would have said a director
approved what their deputy approved.

The Admin UI does **not** provide: self-service workflow administration, a manager queue, role or
group administration, SLA management, escalation management, analytics, scheduling, notification
configuration, or parallel approval configuration. Each absence is stated in the status section as a
sentence, never as a disabled control or a "coming soon".

---

## Performance

`TEST_DATABASE_URL=... pnpm measure:workflow [--only=A|B|C] [--keep] [--plans]`

Production repositories, real `PostgresUnitOfWork`, unprivileged role, RLS enabled and forced, a
second tenant at equal volume, `vacuum analyze` after seeding. Budgets inherited unchanged from
Phases 13–15: **queue 100 ms, detail 150 ms, cohort 2 s / 10 s / 60 s**.

**18 workloads × 3 tiers = 54 measurements, 0 misses.**

| Workload | A (500) | B (10k) | C (100k) | Budget |
| --- | --- | --- | --- | --- |
| **pending queue for one member** | 1.6 | 1.7 | **3.9** | queue |
| decided approvals for one member | 1.7 | 1.7 | 3.1 | queue |
| instance listing (all) | 4.1 | 9.5 | 82.5 | queue |
| instance listing (running) | 2.4 | 6.0 | 8.2 | queue |
| definition listing (active) | 14.5 | 4.0 | 15.4 | queue |
| instances by subject | 2.1 | 1.8 | 3.0 | detail |
| open approval for a subject | 1.2 | 1.0 | 2.0 | detail |
| instance detail (4 reads) | 3.4 | 2.2 | 4.3 | detail |
| approval status (3 reads) | 1.9 | 2.4 | 2.9 | detail |
| timeline for one approval | 2.0 | 1.7 | 2.7 | detail |
| steps for one approval | 1.2 | 1.6 | 1.7 | detail |
| cohort: 200 subjects | 59.1 | 60.9 | 91.9 | cohort |

At tier C each tenant holds 100,000 instances, 200,000 steps, 140,000 decisions and 300,000 timeline
entries, with a second tenant beside it at the same volume. **The queue is flat across a 200× growth
in data** — 1.6 ms to 3.9 ms — which is the single result this phase most had to earn.

**Two proposed workloads were deliberately not measured.** The plan's §14 lists "instances breaching
SLA as of an instant" and "escalation candidates as of an instant". Both need a due time and an
escalation level, and Workflow has neither a column nor a field for either because both are Phase 16B
(D-12). Measuring them would have meant inventing the capability, so they are named here rather than
quietly dropped.

**One proposed workload cannot be run as specified.** §14 proposes "open instances for 200 subjects —
one query for 200". `InstanceStore.search` accepts a single `subjectId` and no `subjectIdsIn`, so
that query does not exist and adding one is a new capability rather than an audit. What is measured
instead is what an adopting module asking about two hundred records pays **today**: two hundred
bounded lookups, 59–92 ms, reported under the cohort budget and labelled for what it is.

---

## Query Plans

Captured from the production repositories by wrapping the transaction's `execute`, so what is
explained is the SQL the repository actually issued — parameters and all. Retyping the query beside
the benchmark would explain a statement nobody runs.

Verified on every critical read: the tenant predicate is visible (as the RLS `One-Time Filter` *and*
as an explicit index condition), `Limit` is pushed into the statement, ordering is deterministic and
ends in `id` as a unique tie-breaker, the count's predicate matches its listing's, and there is no
N+1 and no cross-tenant lookup. Both queue counts run as **index-only scans with `Heap Fetches: 0`**.

Indexes reached: `workflow_step_queue_idx`, `workflow_decision_decider_idx`,
`workflow_instance_subject_idx`, `workflow_instance_status_idx`,
`workflow_instance_open_subject_idx`, `workflow_history_instance_idx`.

**Two sequential scans were accepted and no index was added.** `definition listing` (12 rows) and
`current published version` (36 rows) are configuration tables that stay the same size at every tier —
a tenant of a hundred thousand runs the same handful of approval processes as one of five hundred.
Covering indexes already exist; the planner is simply right that scanning one page is cheaper, and
both reads complete in about 0.03 ms. Adding an index to flatter a fixture is exactly what the plan
forbids.

---

## Concurrency

Nine races, each with **two real PostgreSQL connections**, no sleeps, and every constraint enabled.

| Race | Outcome |
| --- | --- |
| Two simultaneous starts for one subject | One runs; the other loses on `workflow_instance_open_subject_idx` |
| Two simultaneous decisions on one step | One commits; exactly one decision row exists |
| Stale `expectedVersion` | `ConcurrencyException` → 409 |
| Decision racing cancellation | Exactly one terminal state; loser classified |
| Duplicate delegated delivery | Converges |
| Same approval redelivered | Converges; Recruitment not asked again |
| Different approval, same subject | Refused; existing `approvalId` untouched |
| Direct Recruitment decision vs Workflow | Refused, and distinguished |
| Two non-conflicting writes | Both commit |

**Outcomes are classified, not counted.** A `ConcurrencyException` is not a `Result` — it is raised
out of the repository when a versioned update matches no row, travels past the dispatcher, and
becomes a 409 at the HTTP edge. A test that caught everything and called it "the loser" would report
the same success whether the refusal was the domain's or a crash. The decision-versus-cancellation
race is recorded as producing `committed` + `concurrency`, with the record agreeing with the winner
on both tables: a cancelled approval carries a reason and no decision, a decided one carries a
decision and no reason.

**Not every race is a convergence, and this report does not say otherwise.** Convergence is the
correct answer for a repeated request about the same subject or the same approval. A second decision
on a decided step is a *refusal*, and a stale write is a *conflict*.

---

## Exactness

Final PostgreSQL type inventory across all seven tables: **`character varying`, `integer`, `jsonb`,
`timestamp with time zone`, `uuid`**. Nothing else.

There is no `numeric`, `real`, `double precision`, `bigint` or `money` — and **no `date`**, which is
how "Workflow holds no civil day" is proved rather than asserted. A request, a decision and a step
becoming current are moments, so every temporal column is an instant and there is no calendar
conversion anywhere on the path.

Through the production repositories: identifiers stay strings and are never passed through `Number`;
ordinals and version numbers stay whole; the localized `description` round-trips as an object rather
than as the string it was stored with; instants arrive as `Date` and leave the published contracts as
ISO strings; steps return in ordinal order.

---

## Immutability

`workflow_decision` and `workflow_history` are append-only, enforced by **exactly two** triggers —
`workflow_decision_no_mutation` and `workflow_history_no_mutation`, both `BEFORE DELETE OR UPDATE`.

| Attempt | Result |
| --- | --- |
| Update | Refused |
| Update that changes nothing | Refused |
| Soft delete | Refused |
| Hard delete | Refused |
| Unqualified update / delete | Refused |
| Raw SQL as an unprivileged role | Refused |
| Insert a corrected row | **Permitted** — that is how a correction is made |

The repositories offer **no mutation method at all** on either store — `DecisionStore` and
`HistoryStore` have no `update`, which is a structural absence rather than a discipline. Neither
extends the shared `Repository` base, so there is nothing to inherit one from.

---

## `NOT VERIFIED`

Twenty-two capabilities. None has a placeholder, a disabled control, a "coming soon" or a column
anywhere in the product.

| Capability | Why |
| --- | --- |
| SLA | No due time; Phase 16B (D-12) |
| Business days | No calendar and no working-time rule |
| Escalation | No reassignment after a delay, no timer |
| Scheduling | No `JobPort` adapter anywhere |
| Approval expiry | See below |
| Automatic delegation expiry | Identity is asked at the instant of the decision |
| Parallel approval | Every chain is sequential |
| Majority | No tally |
| Unanimous | No tally |
| Quorum | No tally |
| First-response | No tally |
| Conditional branching | A chain does not fork on the record's value |
| Roles | No role directory; a step names a membership |
| Groups | No group directory; a step names a membership |
| Manager routing | No reporting line is resolved (D-14) |
| External approvers | Everybody asked is a member of the tenant |
| Notification delivery | Nothing is sent when somebody is asked |
| Analytics | No rate, average, bottleneck or compliance figure |
| Asynchronous callbacks | The decision travels inside the approver's request |
| Outbox | Nothing is queued for later delivery |
| Broker | No message broker |
| Self-service | No principal→employment resolution (ADR-0032) |

**`expired` exists in the `ApprovalPort` vocabulary and the current Workflow implementation never
produces it.** The mapping is total so a reader can see the gap rather than infer it; the gap is not
an operational state. The Admin UI renders whichever state the server returned and offers no legend
of the vocabulary, so the word cannot appear from real data, and the status section says plainly that
nothing expires.

---

## Technical Debt

Carried forward, not fixed, and none of it invented.

1. **A duplicate-key race on `POST /instances` can surface as 500.** Two simultaneous requests for
   one subject leave exactly one running approval — the invariant holds exactly — but the loser's
   status is not always a named refusal. A PostgreSQL unique violation is not a
   `ConcurrencyException`, and the shared `ProblemDetailsFilter` maps only that to 409. Teaching the
   shared filter to recognise a duplicate key is a change to shared infrastructure Phase 16A was not
   authorized to make. Asserted as it is (`[201, 409, 422, 500]`) and reported rather than papered
   over with a status the product does not return. **Repository-wide, not Workflow-specific.**

2. **The repository-wide test run fails at default concurrency.** `error: deadlock detected` in
   `@work/onboarding`, with `@work/attendance` skipping 21 tests, when 20+ packages' integration
   suites contend on one PostgreSQL database. The repository's pinned safe configuration
   (`--concurrency=1`) is green at 47/47. Pre-existing and unrelated to Workflow.

3. **`documents-concurrency.integration.test.ts` is flaky under a full run.** Observed failing in 2
   of 4 full `--concurrency=1` runs and passing 3 of 3 in isolation. Phase 12 code, untouched by
   Phase 16A, and not modified here.

4. **Every `measure-*-performance` script changes the database's planner statistics, and they
   outlive the rows.** `vacuum analyze` writes column statistics that `truncate` does not remove and
   an `analyze` of an empty table cannot replace. A repository plan suite run afterwards plans a
   five-row fixture against a hundred thousand rows' worth of statistics. The Workflow benchmark now
   cleans up by default and documents that the migrations must be re-applied to a fresh database
   before the plan suites are run again; the same is true of the Career and Learning scripts.

---

## Defects Found and Fixed

**Three production defects**, all found by tests written to be honest rather than accommodating, and
all in Phase 16A's own code.

1. **Cancelling any approval returned 500.** `cancellationHistory` wrote the audit actor
   (`user:workflow-admin`, a `varchar`) into `actor_membership_id`, a `uuid` column. The history
   entry now carries the acting membership and the audit actor stays in the audit columns.
2. **A body missing a required nested `name` was refused by the domain as a 422 rather than by the
   edge as a 400.** `class-validator` skips `@ValidateNested` entirely when the property is absent.
   Both required nested shapes now carry `@IsDefined`.
3. **The Recruitment adapter read any non-`pending_approval` status as "already decided"**, so an
   approval about a *draft* requisition answered `subject-decided-outside-workflow`. It now refuses
   with the reason that is actually true.

**One UI defect.** Identifiers were shortened to eight characters everywhere; UUIDv7 leads with a
millisecond timestamp, so two memberships created within a few hours rendered identically — on the
one screen where the actor and the authority must be told apart. Memberships now render in full.

**Three fixture defects**, every one of them found by the closing audit and invisible until a
database was built only from the migrations.

1. **The cross-module fixture never granted the application role any privilege on `delegation`** —
   the table the delegation query reads and the suites write. It passed only because the database
   carried a grant predating the fixture.
2. **The API fixture created its role and issued no grants at all**, silently depending on a
   cross-module suite having run first in the same process. On a fresh database every Workflow API
   suite failed with `permission denied for table workflow_history`. It now calls the one function
   that knows what the role needs.
3. **The benchmark left its seed behind**, changing the planner statistics every other suite sees.
   It now cleans up by default.

Beside these, roughly twenty test and fixture corrections were made during the phase — a history
count that was wrong by one, a `uuidV7().slice(0, 8)` that collided within a millisecond, a step
added to a published version instead of a draft, an assertion that authorization precedes validation
when the pipe legitimately runs first, and an isolation assertion that assumed subject identifiers
were unique per tenant when the fixture deliberately shares them. **No test was weakened to fit
behaviour, and no production code was changed merely to make a test pass.**

---

## Scope

Phase 16A added one module and changed exactly two things outside it:

- **Recruitment** — the approved M-1 seam only: `decide` accepts an optional `approvalId`, stores it,
  and refuses when a different approval already routed the record.
- **The kernel** — one optional `membershipId?` on `TenantContext`. `ApprovalPort` is untouched.

No other completed module was changed. No shared infrastructure was changed. No index was added, no
budget moved, no test weakened, no `eslint-disable`, no `any`, no `.only`, no `@ts-ignore`, and no
skipped test beyond the documented `CONNECTION === undefined` guard that turns integration suites off
where no database is configured.

**Phase 16B is not started**: no column, no port, no route, no screen, no placeholder.
