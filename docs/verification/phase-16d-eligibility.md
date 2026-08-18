# Phase 16D — Escalation Eligibility Gap Review

**No implementation was performed.** Investigation and documentation only. No approval is recorded
anywhere in this document; every decision below is `OPEN — awaiting explicit approval`.

Carried forward unchanged: **D-16D-09 OPEN** (`WorkflowStepView.escalated: boolean`),
**D-16D-10 OPEN** (Admin authentication remains an unresolved Platform-level dependency; no Work-side
authentication implementation is permitted), **D-16D-11 OPEN** (and now requiring amendment — §8).

Prior records are preserved and unmodified: [`phase-16d-admin.md`](phase-16d-admin.md),
[`phase-16d-contract-gap.md`](phase-16d-contract-gap.md),
[`phase-16d-decisions.md`](phase-16d-decisions.md).

---

## 1. Current commit

`899b776` on `claude/phase-5-employment-workforce-xaxasu`.

---

## 2. The finding that reframes three of the five gaps

`escalateBranchHandler` (`application/escalation.use-case.ts:64-66`) loads **every step of the
instance** — `stores.steps.forInstance(transaction, command.instanceId)` — and passes the whole array
to `escalateBranch`, which narrows to one branch itself via `branchAt(steps, ordinal)`. The instance
state, carrying `requestedByMembershipId`, is already in hand as well.

**So the omissions in E-2 and E-3 are not data-availability constraints. They are modelling choices.**
Both could be enforced today with no new query, no new port, no repository change and no schema
change — a predicate over data the command already holds. That does not make either of them correct;
it removes cost from the argument, so the decision rests on meaning alone.

E-1 and E-4 are different in kind: both need a fact Workflow does not own.

---

## 3. E-1 — Active status

### Current command behaviour

`escalateBranch` never checks whether the membership is active, exists, or is known to anybody.
`approval-group.use-case.ts:92-93` states the module-wide position: *"The membership is taken as
given and never resolved. Workflow does not ask Identity whether this person exists."*

### The existing invariant is split, and the split is principled

Workflow **does** already refuse on membership activeness — but only where it *resolved* the person
rather than being *told* them. `ManagerResolution` (`domain/manager.ts:59-72`) carries
`manager-not-a-member` (*"the manager's employment resolves to no active membership — nobody who
could be asked"*) and `manager-membership-ambiguous` (*"more than one active membership"*).

The pattern that emerges from the whole module is consistent: **when Workflow follows a chain to find
somebody, it refuses if the chain ends nowhere; when a human names somebody, it takes the name as
given.** Escalation is a human naming somebody, so today's behaviour sits on the "taken as given"
side of an existing line rather than outside any line.

### Option A — escalation requires an active membership

Consequences, all of which follow necessarily:

- The **write path** must enforce it. A picker-only rule is not the product invariant.
- The bounded Identity port is therefore **not read-only** — the command calls it, on every
  escalation, before accepting.
- A **new refusal** is required (e.g. `escalation-approver-not-a-member`), taking the escalation
  refusal set from five to six.
- `escalateBranch` is a pure function over state it is handed; the activeness answer must be
  **resolved in the application and passed in**, exactly as `ManagerResolution` is — the domain
  cannot query.
- Workflow gains a **write-path dependency on Identity's availability**. If the port is unreachable,
  escalation must fail closed, which makes an Identity outage an escalation outage.
- It moves the "taken as given" line for one command only, so `add-group-member` would still accept
  an inactive membership while escalation refused it. That inconsistency would need its own
  justification or its own follow-up.

### Option B — escalation accepts any membership satisfying the branch exclusions

Consequences:

- The command contract is documented as it already behaves: **any membership identifier** is accepted
  provided it is not already assigned to, or already escalated onto, the target branch.
- The picker becomes a **convenience filter**, and must not present "active" as a product invariant —
  in the honesty catalogue, in a column heading, or in any notice.
- The port may remain **read-only**, consulted at render time only.
- Consistency with `add-group-member` and with typed membership steps is preserved.
- An escalation to an inactive membership is possible through the API, and would sit `awaiting`
  forever because nobody can answer it. **That is the concrete harm**, and it is the argument for A.

**Not chosen. Both presented.**

---

## 4. E-2 — Requester self-approval

### Current command behaviour

`escalateBranch` applies no rule about `instance.requestedByMembershipId`. Escalating an approval to
the person who raised it is permitted today.

### The existing invariant

`resolveManager` refuses `manager-is-the-requester` (`domain/manager.ts:104-106`). Its stated grounds
(lines 85-91) are explicit that this is **not** a manager-specific rule:

> *"it is 16A's cycle rule (D-5 — a step may not name an approver already terminal on the same
> instance) meeting the fact that a manager is now resolved rather than typed… the approval would
> look like a process while being a formality."*

