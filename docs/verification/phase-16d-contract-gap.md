# Phase 16D — Checkpoint 8 — Stopped / Contract Gap Review

**Investigation only. No implementation was performed.** No domain, application, repository, schema,
API, Admin, Identity, Employment, Organization or Recruitment file was modified. The only file added
by this checkpoint is this document.

**Result: B — explicit decisions are required before implementation.** Neither blocker is solvable
with existing approved contracts and patterns, and the investigation found a **third blocker** that
sits underneath Blocker B and is larger than it.

---

## 1. Current commit

`535ca9b` on `claude/phase-5-employment-workforce-xaxasu`. Working tree clean at the start of this
checkpoint.

---

## 2. The public `WorkflowStepView` contract

`packages/modules/workflow/src/contracts/views.ts:228`, in full and unabridged:

| Field | Type | Optional |
|---|---|---|
| `stepId` | `string` | required |
| `instanceId` | `string` | required |
| `ordinal` | `number` | required |
| `approverKind` | `ApproverKind` | required |
| `approverMembershipId` | `string` | required |
| `status` | `WorkflowStepStatus` | required |
| `sourceGroupId` | `string` | optional |
| `branchRule` | `BranchRule` | optional |
| `quorum` | `number` | optional |
| `condition` | `readonly BranchConditionView[]` | optional |
| `serviceLevel` | `StepServiceLevelView` | optional |
| `version` | `number` | required |

Twelve fields. **None of them is an escalation marker.**

---

## 3. Exact evidence that escalation cannot currently be distinguished

**3.1 The state carries it; the view drops it.** `WorkflowStepState.escalatedAt?: Date`
(`domain/instance.ts:133`) is populated from the column, and the mapper
`asStepView(state, asAt)` (`application/workflow-views.ts:188-203`) copies eleven fields and
**omits `escalatedAt`**. The information reaches the mapper and stops there.

**3.2 The persistence layer already reads it.** `escalated_at` is in the SELECT list
(`infrastructure/workflow-record-rows.ts:175`), mapped in at `:197`, written at `:221`. This matters
for §13–§14: publishing a derived marker costs **no additional query, join, or round trip.**

**3.3 The API deliberately withholds it, and asserts so.**
`apps/api/src/workflow/workflow.escalation.spec.ts:126-147` serialises the *entire* instance-detail
response and asserts the lowercased body contains none of `escalated`, `escalation`, `sourcegroupid`,
`employment`, `reporting`, `manager`.

**3.4 `sourceGroupId` is orthogonal, not a proxy.** `escalateBranch`
(`domain/escalation.ts`) spreads only `branchRule`, `quorum`, `condition`, `serviceLevel` onto the
new step — an escalated step **never** carries `sourceGroupId`. But neither does a step a tenant
typed a membership into directly. `sourceGroupId === undefined` therefore means "not from a group",
which is true of both an escalated approver and an ordinary assigned one.

**3.5 Row counts cannot recover it, and are wrong by design.**
`assignedOf(members) = members.filter(m => m.escalatedAt === undefined)` (`domain/branch.ts:78-80`)
is the denominator. Under D-16D-08 the tally is *supposed* to disagree with the row count; a
consumer comparing `steps.length` to `tally.assigned` learns only *how many* steps were escalated,
never *which*. With one escalation and one group expansion the two effects are indistinguishable.

**3.6 The history join is unsafe, as reported in Checkpoint 7.** Admin fetches
`page=1&size=50` (`apps/admin/src/workflow/api.ts:54,220`). Past fifty entries the `step-escalated`
event falls off the fetched page and the join returns nothing — which renders an escalated approver
as an **ordinarily assigned** one, silently, on exactly the long-running approvals where the
distinction matters. Raising the page size moves the threshold rather than removing it.

**Conclusion.** Every non-forbidden derivation is either impossible or unsound. This is a contract
gap, not an Admin defect.

---

## 4. Recommendation — the narrowest public marker

`escalated: boolean` on `WorkflowStepView`, **required and non-optional**, derived in the mapper as
`state.escalatedAt !== undefined`.

