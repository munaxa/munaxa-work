# Phase 16B — Checkpoint 6 — API

**HTTP surface only.** No schema change, no migration, no domain rule, no application command or
query, no permission, no repository, no Admin screen and no cross-module adapter. No completed module
was touched.

The five approval-group handlers and the branch fields have been composed, permission-checked and
persisted since Checkpoints 4 and 5, and were unreachable over the wire. This checkpoint makes them
reachable and proves that nothing was added on the way through.

---

## What was written

`api/approval-group.controller.ts` — five routes over the two group tables. It is the only new
controller in the phase.

| Method | Path | Command or query | Permission |
| --- | --- | --- | --- |
| `GET` | `/approval-groups` | `workflow.search-approval-groups` | `workflow.approval-group.read` |
| `POST` | `/approval-groups` | `workflow.create-approval-group` | `workflow.approval-group.manage` |
| `GET` | `/approval-groups/:approvalGroupId` | `workflow.read-approval-group` | `workflow.approval-group.read` |
| `POST` | `/approval-groups/:approvalGroupId/members` | `workflow.add-group-member` | `workflow.approval-group.manage` |
| `DELETE` | `/approval-groups/members/:approvalGroupMemberId` | `workflow.remove-group-member` | `workflow.approval-group.manage` |

`workflow.dto.ts` gained `CreateApprovalGroupBody`, `AddGroupMemberBody` and `BranchConditionBody`;
`AddStepBody` gained `approverMembershipId` (now optional), `approverGroupId`, `branchRule`, `quorum`
and `condition`; `DecideStepBody` gained an optional `stepId`.

`version.controller.ts` carries the five step fields through, `approval.controller.ts` carries
`stepId`, and the existing instance reads now return `awaitingSteps` and `tallies` because the
application's view already produced them.

**Removing a member addresses the member row rather than a nested path.** The application's command
takes one identifier, so `/approval-groups/:groupId/members/:memberId` would put a group in the URL
that nothing verifies — and a caller naming group A while removing group B's member would be told
they had done what the URL said. Adding is nested, because there the group *is* the command's field.
The route shape is pinned by a test rather than left to convention.

---

## The kind of approver is derived, never sent

There is no `approverKind` property on any body, so `forbidNonWhitelisted` refuses one with a 400: a
client cannot claim `group` while naming a person, and `role` has no field in which to arrive. The
kind is derived from which identifier is present, and the two mistakes a well-formed body can still
make are the **domain's** refusals rather than the edge's:

- both `approverMembershipId` and `approverGroupId` → 422, `step-approver-ambiguous`
- neither → 422, `step-approver-required`

422 rather than 400 because both bodies are well formed on the wire, and which one the administrator
meant is a question about the process they are configuring.

---

## What the API refuses to be told

No shape accepts `membershipId` as an actor, `approverMembershipId` on a decision,
`workforceUserId`, `platformUserId`, `actorMembershipId`, `decidedByMembershipId`,
`onBehalfOfMembershipId`, `delegate`, `me`, `self`, or any tenant identifier. The acting membership
comes from the authenticated request and the tenant from the request context; both are asserted by
attempting the substitution over the wire rather than by reading the DTOs.

`membershipId` **is** a field on `POST /approval-groups/:id/members`, and that is a different thing:
it names who goes on a list, not who is asking. A test sends a group body carrying `tenantId`,
`status` and `ownerMembershipId` and earns a 400 for each — a tenant that could arrive in a body is a
tenant a client chooses, and a `status` silently dropped would be a lifecycle somebody thought they
had set.

The queue keeps its Checkpoint 4 shape: it takes no caller identity, and `stepId` on a decision
**narrows** the caller's own awaiting steps and cannot widen them — naming a colleague's step earns
the same 422 as sending nothing would.

---

## Nothing is computed at the edge

No controller contains a threshold, a denominator, an outcome or a comparison. `branchRule`, `quorum`
and `condition` are carried through untouched, and the tally in every response is the application's
own view. A route test strips comments **and string literals** from all five controller sources and
asserts the arithmetic is not there — the string strip was added because `approvals` legitimately
appears inside an `@ApiOperation` summary, and an assertion that failed on prose would have been
answering a different question than it asked.

---

## What the suites establish

