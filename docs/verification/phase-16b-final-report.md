# Phase 16B — Final Report

**Routing core: approval groups, parallel branches, tallies and conditions.**

Written from the final tree at commit `38d2257`, with every count re-derived from the repository and
the database rather than copied from a checkpoint report. Where an earlier report disagreed with the
tree, the report was corrected and the tree was not.

---

## 1. Executive summary

Phase 16A gave this product an approval engine that asks **one named person at a time**. Phase 16B
makes it ask **several people at once, and choose which people to ask**.

A tenant can now write down a list of approvers, name that list on a step, and have an approval
expand it into individual steps that are all asked at the same moment. How that branch ends is a rule
the tenant chose — everybody, a majority, or the first answer — optionally gated by a minimum number
of responses, and optionally skipped entirely when a condition on the raising request does not hold.
Every number behind that is an integer the server computed from the decisions that exist, and the
denominator is the set of approvers the approval **snapshotted when it started**: editing the list
afterwards changes the next approval and never the one already running.

Two tables, nine handlers, five HTTP routes, five Admin sections and one new domain vocabulary. No
role directory, no group directory, no manager routing, no SLA, no escalation and nothing scheduled —
and none of those has a column, a port, a route, a screen or a placeholder anywhere in the product.

**Phase 16B is complete. Phase 16C has not started.**

---

## 2. Scope

| Checkpoint | Delivered |
| --- | --- |
| 1 | Plan, reviewed and locked |
| 2 | Domain: branch, tally, condition, approval group |
| 3 | Schema: two tables, branch columns, one additive migration |
| 4 | Application: three commands, two queries, group snapshot, branch orchestration |
| 5 | PostgreSQL repositories, replacing Checkpoint 4's declared-unimplemented store |
| 6 | API: one controller, five routes, extended DTOs |
| 7 | Admin UI: five new sections on `/workflow`, read-only |
| 8 | Performance, security and integration audit |
| 9 | This report, and phase closure |

**Nothing outside Workflow changed.** The only cross-module code in the phase is the Recruitment
decision seam and the kernel's `ApprovalPort`, both approved and built in Phase 16A and both untouched
here.

---

## 3. Architecture inventory

Counted from `prisma/schema.prisma`, the live database, and the module's own registration.

| | Count |
| --- | ---: |
| Architecture models checked by the gate (repository-wide) | 176 |
| **Workflow tables** | **9** |
| Workflow Prisma models | 9 |
| Workflow repositories | 7 |
| Workflow domain source files (aggregates and rules) | 9 |
| Workflow commands | 12 |
| Workflow queries | 10 |
| Workflow permissions | 9 |
| Workflow ports (stores + outbound) | 7 stores, 2 outbound ports |
| Workflow API controllers | 5 |
| Workflow HTTP routes | 22 |
| Admin sections on `/workflow` | 16 |
| Indexes on Workflow tables | 28 |
| Unique indexes | 16 |
| **Partial unique indexes** | **6** |
| Foreign keys on Workflow tables | 11 |
| **Cross-module foreign keys** | **0** |
| Check constraints | 39 |
| RLS policies (one per table) | 9 |
| Append-only tables (triggers refusing update and delete) | 2 |
| Migrations in the repository | 22 |
| Migrations added by Phase 16 | 2 (16A `20260814100000_workflow`, 16B `20260815100000_workflow_routing`) |
| Workflow production source files | 54 |
| Locale keys, English and Arabic | 228 each |

The six partial unique indexes are `workflow_definition_code_idx`, `workflow_version_number_idx`,
`workflow_instance_open_subject_idx`, `workflow_decision_step_idx`,
`workflow_approval_group_code_idx` and `workflow_approval_group_member_idx`. The two append-only
tables are `workflow_decision` and `workflow_history`, each with a
`workflow_*_no_mutation` trigger.