Required rather than optional on purpose: an omitted field cannot be distinguished from an old
server, and "absent" would come to mean "probably not escalated", which is the ambiguity the whole
marker exists to remove. It is a total function over every step, including every step written before
migration #24 — those have `escalated_at IS NULL` and are correctly `false`, because escalation did
not exist when they were written. **No backfill is needed and none should be run.**

What it publishes: *that* a step was added. What it does not publish: **when** (`escalatedAt`),
**who** (the actor), **why** (no reason field exists), and nothing about employment, reporting lines,
departments, or the manager chain.

It changes no arithmetic. `assigned`, `threshold`, `outstanding`, `unresolved`, `outcome`, `quorum`,
`branchRule` and every service-level value are computed in the domain from `escalatedAt` exactly as
they are today; the marker is a projection of a predicate the domain already applies, not a second
source of it.

---

## 5. Existing Admin mutation patterns — **none exist, anywhere**

Across all 137 tracked files of `apps/admin`, covering all sixteen modules, not only Workflow:

| Searched for | Result |
|---|---|
| `'use server'` | **0** — no server action anywhere |
| `'use client'` | **0** in production; 2 hits, both string literals in tests asserting its absence |
| `route.ts` / `route.tsx` under `src/app` | **0 files** — only 16 `page.tsx`, `layout.tsx`, `manifest.ts`, `globals.css` |
| `middleware.ts` | **does not exist** |
| `<form`, `action=`, `onSubmit`, `onClick`, `onChange` | **0** in production code |
| `useState`, `useEffect`, `useRouter`, `useActionState`, `useFormState` | **0** |
| `revalidatePath`, `revalidateTag`, `redirect(` | **0** |
| `next/navigation`, `next/headers`, `next/cache`, `next/link` | **0** — the only `next` imports are type-only `Metadata`/`Viewport` |
| non-GET `fetch` | **0** — see §6 |

The single JSX control in the whole application is `<Button>Continue</Button>` at
`apps/admin/src/app/page.tsx:30` — the bootstrap page, with no `onClick`, no form and no action,
existing (per its own comment) to prove the design system resolves in a real build.

The absence is **test-enforced**, not incidental: `apps/admin/src/workflow/boundary.test.ts:111`
scans production source for `['use client','useState','useEffect','useRouter','onClick','window.']`,
and `page.test.tsx:111` scans the rendered markup for
`['<form','<button','<input','<select','<textarea','<dialog','onclick','onsubmit','href=']`. The same
pattern exists in the Career portal, whose test says in as many words: *"this portal has no mutation
architecture."*

`next.config.ts` is ten lines with no `serverActions` block, no `headers()`, no `rewrites()`.
`package.json` carries no form library, no state manager, no HTTP client and no auth library.

---

## 6. Authentication propagation — **there is none**

This is the finding that reframes Blocker B. Every one of the fifteen module loaders in `apps/admin`
makes the identical call. `apps/admin/src/workflow/api.ts:91-100`:

```ts
const response = await fetch(`${BASE}/api/v1/workflow${path}`, { cache: 'no-store' });
```

Extracting the second argument from all fifteen `fetch` call sites yields exactly one unique value:
`{ cache: 'no-store' }`. **No `Authorization` header. No `credentials`. No cookie. No tenant header.
No API key.** There is no shared HTTP helper — no `src/lib`, `src/shared` or `src/utils` exists; the
pattern is duplicated per module. The only environment input is `WORK_API_URL`
(`packages/config/src/portal-environment.ts:17-20`) — a schema with exactly one field.

The API authenticates by **bearer token in the `Authorization` header**
(`apps/api/src/tenancy/tenant.middleware.ts:16,110-119`), and `AuthenticatedTenantGuard` is
registered globally (`apps/api/src/app.module.ts:67`); with no principal it throws
`UnauthorizedException('Not authenticated.')` (`authenticated-tenant.guard.ts:56-62`).

So **every Admin request to a real API returns 401 today.** The loader converts that to
`unavailable: true` and the page says the service did not answer. `apps/admin/src/workflow/api.ts:31`
states it outright: *"Every business endpoint returns 401 until Platform's authentication adapter is
supplied; this repository authenticates nobody, by design (ADR-0032)."*

