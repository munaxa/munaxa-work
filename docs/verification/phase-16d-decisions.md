# Phase 16D — Contract Gap Decisions

**All three decisions below are `OPEN — awaiting explicit approval`.** None is approved. No
implementation was performed, and nothing here may be treated as authorization to begin one.

This document records the decisions. The investigation that produced them is preserved unchanged in
[`phase-16d-contract-gap.md`](phase-16d-contract-gap.md) and
[`phase-16d-admin.md`](phase-16d-admin.md); neither has been rewritten.

---

## 1. Current commit

`e94ead0` on `claude/phase-5-employment-workforce-xaxasu`.

---

## 2. D-16D-09 — A public escalation marker on `WorkflowStepView`

**Status: `OPEN — awaiting explicit approval`.**

### Finding

`workflow_step.escalated_at` already reaches the application layer in full. It is in the SELECT list
(`infrastructure/workflow-record-rows.ts:175`), mapped into `WorkflowStepState.escalatedAt` at
`:197`, and written at `:221`. The only missing step is the public projection: `asStepView`
(`application/workflow-views.ts:188-203`) copies eleven fields and omits it.

No schema change, no query, no repository call, no round trip, no route and no permission are needed
to publish a marker derived from it.

### Recommendation

Add one required field to `WorkflowStepView`:

```
readonly escalated: boolean;
```

`true` if and only if `WorkflowStepState.escalatedAt !== undefined`; `false` otherwise. It means
exactly one thing — *this step was added by escalation* — and nothing about when, by whom, or why.

Required rather than optional deliberately: an omitted field cannot be distinguished from an older
server, so "absent" would drift into meaning "probably not escalated", which is the ambiguity the
marker exists to remove. The derivation is total over every step ever written, including every row
predating migration #24 — those have `escalated_at IS NULL` and are correctly `false`, because
escalation did not exist when they were written. **No backfill is needed and none should be run.**

### Rejected alternatives

| Alternative | Why it is rejected |
|---|---|
| Publish `escalatedAt` itself | Exposes an internal timestamp for a distinction that needs no timestamp. Checkpoint 6 withheld it deliberately. |
| Derive from `sourceGroupId` | Does not distinguish. An escalated step never carries one — and neither does a step a tenant typed a membership into directly. `undefined` means "not from a group", true of both. |
| Derive from row counts | Explicitly unreliable under D-16D-08: the denominator is the snapshotted assigned set and escalated rows are *meant* not to move it. A consumer learns *how many* steps were escalated, never *which*, and one escalation plus one group expansion are indistinguishable. |
| Join the `step-escalated` history event | History is paginated at `page=1&size=50` (`apps/admin/src/workflow/api.ts:54,220`). An older event falls outside the fetched page, the join returns nothing, and the row renders as an **ordinary assigned approver** — failing silently, in the wrong direction, on exactly the long-running approvals where the distinction matters. |
| Add no marker | Recorded explicitly: **no reliable alternative was found.** If this is chosen, Checkpoint 7 requirement 2 should be formally withdrawn rather than left open. |

### Exact contract change

Two production lines.

```
packages/modules/workflow/src/contracts/views.ts
    + readonly escalated: boolean;          // on WorkflowStepView

packages/modules/workflow/src/application/workflow-views.ts
    + escalated: state.escalatedAt !== undefined,   // in asStepView, outside definedOf()
```

Outside `definedOf()` so the field is always present rather than dropped when `false`.

### Invariants preserved

The marker publishes a predicate the domain **already applies**
(`assignedOf = members.filter(m => m.escalatedAt === undefined)`, `domain/branch.ts:78-80`). It is a
projection, not a second source of truth, and it changes no computation:

`assigned` · `threshold` · `outstanding` · `unresolved` · `outcome` · `quorum` · `branchRule` ·
every service-level value — all remain computed in the domain exactly as today.