**No completed module was modified**, except the already-approved Recruitment M-1 seam, which was
built in Phase 16A and not touched in 16B. **No new completed-module contract was introduced.** **No
Phase 16C infrastructure exists**: no `JobPort` adapter, no scheduler, no broker, no worker, no
outbox.

---

## 4. Phase 16A — the workflow engine

Unchanged by 16B and re-verified by it.

- **Definitions and versions.** A tenant configures an approval process; a version is drafted, given
  steps, and published. A published version is immutable, and an approval copies its steps at start,
  so retiring a definition or publishing a replacement changes nothing already running.
- **Instances.** An approval is raised *about* a subject the owning module identifies by two opaque
  strings. Workflow interprets neither and owns no business data.
- **Sequential approval.** Steps in ordinal order, one asked after the one before it answers.
- **Direct and delegated decisions.** A decision records **two** memberships that never collapse: the
  person who acted, and the approver whose authority they used. Delegation itself is Identity's, read
  at the instant of the decision; Workflow stores none of it.
- **History.** An append-only timeline of routing — who was asked, who answered, on whose authority,
  when. It carries no comment: a rejection comment lives on the decision, behind its own permission.
- **The two queues.** "Waiting for me" and "decided by me", resolved from the authenticated request.
  No endpoint, body or command field accepts a membership, so nobody can aim a queue at somebody else.
- **`ApprovalPort` and the Recruitment seam.** Workflow answers the kernel's port inbound; Recruitment
  is the single adopted module, asked *first* so a refusal leaves Workflow with nothing written.

---

## 5. Phase 16B — the routing core

Everything below is proved by the final tree.

- **Approval groups.** A tenant-owned, explicit list of memberships with a code unique per tenant and
  a bilingual name. **Not a directory**: no query behind it, no nesting, no inheritance, no role
  semantics, no lifecycle, no owner and no effective period.
- **Group membership.** A membership appears at most once on a list, may appear on many lists, and is
  Identity's identifier held as an opaque value — no join, no lookup, no foreign key.
- **Mutable groups.** Members are added and removed at any time.
- **The snapshot.** When an approval starts, a group is resolved into its members **once**, and each
  resulting step records `source_group_id` as provenance. Every running step names a person; no
  running step names a list.
- **Parallel branches.** Several steps may share one ordinal and are all awaiting at once. The
  instance view publishes `awaitingSteps` (plural) beside the 16A singular.
- **Three branch rules.** `unanimous`, `majority`, `first-response`.
- **Quorum.** A minimum number of responses before a rule is evaluated. A count, never a proportion.
- **Conditions.** A closed form — `(key, operator, value)` with five operators, combined only by
  `all-of` — evaluated by the domain against the raising request's context when the approval starts,
  and stored as JSONB that PostgreSQL shape-checks but never evaluates.
- **Branch selection.** A branch whose condition does not hold is skipped and the approval moves on.
- **Branch tally.** Computed at read time from the decisions that exist, never stored: assigned,
  approvals, rejections, responses, outstanding, threshold, quorum, quorum met, outcome.
- **Branch-specific history.** One `step-awaiting` entry per person asked, not one per branch.
- **API.** Five new routes on one new controller; the step and decision bodies carry the branch fields.
- **Admin.** Five new read-only sections on `/workflow`.
- **Audit.** Three performance tiers, security, concurrency and integration — Checkpoint 8.

---

## 6. Domain rules, as locked and verified

### Majority — `floor(assigned / 2) + 1`

| Assigned | Approvals needed |
| ---: | ---: |
| 1 | 1 |
| 2 | 2 |
| 3 | 2 |
| 4 | 3 |
| 5 | 3 |

Machine-checked as a table, with 6→4 and 7→4 beyond it. **A tie is not an approval**: two of four is
exactly half, and a threshold written as `ceil(n / 2)` would have approved it.

### Unanimous

Every assigned approver must approve.

### First-response