This means Blocker B is not "Admin has no *write* path." It is: **Admin has no authenticated path at
all, and authentication is Platform's to supply (AD-001), not Workflow's and not this checkpoint's.**
A mutation architecture cannot be designed on top of an identity that does not yet exist — the CSRF
answer, the error-handling answer and the actor-propagation answer all depend on whether the eventual
credential is a bearer token held server-side or a browser cookie.

---

## 7. CSRF protection — **no pattern exists, and none is currently needed**

`csrf`, `xsrf`, `SameSite` and `helmet` return **zero matches** in `apps/admin` and **zero** in
`apps/api`. The only `cookie` occurrences in `apps/api` are log-redaction paths
(`observability/logging.ts:30,32`).

There is no cookie session anywhere, so the API has no ambient credential for a cross-site request to
ride, and CSRF is structurally not a live risk **today**. It becomes one the moment a browser holds a
credential — which is precisely the decision §6 shows has not been made. Designing CSRF protection
now would be designing it against an unknown credential.

---

## 8. Existing mutation test pattern — **none exists**

`apps/admin/vitest.config.ts` is, in its entirety, `defineConfig({ esbuild: { jsx: 'automatic' } })`.
No `environment`, no `setupFiles`, no `globals`. Zero matches for `jsdom`, `happy-dom`,
`testing-library` or `@vitest-environment` in the app or its dependencies. Thirteen of the twenty-one
test files use `renderToStaticMarkup` and assert on the HTML string; **nothing mounts, and no test in
this application has ever simulated an interaction.**

The config comment states the position deliberately: adding jsdom or a testing library *"would be
test infrastructure for interactivity this portal does not have."* Checkpoint 7 §13 forbids
introducing any of them, so a mutation built now could not be tested at the level it operates.

---

## 9. Can Admin invoke API mutations without a new architecture? **No.**

Three independent reasons, in order of depth:

1. It cannot authenticate (§6). A `POST` would 401 exactly as every `GET` does.
2. It has no mechanism to issue a non-GET request — no server action, no route handler, no form, and
   a `read` helper whose signature has no place for a method or a body (§5).
3. It has no way to test one (§8).

---

## 10. Existing public membership-selection contracts

Three, and only three, exist anywhere in the repository.

| Contract | Route | Returns | Scope |
|---|---|---|---|
| `workflow.read-approval-group` | `GET /api/v1/workflow/approval-groups/:id` | `ApprovalGroupDetailView` — `{ group, members[] }`, each member `{ approvalGroupMemberId, approvalGroupId, membershipId, addedOn }` | **one named group** |
| `identity.list-memberships` | `GET /api/v1/identity/members` | `PagedResult<TenantMembershipView>` — `{ id, tenantId, workforceUserId, status, … }` | **the entire tenant roster** |
| `identity.search-members` | `GET /api/v1/identity/members/search?term=&limit=` | `readonly BusinessProfileView[]` — `{ membershipId, displayName, jobTitle?, … }` | **the entire tenant directory, by name** |

Confirmed absent, each with the search that established it:
- No Workflow query lists memberships generally — the ten registered queries are the complete set,
  and `group-queries.ts:14-17` records the refusal in as many words: *"There is no 'which groups is
  this membership on' — that is the question a directory answers."*
- **Organization, People and Employment publish nothing membership-shaped.** `PersonView` and
  `EmploymentView` carry no `membershipId`; the employment↔membership bridge lives on Identity's side
  and has **no HTTP route** (`identity.active-memberships-for-employment` and
  `identity.primary-employment-for-membership` are dispatcher-only).
- `TenantMembershipDirectory.activeMembershipsOf(platformUserId)`
  (`identity/src/contracts/membership-directory.ts:34`) answers *"which tenants does this one person
  belong to"* — the opposite direction — and is an injected infrastructure port, not a query.

**Nothing answers "which memberships may be added as an approver for this branch."**

---

## 11. Permissions those contracts require

| Contract | Permission |
|---|---|
| `workflow.read-approval-group` | `workflow.group.read` |
| `identity.list-memberships` | `identity.membership.read` |
| `identity.search-members` | `identity.profile.read` |

