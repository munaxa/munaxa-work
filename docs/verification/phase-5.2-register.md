# Phase 5.2 — Employee Relations & Disciplinary · Decision Register

**Status** Six approved · **Checkpoint 1 implemented** · **Date** 2026-08-22 · **Baseline** `d5c24b7`

**Implementation status:** Checkpoint 1 is built, tested and verified — module `@work/relations`,
three tables, one additive migration, three commands, three queries, four permissions, 188 module
tests plus 26 in `apps/api`. The report is
[`phase-5.2-checkpoint-1.md`](phase-5.2-checkpoint-1.md). **The eight remaining decisions are
untouched and none was needed.**

**Six decisions were approved by the owner on 2026-08-22** — D-5.2-03, D-5.2-04, D-5.2-05, D-5.2-06,
D-5.2-07 and D-5.2-14. Each carries an **Owner approval** block recording the approval in the owner's
own terms, appended beneath the analysis rather than replacing it, so what was recommended and what
was approved stay separately readable. **Checkpoint 1 is authorized and implemented** — see
[`phase-5.2-checkpoint-1.md`](phase-5.2-checkpoint-1.md).

The remaining eight decisions are unchanged. Every decision below is **OPEN** unless its Status says otherwise. A decision marked
*SETTLED BY EXISTING EVIDENCE* is one the repository has already decided in a document that predates
this register; the evidence is cited so the claim can be checked rather than trusted.

**A recommendation is not an approval.** Where this register recommends an option, that is analysis
offered to the owner. The eight decisions still `OPEN` carry no approval date, because none has been
given for them.

---

## Summary

| ID | Question | Status | Blocks checkpoint 1? |
|---|---|---|---|
| D-5.2-01 | Module name and boundary | **SETTLED BY EXISTING EVIDENCE** | no |
| D-5.2-02 | What Relations references — Employment, never Person | **SETTLED BY EXISTING EVIDENCE** | no |
| D-5.2-03 | Immutability mechanism | **APPROVED** 2026-08-22 | **resolved** |
| D-5.2-04 | The `relations.*` permission set | **APPROVED** 2026-08-22 | **resolved** |
| D-5.2-05 | Read auditing — AD-007 | **APPROVED** 2026-08-22 | **resolved** |
| D-5.2-06 | Country-pack constraint on categories — AD-002 | **APPROVED** 2026-08-22 | **resolved** |
| D-5.2-07 | Penalty ladder: shape, and whether it lands in checkpoint 1 | **APPROVED** 2026-08-22 | **resolved** |
| D-5.2-08 | Evidence attachments — the Documents contract | **OPEN** | no (deferred out) |
| D-5.2-09 | Warning expiry — derived or persisted (AD-006) | **OPEN** | no |
| D-5.2-10 | Payroll penalty intake — AD-004 | **OPEN** | no |
| D-5.2-11 | Employment termination recommendation — AD-005 | **OPEN** | no |
| D-5.2-12 | Workflow approval adoption — AD-008 | **OPEN** | no |
| D-5.2-13 | Grievance confidentiality | **OPEN** | no |
| D-5.2-14 | Scope of the first implementation checkpoint | **APPROVED** 2026-08-22 | **resolved** |

All six blocking decisions are **APPROVED**, and none required a new architectural pattern: every one
resolved onto a mechanism this repository already runs. The eight that remain `OPEN` are untouched by
this approval and none of them was needed by Checkpoint 1.

---

## D-5.2-01 — Module name and boundary · SETTLED BY EXISTING EVIDENCE

**Evidence.** `docs/DOMAIN_OWNERSHIP.md:49` — `| Violation, disciplinary action, grievance |
relations | Phase 5.2 |`. The ownership map already names the module and the concepts it will own,
and states that its table *"is the intent recorded by the phase specifications"*.

Verified absent: no `packages/modules/relations`, and no `violation`, `grievance` or `disciplinary`
identifier anywhere in `packages/modules/*/src` or `prisma/schema.prisma` (the only matches are
`UniqueViolation` error handling in Attendance and Career, which is unrelated).

