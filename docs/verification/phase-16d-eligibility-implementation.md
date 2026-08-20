# Phase 16D — Approved Eligibility Rules and the Public Escalation Marker

Implementation of the decisions approved on **2026-08-18**, recorded in
[`phase-16d-register.md`](phase-16d-register.md).

**Delivered:** D-16D-09, D-16D-13, D-16D-14, D-16D-15 (as a proven absence), D-16D-16 (as a proven
absence).
**Blocked and stopped:** **D-16D-12** — see §4. **D-16D-11** follows it.
**Confirmed and untouched:** D-16D-10.

---

## 1. Commit

Implemented on `claude/phase-5-employment-workforce-xaxasu`, from `3eb6349`.

## 2. Files changed

| File | Change |
|---|---|
| `docs/verification/phase-16d-register.md` | the eight approvals, dates, constraints, final eligibility rule, D-16D-08 locked |
| `packages/modules/workflow/src/domain/escalation.ts` | two new refusals; `personRefusal` extracted; `TERMINAL_ON_THE_INSTANCE` |
| `packages/modules/workflow/src/contracts/views.ts` | `WorkflowStepView.escalated: boolean`, required |
| `packages/modules/workflow/src/application/workflow-views.ts` | one line in `asStepView`, outside `definedOf` |
| `packages/modules/workflow/src/domain/workflow-escalation-eligibility.test.ts` | **new** — 13 tests |
| `packages/modules/workflow/src/application/workflow-escalation-eligibility.test.ts` | **new** — 6 tests |
| `packages/modules/workflow/src/domain/workflow-escalation.test.ts` | prose only: five refusals → seven, pointing at the new suite |
| `packages/modules/workflow/src/infrastructure/workflow-database.fixture.ts` | `OUTSIDER`, a fifth membership |
| `packages/modules/workflow/src/infrastructure/workflow-escalation-persistence.integration.test.ts` | fixture corrected — see §11 |
| `apps/api/src/workflow/workflow.escalation.spec.ts` | leak scan narrowed; two positive marker tests |
| `apps/admin/src/workflow/views.fixture.ts`, `branches.fixture.ts` | the required field on every step |

**No migration. No schema change. No repository change. No permission change. No new route. No new
query. No Identity change. No Admin component change.**

## 3. Domain rules added

Both in `escalateBranch`, both operating on state the command already holds.

**D-16D-13 (B) — `escalation-approver-is-the-requester`.** Refuses when
`approverMembershipId === instance.requestedByMembershipId`. Its own name, **not**
`manager-is-the-requester`: that one means *"your reporting line points at you"*, which is somebody's
data to fix, and this one means *"you chose yourself"*, which is the request to fix. An administrator
sent to the reporting line by this refusal would find nothing wrong there.

**D-16D-14 (A) — `escalation-approver-already-decided`.** Refuses when the membership has any step on
the **instance** whose status is in `TERMINAL_ON_THE_INSTANCE = ['approved', 'rejected']`.
**`skipped` is deliberately excluded**: a step is skipped when a rejection, a cancellation or a
condition removed it, so the person it names never had a say, and refusing them would refuse somebody
because the process passed them by.

Both are checked after the branch questions and after the two duplicates, in the approved order. The
seven refusals are extracted into `personRefusal` so the branch's eligibility and the person's read as
the two separate questions they are, and so both halves stay inside the function budget.

## 4. Identity contract — **STOPPED, and why**

The instruction directed: *"identify the narrowest existing permission that can legally support this
exact predicate. If no existing permission can support it without broadening authorization: STOP…
Report the exact permission gap."*

**There is no permission gap.** `identity.membership.read` supports the predicate and broadens
nothing, because ADR-0043's bounded service grant is the mechanism and Workflow already uses it
against Identity three times in `workflow-reporting-line.ts` — `runWithServiceGrant` with
`permits: [EMPLOYMENT_LINK_READ]`, entered inside a handler the pipeline has already authorized. The
user keeps only `workflow.approval.escalate`.