Queries carry a **required** `permission` field (`packages/kernel/src/cqrs/pipeline.ts:43-47`),
enforced centrally by the `Dispatcher`.

For reference, the ten Workflow permissions are unchanged: `definition.read`, `definition.manage`,
`instance.read`, `instance.start`, `instance.cancel`, `approval.decide`, `approval.read-own`,
`approval.escalate`, `group.read`, `group.manage`. `DELEGABLE_SCOPES` remains exactly
`['workflow.approval.decide', '*']` — `approval.escalate` is **not** delegable and this checkpoint
proposes no change to that.

---

## 12. Are they narrow enough for escalation? **No — each fails differently.**

**`identity.list-memberships` / `identity.search-members` — fail the brief directly.** Both are
whole-tenant directories. Using either would (a) make Admin depend on a broad Identity member
directory, which Checkpoint 8's stop condition 6 forbids; (b) require the caller to hold
`identity.membership.read` or `identity.profile.read` **in addition to**
`workflow.approval.escalate`, so a user granted exactly the escalation permission could not use the
screen — the permission would silently stop being sufficient for the capability it names; and (c)
offer every member of the tenant as an escalation target, which is the arbitrary enumeration the
brief rules out.

**`workflow.read-approval-group` — bounded and tenant-owned, but semantically wrong.** It is the only
candidate inside Workflow's own ownership, needs no Identity dependency, and returns ids without
names. It still fails on three counts:

1. **It contradicts the contract's own stated meaning.** `ApprovalGroupView`
   (`contracts/views.ts:155-161`) is documented as a list *"resolved into individual approvers when an
   approval starts and **never consulted again by one that is already running**."* Escalation is by
   definition an act on a running approval. Using a group as an escalation pool changes what a group
   *is*, which is a domain decision, not a UI convenience.
2. **A group has no relationship to the approval being escalated.** Nothing links a group to a
   definition, a version or an instance. Offering "the members of some group" as escalation
   candidates is offering an arbitrary list that merely happens to be enumerable.
3. **The page loads exactly one group** — the first of the listing
   (`apps/admin/src/workflow/api.test.ts:95-98`). Loading all of them is the N+1 in §14.

---

## 13. Request-budget implications

**Decision A: zero.** The marker is derived from a column already in the SELECT list (§3.2) inside a
query Admin already makes. The fixed budget stands unchanged at **5 / 10 / 10 / 1**
(`apps/admin/src/workflow/api.test.ts:31,81,109,120`).

**Decision B2, per source:**
- *Approval groups.* The page currently fetches the group listing once and one group's detail once.
  A usable pool needs the members of **every** group — one detail read per group, unbounded in the
  number of groups a tenant has. This breaks the fixed budget outright.
- *Identity directory.* One additional read per page load, plus the pagination or search-term problem
  — `identity.search-members` requires a `term`, so it cannot populate a list without either a typed
  query (browser JavaScript, forbidden by stop condition 8) or a blank-term enumeration.
- *A new narrow Workflow query.* One additional read, bounded, on the instance detail page only.

---

## 14. N+1 implications

The approval-group route is a textbook N+1: *N* groups → *N* detail reads, at page render, for a
control that is used on a small minority of loads. `apps/admin/src/workflow/api.test.ts:141,186,209`
already asserts that no request path is derived per row; that assertion would have to be weakened,
and it should not be.

Decision A introduces no query and therefore no N+1. A purpose-built query answering the eligibility
question in one round trip introduces none either.

---

## 15. Tenant / RLS implications

**Decision A: none.** The value is derived from a row already read under `app_current_tenant()`; no
new table, join or predicate is involved, and RLS remains enabled and forced (ADR-0030).

**Decision B2:** any Identity-sourced list crosses a module boundary from Admin. Admin's own
`boundary.test.ts` forbids importing another module's contracts, so the crossing would have to be
over HTTP — where the API's tenant resolution applies (`tenant-resolution.ts:34-58`, tenant chosen
from stored active memberships, never granted by a header). That is sound **as tenancy**; it is
unsound as *scope*, per §12.

---

## 16. Proposed decision A

### D-16D-09 — A public escalation marker on `WorkflowStepView`

*Evidence.* §2, §3.