**Decision:** one module, `@work/relations`, at
`packages/modules/relations/src/{domain,application,infrastructure,contracts,api}` per ADR-0023, with
`apps/api/src/relations/` owning transport.

## D-5.2-02 — Relations references Employment, never Person · SETTLED BY EXISTING EVIDENCE

**Evidence.** Specification **AD-001**, stated without alternatives. It matches the programme
invariant in `ROADMAP_ANALYSIS.md`: *"Every operational domain references Employment, never Person.
Person owns permanent identity; Employment owns the temporary relationship."*

`employment.read-employment` is published and available. **Nothing new is required of Employment for
this.**

---

## D-5.2-03 — Immutability mechanism · **APPROVED**

**The requirement.** AD-003: *"The record is immutable. A correction is a new, linked record with a
stated reason. Nothing is edited or deleted, including after an appeal succeeds — a successful appeal
annuls, it does not erase."* This is the strongest immutability claim any phase has made, because
these records are evidence in a labor dispute.

**Evidence — the repository has two established mechanisms:**

| Mechanism | Where | What it gives |
|---|---|---|
| A database trigger refusing `UPDATE`/`DELETE` | `workflow_history` (`workflow_history_immutable`), `workflow_decision` (`app_workflow_decision_immutable`), finalized payroll (ADR-0066, measured at +8% on single-row updates) | refusal *from any path*, including a direct `psql` session |
| Insert-only versions with a denormalized pointer | `document_version` + `Document.current_version_id` | a correction history readable as a chain |

**Options.**
- **(a)** Trigger-enforced immutability on the violation and action records themselves.
- **(b)** Insert-only version chain, as Documents does.
- **(c)** Both: the record is trigger-immutable, and a correction is a new linked row.

**Recommendation: (c).** AD-003 asks for both properties and they are not substitutes — the trigger
gives *"nothing is edited"*, the linked row gives *"a correction is a new record with a stated
reason"*. The cost is one trigger function per table, which the repository has paid four times
already.

*This blocks checkpoint 1* because it decides the shape of the first table.

### Owner approval · 2026-08-22

**APPROVED — the existing database-enforced immutability trigger pattern.** *"The violation record
must be immutable after creation. The database must reject: UPDATE; DELETE. Do not rely solely on
application-level guards. Do not invent a new immutability mechanism. Reuse the established
PostgreSQL trigger/function pattern already present in the repository."*

**As built:** `app_relation_violation_immutable()`, modelled on `app_document_access_immutable()`,
refusing `update or delete` with `errcode = 'restrict_violation'`. The recommendation's second half —
a correction as a linked row — is **not** built in Checkpoint 1: no correction path exists yet
because nothing can change a violation. It returns with the lifecycle in a later checkpoint.

## D-5.2-04 — The `relations.*` permission set · **APPROVED**

**Why this is a decision and not an implementation detail.** The repository rule is that a new
permission requires an explicit decision. Every handler declares exactly one, no wildcards, no
prefixes — asserted per module.

**Evidence — the naming convention** is `<module>.<concept>.<verb>`, e.g. Documents'
`document.type.read` / `document.type.manage`, and its three-way split
`document.read` ≠ `document.download` ≠ `document.read-sensitive`, which exists because *a count is
itself a disclosure*.

**The tension AD-007 creates.** *"Access is restricted independently of ordinary employee access."*
So a `relations.*` grant must not be implied by any existing HR grant, and there must be no
permission that a general HR administrator would already hold.

**Options for checkpoint 1.**
- **(a)** Two: `relations.category.manage`, `relations.violation.record`.
- **(b)** Four: add `relations.category.read`, `relations.violation.read`.
- **(c)** A single `relations.manage`.

**Recommendation: (b).** (c) is a wildcard in all but spelling and collapses exactly the read/write
separation AD-007 asks for. (a) leaves reads unpermissioned, which cannot be right for a record whose
every read must be audited. **The exact list is the owner's to approve**, and no permission should be
created before that.