So the module already holds a principle — an approval nobody can fail is not an approval — and has
applied it in exactly one place, where a *resolution* could produce the requester by accident.

### Options

**A — permit the requester.** The status quo. Defensible on the grounds that escalation is a
deliberate act by a permission-holding human who can see who the requester is, whereas
`manager-is-the-requester` guards against an *accidental* self-approval produced by a reporting line.
A rule guarding against accident does not automatically transfer to a deliberate act.

**B — refuse the requester.** Invariant: *a person may not be asked to approve their own request.*
Requires one refusal name (e.g. `escalation-approver-is-the-requester`). **Domain-only**: the
instance state is already passed to `escalateBranch`. Applies to *all* escalation, not only
manager-derived routing, because the requester is a property of the instance rather than of a
routing method.

**C — a different rule**, e.g. refuse only when the requester would become the *sole* unresolved
approver. Recorded for completeness; it makes the outcome depend on a tally at escalation time, which
is a coupling this module has otherwise avoided.

**Whether current behaviour is incorrect** depends entirely on whether the principle in
`manager.ts:85-91` was meant to bind escalation. I cannot determine that from the code, and I have
not aligned escalation with manager routing silently.

---

## 5. E-3 — Terminal approver on another ordinal

### Current command behaviour

`escalateBranch` inspects only the target branch (`branchAt(steps, request.ordinal)`), so a
membership that already approved or rejected at an **earlier ordinal of the same instance** may be
escalated onto a later branch and given a second decision on the same approval.

### The existing invariant

16A's **D-5**: *"a step may not name an approver already terminal on the same instance"*
(`domain/manager.ts:86-87`). It is a definition-time and resolution-time rule; escalation is a third
way a step comes into existence, and D-5 predates it.

### If YES — D-5 applies to escalation

- **The terminal state set must be decided, and it is not obvious.** Step statuses are `pending`,
  `awaiting`, `approved`, `rejected`, `skipped` (`workflow-vocabulary.ts:229-235`). `approved` and
  `rejected` are terminal *decisions*. **`skipped` is terminal but is not a decision** — it is what
  happens to steps after a rejection or cancellation, and to steps a condition excluded. Treating
  `skipped` as terminal would refuse somebody who never had a say; treating it as non-terminal
  admits somebody whose earlier step was deliberately excluded. Both readings are arguable and the
  choice must be explicit.
- **No new data is required.** The command already holds every step of the instance (§2). This is a
  **domain-only** change: one predicate plus one refusal name (e.g.
  `escalation-approver-already-decided`).
- The command contract changes: a previously accepted request begins to be refused.

### If NO — escalation is exempt from D-5

The exemption must be recorded with its reason, not left as an absence. The candidate reason: D-5
protects against a *configured or resolved* approver being reused mechanically; an escalation is a
human deliberately choosing somebody, and there are real cases — a person who rejected one branch
being the right person to consult on a stuck later one — where a second involvement is intended
rather than accidental.

**Not silently inherited, and not silently discarded.**

---

## 6. E-4 — Delegation duplication

### Current command behaviour

The domain compares `approverMembershipId` only. A delegate of an assigned approver is therefore
**not** "already assigned", and may be escalated onto the same branch.

### The existing approved contract that could establish it

`DelegationPort.activeFor(delegateMembershipId, atInstant)`
(`application/workflow-ports.ts:354-356`), mirroring `identity.active-delegations-for`. It is
**already in `WorkflowDependencies`** — so establishing "is this person a delegate of somebody on
this branch" needs **no new contract**: one call, filtering grants whose `delegatorMembershipId` is
on the branch, honouring `workflow.approval.decide` or `*` as the scope.

### The tension that makes this a genuine decision

The port answers **at an instant**, deliberately. Its own comment (lines 341-352) explains why:
*"This module stores no delegation row, keeps no expiry state and runs no expiry job: it asks, at the
instant of the decision."* Identity's side reasons the same way — *"a status is only as fresh as the
last job that updated it, and there is no such job."*

A delegation check at **escalation** time would therefore evaluate delegation at a moment the product
has deliberately decided is not the moment that matters. A grant active at escalation may have lapsed
by the decision; one absent at escalation may exist by then. Enforcing at escalation would introduce
exactly the stale-snapshot semantics ADR-0070 and the delegation design avoid — while **not**
preventing the harm, because the delegation can be created after the escalation.

