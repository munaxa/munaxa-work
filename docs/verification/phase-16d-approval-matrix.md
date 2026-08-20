# Phase 16D — Final Decision Matrix for Owner Approval

**No owner approval is present in the instruction that produced this document.** Every decision below
is therefore recorded as **OPEN**, no option is selected, no approval date exists, and **no
recommendation is made** — the instruction directs that none be given unless explicitly asked.

**No implementation was performed.** No production code, domain, application, repository, Prisma,
migration, API, Admin, Identity, Employment, Organization or permission file was modified.

The consolidated register [`phase-16d-register.md`](phase-16d-register.md) remains authoritative for
status. This document adds, for each decision, the per-option consequences and impact axes an
approver needs in order to choose. Analysis behind each entry is preserved unmodified in
[`phase-16d-admin.md`](phase-16d-admin.md),
[`phase-16d-contract-gap.md`](phase-16d-contract-gap.md),
[`phase-16d-decisions.md`](phase-16d-decisions.md) and
[`phase-16d-eligibility.md`](phase-16d-eligibility.md).

---

## Decision Matrix

| Decision | Question | Options | Dependencies | Status |
|---|---|---|---|---|
| **D-16D-09** | Should `WorkflowStepView` publish `escalated: boolean`? | A approve · B amend the representation · C decline | **None.** Independent of every other decision. | **OPEN** |
| **D-16D-10** | Should Phase 16D define or implement Admin authentication? | A confirm outside 16D · B amend, define Work-side authentication | **None**, but gates all Admin invocation. Constrained by ADR-0001, ADR-0019, ADR-0032. | **OPEN** |
| **D-16D-11** | How does escalation obtain or validate an eligible membership? | A bounded enumeration · B predicate for one supplied membership · C hybrid · D amend | **Depends on D-16D-12…16.** Implementation additionally blocked by D-16D-10. | **OPEN** |
| **D-16D-12** | Must escalation reject a membership that is not active? | A command invariant · B picker concern only · AMEND | **None inbound.** Determines whether D-16D-11's contract touches the write path. | **OPEN** |
| **D-16D-13** | May the requester be added as an escalated approver? | A allowed · B forbidden · C context-specific · AMEND | **None.** Domain-only. | **OPEN** |
| **D-16D-14** | Does 16A D-5 apply when escalating an approver? | A apply exactly · B terminal decisions only · C override · AMEND | **None.** Domain-only. If A or B, the terminal state set must be enumerated. | **OPEN** |
| **D-16D-15** | Should active delegation affect escalation eligibility? | A irrelevant · B blocks · C evaluated at a defined instant · D decision-execution only · AMEND | **None inbound.** Uses the already-injected `DelegationPort` if B or C. | **OPEN** |
| **D-16D-16** | How is a candidate result bounded and ordered? | A no enumeration · B Identity-approved ordering · C unbounded · D paginated · AMEND | **D depends on B** (pagination needs the stable key only B supplies). Feeds D-16D-11. | **OPEN** |

---

## Per-decision consequences and impact

Impact axes: **Dom** domain · **API** public contract · **Idn** Identity dependency · **Adm** Admin ·
**Perm** permissions · **Pers** persistence/schema · **Budget** request budget · **Inv** locked
invariants preserved.

### D-16D-09 — Public escalation marker · OPEN

*Question.* Should `WorkflowStepView` publish `escalated: boolean`, `true` iff
`state.escalatedAt !== undefined`?

| Option | Concrete consequence | Dom | API | Idn | Adm | Perm | Pers | Budget | Inv |
|---|---|---|---|---|---|---|---|---|---|
| **A — approve** | Two production lines. Admin can distinguish an escalated approver from an assigned one. No timestamp, actor, reason, employment or reporting-line information exposed. Pre-migration rows read `false` naturally; no backfill. The API leak scan **will fail, correctly**, and is narrowed — never deleted — **only after approval**, keeping the withheld provenance forbidden while positively asserting the boolean. | none | **yes** — one required field | none | render only | none | none | unchanged | **yes** |
| **B — amend** | Consequences cannot be stated until the amended representation is given. Any representation richer than a boolean (instant, actor, reason) reopens the Checkpoint 6 withholding decision and requires its own justification. | ? | ? | ? | ? | ? | ? | ? | ? |
| **C — decline** | Nothing changes anywhere. An escalated approver remains indistinguishable from an assigned one on every consumer, permanently, because no sound derivation exists. **Checkpoint 7 requirement 2 should then be formally withdrawn** rather than left open. | none | none | none | none | none | none | unchanged | **yes** |