### Owner approval · 2026-08-22

**APPROVED — option (b), the narrowest set Checkpoint 1 requires.** *"no future disciplinary
permissions; no wildcard permission; no broad `relations.admin`; no permission covering functionality
that does not yet exist."*

**As built — four, and only four:** `relations.category.read` · `relations.category.manage` ·
`relations.violation.read` · `relations.violation.record`. Asserted exact by the composition suite,
which also asserts that no existing permission from any other module opens a `relations` handler.

## D-5.2-05 — Read auditing · **APPROVED**

**The requirement.** AD-007: *"every read of a disciplinary record is audited."*

**Evidence — the precedent exists and works.** Documents holds `document_access_event`, written on
read, and publishes `documents.audit` over it. So this is not a new capability; it is a decision to
reuse one.

**The cost, stated honestly.** An audited read means a **write on every read**, inside the read's own
transaction. That makes reads slower and makes a read fail when the write fails. Documents accepted
that trade for the same reason: a disclosure that left no trace is not auditable.

**Options.**
- **(a)** Write an access event on every read of a violation or action, as Documents does.
- **(b)** Audit only reads of records classified confidential.
- **(c)** Defer read auditing to a later checkpoint.

**Recommendation: (a).** AD-007 says *every* read, and (b) re-decides in Relations what the
specification already decided. **(c) is not recommended** even though it would make checkpoint 1
smaller: retro-fitting an access trail onto a record type that already exists means a period with
unaudited reads of exactly the records that most need auditing.

### Owner approval · 2026-08-22

**APPROVED — the existing audited-read pattern**, explicitly `documents.document_access_event`.
*"Do not invent a new audit architecture … The audit must identify the read without exposing
unnecessary employee information. Do not introduce a generic 'audit every query' mechanism."*

**As built:** `relation_violation_access_event`, immutable by trigger, written inside the read's own
transaction. It carries the violation identifier, the action, the actor, the instant, the correlation
identifier and the outcome — **and no employment identifier, no category, no description**, because
the trail answers *who looked at which record* and copying the employee's details into it would make
the audit table a second disclosure of the thing it audits.

**The line the approval draws is honoured:** violation reads are audited; **catalogue reads are
not**. A catalogue is tenant configuration, not an employee record, and auditing it would be the
generic every-query mechanism the approval forbids.

## D-5.2-06 — Country-pack constraint on categories · **APPROVED**

**The requirement.** AD-002: violation categories and penalty ladders are *"tenant configurable and
constrained by the country pack. Nothing is hardcoded."* And the objective: *"Feed statutory
constraints from the country pack — what an employer may lawfully deduct or impose, and after what
process."*

**Evidence — the country pack does not exist.** `packages/country-packs/src/index.ts` is a
bootstrapped shell whose own comment reads: *"Statutory content by country … **Filled in Phase
11.1.** Bootstrapped here so that the package, its build and its place in the project references
graph are proven before anything depends on them. **It deliberately exports nothing yet.**"* Phase
11.1 is unbuilt.

**Evidence — two completed phases already met this exact problem and answered it the same way.**
`AttendancePolicy.source` carries the comment *"`tenant` today; `country_pack` when Phase 11.1
supplies the statutory version"*, and `LeaveType` carries nullable `country_pack_id` and
`country_pack_version`. Payroll shipped with *"no tax, no social security, no GOSI, no WPS, no Mudad,
no Muqeem, and no country pack"*.

**Options.**
- **(a)** Follow the Attendance/Leave precedent: a `source` discriminator (`tenant` today,
  `country_pack` later) plus nullable `country_pack_id` / `country_pack_version`. Categories are
  tenant configuration; **statutory constraint enforcement is recorded `NOT VERIFIED`**.
- **(b)** Block Phase 5.2 until Phase 11.1 ships.
- **(c)** Write the statutory rules into Relations now.