Also unchanged: no `escalatedAt`, no actor, no reason, no manager, employment, reporting-line or
department information; no source-group internals; no new permission; no new route; no delegability
(`DELEGABLE_SCOPES` stays `['workflow.approval.decide', '*']`); no filtering or sorting by the new
field. The tally remains the **only** published authority on the denominator — a consumer must never
sum the marker to recompute one.

### Known consequence

`apps/api/src/workflow/workflow.escalation.spec.ts:126-147` scans the whole serialized response and
forbids the substring `escalated`. Approving D-16D-09 **will make that test fail, correctly** — the
approved public contract will have changed.

**Do not weaken that test before approval.** After approval, the honest repair is to narrow the scan
to the provenance still withheld (`escalatedat`, actor, reason) and add a positive assertion that
`escalated` is present and boolean. It must not be repaired by deleting the scan.

The same applies to Admin's forbidden-heading list: `escalat` stays forbidden until a column is
approved, at which point the word becomes a description of published data rather than a claim about
absent data, and the pairing test is narrowed and asserted rather than deleted.

---

## 3. D-16D-10 — Authenticated Admin → API request architecture

**Status: `OPEN — awaiting explicit approval`. This is the primary architectural blocker, and it is
very likely outside Phase 16D.**

### Current authentication state

There is none. `apps/admin` propagates no identity to the API.

### Evidence

| Fact | Evidence |
|---|---|
| Every request is headerless | All 15 module loaders call `fetch(url, { cache: 'no-store' })`. Extracting the second argument from every `fetch` in `apps/admin/src` yields exactly one unique value. No `Authorization`, no `credentials`, no cookie, no tenant header, no API key. |
| There is no shared HTTP helper | No `src/lib`, `src/shared` or `src/utils` exists; each module defines its own private `read` and its own `BASE`. |
| The only environment input is a URL | `portalEnvironmentSchema` has exactly one field, `WORK_API_URL` (`packages/config/src/portal-environment.ts:17-20`). |
| The API expects a bearer token | `apps/api/src/tenancy/tenant.middleware.ts:16,110-119`. |
| Every business endpoint therefore 401s | `AuthenticatedTenantGuard` is registered globally (`apps/api/src/app.module.ts:67`) and throws `UnauthorizedException('Not authenticated.')` (`authenticated-tenant.guard.ts:56-62`). |
| Admin renders that as unavailability | `apps/admin/src/workflow/api.ts:91-100` converts a non-OK response to `undefined`, surfaced as `unavailable: true`. |
| It is deliberate and documented | `apps/admin/src/workflow/api.ts:31` — *"Every business endpoint returns 401 until Platform's authentication adapter is supplied; this repository authenticates nobody, by design (ADR-0032)."* |
| No write surface exists either | Across all 137 tracked files of `apps/admin`: zero `'use server'`, zero `route.ts`, no `middleware.ts`, zero form controls, zero non-GET `fetch`, and no DOM test environment. Absence is enforced by `boundary.test.ts:111` and `page.test.tsx:111`. |

**This is not a Workflow problem.** It is not that escalation lacks a button; it is that the portal
has no authenticated path of any kind, for reading or for writing.

### Why a service credential is forbidden

A shared bearer token held by `apps/admin` would let the portal act as one privileged identity for
every operator. Permission checks in the API are evaluated against the **caller**, so a service
credential collapses every distinct user into one, and the per-user permission boundary the API
exists to enforce ceases to exist. Escalation makes this concrete: `workflow.approval.escalate` was
approved as a narrow, non-delegable capability precisely so that holding it is a deliberate grant to
a named person. A service credential would hand it to everyone who can open the page.

Equally forbidden, and recorded so each is refused explicitly rather than by omission: creating a
shared credential; making Admin act as the tenant administrator; bypassing or weakening the API
guard; reusing an unrelated permission; putting credentials in client-side code; fabricating an
authenticated identity; or building a Workflow-specific authentication mechanism.

### Ownership question

**Does an approved Platform or ADR contract already define this?** I searched, and the answer is no.

- **ADR-0001 (Platform Ownership)** — *"Platform owns Authentication, Authorization, Design System,
  RBAC, Shared Components, Shared Infrastructure. Munaxa Work consumes Platform. Never duplicate
  Platform functionality."*