### D-16D-10 — Admin authentication · OPEN

*Question.* Should Phase 16D define or implement Admin authentication?

| Option | Concrete consequence | Dom | API | Idn | Adm | Perm | Pers | Budget | Inv |
|---|---|---|---|---|---|---|---|---|---|
| **A — confirm outside 16D** | No code anywhere. Escalation stays **API-reachable but not invocable from Admin**. Checkpoint 7 requirement 3 is blocked indefinitely. D-16D-11 and D-16D-16 have no consumer until Platform delivers. The twelve authentication sub-decisions stay unanswered; no owner is assigned beyond ADR-0001 and ADR-0019. | none | none | none | none | none | none | unchanged | **yes** |
| **B — amend, define Work-side authentication** | **STOP is required**: the architecture must be separately specified and approved before any Admin mutation work. It conflicts with ADR-0001 (*"Never duplicate Platform functionality"*) and ADR-0019 unless a separate Platform scope is approved. Scope spans `apps/admin` application-wide, `packages/config` and possibly `apps/api` — **not Workflow**. Nothing may be invented: no token acquisition, service credential, browser-held credential, cookie, session, CSRF scheme or token storage. | none | none | none | **app-wide** | none | none | changes | **yes** |

### D-16D-11 — Eligible-membership architecture · OPEN

*Question.* How can escalation obtain or validate an eligible membership? **The form cannot be chosen
until D-16D-12…16 are settled.**

| Option | Concrete consequence | Dom | API | Idn | Adm | Perm | Pers | Budget | Inv |
|---|---|---|---|---|---|---|---|---|---|
| **A — bounded enumeration** | Identity answers "which memberships are eligible". Enables an Admin picker. Requires D-16D-16 to settle bound **and** ordering first, and Workflow owns no sortable membership attribute. Carries the largest directory-adjacency risk of the three. | none | new query + route | **yes** — enumeration | picker | none — `workflow.approval.escalate` | none | +1 read where rendered | **yes** |
| **B — predicate for one supplied membership** | Identity answers "is this one membership eligible". Narrowest possible contract; **cannot become a directory**. Provides Admin no candidate list, so it does not by itself enable a picker. **If D-16D-12 = B there is no command-side invariant for it to validate**, and the contract has nothing to answer. | none, unless D-16D-12 = A | possibly none | **yes** — predicate | none | none | none | +1 on submit | **yes** |
| **C — hybrid** | Admin enumerates candidates; Workflow or Identity validates the selection. Both contracts exist, so both risk surfaces exist, and both D-16D-16 and D-16D-12 must be settled. | as A + B | as A + B | **yes** — both | picker + validation | none | none | +1 render, +1 submit | **yes** |
| **D — amend** | Consequences unstatable until the amendment is given. | ? | ? | ? | ? | ? | ? | ? | ? |

Constraints on every form: no general member directory, search, role directory, organization chart or
people directory · no `identity.membership.read` or other broad Identity permission · ADR-0043
bounded grant · tenant ambient · excludes memberships already on the branch · no N+1 · no
client-supplied identifier as source of truth.

### D-16D-12 — Active membership · OPEN

*Question.* Must escalation reject a membership that is not active?