**Recommendation: (a).** It is the answer two completed phases already gave, it keeps the seam
visible rather than implied, and it satisfies *"nothing is hardcoded"* — which is the half of AD-002
that is actually achievable today. **(c) is refused outright**: inventing labor-law rules for any
jurisdiction would be fabricating legal content, and the specification assigns statutory content to
the country pack, not here. **(b) is not recommended** — 5.2's own Prerequisites are *"Phases 0
through 5, plus Phases 4.1 and 5.1"* and do **not** list 11.1, and Phase 11.2 lists 5.2 as *its*
prerequisite, so blocking on 11.1 would stall the milestone on a dependency the specification did not
declare.

**What this costs, stated plainly:** until Phase 11.1, a tenant can configure a ladder its country's
labor law would not permit, and nothing will stop it.

### Owner approval · 2026-08-22

**APPROVED — option (a), the existing country-pack discriminator/version pattern.** *"Do not implement
labor-law enforcement in Checkpoint 1 … Mark actual legal enforcement as NOT VERIFIED / deferred to
Phase 11.1. Do not invent Jordanian or any other jurisdiction's disciplinary rules. Do not hard-code
statutory limits. Do not create a new country-pack implementation."*

**As built:** `source` (`tenant` | `country_pack`) plus nullable `country_pack_id` and
`country_pack_version`, exactly the columns `document_type` already carries and the discriminator
`attendance_policy` already carries. A `country_pack` source with no pack identifier is refused by a
CHECK constraint, so the boundary is explicit in the schema rather than implied.

**No statutory content ships**, for any jurisdiction. Legal enforcement is **NOT VERIFIED**, deferred
to Phase 11.1. A negative-space test asserts that no country code, no jurisdiction name and no
statutory limit appears in the module's source.

## D-5.2-07 — Penalty ladder: shape, and whether it lands in checkpoint 1 · **APPROVED**

**The requirement.** `ViolationCategory` — *"code, severity, penalty ladder, statutory constraints,
repeat window."*

**The problem.** A ladder is an ordered list of penalties escalating *"from verbal warning through to
dismissal recommendation"*. Its shape is determined by what consumes it — `DisciplinaryAction`, which
does not exist until checkpoint 2. Designing it first means guessing.

**The competing principle.** ADR-0070: *"a stored flag that nothing maintains is worse than no flag."*
A ladder nothing reads is configuration ahead of its consumer — which is normal (leave types precede
leave requests) — but a ladder whose *shape* is guessed ahead of its consumer is a published contract
that will need a breaking change.

**Options.**
- **(a)** Category in checkpoint 1 carries `code`, `name`, `severity`, `repeat window`, `source`; the
  **ladder arrives in checkpoint 2** with the action that reads it.
- **(b)** The full category including the ladder in checkpoint 1.

**Recommendation: (a).** It delivers the configurable catalogue — real, usable tenant configuration —
without publishing a contract whose consumer is unbuilt. **This is a checkpoint-sequencing
recommendation, not a scope reduction:** the ladder remains fully in Phase 5.2.

### Owner approval · 2026-08-22

**APPROVED — an explicit ordered sequence, persisted as data.** *"The sequence must be deterministic
and persisted as configuration/data rather than inferred from severity names … The first checkpoint
does not implement the disciplinary ladder execution."*

**As built:** `sequence`, a non-negative integer on the catalogue entry. Ordering is
`(sequence, code)` — deterministic **without** requiring the sequence to be unique, so two entries
sharing a rank still order identically on every read. `severity` is a tenant-defined label and
**nothing orders by it**, which is the approval's operative clause.

**Not built, per the approval:** ladder execution · automatic advancement through disciplinary levels ·
any inference of legal validity from the sequence.

---

## D-5.2-08 — Evidence attachments · OPEN · *not required by checkpoint 1*

**The requirement.** `Violation` — *"evidence attachments"*. `Investigation` — *"statements,
evidence"*.

**Evidence — Documents can already hold this, and no storage adapter is needed.** `Document.owner_type`
is *"Explicit, never inferred: `person`, `employment` or `legal_entity`"*, so a document already
files against an employment. Relations would hold a **document reference**, not bytes.