### The three questions, separated

| May escalation add… | Today | Note |
|---|---|---|
| the assigned approver | **No** — `escalation-approver-already-assigned` | settled |
| that approver's active delegate | **Yes** | would give one approver's authority two seats on one branch |
| a membership holding delegated authority elsewhere | **Yes** | unrelated to this branch; no argument found for refusing it |

**If delegation must matter**, the contract exists and no new dependency is needed — but the
instant-versus-decision-time tension above must be resolved first, and enforcement at escalation
cannot be made complete.

**If it does not matter**, the reason to record is that delegation is evaluated at decision time by
design, and the branch tally already counts one decision per *step*, so a delegate answering their
own escalated step is one step's vote rather than a duplicate of the delegator's.

---

## 7. E-5 — Result bound and ordering

Nothing in Workflow establishes a maximum result size, an ordering, or a pagination model for an
eligible-membership result. The universe is Identity's tenant membership roster, whose size is
unbounded and which Workflow does not own.

Undetermined, each requiring a product answer rather than an engineering guess:

- **Maximum returned** — no basis exists in the repository for any figure. I decline to propose 50 or
  100; an invented bound would silently define "these are your options" for a tenant of ten thousand.
- **Deterministic ordering** — required if a bound exists, because a bounded set without an order is
  a different answer on each read. Workflow holds no name, title or sort key for a membership
  (`ApprovalGroupMemberView` carries `membershipId` and `addedOn` only), so ordering meaningfully
  would require a field Workflow does not have.
- **Pagination versus bounded list** — a paginated picker needs navigation, which needs the
  interactivity D-16D-10 blocks.
- **Whether the entire eligible set may be returned** — for a large tenant this is a full directory
  dump under another name, which D-16D-11's own constraints forbid.
- **Performance at volume** — no target exists, and none should be invented.

**This remains open**, and it is worth naming why it is not merely a parameter: the ordering problem
shows the picker cannot be *usable* without a human-readable label, which is a directory fact
D-16D-11 forbids depending on. E-5 may therefore be the constraint that decides whether a picker is
the right shape at all.

---

## 8. Picker eligibility versus command eligibility

The distinction, applied to each criterion. The rule: a picker may be **narrower** than the command
(a convenience), may be **wider** only where the command's refusal is intentional and legible, and
must **never present as a business invariant something the command does not enforce**.

| Criterion | Picker rule | Command rule | Divergence permissible? |
|---|---|---|---|
| **E-1 active** | Under Option A: identical — the picker filters and the command enforces. Under Option B: picker may filter as a convenience, but must not label it an invariant. | A: enforced, new refusal. B: unenforced. | **Only under B**, and only as an unlabelled convenience. Under A they must not diverge. |
| **E-2 requester** | Must match the command. | A: permitted. B: refused. | **No.** A picker hiding the requester while the command accepts them teaches an operator a rule that is not real; a picker offering them while the command refuses wastes a deliberate act. |
| **E-3 terminal elsewhere** | Must match the command. | Yes: new refusal. No: exempt, recorded. | **No** — same reasoning as E-2. |
| **E-4 delegation** | May narrow as a convenience only. | Almost certainly unenforced (§6). | **Yes, one-directional** — the picker may omit delegates, but must not claim delegation is prevented. |
| **E-5 bound** | Purely a picker concern. | Not a command concern — the command takes one membership. | **N/A.** A bounded picker never implies the command rejects what it omitted. |

**The API and the domain remain the final authorization boundary in every row.** No picker rule ever
pre-authorizes; the five `escalateBranch` refusals fire regardless of what a screen offered.

---

## 9. Decision matrix

Every row **OPEN**. None approved.