| Option | Concrete consequence | Dom | API | Idn | Adm | Perm | Pers | Budget | Inv |
|---|---|---|---|---|---|---|---|---|---|
| **A — command invariant** | Identity joins the **write path**. A sixth escalation refusal is required. The domain stays pure, so activeness must be resolved in the application and passed in, as `ManagerResolution` is. Escalation fails closed when Identity is unreachable, so **an Identity outage becomes an escalation outage**. Picker and command can then share one predicate. Moves the "taken as given" line for one command only — `add-group-member` would still accept what escalation refuses. | **yes** — new input + refusal | new failure mode (422), no view change | **yes** — write path | picker may share the predicate | none | none | +1 port call per escalation | **yes** |
| **B — picker concern only** | The command's contract is documented as it already behaves: any identifier satisfying the two branch exclusions. No Identity read during execution. Consistency with `add-group-member` and typed membership steps preserved. **A picker may filter but must never present "active" as a Workflow guarantee.** Concrete harm: an escalation to an inactive membership sits `awaiting` forever, because nobody can answer it. | none | none | none | filter only, unlabelled | none | none | unchanged | **yes** |

*Note.* "Active" is not automatically correct merely because Identity has a status field. The module's
existing line is principled: Workflow refuses on activeness where it **resolved** somebody
(`manager-not-a-member`, `manager-membership-ambiguous`) and takes the identifier as given where a
human **named** somebody. Escalation is the latter.

### D-16D-13 — Requester self-approval · OPEN

*Question.* May the requester be added as an escalated approver?

| Option | Concrete consequence | Dom | API | Idn | Adm | Perm | Pers | Budget | Inv |
|---|---|---|---|---|---|---|---|---|---|
| **A — allowed** | Status quo. An administrator may escalate an approval to the person who raised it. | none | none | none | none | none | none | unchanged | **yes** |
| **B — forbidden** | One domain refusal with its own name and reason — **not** a reuse of `manager-is-the-requester`, whose scope is manager routing. Applies to all escalation, since the requester is a property of the instance rather than of a routing method. **Domain-only**: the instance state is already in hand. A previously accepted request begins to be refused, so **the shipped command's behaviour changes**. | **yes** — one predicate + refusal | new failure mode | none | none | none | none | unchanged | **yes** |
| **C — context-specific** | Exact semantics must be stated. The example considered (refuse only when the requester would become the sole unresolved approver) makes the rule depend on a **tally read at escalation time** — a coupling this module has otherwise avoided. It does not alter the tally, so invariants hold, but it ties a refusal to computed state. | **yes** | new failure mode | none | none | none | none | unchanged | **yes**, with the coupling caveat |

### D-16D-14 — D-5 terminal-approver rule · OPEN

*Question.* Does 16A D-5 — *a step may not name an approver already terminal on the same instance* —
apply when escalating? **Not a data-availability question**: the command already loads every step of
the instance.

| Option | Concrete consequence | Dom | API | Idn | Adm | Perm | Pers | Budget | Inv |
|---|---|---|---|---|---|---|---|---|---|
| **A — apply exactly** | Any membership with a terminal step anywhere on the instance is refused. **The approval must state whether `skipped` counts.** `skipped` is terminal but is **not a decision** — it is what happens after a rejection or cancellation and to steps a condition excluded, so counting it refuses somebody who never had a say. Behaviour of the shipped command changes. | **yes** — one predicate + refusal | new failure mode | none | none | none | none | unchanged | **yes** |
| **B — terminal decisions only** | Refuses `approved` and `rejected`; admits `skipped`. Narrower, and the terminal set is unambiguous. Behaviour of the shipped command changes. | **yes** | new failure mode | none | none | none | none | unchanged | **yes** |
| **C — override D-5** | Status quo, with the exemption recorded and reasoned rather than left as an absence. Candidate reason: D-5 guards a *configured or resolved* approver being reused mechanically, whereas a human may deliberately want somebody who rejected one branch consulted on a stuck later one. | none | none | none | none | none | none | unchanged | **yes** |

### D-16D-15 — Delegation · OPEN

*Question.* Should active delegation affect escalation eligibility? The existence of
`DelegationPort.activeFor` does not imply that it must.