*Proposed option.* Add **`escalated: boolean`**, required and non-optional, derived in `asStepView`
as `state.escalatedAt !== undefined`. Publishes *that*, never *when*, *who* or *why*.

*Rejected alternatives.*
- **Publish `escalatedAt`** — rejected: it exposes an internal timestamp for a display distinction
  that needs no timestamp, and Checkpoint 6 refused it deliberately.
- **Derive from the history endpoint** — rejected: unsound under pagination (§3.6), and it fails
  toward "assigned", the wrong direction.
- **Derive from `sourceGroupId` or row counts** — rejected: both are false proxies (§3.4, §3.5).
- **Add no marker at all** — rejected, and I record explicitly that I found **no** way for Admin to
  distinguish the two reliably without it. If this option is chosen, Checkpoint 7's requirement 2
  should be formally withdrawn rather than left open.

*Constraints.* Must not alter `assigned`, `threshold`, `outstanding`, `unresolved`, `outcome`,
`quorum`, `branchRule` or any service-level value. Must not become delegable, permissioned
separately, or filterable — it is a display field on a view already gated by
`workflow.instance.read`. No backfill. The tally remains the **only** published authority on the
denominator; the marker must never be summed by a consumer to recompute one.

*Known consequence requiring its own approval.* The leak-scan at
`apps/api/src/workflow/workflow.escalation.spec.ts:126-147` forbids the substring `escalated` in the
response body and **will fail**. The honest resolution is to narrow that scan to the provenance that
is still withheld — `escalatedat`, the actor, a reason — and to add a positive assertion that
`escalated` is present and boolean. It must **not** be resolved by deleting the scan. Likewise,
`escalat` stays on Admin's forbidden-heading list only until a column is approved; a rendered column
would make it a description rather than a claim, and the pairing test would need the same
narrow-and-assert treatment rather than a deletion.

*Affected checkpoint.* Unblocks Checkpoint 7 requirement 2. Touches contracts, the view mapper, and
two test files.

---

## 17. Proposed decision B1

### D-16D-10 — Admin mutation architecture

**This is an application-wide architecture decision, not a Workflow-local implementation, and it is
blocked on something further upstream.** I am not proposing a pattern, because §6 shows the
prerequisite does not exist.

*Evidence.* §5, §6, §7, §8, §9.

*The finding.* `apps/admin` does not merely lack a write path — it **propagates no identity at all**.
Every request is headerless, every business endpoint returns 401, and the app is documented as
authenticating nobody by design (ADR-0032; AD-001 places authentication with Platform). A mutation
architecture is a set of answers — where the mutation lives, how the actor is propagated, whether
CSRF applies, whether browser JavaScript is required — and **every one of those answers depends on a
credential model that has not been chosen.** A bearer token held server-side and a browser cookie
imply different, incompatible designs.

*Rejected alternatives.*
- **Build a server action inside Workflow now** — rejected: it would establish the application's
  credential model, CSRF posture and error convention as a side effect of one capability in one
  module, and it would be untestable (§8).
- **Add a Next route handler in `apps/admin` proxying to the API** — rejected for the same reason,
  and it adds a second network hop with no principal to forward.
- **Hold a service credential in `apps/admin` and act on behalf of the operator** — rejected
  outright: it dissolves the per-user permission model the API exists to enforce and would let the
  portal escalate as anybody. Recorded so it is refused explicitly rather than by omission.

*Recommendation.* **STOP.** Escalation stays an API capability, which is what the page already tells
administrators (`workflow.notice.actionsAreApi`, and now `workflow.provided.escalation`). Sequence
the credential model first, as its own decision with its own owner; the mutation pattern follows from
it, and Workflow's escalation button is a consumer of that decision rather than the occasion for it.

*Affected checkpoint.* Blocks Checkpoint 7 requirement 3 indefinitely. Owner: whoever owns
`apps/admin` and the Platform authentication seam — **not identified in this repository**, and I have
not invented one.

---

## 18. Proposed decision B2

### D-16D-11 — Source of selectable approver memberships

*Evidence.* §10, §11, §12.

*The finding.* **No existing contract answers the question.** The three that exist are one arbitrary
list and two whole-tenant directories.