| Criterion | Current command | Existing invariant | Proposed picker rule | Proposed command rule | New dependency? | Decision |
|---|---|---|---|---|---|---|
| **Active membership** | Not checked; membership taken as given (`approval-group.use-case.ts:92`) | Split: refused where Workflow *resolves* (`manager-not-a-member`), taken as given where a human *names* | A: filter to active · B: unfiltered, or filtered without claiming an invariant | A: new refusal, resolved in application, passed to domain · B: unchanged | **A: yes** — bounded Identity port on the **write** path; fail-closed on outage · **B: no** | **OPEN** — D-16D-12 |
| **Requester** | Permitted | `manager-is-the-requester`, on grounds stated as 16A's D-5 rather than manager-specific | Must match the command | A: permitted (status quo) · B: refuse, one new refusal · C: refuse only if sole unresolved | **No** — instance state already in hand | **OPEN** — D-16D-13 |
| **Terminal elsewhere** | Permitted; only the branch is inspected | 16A D-5 — *a step may not name an approver already terminal on the same instance* | Must match the command | Yes: new refusal + an explicit terminal state set (is `skipped` terminal?) · No: exemption recorded with its reason | **No** — every step of the instance is already loaded (§2) | **OPEN** — D-16D-14 |
| **Delegation** | Not considered; comparison is by `approverMembershipId` | Delegation is Identity's fact, evaluated **at the decision instant** by design | May omit delegates as an unlabelled convenience | Probably unchanged; enforcement at escalation is incomplete by construction (§6) | **No** — `DelegationPort` already injected | **OPEN** — D-16D-15 |
| **Bound / order** | N/A — the command takes one membership | None. Workflow holds no sortable membership attribute | Undetermined; may decide whether a picker is viable at all | N/A | Depends on D-16D-11 | **OPEN** — D-16D-16 |

---

## 10. Domain impact analysis

### Domain-only changes — no completed-module dependency

**E-2 Option B/C** and **E-3 "yes"**. Both are predicates over state `escalateBranch` already
receives.

| Impact | Detail |
|---|---|
| Domain file | `domain/escalation.ts` — one predicate each; `domain/workflow-rejection.ts` — one refusal name each |
| Application file | none |
| Repository / query | **none** — `steps.forInstance` already returns every step; the instance is already loaded |
| Published contract | **none** — no view changes |
| Schema | **none** |
| Refusal vocabulary | one new name each, and the locale catalogues in both languages |
| Permission | none |
| Cross-module | none |
| Tests | `domain/workflow-escalation.test.ts`; `application/workflow-escalation.test.ts`; `apps/api/src/workflow/workflow.escalation.spec.ts` (the refusal-distinctness assertions enumerate the set and would need the new member); the negative-space scanners assert refusal names |

### Changes requiring a completed-module dependency

**E-1 Option A**, and **E-4 if enforced**.

| Impact | Detail |
|---|---|
| Domain file | `domain/escalation.ts` — a new resolved input, shaped like `ManagerResolution`; one refusal |
| Application file | `application/escalation.use-case.ts` — call the port before the domain; `workflow-dependencies.ts` — a new required port (E-1); `workflow-ports.ts` — the port shape |
| Repository / query | none in Workflow; Identity must publish the narrow answer |
| Published contract | none in Workflow's views; a **new Identity contract** for E-1 |
| Schema | **none** |
| Refusal vocabulary | one new name, both languages |
| Permission | **none** — ADR-0043 bounded grant, not a user-held Identity permission |
| Cross-module | Workflow gains a **write-path** dependency on Identity; every composition (production and test) must supply it, since `WorkflowDependencies` has no optional field |
| Tests | all of the above, plus port fakes in every harness and a real adapter test |

**Neither is implemented. Neither is authorized.**

---

## 11. Identity-port implications

**The port cannot be specified yet, and the previous recommendation must not be treated as approved.**

`eligibleActiveMemberships(...)` must not be defined, because:

- whether **"active"** is a command invariant is E-1, unresolved — and it decides whether the port is
  read-only or sits on the write path, which is the port's most basic property;
- the **eligibility predicate** is E-1 through E-4 combined, three of which are unresolved;
- **result size and ordering** are E-5, unresolved — and §7 shows ordering may not be expressible
  without a directory fact the decision forbids;
- the **input shape** depends on whether the exclusion set is computed in Workflow (needing
  `instanceId` + `ordinal`) or pushed to Identity (which would leak Workflow's branch model into
  another module — almost certainly wrong, but not yet decided);
- the **authorization mechanics** depend on E-1: a read-only port is consulted under
  `workflow.approval.escalate` at render; a write-path port participates in a command's own
  authorization.

There is also a shape question the earlier recommendation did not surface: E-1 needs *"is this one
membership active"* (a predicate over a named person), while a picker needs *"which memberships are
active"* (an enumeration). **These are different contracts with very different blast radii** — the
first is narrow and cannot become a directory; the second is a directory under constraints. If E-1
resolves to Option A and D-16D-11's picker is declined, only the first is needed.

---

## 12. New decisions required

Each recorded as `OPEN — awaiting explicit approval`. None inferred, none approved.