**There is a contract gap, and it is the blocker.** No Identity query answers *"is this one membership
active"*. The complete set of membership-keyed reads is:

| Query | Permission | Why it cannot serve |
|---|---|---|
| `identity.describe-member` | `identity.membership.read` | *"Everything a portal needs to render one member's page"* — returns profile, preferences, portals, employments **and delegations**. Using it would make the escalation write path pull a **broad member profile**, which the instruction forbids the port from becoming. The grant bounds the *permission*, not the *payload*. |
| `identity.list-memberships` | `identity.membership.read` | An enumeration, which D-16D-16 (A) forbids. |
| `identity.search-members` | `identity.profile.read` | A directory search, and requires a term. |
| `identity.active-memberships-for-employment` | `identity.employment-link.read` | Keyed by **employment**, not membership. Wrong key. |

Answering the approved predicate needs a **new narrow Identity query** — an Identity change. Identity
is a completed module, this instruction's boundary forbids modifying it, and no such contract is
approved. The `reportingLine` precedent states the rule this follows: *"the Identity contract behind
it is a completed module's change, built and verified on its own side first."*

**So D-16D-12 is implemented in no part.** The command does **not** yet refuse an inactive
membership, and no port was invented, no permission was invented, and no weaker UI-only
interpretation was substituted — which the approval explicitly forbids. `escalateBranch` carries a
comment recording that the activeness fact is expected to arrive resolved, as a manager's does.

**What is required to unblock it:** an approved Identity contract answering only *"is this membership
active in the current tenant"*, returning a boolean or a single status and nothing else. Once it
exists, D-16D-12 is a bounded port, one grant naming `identity.membership.read`, a resolved input to
`escalateBranch`, and one refusal.

## 5. Permission used

**None added, none changed.** `workflow.approval.escalate` remains the only permission the command
requires, and remains outside `DELEGABLE_SCOPES`.

## 6. API contract changes

`WorkflowStepView.escalated: boolean` — required, mapped in `asStepView` as
`state.escalatedAt !== undefined`, placed **outside `definedOf`** so `false` is published rather than
dropped. `escalatedAt` itself remains unpublished. No route, DTO or permission changed.

## 7. Admin changes

**Fixtures only.** The required field forced every construction site to state it, which is the field
being required doing its job. Two comments that said the view *had* no marker were corrected, since
that is no longer true.

**No picker, no candidate list, no mutation, no credential handling** — D-16D-10 (A) and D-16D-16 (A)
between them make an Admin escalation UI impossible in this phase, and that is intentional.
**Rendering the assigned/escalated distinction is now unblocked but was not implemented**: it is
Checkpoint 7 requirement 2, and this instruction's order stops at the API marker. Recorded as
deferred (§13).

## 8. Migrations

**None.** `prisma migrate status`: *24 migrations found · Database schema is up to date.*

## 9. Tests added

**Domain — 13 new** (`workflow-escalation-eligibility.test.ts`): requester refused by its own name ·
not `manager-is-the-requester` · others still admitted · `approved` refused · `rejected` refused ·
**`skipped` admitted** · still-awaiting admitted · no-prior-step admitted · branch refusal preferred
where both apply · the two new refusals distinct · unanimous judged before the person · the accepted
step unchanged · **all seven refusals distinct in one assertion**.

**Application — 6 new** (`workflow-escalation-eligibility.test.ts`): the requester the *instance*
recorded is the one refused · anybody else admitted · a refusal writes no timeline entry · somebody
who approved an earlier branch refused **through a real `workflow.decide-step`** · somebody with no
decision admitted · **a delegation is granted, escalation succeeds anyway, and `DelegationPort` is
spied on and never called**.

**API — 2 new**: every step carries the marker and exactly one is `true`, with the `false` ones
matched to the assigned approvers by identity; an approval never escalated is `false` throughout.