| Option | Concrete consequence | Dom | API | Idn | Adm | Perm | Pers | Budget | Inv |
|---|---|---|---|---|---|---|---|---|---|
| **A — irrelevant** | A delegate is a separate membership and may be escalated unless another approved rule excludes them. No change. | none | none | none | none | none | none | unchanged | **yes** |
| **B — blocks escalation** | The exact instant must be defined. The port answers **at an instant** by design — Workflow stores no delegation row and runs no expiry job — so a check at escalation evaluates delegation at a moment the design says is not the deciding moment, **and cannot prevent the harm**, since a delegation may be created after the escalation. Incomplete by construction. | **yes** — new input + refusal | new failure mode | none new — port already injected | none | none | none | +1 port call per escalation | **yes** |
| **C — another defined instant** | As B, plus the instant and its justification must be stated. | **yes** | new failure mode | none new | none | none | none | +1 | **yes** |
| **D — decision-execution only** | Escalation does not consider delegation; delegation governs who may act when the decision is later made. Documented rather than left silent. No change. | none | none | none | none | none | none | unchanged | **yes** |

### D-16D-16 — Result bound / ordering · OPEN

*Question.* If Admin needs candidate memberships, how is the result bounded and ordered? **Workflow
owns no approved sortable membership attribute** — `ApprovalGroupMemberView` carries `membershipId`
and `addedOn` only. No ordering may be invented from a UUID, insertion order, physical order or an
unapproved timestamp; no limit or page size may be invented.

| Option | Concrete consequence | Dom | API | Idn | Adm | Perm | Pers | Budget | Inv |
|---|---|---|---|---|---|---|---|---|---|
| **A — no enumeration** | A predicate/validation model. **Admin has no candidate picker**, and — since a free-text identifier is forbidden — no way to select an approver from the screen at all. Escalation stays API-only regardless of D-16D-10. | none | none | predicate only | **no picker** | none | none | unchanged at render | **yes** |
| **B — Identity-approved ordering** | Identity's contract must publish a deterministic ordering key. That key is a membership attribute, so the contract moves measurably closer to a directory and needs review against D-16D-11's directory constraints. | none | new query + route | **yes**, widened | picker | none | none | +1 read | **yes** |
| **C — unbounded enumeration** | Acceptable only if tenant scale and request budget explicitly justify it. For a large tenant this is a full directory dump under another name, which D-16D-11's constraints forbid. | none | new query + route | **yes**, widest | picker | none | none | unbounded | **yes** |
| **D — paginated** | Requires a stable ordering key, so **D presupposes B**. Pagination also needs navigation, which needs interactivity — blocked by D-16D-10. | none | new query + route | **yes**, as B | picker + navigation | none | none | +1 per page | **yes** |

---

## Dependency Analysis

**Three independent tracks. Approvals must be made in this order within each.**

```
Track 1 — independent
  D-16D-09  ──▶  WorkflowStepView marker        [approvable and deliverable alone]

Track 2 — eligibility
  D-16D-12 ─┐
  D-16D-13 ─┤
  D-16D-14 ─┼──▶  D-16D-11 exact contract ──▶  Identity contract / port ──▶  candidate
  D-16D-15 ─┤                                                                selection
  D-16D-16 ─┘                                                                or validation

Track 3 — invocation
  D-16D-10  ──▶  Platform authentication  ──▶  Admin mutation architecture
```

**Ordering within Track 2, and why:**

1. **D-16D-13 and D-16D-14 first.** Both are domain-only, depend on nothing, and change the *meaning*
   of escalation. Any contract or picker designed before they settle would be designed against a
   command that may be about to refuse more than it does today.
2. **D-16D-12 next.** It fixes D-16D-11's most basic property — whether the contract sits at render
   time or on the write path — so the form cannot be chosen before it.
3. **D-16D-15 next.** It may add a second write-path port call; settling it after D-16D-12 keeps the
   write-path question in one place.
4. **D-16D-16 next.** It decides whether enumeration is viable at all, and therefore whether a picker
   exists.
5. **D-16D-11 last**, because its form (enumeration, predicate, hybrid) is a *consequence* of 1–4
   rather than an independent choice.

**Track 3 is orthogonal to whether the API supports escalation.** The API already does. D-16D-10
decides only whether Admin can invoke it.

**Track 1 is orthogonal to both.** D-16D-09 needs no authentication and no membership source.

---

## Implementation Blockers