| ID | Decision | Blocks |
|---|---|---|
| **D-16D-12** | Does escalation require an **active** membership? (E-1, Options A/B) | D-16D-11 port shape; possibly the command contract |
| **D-16D-13** | May escalation name the **requester**? (E-2, Options A/B/C) | Command contract |
| **D-16D-14** | Does **D-5** apply to escalation, and what is the terminal state set — is `skipped` terminal? (E-3) | Command contract |
| **D-16D-15** | Does **delegation** bear on escalation eligibility? (E-4) | Picker rule; possibly the command |
| **D-16D-16** | **Bound and ordering** for an eligible-membership result (E-5) | Whether a picker is viable at all |

D-16D-13 and D-16D-14 also carry a **latent correctness question**: if either resolves to "should
have been refused", the already-shipped `workflow.escalate-branch` has a gap, and the fix belongs in
the domain rather than in a query that conceals it. Reported, not changed.

---

## 13. Must D-16D-11 be amended? **Yes.**

Its current wording presupposes E-1's answer. It reads:

> *"Which **active** tenant memberships may be selected as an additional approver for this running
> approval branch?"*

"Active" is D-16D-12, which is open. The wording also implies a single enumerating contract, which
§11 shows may be the wrong shape.

### Proposed amended D-16D-11 wording — `OPEN — awaiting explicit approval`

> **D-16D-11 (amended).** *Approve the architectural direction only:* where escalation requires a
> fact about a membership that Workflow does not own, that fact is obtained through a **bounded
> Identity port under ADR-0043**, following the `reportingLine` and `delegation` precedent — never
> through a broad Identity permission held by the user, and never by reading Identity's tables.
>
> The port's **method, input, output, eligibility predicate, maximum result size, ordering,
> authorization, tenancy and failure semantics remain undefined** and must not be written until
> D-16D-12 through D-16D-16 are resolved. In particular, whether the port answers a **predicate**
> about one named membership or an **enumeration** of many is itself a consequence of D-16D-12 and
> D-16D-16, not a detail of implementation.
>
> Implementation remains blocked behind D-16D-10 regardless.

Constraints from the original are preserved in full: no general member directory, search, role
directory, organization chart or people directory; no `identity.membership.read` or other broad
Identity permission; caller holds `workflow.approval.escalate` only; tenant ambient; active status
only *if* D-16D-12 resolves that way; excludes memberships already on the branch; bounded; no N+1; no
client-supplied UUID as source of truth; deterministic ordering if ordering is required.

---

## 14. Implementation order after approval

Nothing below is authorized. This is the order that would be correct **if** approvals arrive.

1. **D-16D-09** — independent of everything here. Two production lines, then narrow the leak scan and
   assert the marker positively. Delivers Checkpoint 7 requirement 2 alone.
2. **D-16D-13 and D-16D-14** — domain-only, no dependency, and they change the *meaning* of
   escalation. They must land before any picker is designed, because a picker built against the wrong
   command contract would have to be rebuilt. If either reveals a gap in the shipped command, fixing
   the domain comes first.
3. **D-16D-12** — decides whether a port is on the write path. If Option A, the port and its refusal
   land here, with the Identity contract built and verified on its own side first (the precedent
   `reportingLine` set: *"a completed module's change, built and verified on its own side first"*).
4. **D-16D-15** — resolve, and record either way.
5. **D-16D-16** — only if a picker is still wanted after 2–4.
6. **D-16D-11 (amended)** — the port contract, written only once 2–5 are settled.
7. **D-16D-10** — Platform's, outside this phase. **No Admin mutation may be built before it**, so
   steps 5, 6 and any picker have no consumer until it resolves.

---

## 15. Locked invariants — none touched

Nothing in this review weakens or reopens: the snapshotted assigned denominator; branch tally
semantics; `majority`; `first-response`; the `unanimous` refusal for escalation; assigned-set
semantics; snapshot-at-start; fail-closed behaviour; append-only history; tenant isolation; RLS; the
absence of cross-module foreign keys; the absence of automatic execution, of a scheduler, of a
JobPort runner and of notification delivery.

**D-16D-08 is not reopened.** Every option above adds or withholds a *step*; none changes what the
denominator counts.

---

## 16. Statement

**No implementation was performed.** No domain, application, repository, Identity port, Identity
query, API, Admin, schema, migration, permission, authentication, scheduler or notification code was
written or modified. Only `pnpm standards` and `pnpm format:check` were run, as the
documentation-only rule allows; no implementation gate is claimed.

Register status: **D-16D-09 OPEN · D-16D-10 OPEN · D-16D-11 OPEN (amendment proposed, §13) ·
D-16D-12 OPEN · D-16D-13 OPEN · D-16D-14 OPEN · D-16D-15 OPEN · D-16D-16 OPEN.** No approval date is
recorded for any of them, because none has been approved.
