# After Phase 16E — the next product phase

**Date** 2026-08-21 · **Baseline** `2e70fa4`, working tree clean · **Code changes** NONE

This document selects the next phase from repository evidence and prepares its first implementation
checkpoint. **No implementation was performed**, and none is authorized by this document.

---

## 0. Summary

**Next product phase: Phase 5.2 — Employee Relations & Disciplinary**, delivered as a new module
`relations`.

It is the **lowest-numbered genuinely unbuilt phase whose prerequisites are all satisfied**, it is
named by the repository's own ownership map, it is a **hard prerequisite of Phase 11.2**, and it needs
nothing from `munaxa/munaxa-platform`.

It is *not* Phase 17. Phase 17 is examined and rejected in §3, on its own specification's evidence.

---

## 1. What the ledger actually says, once its stale rows are corrected

[`PHASES.md`](../PHASES.md) states the rule: *"Phases are implemented strictly in order. No phase
begins before the previous one satisfies its acceptance criteria, and skipping a phase is
prohibited."*

Its status column had drifted from the repository, in a way that matters here. Three rows were
corrected in this checkpoint:

| Row | Was | Now | Why |
|---|---|---|---|
| 4.1 Employee documents | Not started | **Complete** | Delivered as brief-numbered "Phase 12"; `documents` module, five tables. `phase-12-plan.md` **D-0** decided *"Deliver as 4.1 + 5.1 … update `PHASES.md` accordingly"* — decided, never actioned |
| 5.1 Employee letters | Not started | **Complete** | Same decision; `letters` module, six tables |
| 16 Workflow | Not started | **Awaiting approval** | 16A–16E all delivered with final reports. Marked *Awaiting approval* rather than *Complete* because no owner approval of Phase 16 as a whole is recorded — the same value rows 5 and 8 carry |

**The brief numbering and the roadmap numbering are two different sequences**, and this is a known,
recorded discrepancy rather than a discovery: `phase-12-plan.md` §0.1 states it outright — *"This phase
is not the repository's Phase 12 … Benefits already occupies 12."* Delivery has run
2·3·4·5·6·7·8·9·10·11 → **4.1+5.1** → 13·14A·15·16A–16E.

**Genuinely unbuilt, from the ownership map** ([`DOMAIN_OWNERSHIP.md`](../DOMAIN_OWNERSHIP.md), whose
table *"is the intent recorded by the phase specifications"* and names the module each will own):

| Phase | Module named | Built? |
|---|---|---|
| **5.2** Employee relations | **`relations`** | **no** |
| 5.3 Assets & custody | `assets` | no |
| 10.1 Loans & advances | `loans` | no |
| 11.1 Statutory & country packs | `statutory` | no |
| 11.2 Offboarding & settlement | `offboarding` | no |
| 12 Benefits | `benefits` | no |
| 12.1 Medical claims | `claims` | no |
| 13.1 Engagement & surveys | `engagement` | no |
| 17 Communications | `communications` | no |
| 22 Integrations | `integration` | no |

Verified by search: `violation`, `grievance`, `disciplinar` and `employee relations` have **zero**
presence in `packages/modules/*/src` or `prisma/schema.prisma` outside unrelated
`UniqueViolation` error handling.

**5.2 is the lowest.** Under the repository's own ordering rule, that alone decides it — and the
remaining criteria agree rather than conflict.

## 2. Prerequisites, as each specification states them

| Phase | Prerequisites it declares | Satisfied? |
|---|---|---|
| **5.2** | *"Phases 0 through 5, plus Phases 4.1 and 5.1."* | **Yes — every one delivered** |
| 5.3 | *"Phases 0 through 5, plus Phase 4.1."* | Yes — but numerically after 5.2 |
| 10.1 | *"Phases 0 through 10."* | Yes — but after 5.2 and 5.3 |
| 11.1 | *"Phases 0 through 11, and `00B_LOCALIZATION_AND_STATUTORY_FRAMEWORK.md`."* | Yes — but after the above |
| 11.2 | *"Phases 0 through 11, plus Phases 4.1, 5.1, **5.2**, **5.3** and **10.1**."* | **No — it names 5.2 as a prerequisite** |
| 12 Benefits | Phases 0–11 (read-list form) | Yes — but after 5.2…11.2 |
| **17** | read-list including **`13_PHASE_12_BENEFITS.md`** | **No — Benefits is unbuilt** |

**Phase 11.2 Offboarding — the last item of the first commercial milestone — explicitly requires 5.2.**
[`PHASES.md`](../PHASES.md): *"Phases 0 through 11.2 deliver a sellable product."* So 5.2 is not a
detour from the milestone; it is on its critical path.

## 3. Why the next phase is *not* Phase 17 Communications