The delegation test is the one that would otherwise rot silently: D-16D-15 (D) breaks not by a failing
test but by somebody adding a "helpful" check later, so the assertion is that the question was never
asked, with a live delegation present so an empty register cannot pass for the rule.

## 10. Audit / negative space

One negative assertion moved, and only because the approved public contract changed. The API leak
scan forbade the substring `escalated` outright; it now forbids `escalatedat`, `escalatedon`,
`escalatedby`, `escalatedbymembershipid`, `escalationreason`, `escalationactor`, `sourcegroupid`,
`employment`, `reporting`, `manager` — the provenance that is still withheld, with `escalatedat`
spelled out because it is the near-miss. **Paired with two positive assertions** that the approved
boolean is present, is a boolean on every step, and is `true` for exactly one. No coverage was
removed and no assertion was weakened.

Admin's forbidden-heading list still contains `escalat`, correctly: no column renders it yet.

## 11. Defects found and fixed

**One, and it was a stale fixture rather than a product defect.**
`workflow-escalation-persistence.integration.test.ts` escalated to `REQUESTER` in all eight of its
scenarios — the membership `workflow-live.fixture.ts:218` uses to *raise* the approval. D-16D-13 now
refuses that, correctly, so eight assertions began failing.

The fixture had four memberships: three on the branch and the requester. After this phase's rules
**none of them is eligible**, so the suite could not express "escalate to somebody who may be
escalated" at all. The fix was a fifth membership, `OUTSIDER`. **No assertion was weakened, removed or
retargeted**; every one of the eleven tests asserts exactly what it did before, about a person who may
legitimately be added.

## 12. Deviations from the instruction

1. **D-16D-12 was not implemented.** §4 — a required Identity contract does not exist, and the
   instruction directs a STOP rather than a workaround.
2. **The register's header and summary table were edited, not only appended to.** They said every
   decision was OPEN, which the approvals made false. Every per-decision entry is preserved exactly as
   it stood, including its rejected alternatives, and the header now says so explicitly.
3. **`pnpm verify` and `pnpm prisma validate` were run under their real names** — `pnpm prisma:validate`
   and the turbo pipeline; a bare `pnpm prisma` is not a script in this repository.

## 13. NOT VERIFIED / remaining blocked

- **An inactive membership is not refused.** D-16D-12 is approved and unimplemented (§4). Until the
  Identity contract exists, the command accepts a membership that satisfies the six rules it does
  enforce, whatever Identity thinks of it.
- **Admin does not render the assigned/escalated distinction.** Unblocked by D-16D-09, not authorized
  by this instruction.
- **Admin cannot invoke escalation.** D-16D-10 (A); Platform's, outside this phase.
- **No candidate selection exists.** D-16D-16 (A), intentionally.
- **No Identity port exists.** D-16D-11 (B) waits on §4.
- Nothing about automatic escalation, schedulers, `JobPort`, notifications, expiry, business-day
  targets, role approvers or external approvers — all outside the approved scope and untouched.

## 14. Next checkpoint

**Not started.** Two candidates, in dependency order:

1. **An approved narrow Identity contract**, then D-16D-12 and D-16D-11 together. This is the only
   remaining approved-but-undelivered work.
2. **Admin rendering of `escalated`** — Checkpoint 7 requirement 2, now unblocked and independent of
   everything above.

## 15. Locked invariants

Untouched and re-verified by the full suite: the snapshotted assigned denominator · the stable
assigned set · escalated steps excluded from `assigned` · `majority` · `first-response` · the
`unanimous` refusal · quorum · condition behaviour · threshold · outstanding · tally semantics ·
branch isolation · snapshot semantics · append-only history · tenant isolation · RLS · no cross-module
foreign keys. **D-16D-08 is not reopened**: both new rules refuse a *step* before it exists and change
nothing the tally counts.