The first decision determines the outcome, whichever way it went. Concurrent first responses resolve
deterministically — the earlier decision wins, and the result is stable when two tie.

### Quorum

Gates an approval **and** a rejection. Approves nothing by itself. Defaults to one, which is no gate.
An unreachable quorum leaves the branch **awaiting** rather than resolving it. A quorum larger than
its branch is refused at publication; a quorum that is not a whole number of one or more is refused.

### The denominator

**Assigned approvers, snapshotted at start.** Never respondents. A person who has not answered is
counted as outstanding and never subtracted, so a branch cannot become easier to pass by somebody
staying silent.

### Delegation

A delegated decision is **one vote for the approver it acts for**, with the actor and the authority
preserved in two separate columns.

### Conditions

A condition that cannot be evaluated is a **refusal**, never `false`. The three refusals stay three —
the request does not carry the key, the operand is of a kind the comparison cannot use, the operand
is of a different kind from the configured one — and an unevaluable condition never completes an
approval. An absent condition means the branch runs.

### Branch isolation

Votes recorded on one branch cannot affect another branch's tally. A branch opens with its own
assigned voters and its own decisions; a historical approval cannot inflate the current majority.

### Snapshot

Group membership is snapshotted when an instance starts. Later edits do not change a running
approval — and a **new** instance sees the current membership. A member removed from the list can
still decide the approval that already asked them; a member added afterwards has no step.

---

## 7. Persistence

Two new tables. `workflow_approval_group` carries a code, a bilingual name and the standard audit,
soft-delete and version columns; `workflow_approval_group_member` carries the group, the membership
and the instant it was added.

**The composite tenant-aware foreign key is the security-relevant design.** A member references its
group by `(approval_group_id, tenant_id)`, and a step template references a group the same way,
because **PostgreSQL checks a foreign key without consulting row-level security**: with a
single-column reference the parent row exists, the check passes, and one tenant ends up holding a row
that points at another's list. Proved by attempting exactly that and naming the constraint that
refuses it.

`workflow_step_template` gained `approver_group_id`, `branch_rule`, `quorum` and `condition`, and its
`approver_membership_id` became nullable; `workflow_step` gained `source_group_id`, `branch_rule`,
`quorum` and `condition`. Three indexes that were unique while a branch could hold only one step —
`workflow_step_template_ordinal_idx`, `workflow_step_ordinal_idx`, `workflow_step_awaiting_idx` — were
recreated **non-unique**, because a branch is several steps at one ordinal.
`workflow_decision_step_idx` remains unique: one decision per step, still.

One additive migration. No 16A migration was modified. No `numeric`, `real`, `double precision`,
`bigint`, `money` or civil `date` column exists anywhere in the module; the types are exactly
`varchar`, `integer`, `jsonb`, `timestamptz` and `uuid`.

---

## 8. Security