- **ADR-0019 (Security)** — *"Authentication belongs to Platform. Business authorization belongs to
  Munaxa Work."*
- **ADR-0032** defines how a tenant is *resolved from* an already-authenticated principal. It does
  not define how a portal obtains one.
- **The 49 ADRs numbered 0021–0074 contain no record about portal authentication, sessions, token
  acquisition, CSRF or credential storage.** Nothing in `docs/adr/` addresses it.

So the two founding ADRs place this squarely with Platform and forbid Munaxa Work from building its
own, and no approved contract yet says how the portal consumes it. Per the brief's own rule — *"do
NOT recommend a concrete implementation unless an existing approved Platform/ADR contract already
defines it"* — **I recommend no implementation, and D-16D-10 remains open.**

### Exact decisions required

Each of these is unanswered today:

1. **Credential/token source** — where does a portal request obtain a Platform token?
2. **Authenticated user propagation** — how does the operator's identity, not the portal's, reach the API?
3. **Server-side vs browser-side handling** — does the credential ever exist in the browser?
4. **Session/cookie vs bearer model** — the choice that determines every answer below it.
5. **CSRF protection** — not currently a live risk (no ambient credential exists anywhere; `csrf`, `xsrf`, `SameSite` and `helmet` return zero matches in both apps), and it becomes one the moment a browser holds a credential.
6. **Tenant propagation** — how the tenant selector reaches `resolveTenant` for an operator in several tenants.
7. **Permission evaluation** — confirmation that it stays per-caller in the API and is never mirrored in the portal.
8. **Logout and session expiry.**
9. **Error handling** — how 401 and 403 are distinguished from the existing `unavailable: true`.
10. **Test strategy** — `apps/admin` has no DOM environment and no interaction test in its history; §13 of Checkpoint 7 forbids adding one.
11. **Ownership of the implementation.**
12. **Whether this belongs to Platform / ADR-0001 / ADR-0019 rather than to Workflow.** On the evidence above, it does.

**No owner is named in this repository, and I have not invented one.**

---

## 4. D-16D-11 — Source of eligible approver memberships

**Status: `OPEN — awaiting explicit approval`. Blocked behind D-16D-10 for implementation.**

### Existing contracts investigated, and why each is insufficient

| Contract | Route | Permission | Why insufficient |
|---|---|---|---|
| `identity.list-memberships` | `GET /api/v1/identity/members` | `identity.membership.read` | Whole-tenant directory. Requires a **second** permission, so a user granted exactly `workflow.approval.escalate` could not use the screen — the permission would stop being sufficient for the capability it names. Enumerates every member of the tenant. |
| `identity.search-members` | `GET /api/v1/identity/members/search` | `identity.profile.read` | Same second-permission and breadth problems, plus it requires a typed term — which needs browser JavaScript, forbidden by stop condition 8. |
| `workflow.read-approval-group` | `GET /api/v1/workflow/approval-groups/:id` | `workflow.group.read` | Its own contract (`contracts/views.ts:155-161`) says a group is *"resolved into individual approvers when an approval starts and **never consulted again by one that is already running**."* Escalation acts on a running approval. It is also unrelated to the approval, and reading every group is an N+1. |