Phase 17 is the numerically obvious answer and the wrong one, on two independent grounds from its own
specification:

1. **Its prerequisites are unsatisfied.** `18_PHASE_17_COMMUNICATIONS.md` requires
   `13_PHASE_12_BENEFITS.md`, and no `benefits` module exists.
2. **Its scope is blocked by the same missing dependency 16E just handed to Platform.** Phase 17's
   scope names **Delivery Queue · Delivery Attempt · Retries · Scheduled Message**, and its AD-006 makes
   retries configurable. Delivering a message on a schedule, retrying it on a policy and draining a
   queue all require the durable job runner that **does not exist and is Platform's** (D-16E-03).
   Selecting Phase 17 now would mean either building that runner here — forbidden — or shipping a
   Communications module that records requests and delivers nothing, which is the position Workflow is
   already in.

Choosing 17 would take the one thing 16E carefully handed across a repository boundary and pull it
back. It should be selected **after** Platform ships the runner, or after an explicit owner decision
narrows its scope to the parts that need none.

Phase 20 (analytics) and Phase 22 (integrations) are further out still, and 16D/16E already assigned
Workflow analytics to Phase 20 by that phase's own specification.

## 4. The dependency chain from 16E to 5.2

```
16E closes automatic execution
        ↓  Workflow is now feature-complete for adoption:
           definitions, versions, instances, parallel branches, quorum,
           conditions, groups, delegation, manager routing, service levels,
           escalation, and an automatic reminder
        ↓
5.2 is the next domain that *adopts* Workflow rather than extending it
        ↓  it routes disciplinary approval through the engine (Non-Goal:
           "Workflow engine — approvals route through Workflow")
        ↓
5.2 → 5.3 → 10.1 → 11.1 → 11.2  (11.2 names 5.2, 5.3 and 10.1 as prerequisites)
        ↓
first commercial milestone complete
```

16E does not *block* 5.2 and 5.2 does not *consume* 16E's automatic reminder. The relationship is
ordering, not coupling — which is exactly what makes 5.2 safe to start: it opens nothing 16E closed.

## 5. What already exists (do not rebuild)

| Capability 5.2 needs | Already delivered by | Contract |
|---|---|---|
| Approval routing for a disciplinary action | Workflow 16A–16D | `ApprovalPort` (kernel), `BusinessDecisionPort`; `recruitment.requisition` is the working precedent for an adopting module |
| The employment a violation is recorded against | Employment (Phase 5) | published contract; **AD-001 — reference Employment, never Person** |
| Evidence documents | Documents (4.1) | document types, stable identities, insert-only versions, verification, access trail |
| The issued disciplinary letter | Letters (5.1) | templates, immutable versions, frozen snapshot of substituted values, named-human approval |
| Authorized penalty reaching payroll | Payroll (Phase 11) | deduction definitions; **Payroll applies, Relations authorizes** |
| Who the manager/investigator is | Organization + Employment | the bounded reporting-line reads 16C already built |
| Immutability, RLS, effective dating, optimistic concurrency, audit | kernel + persistence | `app_protect_table` (ADR-0030), the append-only history pattern |

## 6. What is missing (the actual work)

A new `relations` module holding, per `06B_PHASE_5.2_EMPLOYEE_RELATIONS.md` §Domain model:
**ViolationCategory** (code, severity, penalty ladder, statutory constraints, repeat window) ·
**Violation** · **Investigation** · **DisciplinaryAction** · **Warning** (validity window and expiry) ·
**Grievance** · **Appeal**; the two lifecycles; the ten domain events; the REST surface; the Admin
read; and the localized catalogue.

## 7. Prerequisite audit

| Prerequisite | State |
|---|---|
| Phases 0–5 | **satisfied** |
| Phase 4.1 (Documents) | **satisfied** |
| Phase 5.1 (Letters) | **satisfied** |
| Workflow, for approval routing | **satisfied** — and now feature-complete through 16E |
| Payroll, to receive an authorized penalty | **satisfied** |
| **Country pack / statutory constraints** (Phase 11.1) | **missing, and Work-owned** — but *not* listed in 5.2's Prerequisites. AD-002 makes ladders *"tenant configurable and constrained by the country pack"*. The repository's established answer is Payroll's: it shipped with *"nothing statutory … no country pack"* and recorded the constraint as `NOT VERIFIED`. **Recommended: carry the statutory constraint as configuration and record enforcement `NOT VERIFIED`, and raise it as an explicit decision rather than inventing a country pack** |
| **Evidence file storage** | **missing, and not Work-owned in practice** — `StoragePort` has no adapter, which is why Documents *"holds no bytes"*. Evidence attaches as a **document reference**, and upload/download stay `NOT VERIFIED`, exactly as Documents already records |
| **`WarningExpired` as a fired event** | **blocked, Platform-owned** — no job runner. Expiry must be **derived at read time** from the validity window, the same pattern 16C used for service levels and 16E preserved. **No `expired` column, no sweep, no synthetic actor** |
| Platform | **nothing required** |
| Blocking approvals | **none** — the specification is `Status: Approved` |