| Property | Where |
| --- | --- |
| Bilingual create, read-back, deterministic member order, an instant as a string | `workflow.groups` |
| 400 for a malformed code, a half-named list, a non-UUID, an unknown property | same |
| 409 for a repeated code in one tenant, 201 for the same code in another | same |
| 409 for a membership already on a list, 404 for a list that is not there | same |
| Removal takes exactly the named row, answers 200, and is invisible across tenants | same |
| Two tenants: each sees only its own lists, and each total counts only its own | same |
| Paging: deterministic, no overlap, past-the-end is an empty page, malformed falls back, size capped | same |
| A step takes a person or a list; both → 422; neither → 422; `approverKind` → 400 | `workflow.branches` |
| An unknown list → 404 while the administrator is still editing | same |
| Three branch rules accepted, a fourth → 400; quorum ≥ 1, and 0, −1, 1.5 → 400 | same |
| A quorum larger than its branch → 422 at publication | same |
| Five condition operators accepted; unknown operator, missing key, missing value → 400 | same |
| A text bound on an ordering comparison → 422, left to the domain rather than guessed at the edge | same |
| A group branch end to end: two asked at once, one tally, two queues, one completed approval | `workflow.parallel` |
| A decision from somebody never asked, and one naming a colleague's step → 422 | same |
| Row-level security enabled and forced on all **nine** tables, under a non-superuser role | `workflow.tenancy` |
| 22 routes for 22 handlers, reconciled by name against the module's own registration | `workflow.routes` |
| Every route refused for every permission other than its own | `workflow.authorization` |

The parallel suite is the checkpoint's centre: a bilingual list, two members, a `unanimous` group
branch at ordinal 1 and a single approver at ordinal 2, published and started over HTTP. It asserts
two awaiting steps and an opening tally of `{assigned: 2, threshold: 2, outcome: 'awaiting'}`, one
pending row per member, `approvals: 1` after the first decision, `approved` and one newly-opened step
after the second, a completed instance after the third, and a timeline holding **three**
`step-awaiting` entries — two people asked at once is two entries, and a timeline recording one would
be telling the second of them they had never been asked.

Nothing on that path is mocked: real controllers, the real `ValidationPipe`, the real guard, the real
application, the real PostgreSQL repositories and real row-level security.

---

## One fixture defect

Creating a group over HTTP answered **500**. The unprivileged API role had no grants on
`workflow_approval_group` or `workflow_approval_group_member`, because the cross-module role fixture
lists its tables by hand and Checkpoint 3 added two.

Classified as a **fixture** defect and fixed there. The schema, the policies and the repositories
were correct; a role that had never been granted anything is refused by PostgreSQL exactly as it
should be. It is the fifth of this family found in the phase, and the answer each time was to grant
what the fixture always meant to, never to loosen the boundary.

Two assertions were corrected to what actually happens rather than what was expected: `DELETE`
answers **200** under Nest, not 201, and the tenancy suite's forced-RLS check now covers nine tables
rather than seven.

---

## Preserved

Nine permissions, unchanged and unextended — the two group permissions are Checkpoint 4's, and
`workflow.instance.start` still does not imply `workflow.approval-group.manage`. Twelve commands and
ten queries, each reachable by exactly one route, reconciled by name against `workflowModuleFor`
rather than counted. No generic execute endpoint. No controller reaches a repository, Prisma or the
Recruitment seam. No `Date` and no domain type crosses the boundary in either direction.

---

## Gates

- `pnpm standards`: clean — 176 architecture models, 17 catalogues, 1,669 files, no cycles, no unused
  dependencies.
- `format:check`, `lint`, `typecheck`, `build`: clean, 47/47 and 27/27.
- Prisma validate and migrate status: valid, database up to date, 22 migrations — unchanged, as this
  checkpoint added none.
- Repository-wide, uncached, `--concurrency=1`: **3,430 passed, 0 failed, 0 skipped**, 334 files,
  47/47 tasks. The Workflow API suites within it: 20 files, 178 tests.

---

## Not verified

- No Admin screen shows a group, a branch tally, a quorum or a condition. Nothing in `apps/admin`
  changed, and every 16B surface remains API-only until Checkpoint 7.
- No route evaluates a condition against a subject's context: conditions are stored and returned, and
  the evaluation is the domain's, unchanged from Checkpoint 2.
- Performance at volume. These are correctness tests at fixture size; the benchmark tiers belong to
  the performance checkpoint.
- Everything the Phase 16B plan lists as `NOT VERIFIED` remains so: SLA, escalation, scheduling,
  notification, analytics, manager routing, role approvers, external approvers, approval expiry — and
  no route exists through which any of them could be requested.