Also confirmed absent: **Organization, People and Employment publish nothing membership-shaped** —
`PersonView` and `EmploymentView` carry no `membershipId`, and Identity's employment↔membership
bridge queries have no HTTP route. `TenantMembershipDirectory.activeMembershipsOf(platformUserId)`
answers the opposite question (one person's tenants) and is an injected port, not a query.

### Recommended narrow Workflow query

A purpose-built Workflow query answering only:

> *"Which active tenant memberships may be selected as an additional approver for this running
> approval branch?"*

permissioned with the **existing** `workflow.approval.escalate`, tenant-scoped, bounded, returning
bare `membershipId` values, and excluding memberships already on the branch — which the domain would
otherwise refuse with `escalation-approver-already-assigned`.

### One constraint in the brief cannot be met as written — this needs an explicit decision

> *"no Identity dependency if the existing Workflow persistence can answer it"*

**Workflow's persistence cannot answer it.** Workflow owns nine tables
(`WorkflowDefinition`, `WorkflowVersion`, `WorkflowApprovalGroup`, `WorkflowApprovalGroupMember`,
`WorkflowStepTemplate`, `WorkflowInstance`, `WorkflowStep`, `WorkflowDecision`, `WorkflowHistory`).
**None is a membership table.** They hold `membership_id` values as opaque foreign values —
`approval-group.use-case.ts:92-93` states it directly: *"The membership is taken as given and never
resolved. Workflow does not ask Identity whether this person exists."*

So Workflow can enumerate only the memberships that already appear on its own rows, which is the
wrong set — and, decisively, **`status` lives on Identity's `tenant_membership` table**
(`prisma/schema.prisma:41`). Workflow cannot tell whether a membership is *active*, which the
requirement explicitly demands. Querying that table directly would be a cross-module table read,
forbidden by ADR-0043's rule that another module is reached through its published application
service, never its repositories or tables.

**The compliant form is therefore a bounded port, not a broad permission.** ADR-0043 exists for
exactly this case: *"so one module may act inside another without widening a user's role."* Workflow
already holds two such ports — `reportingLine: ReportingLinePort` (16C's manager routing) and
`delegation: DelegationPort` — each a narrow injected contract answering one question, with no
directory permission required of the user. A third, answering only *"is this membership active in
this tenant"* or *"which memberships are active in this tenant"*, follows the established precedent.

This is a **refinement of the recommendation that requires its own approval**, because it changes the
answer from "no Identity dependency" to "a new bounded Identity port under ADR-0043". I have not
adopted it silently.

### Exact security constraints if approved

- No new permission — the caller must already hold `workflow.approval.escalate`.
- Tenant remains ambient, from the authenticated context, never a parameter.
- Active memberships only.
- No broad tenant member directory, and no directory permission required of the user.
- Any Identity fact reached through a bounded port under ADR-0043 — never a table, repository, or
  broad query.
- No arbitrary UUID accepted as the UI's source of truth.
- No N+1; bounded and paginated if the result can be large.
- Excludes memberships already assigned to the branch.
- Respects the branch's existing eligibility rules.
- Does not change the branch denominator.
- Does not modify escalation semantics — the query narrows a picker, it never pre-authorizes. All
  five `escalateBranch` refusals still apply at the command, which remains the authorization
  boundary.

### Do not build this yet

It is a read supporting a write that cannot be invoked from Admin while D-16D-10 is unresolved.
Approve it conceptually if you wish; implementation waits.

---

## 5. Dependency graph

```
D-16D-09  (public escalation marker)
    └─> API publishes `escalated: boolean`
            └─> Admin can DISTINGUISH assigned from escalated
                 [independent — deliverable on its own]

D-16D-10  (authenticated Admin → API architecture)      ◀── PRIMARY BLOCKER
    └─> Admin can authenticate at all
            └─> Admin can legitimately INVOKE escalation
                    │
                    └─> D-16D-11  (eligible approver memberships)
                            └─> Admin can obtain a valid approverMembershipId
                                    └─> Admin can CONSTRUCT the escalation command
```

**D-16D-09 is independent** and delivers Checkpoint 7 requirement 2 on its own.

**D-16D-10 blocks everything else**, and on the ADR evidence belongs to Platform rather than to
Phase 16D. **D-16D-11 must not be implemented before D-16D-10 resolves.**

---

## 6. Implementation files that would eventually change, after approval

### If D-16D-09 is approved — and only D-16D-09

| File | Change |
|---|---|
| `packages/modules/workflow/src/contracts/views.ts` | one required field on `WorkflowStepView` |
| `packages/modules/workflow/src/application/workflow-views.ts` | one line in `asStepView` |
| `apps/api/src/workflow/workflow.escalation.spec.ts` | narrow the leak scan; add a positive assertion |
| `apps/admin/src/workflow/views.fixture.ts` | set the field on the escalated fixture step |
| `apps/admin/src/workflow/instances.tsx` (or `branches.tsx`) | render the distinction |
| `apps/admin/src/workflow/notices.test.tsx` | narrow the forbidden-heading entry; assert the column |
| `packages/modules/workflow/locales/{en,ar}.json` | one column label, both languages |
| `docs/verification/phase-16d-admin.md` | record requirement 2 as delivered |

No migration, no repository change, no permission change, no new route, no new query.

### If D-16D-10 is approved

**Not enumerable.** The file list is a function of the credential model, which is the decision
itself. It will span `apps/admin` application-wide, `packages/config`, and possibly `apps/api` — not
Workflow alone.

### If D-16D-11 is approved

Not to be written until D-16D-10 resolves. It would touch Workflow's query layer, module
registration, one API route, `WorkflowDependencies` (a new bounded port), the Identity adapter
implementing it, and the compositions — the exact list depends on the port decision above.

---

## 7. Statement

**No implementation was performed.**

No domain, application, repository, schema, migration, API, DTO, permission, Admin, Identity,
Employment, Organization or Recruitment file was created or modified by this checkpoint. No
implementation gate is claimed, because no implementation occurred; only `pnpm standards` and
`pnpm format:check` were run, as the documentation-only rule allows.

D-16D-09, D-16D-10 and D-16D-11 are each recorded as **`OPEN — awaiting explicit approval`**. None
has been marked approved, and none has been written into the Phase 16D decision register as
approved. A recommendation being technically attractive is not approval.

When an owner explicitly approves any of them, this document gains the approval date, the approved
option, the rejected alternatives and the constraints — appended, never by rewriting what is above.

---

## 8. Decision table — status as at 2026-08-18

Appended, not substituted for anything above. **No approval has been recorded.** The instruction that
produced this section states its own recommendations and then says *"Do not infer approval from the
recommendations"* and *"Update the decision register only after explicit approval"*; the response
template it supplies carries `OPEN` in every row. All three therefore remain open.

| Decision | Recommendation | Approved? | Constraints |
|---|---|---|---|
| D-16D-09 | `WorkflowStepView.escalated: boolean` | **OPEN** — awaiting explicit approval | narrow marker only; no timestamp, actor, reason, employment, reporting line or internal provenance; alters no tally value; no schema, query, repository, permission or route change; no backfill; leak test narrowed, never deleted, and only after approval |
| D-16D-10 | Platform authentication remains outside 16D | **OPEN** — awaiting confirmation as `OPEN / PLATFORM-OWNED / OUTSIDE PHASE 16D` | no Work-side authentication invention; no service credential, shared token, guard bypass, browser-held credential or Workflow-specific mechanism; per-user permission model intact; twelve sub-decisions remain unanswered; no owner assigned beyond ADR-0001 and ADR-0019 |
| D-16D-11 | Bounded Identity port for active eligible memberships | **OPEN** — awaiting explicit approval | no broad directory, search, role directory, org chart or people directory; no `identity.membership.read` or other broad Identity permission; ADR-0043 bounded pattern; caller holds `workflow.approval.escalate` only; tenant ambient; bounded, ordered, no N+1; excludes memberships already on the branch; no client-supplied UUID as source of truth; **exact contract not yet defined — see §9** |

**Approval date: none.** No decision below has been approved, amended or declined, and nothing has
been written into the Phase 16D decision register as approved. Rejected alternatives and constraints
for each decision are preserved in §2, §3 and §4 above and are not restated here in reduced form.

**Consequence for sequencing.** D-16D-09 is independent and is the only one that could proceed on
approval alone. D-16D-10 blocks D-16D-11's implementation regardless of D-16D-11's own status. No
workaround for either blocker has been invented.

---

## 9. D-16D-11 pre-work — eligibility criteria identified from existing Workflow rules

The instruction asks, before implementation: *"Do NOT assume that all active memberships are
eligible… If additional eligibility criteria are required by the existing Workflow rules, identify
them before implementation."* This section is that identification. **It is not a contract**, and it
resolves nothing — it reports what the domain enforces today and what it does not.

### 9.1 What `escalateBranch` enforces today

`packages/modules/workflow/src/domain/escalation.ts`, in the order the refusals fire:

**Branch-level preconditions** — these decide whether an escalation picker should be *offered at
all*, not who appears in it:

| Rule | Refusal |
|---|---|
| The approval is running | `escalation-instance-not-running` |
| The branch at this ordinal exists and at least one step is `awaiting` | `escalation-branch-not-awaiting` |
| The branch's rule is not `unanimous` (D-16D-08) | `escalation-branch-is-unanimous` |

**Per-membership exclusions** — the actual eligibility predicate, and it has exactly two clauses:

| Rule | Refusal |
|---|---|
| Not already assigned on **this branch** (`escalatedAt === undefined`) | `escalation-approver-already-assigned` |
| Not already escalated onto **this branch** | `escalation-already-escalated` |

Both are scoped to the branch, so the query needs `instanceId` **and** `ordinal` to compute the
exclusion set — meaning it must read Workflow's own steps *and* consult the Identity port. The
composition shape is itself a decision.

### 9.2 Five criteria the recommendation assumes that the domain does **not** enforce

Each is an open question, not a defect claim. I cannot tell from the code whether any was a
deliberate exemption or an omission, and I have not guessed.

**(a) Active status is not checked anywhere.** `escalateBranch` never asks whether the membership is
active, or whether it exists at all. `approval-group.use-case.ts:92-93` states the position
module-wide: *"The membership is taken as given and never resolved. Workflow does not ask Identity
whether this person exists."* An active-only picker would therefore be **stricter than the command it
feeds**. Two coherent resolutions, and they are not equivalent:

- *(i)* the picker is advisory and the command stays permissive — an accepted, documented divergence
  in which a caller can still escalate to an inactive membership through the API;
- *(ii)* the command gains an active-membership check — a **domain change**, a sixth refusal, and a
  new port dependency on the write path, requiring its own approval.

This choice cannot be made silently, because it determines whether the port is consulted on read
only or on write as well.

**(b) The requester is eligible, and the manager path says they should not be.** `resolveManager`
refuses `manager-is-the-requester` (`domain/manager.ts:104-106`), on stated grounds: *"Somebody who
manages themselves… would otherwise be asked to approve their own request, and the approval would
look like a process while being a formality."* `escalateBranch` applies no such rule — escalating to
`instance.requestedByMembershipId` is currently permitted. Is escalation intentionally exempt from
the self-approval rule, or is this a gap?

**(c) 16A's D-5 cycle rule is not applied.** D-5 is recorded as *"a step may not name an approver
already terminal on the same instance"* (`domain/manager.ts:86-87`). `escalateBranch` inspects only
the **branch**, never the instance. Escalating to somebody who already approved or rejected at an
earlier ordinal is therefore permitted today, and gives that person a second, later say on the same
approval. Whether escalation is exempt from D-5 is unresolved.

**(d) Delegation is not considered.** Escalation is deliberately not delegable, but a delegate of an
already-assigned approver is not "already assigned" — the domain compares `approverMembershipId`
only. Escalating to a delegate would give one approver's authority two seats on the same branch.

**(e) Bounds and ordering have no approved rule.** Tenant membership count is unbounded; nothing
establishes a maximum result size or a deterministic order.

### 9.3 Consequence

Points (b) and (c) matter beyond the picker: if either is answered *"should have been refused"*, then
the **shipped** `workflow.escalate-branch` command has a gap, and the fix belongs in the domain
rather than in a query that hides it. Per the standing rule for a discovered defect, I have stopped
and reported rather than changed anything.

**Even if D-16D-11 is approved, its exact membership eligibility contract remains ambiguous on five
counts, so implementation stops here** — which is the stop condition the instruction sets out.
Defining the port contract (method, input, output, eligibility predicate, maximum result size,
ordering, authorization, tenancy, failure semantics) requires (a)–(e) to be answered first.