**And bytes are not available anyway.** `StoragePort` has **no adapter anywhere** — Documents
*"holds no bytes"*, and upload, download, content inspection, malware scanning and hash verification
are all `NOT VERIFIED`. Performance, Career and Learning each record the same absence.

**Options.**
- **(a)** Relations references a `documentId`; Documents owns the file; a bounded Documents port
  answers whether the reference is valid and readable by this caller.
- **(b)** Relations holds its own attachment table.
- **(c)** Build a `StoragePort` adapter.

**Recommendation: (a).** (b) duplicates a concept Documents owns, which the one-concept-one-owner
rule forbids. **(c) is explicitly out of scope** — building S3/R2/local storage to unblock planning
is exactly the speculative infrastructure this phase must not create, and storage ownership is
Phase 4.1's open `NOT VERIFIED` item, not 5.2's to close.

**Checkpoint 1 does not need this**, because a violation can be recorded with a description before
evidence is attached to it — which is also how the lifecycle reads: *Violation Reported → Under
Investigation*, with evidence gathered during investigation.

## D-5.2-09 — Warning expiry · OPEN · *not required by checkpoint 1*

**The requirement.** AD-006: *"Warnings expire. Validity periods are configurable, and an expired
warning no longer counts toward escalation."*

**Evidence — the repository has decided this class of question four times, the same way.** 16C:
due-ness, state and overdue minutes are *"derived on every read … and stored nowhere: there is no
`due_at`, no `expired`, no `breached`"*, because *"a stored due time would be a second record able to
disagree with its own inputs and a stored `expired` would need something to write it — a scheduler
this phase does not have or a synthetic actor ADR-0045 refuses"*. ADR-0070 states it generally.
Phase 16E's **G-6** withheld an automatic expiry action pending a named behaviour, and none has been
named.

**Read AD-006 precisely.** *"An expired warning no longer counts toward escalation"* is a **read-time
predicate**: when counting prior warnings, exclude those whose validity window has closed. That needs
no column, no event and nothing to fire.

**The one part that is not read-time** is the `WarningExpired` **domain event** the specification
lists. An event is something that *fires*, and nothing in this repository fires on a date —
`JobPort` has no adapter, and Phase 16E assigned the runner to Platform.

**Options.**
- **(a)** Expiry is derived at read time; no `expired` column; `WarningExpired` is **not** emitted,
  and is recorded `NOT VERIFIED` with the runner named as its dependency.
- **(b)** Persist an `expired` flag and have something maintain it.
- **(c)** Build a sweep in Relations.

**Recommendation: (a).** **(c) is refused** — it is a scheduler, forbidden by D-16E-03 and by this
checkpoint's own constraints. **(b) is refused** — nothing exists to maintain the flag, which is
precisely the state ADR-0070 calls worse than no flag.

## D-5.2-10 — Payroll penalty intake · OPEN · *not required by checkpoint 1*

**The requirement.** AD-004: *"A disciplinary action that carries a financial penalty produces an
authorized deduction instruction for Payroll. This domain never computes payroll."*

**Evidence — Payroll has no inbound seam for this, and its architecture is pull, not push.** Every
Payroll cross-module port is a `*SourcePort` it **reads** from: `EmploymentSourcePort`,
`CompensationSourcePort`, `AttendanceSourcePort`, `LeaveSourcePort`, `OrganizationSourcePort`. There
is no `RelationsSourcePort` and no command that accepts an external deduction instruction. Phase 11's
own record states *"Reconciliation is a pull, so correctness never depends on an event having been
delivered"*, and dispatch is at-most-once with no outbox (ADR-0053/0064).

**So this is a cross-module contract decision that touches a completed module.**

**Options.**
- **(a)** Relations **publishes a read** of authorized penalties for a period; Payroll consumes it
  through a new `RelationsSourcePort`. Matches the established pull pattern exactly.
- **(b)** Relations emits a domain event Payroll subscribes to.
- **(c)** Relations calls a new Payroll command.