**Nine protected tables.** Row-level security **enabled and forced** on every one, with exactly one
permissive `ALL` policy named `tenant_isolation`, applying to `{public}` (PostgreSQL's role oid `0`),
with both `USING` and `WITH CHECK` equal to `(tenant_id = app_current_tenant())`.

The policy count is a security property rather than tidiness: PostgreSQL **ORs** permissive policies,
so a second one would widen access instead of narrowing it.

Every security conclusion in this phase was reached under a role proved `rolsuper = false` and
`rolbypassrls = false` **before** any result was believed.

- Cross-tenant **reads** blocked: definition, version, instance, step, decision, template, history,
  group, group members, `membersOfAll`, branch steps.
- Cross-tenant **totals** blocked — a count computed without the tenant predicate discloses how much
  work another organization has even when no row comes back.
- Cross-tenant **writes** blocked, by the policy's `WITH CHECK` and by the composite foreign keys.
- The subject two tenants share resolves to **each tenant's own** approval; the membership identifier
  they share returns each tenant's own queue.
- **No tenant context, no data**: the policy compares against a null tenant, and the application
  refuses to run a handler outside a tenant context before that is even reached.
- **No cross-module foreign key.** All 11 foreign keys are inside Workflow.

---

## 9. Cross-module boundary

**Exactly two crossings exist, both approved before Phase 16B and both unchanged by it:**

1. **Identity delegation read** — `DelegationPort`, asked at the instant of a decision.
2. **Recruitment decision seam** — `BusinessDecisionPort`, implemented in `apps/api` for requisitions
   and nothing else; every other subject type is answered `not-adopted`. Workflow also answers the
   kernel's `ApprovalPort` inbound, which is the other half of that same seam and has existed since
   Phase 2.

No business module imports `@work/workflow`. The only packages that do are `apps/api` (composition and
the two adapters) and `apps/admin` (published contracts and locale catalogues). The module's manifest
depends on nothing but `@work/kernel` and `@work/persistence`.

**Confirmed absent:** manager resolution, role directory, group directory, Organization calendar
dependency, People dependency, Performance dependency, Learning dependency, Payroll dependency,
notification dependency, scheduling dependency.

**The approval group is not a group directory.** It is an explicit, tenant-owned membership list with
no query behind it. The distinction is enforced in the product's own words: the Admin screen states
it, and a test refuses the words *role*, *department*, *organizational unit*, *manager*, *team*,
*reports*, *directory*, *position*, *employment*, *dynamic*, *owner*, *status* and *effective* as a
heading or a column anywhere near a group.

---

## 10. API

**22 routes across 5 controllers, for 12 commands and 10 queries** — one route per handler,
reconciled by name against the module's own registration rather than counted. No handler is reachable
twice, none is unreachable, and there is no generic execute endpoint.

The five routes Phase 16B added:

| Method | Path | Handler | Permission |
| --- | --- | --- | --- |
| `GET` | `/approval-groups` | `workflow.search-approval-groups` | `workflow.group.read` |
| `POST` | `/approval-groups` | `workflow.create-approval-group` | `workflow.group.manage` |
| `GET` | `/approval-groups/:approvalGroupId` | `workflow.read-approval-group` | `workflow.group.read` |
| `POST` | `/approval-groups/:approvalGroupId/members` | `workflow.add-group-member` | `workflow.group.manage` |
| `DELETE` | `/approval-groups/members/:approvalGroupMemberId` | `workflow.remove-group-member` | `workflow.group.manage` |

**`approverKind` is derived and never sent.** No body carries one, so `forbidNonWhitelisted` refuses
it with a 400: a client cannot claim `group` while naming a person, and `role` has no field to arrive
in. Naming both approvers or neither is the **domain's** 422, because both bodies are well formed.

**No identity is accepted anywhere**: not `membershipId` as an actor, `approverMembershipId` on a
decision, `workforceUserId`, `platformUserId`, `actorMembershipId`, `decidedByMembershipId`,
`onBehalfOfMembershipId`, `delegate`, `me`, `self`, nor any tenant identifier.

**Nothing is computed at the edge** — no threshold, denominator, outcome or comparison in any
controller, asserted against the sources with comments and string literals stripped.

### Permissions — nine, exactly

`workflow.definition.read`, `workflow.definition.manage`, `workflow.instance.read`,
`workflow.instance.start`, `workflow.instance.cancel`, `workflow.approval.decide`,
`workflow.approval.read-own`, `workflow.group.read`, `workflow.group.manage`.

Granted by **exact name**: no wildcard, no trailing dot, and no `startsWith`, `includes`, `RegExp` or
`split` anywhere in the permission guard — a prefix match would turn nine grants into one.
`workflow.group.read` ≠ `workflow.group.manage`; `workflow.approval.read-own` ≠
`workflow.approval.decide`; neither group permission is implied by `workflow.definition.manage` or by
`workflow.instance.start`. No permission names a role, a manager, a team, an SLA, an escalation or a
notification.

---

## 11. Admin

One route, `/workflow`, server-rendered, `?lang=en` and `?lang=ar` with direction following language
and English as the fallback for an unknown one. **16 sections**, five of them added by 16B: approval
groups, members of a group, branches and tallies, awaiting steps, and "what this release added".

Read-only: no form, button, input, select, dialog, link, client directive or browser state, asserted
over the whole rendered route and over every production source file of the workspace. The screen
talks to the API and to nothing else — no Prisma, no repository, no unit of work, no handler, no
other module's contracts.

**Request budget: 10 at most** — five listings plus five first-row details. Zero rows → 5; one row →
10; fifty rows → 10. **No N+1 of any kind**: fifty groups produce one group-detail request, and there
is no request per member, per branch, per tally or per instance.

**The honesty section shrank when the product grew.** Six capabilities moved from "not verified" to
"added in this release", and their catalogue keys were deleted so none can be rendered by accident.
Two were rewritten rather than removed, because what is absent is narrower than what was absent:
there is no role directory and no **group** directory, while an approval group is real.

**Nothing is computed on the screen.** No arithmetic, no percentage and no progress bar exists in the
branch components, asserted against the source: a bar is `approvals / threshold` rendered as a shape,
and the division is the part that does not belong there.

---

## 12. Performance

Real PostgreSQL, the real repositories, an unprivileged role, two tenants at equal volume at every
tier, `vacuum analyze` after seeding, no constraint or policy disabled.

**Tiers: 500 / 10,000 / 100,000 approvals per tenant.** The fixture seeds 40 approval groups of 5
members each, and branches one approval in ten into three simultaneous approvers.

**26 workloads, zero budget misses at any tier.**

| Property | Result |
| --- | --- |
| Slowest workload | unfiltered instance listing, **91.4 ms** at Tier C against a 100 ms budget |
| Queue scaling | **flat** — 1.6 / 2.3 / 3.2 ms across a 200× increase in approvals |
| Group scaling | **flat** — every group read under 4 ms at every tier; configuration does not grow with headcount |
| `membersOfAll` | **one statement** for forty groups, `= ANY (uuid[])`, one scan |
| Cohort | 62.9 / 56.0 / 68.2 ms for 200 subjects |

Query plans, captured from the production repositories rather than retyped: the tenant predicate is
visible twice on every plan, every listing pushes `LIMIT` into the query over a sort key ending in a
unique tie-breaker, every count uses the same predicate as the listing it labels, and the queues are
served by `workflow_step_queue_idx` and `workflow_decision_decider_idx` with index-only counts.

---

## 13. Concurrency

Every race on **two real connections**, no sleeps, no disabled constraints, each outcome classified
by the constraint or exception type that produced it rather than by "an error happened".

| Race | Outcome |
| --- | --- |
| Two identical group codes | one wins; the other loses to `workflow_approval_group_code_idx` |
| Two identical member insertions | one wins; the other loses to `workflow_approval_group_member_idx` |
| Two different people onto one list | both succeed |
| One person onto two lists | both succeed |
| Two removals of one member | one wins; the loser finds nothing to remove |
| Removal of an already-removed member | `ConcurrencyException`, asserted by type |
| Two decisions on one step | exactly one decision; the other loses to `workflow_decision_step_idx` |
| Two approvers on two steps of one branch | both commit |
| A decision racing a cancellation | exactly one terminal state; the other is a named refusal |
| Two approvals for one subject | one runs; the other loses to `workflow_instance_open_subject_idx` |

---

## 14. Exactness

- **No inexact numeric type** in any of the nine tables, machine-checked against the catalogue.
- Every tally figure is an **integer**; `parseFloat`, `toFixed`, `Math.round` and `Math.ceil` are
  forbidden in every production file of all five layers.
- Identifiers are strings and never converted; a UUID is not a quantity.
- Instants are `timestamptz`, rendered through one **UTC-pinned** function.
  `2026-02-28T23:30:00.000Z` renders as the 28th at 23:30 in both languages, never as the 1st of
  March. No clock is consulted anywhere on the screen.
- Integers render through `String`: no thousands separator, no Arabic-Indic digits, no decimal.
- Memberships render **in full**, because UUIDv7 identifiers created hours apart share their first
  eight characters and this is the module where two must be told apart.
- Workflow holds **no civil date**. Every moment it stores is an instant.

---

## 15. Test accounting

Repository-wide, uncached, `--concurrency=1`, against real PostgreSQL.

| Scope | Files | Tests |
| --- | ---: | ---: |
| Workflow domain | 7 | 122 |
| Workflow application | 11 | 148 |
| Workflow infrastructure / repositories | 29 | 263 |
| **Workflow module** | **47** | **533** |
| Workflow API (`apps/api/src/workflow`) | 21 | 193 |
| Workflow Admin (`apps/admin/src/workflow`) | 8 | 94 |
| Recruitment | 8 | 74 |
| **Repository-wide** | **340** | **3,489** |

Failed **0**. Skipped **0**. `.only` **0**. Disabled lint rules **0**. Suppressed type errors **0**.
`any` **0**. Tasks **47/47**.

`describe.skip` appears only as a *value*, in the one guarded form
`CONNECTION === undefined ? describe.skip : describe` — a suite that needs a database and says so.
The whole-module audit requires that guard wherever the value appears.

---

## 16. Defect register

Every defect found across Phase 16A and 16B, counted once.

### Production defects — 16A (3, plus 1 UI)

1. Cancelling any approval returned 500: the audit actor was written into a `uuid` column.
2. A body missing a required nested `name` was refused as 422 by the domain rather than 400 by the
   edge — `class-validator` skips `@ValidateNested` when the property is absent.
3. The Recruitment adapter read any non-`pending_approval` status as "already decided", so an
   approval about a draft requisition gave the wrong reason.
4. **UI:** identifiers were shortened to eight characters everywhere, so two memberships created
   hours apart rendered identically — on the one screen where the actor and the authority must be
   told apart.

### Production defects — 16B (4)

5. **Domain (Checkpoint 2):** `LocalizedName` was accepted without validating both languages.
6. **Domain (Checkpoint 2):** a branch skip overwrote decisions already recorded.
7. **Domain (Checkpoint 4):** a vote was counted outside its own branch — a decision on an earlier
   branch inflated the current branch's majority. Fixed by scoping the vote to its own branch, and
   guarded by the branch-isolation tests.
8. **Repository (Checkpoint 5):** a group's members outlived the soft delete of the group, so
   `membersOfAll` could start an approval from a list `byId` refuses to return. Fixed with a join on
   the group's `deleted_at is null`, so the two reads agree and a start fails closed.

### Application defect — 16B (1)

9. **In-memory store over-strictness (Checkpoint 4):** a fake refused a write PostgreSQL accepts. A
   test double that is stricter than the database is a defective double, and was corrected to match.

### Fixture defects (5 in 16A/16B, one family)

Every one was "a role or list that was never granted or seeded what it needed": the cross-module
fixture's `delegation` grants, the API fixture's missing grants entirely, the benchmark leaving its
seed behind, the cross-module role fixture missing the two new group tables (which made group
creation answer 500 in Checkpoint 6), and `SECOND_APPROVER` missing from a seed.

### Benchmark defects (2)

- The vocabulary-parity check parsed only PostgreSQL's `= ANY (ARRAY[…])` rendering and could not
  read the single-value form, so it reported a one-word vocabulary as missing its only value.
- The benchmark left planner statistics behind that `truncate` and `vacuum analyze` do not remove,
  which made the repository plan suite choose an equally valid but differently-named index. The
  harness now deletes those statistics itself.

### Documentation defect (1)

- The group permissions ship as `workflow.group.read` and `workflow.group.manage`; the Checkpoint 6
  report and the Checkpoint 8 brief both named them `workflow.approval-group.*`. **The prose was
  corrected and the permission was not** — renaming a permission would silently revoke every grant
  already issued under the old name.

### Test corrections

Roughly twenty in 16A and a comparable number in 16B, each recorded with its reason beside it: plan
assertions corrected to what PostgreSQL actually does (an Incremental Sort is inherent when the index
is `(tenant_id, code)` and the order is `code, id`), a `DELETE` asserted as 201 when Nest answers 200,
a forced-RLS check widened from seven tables to nine, and source audits taught to strip comments and
string literals so they stop reporting the paragraphs that explain a refusal.

**No test was weakened, skipped or deleted, and no production code was changed merely to make a test
pass.**

---

## 17. Technical debt

1. **`workflow_step_awaiting_idx` is reached by no repository read.** It is `(tenant_id, instance_id,
   ordinal)` where the step is awaiting; the application derives an instance's awaiting steps from
   `steps.forInstance`, which is served by `workflow_step_ordinal_idx`, and a member's queue is served
   by `workflow_step_queue_idx`. The index is a narrower duplicate of one that is used: it costs a
   little write amplification and misleads a reader into thinking a query exists. **Not removed** —
   that is a migration — and **no read was added** for it.
2. **No cohort query.** `InstanceStore.search` accepts a single `subjectId` and no `subjectIdsIn`, so
   an adopting module asking about 200 records pays 200 bounded lookups. Measured and named for what
   it is rather than papered over.
3. **The Tier C all-instance listing is 91.4 ms against a 100 ms budget.** It is the one measured
   read whose work genuinely scales with the tenant — the count is over every row behind the
   predicate — and no index would change that. Recorded so the next phase does not meet it as a
   surprise.
4. **`branch-group-unresolved` and `branch-group-empty` are not distinguished for a soft-deleted
   group.** Both stop the same approval for the same reason; telling them apart needs a second read
   the application does not have.
5. **No volume above 100,000 approvals per tenant** and **no concurrency beyond two connections** has
   been measured.

---

## 18. NOT VERIFIED

None of the following exists in executable code anywhere in the module, and none has a placeholder
control, column, port, route or screen. Each is named in the product's own prose so the absence is
documented rather than left to be inferred.

SLA · business days · escalation · scheduled firing · `JobPort` · durable scheduler · manager routing
· role approvers · dynamic role or group directory · external approvers · notification delivery ·
analytics · approval expiry · automatic delegation expiry · outbox · broker · worker · self-service
portals · routing intelligence beyond the approved 16B core · cohort query · tenant-wide branch or
tally aggregates · volumes above 100,000 · concurrency beyond two connections · authentication
through the real Platform adapter.

Two are worth the extra sentence:

- **`expired`** is declared in `ApprovalPort`'s vocabulary and **this product never produces it**. The
  mapping is total so a reader can see the gap; the gap is not an operational state.
- **Authentication.** Every business endpoint answers 401 until Platform's adapter is supplied
  (ADR-0032). The suites establish tenancy and permission behaviour against a supplied context; they
  do not establish that a real token resolves to it.

---

## 19. Phase closure

Phase 16B delivered two tables, one additive migration, nine domain source files, three commands, two
queries, two permissions, one repository, five HTTP routes, five Admin sections and 228 localized
strings in two languages — and it did so without changing a completed module, adding a cross-module
contract, or introducing any Phase 16C infrastructure.

The routing core is real: a tenant can name who approves what, ask several of them at once, and have
the product decide the outcome by a rule the tenant chose — with every number an integer the server
computed, every list a snapshot taken when the approval started, and every capability the phase does
not have named rather than implied.

**Phase 16B is complete. Phase 16C has not started.**