Two of these need an owner decision before the checkpoint that touches them. **Neither blocks the
first checkpoint below**, which is deliberately scoped to avoid both.

## 8. First implementation checkpoint

**Checkpoint 5.2-1 — Definition of Ready.** Planning only, matching the precedent every prior phase
set (`phase-11-plan.md`, `phase-12-plan.md`, `phase-16d-plan.md`).

**Objective** — establish whether Phase 5.2 can be implemented as specified, and surface every
contradiction, contract gap and blocking decision **before** any code, schema or migration is written.

**Scope**
1. Read `06B_PHASE_5.2_EMPLOYEE_RELATIONS.md` end to end against the repository as it stands.
2. Audit the concepts it claims against `DOMAIN_OWNERSHIP.md` — in particular the boundaries it
   declares: **Employment executes termination, Relations only recommends**; **Payroll applies a
   deduction, Relations only authorizes**; **Performance owns improvement plans**.
3. Enumerate the cross-module reads it needs and check each against a **published contract** — no
   table access, no new broad permission. Report any gap rather than designing around it.
4. Resolve the three known gaps as **decisions, not implementations**: the country-pack constraint,
   evidence storage, and warning expiry with no runner.
5. Produce `docs/verification/phase-5.2-plan.md` with a numbered decision register, every entry `OPEN`.

**Files and areas likely involved** — planning only, so **no production file changes**. The eventual
module would be `packages/modules/relations/src/{domain,application,infrastructure,contracts,api}`
(ADR-0023), with `apps/api/src/relations/` owning transport and one additive migration under
`prisma/migrations/`.

**Tests** — none in this checkpoint; it writes no code. The plan must specify the suites the
implementation checkpoints will carry: domain rules, application authorization (one permission per
handler), persistence against real PostgreSQL with RLS **enabled and forced**, concurrency, and
immutability of the disciplinary record.

**Security and tenancy requirements** to be settled in the plan and honoured by every later checkpoint:

- Every handler declares **one explicit permission**; no wildcard, no prefix.
- **This domain carries legal weight** (specification §IMPORTANT): its records are evidence in a labor
  dispute, so history is **append-only**, corrections and annulments are **linked additions**, and every
  read is audited — a stronger requirement than any module has carried so far.
- Tenancy from the execution context only; `app_protect_table` on every table, enabled **and forced**.
- Access restricted: a grievance carries confidentiality, and a caller without the grant must not learn
  that a withheld record exists — the count-is-a-disclosure rule Documents already established.
- **No new Identity or Organization permission** without an explicit decision.

**Acceptance criteria for this checkpoint**
- Every concept in the specification is mapped to an owner, or reported as unowned.
- Every cross-module dependency is mapped to an existing published contract, or reported as a gap.
- Every contradiction between the specification and the repository is recorded with both readings.
- Every decision is `OPEN`; none is inferred from feasibility, precedent or convenience.
- `pnpm standards` and `pnpm format:check` pass (documentation-only change).

**Explicit non-goals for this checkpoint** — no module, no schema, no migration, no permission, no
route, no Admin screen, no country pack, no storage adapter, no scheduler or expiry sweep, no change to
Workflow, Employment, Payroll, Documents, Letters or Identity, and **no reopening** of D-16D-08,
D-16D-16, D-16D-10, or any Phase 16E decision.

## 9. Not selected, and why

| Candidate | Rejected because |
|---|---|
| **Phase 17 Communications** | Prerequisites unsatisfied (Benefits); scope needs the Platform runner — see §3 |
| **Phase 12 Benefits** | Numerically after 5.2, 5.3, 10.1, 11.1, 11.2; largest unbuilt spec; introduces `Dependent`, which `phase-12-plan.md` **D-1** deliberately *reserved and refused* |
| **Phase 11.2 Offboarding** | Its own specification names **5.2, 5.3 and 10.1** as prerequisites |
| **Phase 11.1 Statutory packs** | After 5.2/5.3/10.1; and it is the largest single source of country-specific risk in the programme |
| **A durable job runner here** | **Forbidden.** D-16E-03 assigns execution to Platform |
| **Another Phase 16 capability** | **No Phase 16F exists** anywhere in the repository. The unbuilt Phase 16 items are assigned elsewhere: analytics → Phase 20, notification delivery → Phase 17, expiry → withheld by G-6 pending an owner decision |