**Recommendation: (a).** (b) makes a financial fact depend on at-most-once delivery, which is the
failure mode Payroll's pull design exists to avoid. (c) inverts the direction every other Payroll
dependency runs in. **(a) still requires an owner decision** because it adds a published contract and
changes a completed module.

## D-5.2-11 — Employment termination recommendation · OPEN · *not required by checkpoint 1*

**The requirement.** AD-005: a recommendation only — *"Employment executes, through its own lifecycle
and approvals."*

**Evidence.** Employment publishes `employment.end-employment` and `employment.change-status`. Neither
takes a recommendation, and neither should be called by Relations — that would *be* the execution
AD-005 forbids.

**Recommendation:** Relations records `TerminationRecommended` as its **own** record and publishes a
read; a human acts on it through Employment's existing lifecycle. **No Employment change, no
automatic call.** Confirmation needed that a recommendation creates no obligation in Employment.

## D-5.2-12 — Workflow approval adoption · OPEN · *not required by checkpoint 1*

**The requirement.** AD-008 (due process — *"notice, hearing, response window and approvals"*) and the
Non-Goal *"Workflow engine — approvals route through Workflow."*

**Evidence — the seam exists and needs nothing new from Workflow.** The kernel's `ApprovalPort`
takes an opaque `subjectType`; Workflow's controller *"neither holds nor interprets"* it —
`recruitment.requisition` is the working precedent. So `relations.disciplinary-action` would route
with **no Workflow change**.

**The one genuinely new piece** is the return path: `apps/api` composes `RecruitmentDecisions`
implementing Workflow's `BusinessDecisionPort`, and a `RelationsDecisions` sibling would be needed.
That is a composition-root addition, **not a Workflow modification**.

**Recommendation:** adopt `ApprovalPort` with `subjectType: 'relations.disciplinary-action'`, add
`RelationsDecisions` in `apps/api`. **No generic workflow engine, no second approval mechanism.**

## D-5.2-13 — Grievance confidentiality · OPEN · *not required by checkpoint 1*

`Grievance` carries *"confidentiality"*. **Evidence:** Documents established that confidentiality is
applied **in** the query rather than after it, *"so a caller without `document.read-sensitive` neither
receives a confidential document nor learns how many were withheld — a count is itself a
disclosure."*

**Recommendation:** the same rule, in the query. A grievance often names the manager it is about, so
a filtered count would leak its existence to exactly the wrong reader.

---

## D-5.2-14 — Scope of the first implementation checkpoint · **APPROVED**

**Recommendation: the tenant's violation catalogue, and recording a violation against an employment.**

It delivers real Employee Relations functionality — a tenant configures the violations its policy
recognises, and an authorized user records that one occurred, against an employment, with a reporter,
an occurrence date and a description, immutably and audited.

**What it deliberately excludes, each for a reason above:** the penalty ladder (D-5.2-07) · evidence
attachments (D-5.2-08) · investigations, actions, warnings, grievances, appeals (later checkpoints) ·
Payroll (D-5.2-10) · Employment recommendations (D-5.2-11) · Workflow approvals (D-5.2-12) · expiry
(D-5.2-09) · country-pack enforcement (D-5.2-06) · Letters · Communications.

**It touches no other module's code**, requires nothing of Platform, and creates no capability that a
later decision would have to unpick.

**Blocked on:** D-5.2-03, D-5.2-04, D-5.2-05, D-5.2-06, D-5.2-07 and this decision. All six are
Work-owned and each is a choice between options already exercised in this repository.

### Owner approval · 2026-08-22

**APPROVED — Checkpoint 1: Violation Catalogue & Violation Recording**, with the exclusion list
restated by the owner: disciplinary cases · grievances · investigations · hearings · appeals ·
evidence/document uploads · disciplinary decisions · automatic penalties · penalty-ladder execution ·
expiry execution · scheduled jobs · notifications · Platform runner · country-specific legal
enforcement · Admin · generic relations workflow · generic automation.

**Every one of those is absent from the implementation**, asserted by a negative-space suite rather
than promised in prose.