*Options.*
- **(a) Identity directory** (`identity.list-memberships` or `identity.search-members`) — **rejected**:
  broad member-directory dependency (stop condition 6); requires a second permission, so
  `workflow.approval.escalate` alone stops being sufficient; enumerates the whole tenant.
- **(b) Workflow approval groups** — **rejected**: contradicts the group contract's stated meaning
  (§12.1), bears no relation to the approval (§12.2), and is an N+1 (§13, §14).
- **(c) A new narrow Workflow query** — e.g. one answering *"which memberships may be added as an
  approver at this ordinal"*, permissioned with the existing `workflow.approval.escalate`, tenant-
  scoped, bounded, returning bare `membershipId` values and excluding those already on the branch
  (which the domain would otherwise refuse). **This is the only option that answers the question that
  was actually asked**, and it needs no new permission and no Identity dependency.
- **(d) Free-text membership id** — **rejected**: the brief forbids it, and it is an IDOR surface.

*Recommendation.* **(c), if and only if D-16D-10 is ever resolved.** Until Admin can authenticate and
mutate, a candidate list has no consumer, and building the query first would be building a read for a
write that cannot happen. **Do not implement (c) now.**

*Constraints if approved.* One query, one route, no new permission, no Identity dependency, no
enumeration beyond the branch's own eligibility, bounded page, one round trip, no N+1. The domain
must remain the final authority — the query narrows a picker, it never pre-authorizes; the five
`escalateBranch` refusals still apply.

*Affected checkpoint.* Blocks Checkpoint 7 requirement 3, behind D-16D-10.

---

## 19. Additional blockers discovered

1. **Admin propagates no identity to the API (§6).** Larger than the stated Blocker B and underneath
   it. Not a Workflow problem and not solvable inside this phase.
2. **The API leak-scan will fail if D-16D-09 is approved (§16).** Named here so it is resolved by an
   approved narrowing rather than discovered mid-implementation and silenced.
3. **The approval-group contract explicitly forbids the reading Option (b) would require** — *"never
   consulted again by one that is already running"* (`contracts/views.ts:155-161`). Reusing a group
   as an escalation pool is a domain change wearing a UI decision's clothes.
4. **Eleven of sixteen Admin modules have no tests at all.** Any pattern established here becomes the
   template for a largely untested application.

---

## 20. Files that would need to change AFTER approval

**If D-16D-09 is approved (and only D-16D-09):**

| File | Change |
|---|---|
| `packages/modules/workflow/src/contracts/views.ts` | one field on `WorkflowStepView` |
| `packages/modules/workflow/src/application/workflow-views.ts` | one line in `asStepView` |
| `apps/api/src/workflow/workflow.escalation.spec.ts` | narrow the leak scan; add a positive assertion |
| `apps/admin/src/workflow/views.fixture.ts` | set the field on the escalated fixture step |
| `apps/admin/src/workflow/instances.tsx` (or `branches.tsx`) | render the distinction |
| `apps/admin/src/workflow/notices.test.tsx` | narrow the forbidden-heading entry; assert the column |
| `packages/modules/workflow/locales/{en,ar}.json` | one column label, both languages |
| `docs/verification/phase-16d-admin.md` | record requirement 2 as delivered |

No migration. No repository change. No permission change. No new route. No new query.

**If D-16D-10 and D-16D-11 are approved:** not enumerable yet — the file list depends on the
credential model, which is the decision itself.

---

## 21. Statement

**No implementation was performed in this checkpoint.** No production or test code was created or
modified. No decision below was recorded as approved; D-16D-09, D-16D-10 and D-16D-11 are proposals
awaiting the owner's approval, and I have not written them into the Phase 16D decision register.

Stop conditions triggered: **1** (no approved public escalation marker exists), **2** (no established
Admin mutation architecture exists), **3** (no approved public source for eligible approver
memberships exists), and **6** (the only existing membership contracts are broad Identity
directories). Conditions 4, 5, 7 and 8 are **not** triggered: no new permission is required by the
recommended options, nothing proposed bypasses the API, no 16B or 16C invariant moves, and no
browser-side business logic is proposed.
