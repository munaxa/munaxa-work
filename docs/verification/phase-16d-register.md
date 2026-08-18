# Phase 16D — Decision Register

**All eight decisions were APPROVED by the owner on 2026-08-18.** The approved selections, their
constraints and the final eligibility rule are recorded in [**APPROVED — 2026-08-18**](#approved--2026-08-18)
at the end of this document.

**Each entry below is preserved exactly as it stood while open**, including its question, evidence,
options and **rejected alternatives** — that is the record of what was not chosen and why, and it is
not rewritten now that a choice exists. Where an entry says "OPEN", read it as the state at the time
it was written; the approval section is authoritative for current status.

This register consolidates decisions D-16D-09 through D-16D-16 in one place. It **supersedes
nothing** — the analysis behind each entry is preserved unmodified in its source document, which the
entry cites. Earlier decisions D-16D-01 through D-16D-08 remain recorded in
[`phase-16d-plan.md`](phase-16d-plan.md) §11 and are unchanged; **D-16D-08 is not reopened.**

| Source | Contains |
|---|---|
| [`phase-16d-admin.md`](phase-16d-admin.md) | Checkpoint 7 delivery and the two original blockers |
| [`phase-16d-contract-gap.md`](phase-16d-contract-gap.md) | Checkpoint 8 investigation, D-16D-09/10/11 origins |
| [`phase-16d-decisions.md`](phase-16d-decisions.md) | Decision detail, rejected alternatives, first eligibility findings |
| [`phase-16d-eligibility.md`](phase-16d-eligibility.md) | E-1…E-5 analysis, domain-impact analysis, picker-vs-command |

---

## Summary

| ID | Decision | Options | Status |
|---|---|---|---|
| D-16D-09 | Public escalation marker | APPROVE / AMEND / DECLINE | **A** approved |
| D-16D-10 | Admin authentication | CONFIRM OUTSIDE 16D / AMEND | **A** approved |
| D-16D-11 | Eligible-membership architecture | APPROVE AMENDED WORDING / AMEND | **B** approved |
| D-16D-12 | Active membership requirement | A / B / AMEND | **A** approved |
| D-16D-13 | Requester self-approval | A / B / C / AMEND | **B** approved |
| D-16D-14 | D-5 terminal-approver rule | A / B / C / AMEND | **A** approved |
| D-16D-15 | Delegation interaction | A / B / C / D / AMEND | **D** approved |
| D-16D-16 | Result bound / ordering | A / B / C / D / AMEND | **A** approved |

---

## D-16D-09 — Public escalation marker · **OPEN**

**Question.** Should `WorkflowStepView` publish `escalated: boolean`
(`true` iff `state.escalatedAt !== undefined`)?

**Options.** APPROVE / AMEND / DECLINE.

**Evidence.** `escalated_at` is already selected, already mapped into `WorkflowStepState`, and
already reaches `asStepView`, which omits it. No schema, query, repository, permission or route
change is required — two production lines.

**Rejected alternatives, preserved.** Publish `escalatedAt` itself · derive from `sourceGroupId`
(absent on escalated *and* directly-typed steps alike) · derive from row counts (unreliable by design
under D-16D-08) · join the paginated `step-escalated` history event (fails silently toward
"assigned") · add no marker (no reliable alternative was found; if chosen, Checkpoint 7 requirement 2
should be formally withdrawn).

**Constraints if approved.** Exposes only the fact of escalation — never timestamp, actor, reason,
employment, reporting line or internal provenance. Alters no tally value. Required, not optional, and
placed outside `definedOf()` so `false` is always published. No backfill (pre-migration rows are
`NULL` → correctly `false`). The existing API leak scan **will fail, correctly**; it must be narrowed
to keep forbidding the withheld provenance while positively asserting the boolean — **never weakened
or deleted, and only after approval**.

**Independence.** Blocked by nothing. It is the only decision here deliverable on approval alone.

*Detail:* `phase-16d-decisions.md` §2.

---

## D-16D-10 — Admin authentication · **OPEN**

**Question.** Confirm that Admin authentication is a Platform dependency outside Phase 16D?

**Options.** CONFIRM OUTSIDE 16D / AMEND.

**Evidence.** ADR-0001 gives Platform authentication and forbids duplicating it; ADR-0019 repeats the
split; ADR-0032 resolves a tenant *from* an already-authenticated principal and does not define how
one is obtained. **No ADR among 0021–0074 defines portal session acquisition, token acquisition,
credential storage, CSRF for Admin mutations, or browser/server propagation.** All fifteen Admin
loaders send headerless `GET`s; the global guard answers 401; Admin renders that as
`unavailable: true`.

**Forbidden regardless of outcome.** Service bearer token · shared service credential · guard bypass
· weakened API authentication · Admin acting as tenant administrator · credentials in browser code ·
Workflow-specific authentication mechanism. Each would collapse the per-user permission boundary the
API exists to enforce.

**Consequence if confirmed.** Escalation remains **API-reachable but not invocable from the current
Admin UI** until Platform authentication exists. The twelve authentication sub-decisions remain
unanswered, and no owner is assigned beyond what ADR-0001 and ADR-0019 establish.

**If instead brought into scope:** STOP and request a separately approved Platform scope before any
code is written.

*Detail:* `phase-16d-decisions.md` §3.

---

## D-16D-11 — Eligible-membership architecture · **OPEN**

**Question.** Approve the amended wording?

**Amended wording as proposed by the owner, recorded verbatim and unapproved:**

> Define a bounded Identity contract for escalation eligibility after D-16D-12 through D-16D-16 are
> resolved. The contract must expose only the minimum membership information required by the approved
> eligibility rules and must not become a general member directory.

**Why the original wording fails.** It read *"which **active** tenant memberships…"*, which
presupposes D-16D-12. Workflow owns no membership table and no membership status —
`tenant_membership.status` is Identity's (`prisma/schema.prisma:41`) — and ADR-0043 forbids reaching
another module's tables, so a bounded contract is required; but its *shape* is a consequence of the
five decisions below, not an implementation detail.

**Candidate forms, none selected.**
**A** bounded enumeration — *"return memberships eligible for escalation"*.
**B** predicate — *"is this supplied membership eligible?"*.
**C** hybrid — Admin obtains candidates, Workflow/Identity validates the selection.

**Constraints preserved.** No general member directory, search, role directory, organization chart or
people directory · no `identity.membership.read` or other broad Identity permission · ADR-0043
bounded grant, following the `reportingLine` and `delegation` precedent · caller holds
`workflow.approval.escalate` only · tenant ambient · excludes memberships already on the branch · no
N+1 · no client-supplied UUID as source of truth · deterministic ordering if ordering is required.

**Do not design the port.** Method, input, output, eligibility predicate, maximum result size,
ordering, authorization, tenancy and failure semantics all remain undefined. Implementation is
additionally blocked behind D-16D-10.

*Detail:* `phase-16d-eligibility.md` §11, §13.

---

## D-16D-12 — Active membership requirement · **OPEN**

**Question.** Must the escalation command reject an inactive or unlinked membership?

**Current behaviour.** Not checked. `approval-group.use-case.ts:92-93`: *"The membership is taken as
given and never resolved. Workflow does not ask Identity whether this person exists."*

**The existing line is principled, not absent.** Workflow already refuses on activeness where it
**resolved** somebody — `manager-not-a-member`, `manager-membership-ambiguous`
(`domain/manager.ts:59-72`) — and takes the identifier as given where a human **named** somebody.
Escalation is a human naming somebody, so today's behaviour sits on an existing side of that line.

**Option A — active is a command invariant.** Identity joins the **write path**; a bounded port is
required *by the command*; a sixth refusal is required; the domain stays pure, so the answer must be
resolved in the application and passed in, as `ManagerResolution` is; Identity availability becomes
part of escalation execution (fail closed → an Identity outage is an escalation outage); picker and
command share one predicate. It moves the line for one command only, leaving `add-group-member`
accepting what escalation refuses — an inconsistency needing its own justification.

**Option B — active is a picker constraint only.** The command's contract is documented as it
behaves: any membership identifier satisfying the two branch exclusions. Escalation stays
Workflow-side; no Identity read during execution; consistency with `add-group-member` and typed steps
preserved. The UI **must not present "active" as a Workflow invariant**. The concrete harm: an
escalation to an inactive membership sits `awaiting` forever because nobody can answer it.

*Detail:* `phase-16d-eligibility.md` §3.

---

## D-16D-13 — Requester self-approval · **OPEN**

**Question.** May escalation add the requester as an approver?

**Current behaviour.** Permitted; no rule references `instance.requestedByMembershipId`.

**Existing invariant.** `resolveManager` refuses `manager-is-the-requester`
(`domain/manager.ts:104-106`), on grounds stated as 16A's D-5 rather than as manager-specific:
*"the approval would look like a process while being a formality."* The distinction that makes this a
real question: manager routing produces an approver **automatically**, whereas escalation is an
explicit act by a permission-holding administrator who can see who the requester is. A rule guarding
against accident does not automatically transfer to a deliberate act.

**Options.** **A** requester allowed (status quo) · **B** requester forbidden — one domain refusal
plus an explicit reason; applies to *all* escalation, since the requester is a property of the
instance rather than of a routing method · **C** context-specific rule, whose exact semantics must be
stated (e.g. refuse only when the requester would become the sole unresolved approver — noted as
coupling the rule to a tally at escalation time, which this module has otherwise avoided).

**Cost.** **Domain-only.** The instance state is already passed to `escalateBranch`; no query, port,
repository or schema change.

**Latent correctness question.** If B or C, the shipped command has a gap and the fix belongs in the
domain, not in a query that conceals it.

*Detail:* `phase-16d-eligibility.md` §4.

---

## D-16D-14 — D-5 terminal-approver rule · **OPEN**

**Question.** Does 16A's D-5 — *"a step may not name an approver already terminal on the same
instance"* — apply to escalation, and what counts as terminal?

**Current behaviour.** Only the target branch is inspected (`branchAt(steps, ordinal)`), so a
membership terminal at an earlier ordinal may be escalated onto a later branch and given a second
decision on the same approval.

**Not a data-availability problem.** `escalateBranchHandler` already loads every step of the instance
via `stores.steps.forInstance` (`application/escalation.use-case.ts:64`). This is **domain-only**.

**The terminal set is the substantive part.** Statuses are `pending`, `awaiting`, `approved`,
`rejected`, `skipped`. `approved` and `rejected` are terminal **decisions**; **`skipped` is terminal
but is not a decision** — it is what happens to steps after a rejection or cancellation, and to steps
a condition excluded. Counting `skipped` refuses somebody who never had a say; not counting it admits
somebody whose earlier step was deliberately excluded.

**Options.** **A** apply D-5 exactly — must state whether `skipped` counts · **B** apply to terminal
*decisions* only (`approved`, `rejected`) · **C** escalation intentionally overrides D-5, with the
reason recorded — candidate reason: D-5 protects against a configured or resolved approver being
reused mechanically, whereas a human may deliberately want somebody who rejected one branch consulted
on a stuck later one.

**If A or B, the terminal states must be enumerated explicitly in the approval.**

*Detail:* `phase-16d-eligibility.md` §5.

---

## D-16D-15 — Delegation interaction · **OPEN**

**Question.** Should delegation affect escalation eligibility at all?

**Current behaviour.** Duplicates are determined by `approverMembershipId`, so a delegate of an
assigned approver is not "already assigned" and may be escalated onto the same branch.

**Feasibility is not the issue.** `DelegationPort.activeFor(delegateMembershipId, atInstant)` is
already injected into `WorkflowDependencies`; establishing "is this person a delegate of somebody on
this branch" needs no new contract.

**The design tension.** The port answers **at an instant**, deliberately — *"This module stores no
delegation row, keeps no expiry state and runs no expiry job: it asks, at the instant of the
decision"* (`workflow-ports.ts:341-352`). A check at escalation time evaluates delegation at a moment
the product has decided is not the moment that matters, **and cannot prevent the harm**, because a
delegation may be created after the escalation.

**Options.** **A** delegation is irrelevant — a delegate is a separate membership · **B** an active
delegation blocks escalation — must define the relevant instant · **C** evaluated as of another
defined point — must specify which instant and why · **D** delegation is handled only by decision
execution — escalation does not consider it; delegation governs who may act when the decision is
later made.

**Observation, not a recommendation.** Option D is the option consistent with the existing design
intent quoted above; Option B is the one whose incompleteness is structural rather than incidental.
Neither observation is a selection.

*Detail:* `phase-16d-eligibility.md` §6.

---

## D-16D-16 — Result bound / ordering · **OPEN**

**Question.** What bound and ordering govern an eligible-membership result?

**Constraint that shapes every option.** Workflow owns **no sortable membership attribute** —
`ApprovalGroupMemberView` carries `membershipId` and `addedOn` only. Deterministic ordering therefore
cannot be invented from a UUID, insertion order, physical order, or any timestamp not exposed by an
approved contract.

**Options.** **A** no enumeration — use a predicate/validation model · **B** Identity provides an
explicitly approved deterministic ordering, becoming part of the Identity contract · **C** unbounded
enumeration — acceptable only if tenant scale and request budget explicitly justify it · **D**
pagination — requires a stable ordering key and pagination semantics.

**No figure is proposed.** Inventing 50 or 100 would silently define "these are your options" for a
tenant of ten thousand.

*Detail:* `phase-16d-eligibility.md` §7.

---

## Cross-decision consequences worth deciding deliberately

Recorded because they are easy to miss when the decisions are taken one at a time. **None is a
recommendation.**

1. **Some combinations close the Admin escalation UI permanently, independently of D-16D-10.** If
   D-16D-16 resolves to **A** (no enumeration) or D-16D-11 to form **B** (predicate only), then
   Admin has nothing to populate a picker from — and a free-text UUID is forbidden. Escalation would
   then remain an API-only capability even after Platform authentication exists. That may be the
   right answer; it should be chosen rather than arrived at.

2. **D-16D-16 A and D-16D-12 A fit together; D-16D-16 A and D-16D-12 B leave nothing to validate.**
   A predicate model presupposes that something is worth validating on the write path, which is
   D-16D-12 Option A. Under Option B there is no command-side invariant for a predicate to answer.

3. **D-16D-12 decides the port's most basic property** — read-only at render, or on the write path —
   so it should be settled before D-16D-11's form is chosen.

4. **D-16D-13 and D-16D-14 should be settled before any picker is designed.** Both change the
   *meaning* of escalation, and a picker built against the wrong command contract would be rebuilt.
   Both are domain-only and depend on nothing else here.

5. **The picker/command divergence rule applies to every one of them.** A picker may be narrower than
   the command as an unlabelled convenience; it must never present as a business invariant something
   the command does not enforce. For D-16D-13 and D-16D-14 the two must not diverge at all — a picker
   teaching an operator a rule that is not real is worse than no picker.

*Detail:* `phase-16d-eligibility.md` §8.

---

## Locked invariants

Every option above was checked against these, and none of them touches any:

snapshotted assigned denominator · assigned set stability · escalated steps not enlarging `assigned`
· `majority` arithmetic · `first-response` arithmetic · the `unanimous` refusal for escalation ·
tally semantics · branch isolation · snapshot-at-start · fail-closed behaviour · append-only history ·
tenant isolation · RLS · no cross-module foreign keys · no automatic execution · no scheduler · no
JobPort runner · no notification delivery.

**D-16D-08 is not reopened.** Every option adds or withholds a *step*; none changes what the
denominator counts.

---

## Recording an approval

When an owner explicitly approves a decision, its entry gains — **appended, never by rewriting what
is above** — the approval date, the selected option, the rejected alternatives (already preserved in
each entry), and the constraints attached to the approval. Until then the entry reads **OPEN**.

**No approval date is recorded for any decision in this register.**

---

# APPROVED — 2026-08-18

The owner entered explicit decisions on **2026-08-18**. The approved selections are recorded below,
appended rather than substituted: every entry above keeps its question, evidence, options and
**rejected alternatives**, which remain the record of what was not chosen and why.

| Decision | Approved option | Approval date |
|---|---|---|
| D-16D-09 | **A** — publish `WorkflowStepView.escalated: boolean` | 2026-08-18 |
| D-16D-10 | **A** — authentication confirmed **outside** Phase 16D | 2026-08-18 |
| D-16D-11 | **B** — predicate / validation model, bounded Identity port | 2026-08-18 |
| D-16D-12 | **A** — active membership is a **command-side invariant** | 2026-08-18 |
| D-16D-13 | **B** — the requester may **not** be escalated | 2026-08-18 |
| D-16D-14 | **A** — D-5 applies exactly; terminal = `approved`, `rejected`; **`skipped` is not terminal** | 2026-08-18 |
| D-16D-15 | **D** — delegation affects decision execution only | 2026-08-18 |
| D-16D-16 | **A** — **no** membership enumeration contract in Phase 16D | 2026-08-18 |

## Constraints attached to each approval

**D-16D-09 (A).** Publish only the boolean. Never `escalatedAt`, actor, reason, or
employment/reporting-line information. No tally arithmetic change, no persistence, query, repository,
permission or route change, no backfill. Pre-migration rows must read `false` naturally. The API leak
test is narrowed **only after this approval is recorded**, and a positive assertion that the marker
exists is added. It is a projection of an existing domain predicate, **not a second source of truth**.

**D-16D-10 (A).** Platform owns authentication; Work owns business authorization. Do not implement
authentication in Work; do not invent token acquisition, browser-held credentials, service
credentials, cookies, sessions or CSRF handling; do not bypass authentication or weaken the per-user
permission model; do not assign an owner for Platform authentication. Admin mutation architecture
stays blocked until Platform provides the approved contract. **This approval does not authorize an
unauthenticated Admin mutation.**

**D-16D-11 (B).** A bounded Identity port validating **one supplied membership**. No broad membership
directory, no unbounded enumeration, no new broad Identity permission, no direct Identity database
access. ADR-0043 bounded cross-module port pattern. Narrow and purpose-specific. No N+1, no arbitrary
ordering, no arbitrary pagination. **Not to be implemented until D-16D-12…16 are recorded and
reconciled.** No additional eligibility criteria may be invented.

**D-16D-12 (A).** Active membership is authoritative business validation on the **command/write
path**. The bounded Identity port may be called for it. A named refusal for an inactive membership is
required. **Identity failure must fail the command** rather than silently treating the membership as
active. A future Admin picker may additionally filter, but the picker is never the authority. A
weaker UI-only interpretation must not be implemented.

**D-16D-13 (B).** Enforced in the **domain**, with a dedicated escalation refusal. **Do not reuse
`manager-is-the-requester`.** Not a UI-only restriction. No Identity query is required, because the
requester membership is already available to the command. All existing manager semantics preserved.

**D-16D-14 (A).** Enforced in the **domain**, inspecting the complete instance step set the command
already loads — **no additional query**. Dedicated refusal. Terminal means `approved` or `rejected`
only; **`skipped` is not terminal for this rule.** D-5 is not reinterpreted anywhere else. Branch
isolation preserved. The locked D-16D-08 denominator semantics preserved.

**D-16D-15 (D).** Do not consult `DelegationPort` during escalation eligibility; do not block
escalation for an active delegation; do not use delegation to select an escalated approver; do not
add delegation checks to the escalation command. Existing delegation semantics unchanged. **No new
Identity dependency is created by this decision.**

**D-16D-16 (A).** No membership enumeration contract in Phase 16D. Escalation accepts one explicitly
supplied `approverMembershipId`. No candidate list, arbitrary limit, arbitrary ordering, pagination,
UUID ordering, physical ordering, broad Identity directory or new membership-list query. **Admin
cannot build a candidate picker from this phase alone, and that is intentional.** The API remains
able to accept a known membership identifier; the Admin candidate-selection problem stays blocked
until a future approved contract exists.

## The final eligibility rule

The escalation command must ultimately enforce all of the following, and **no other criterion may be
added**:

1. the branch is eligible for escalation under D-16D-08;
2. `unanimous` branches remain refused;
3. the supplied membership is not already assigned on the branch;
4. the supplied membership is not already escalated onto the branch;
5. the supplied membership is **active**;
6. the supplied membership is not the **requester**;
7. the supplied membership has not already been **terminal** on the same instance under D-5, where
   terminal means `approved` or `rejected`;
8. **no** delegation check is performed;
9. **no** enumeration or ordering is performed;
10. the snapshotted assigned denominator remains unchanged;
11. escalated steps remain excluded from `assigned`;
12. escalated votes count according to the already-approved D-16D-08 rule;
13. `unanimous` remains refused;
14. branch isolation remains intact.

## D-16D-08 remains LOCKED

Explicitly recorded: **D-16D-08 is not reopened by any approval above.** No approved option alters
the snapshotted assigned denominator, the stable assigned set, the exclusion of escalated steps from
`assigned`, `majority`, `first-response`, the `unanimous` refusal, quorum, condition behaviour,
threshold calculation, outstanding semantics, tally semantics, branch isolation or snapshot
semantics.