Exactly what each OPEN decision blocks, and nothing more.

| OPEN decision | Blocks |
|---|---|
| **D-16D-09** | Any distinction between an escalated and an assigned approver in any consumer. Checkpoint 7 requirement 2. **Blocks nothing else** — no other work waits on it. |
| **D-16D-10** | Every Admin mutation, in every module, not only escalation. Checkpoint 7 requirement 3. The *usefulness* of anything Track 2 produces — a picker with no authenticated way to submit has no consumer. Does **not** block API escalation, which already works. |
| **D-16D-11** | The Identity contract and port. Must not be designed before D-16D-12…16 settle. Additionally blocked from implementation by D-16D-10. |
| **D-16D-12** | D-16D-11's form. Whether the port is read-only or on the write path. Whether a sixth refusal exists. Whether a picker's "active" filter may be described as enforcement. |
| **D-16D-13** | The command's eligibility contract. Any picker rule about the requester. Resolution of whether the shipped command has a gap. |
| **D-16D-14** | The command's eligibility contract. The terminal state set. Any picker rule about prior participation. Resolution of whether the shipped command has a gap. |
| **D-16D-15** | Whether escalation consults delegation. Any picker rule about delegates. |
| **D-16D-16** | Whether a candidate picker is viable at all. D-16D-11's form. Any Identity ordering contract. |

**Not blocked by anything here:** the escalation API route, command, domain, schema and permission,
all of which shipped in Checkpoints 2–6 and remain fully functional.

---

## Product consequences surfaced explicitly

1. **If D-16D-16 = A, Admin may have no candidate picker** — and, with free-text identifiers
   forbidden, no way to select an approver from the screen at all.
2. **If D-16D-11 = predicate-only, Admin has no candidate enumeration.** It can validate a selection
   it cannot make.
3. **If D-16D-12 = B, there is no active-status command invariant for an Identity predicate to
   validate.** Combined with D-16D-11 = B, the contract has nothing to answer.
4. **D-16D-13 and D-16D-14 change the actual meaning of escalation** and must therefore be
   implemented in the domain command, never as UI filtering.
5. **Any picker rule narrower than the command must be described as UI convenience, not business
   enforcement** — in the honesty catalogue, in column headings and in notices.
6. **A rule intended to be authoritative belongs in the domain command**, where the API remains the
   final authorization boundary and every refusal fires regardless of what a screen offered.
7. **D-16D-10 is independent of whether the API supports escalation.** It already does; D-16D-10
   determines only whether Admin can invoke it.

---

## Locked invariants

**Every option in this matrix preserves all locked invariants**, and each was checked individually:
snapshotted assigned denominator · stable assigned set · escalated steps excluded from `assigned` ·
`majority` semantics · `first-response` semantics · the `unanimous` refusal · branch isolation ·
quorum · condition behaviour · snapshot semantics · append-only history · tenant isolation · RLS · no
cross-module foreign keys.

Every option adds or withholds a **step**, or adds a **refusal**; none changes what the denominator
counts. **D-16D-08 remains LOCKED and is not reopened.**

One caveat recorded rather than buried: **D-16D-13 Option C** would make a refusal depend on a tally
read at escalation time. It does not modify the tally and so preserves the invariants, but it couples
a refusal to computed state in a way the module has otherwise avoided.

---

## Register Update

**No explicit owner approval is present in the instruction that produced this document.**
Accordingly:

- **No decision was made.**
- **Every decision is recorded as OPEN**: D-16D-09, D-16D-10, D-16D-11, D-16D-12, D-16D-13,
  D-16D-14, D-16D-15, D-16D-16.
- **No production change was made.**
- **No implementation checkpoint was created.**
- **No option was recommended**, in accordance with the instruction.
- No approval date is recorded for any decision.

**When an owner explicitly approves an option**, the sequence is: update the register first; record
the approval date; preserve the rejected alternatives; record the constraints attached to the
approval; and only then begin the implementation checkpoint that decision authorizes.

Gates run: `pnpm standards`, `pnpm format:check`. **No implementation gate is claimed, because no
implementation occurred.**
