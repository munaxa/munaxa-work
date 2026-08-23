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
| D-5.2-08 | Evidence attachments — the Documents contract | **OPEN** | no — deferred out of Checkpoint 2 |
| D-5.2-09 | Warning expiry — derived or persisted (AD-006) | **OPEN** | no — no warning exists to expire until Checkpoint 3 |
| D-5.2-10 | Payroll penalty intake — AD-004 | **OPEN** | no — nothing imposes a penalty until Checkpoint 3 |
| D-5.2-11 | Employment termination recommendation — AD-005 | **OPEN** | no — a recommendation is an *outcome*, and Checkpoint 2 issues none |
| D-5.2-12 | Workflow approval adoption — AD-008 | **OPEN** | no — nothing is *issued* in Checkpoint 2, so nothing needs approving |
| D-5.2-13 | Grievance confidentiality | **OPEN** | no — grievances are a later checkpoint |
| D-5.2-14 | Scope of the first implementation checkpoint | **APPROVED** 2026-08-22 | **resolved** |
| D-5.2-15 | How the violation lifecycle advances, given an immutable violation row | **APPROVED** 2026-08-23 | **resolved** |
| D-5.2-16 | What an investigation is, and who may run one | **APPROVED** 2026-08-23 | **resolved** |
| D-5.2-17 | Whether findings are immutable, and how a correction is made (AD-003) | **APPROVED** 2026-08-23 | **resolved** |
| **D-5.2-18** | **Whether investigations need permissions of their own** | **OPEN** | no — Checkpoint 2 shipped without them |
| **D-5.2-19** | **How a concluded investigation is corrected** | **OPEN** | no — deferred out of Checkpoint 2 |

All six of Checkpoint 1's blocking decisions are **APPROVED**, and none required a new architectural
pattern: every one resolved onto a mechanism this repository already runs.

**Status after Checkpoint 2 (2026-08-23).** D-5.2-15, D-5.2-16 and D-5.2-17 were approved and are
implemented; see `phase-5.2-checkpoint-2.md`. Implementing them surfaced two further decisions,
D-5.2-18 and D-5.2-19, **both recorded rather than taken** — neither blocked the checkpoint, and
taking either without approval is precisely what the authorization forbade.

**The Checkpoint 2 investigation added three decisions and closed none.** D-5.2-15, D-5.2-16 and
D-5.2-17 did not exist before it, and the first of them is the reason: **Checkpoint 1 made the
violation row immutable and locked its `state` column to `'reported'`, so the specification's
lifecycle cannot advance by updating it.** That is not a defect — it is AD-003 working — but it means
the next checkpoint must decide *where* lifecycle state lives before it writes anything. Six earlier
decisions remain `OPEN` and **none of them blocks Checkpoint 2**; each is investigated below with a
recommendation, and every recommendation is analysis offered to the owner rather than a decision
taken.

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

## D-5.2-08 — Evidence attachments · **OPEN** · *investigated for Checkpoint 2*

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

### Checkpoint 2 investigation · 2026-08-23

**`StoragePort` still has no adapter.** The interface is declared in `packages/kernel/src/ports`
and **nothing implements it** anywhere in the repository. The only `StorageAccessPort` in production
is Documents' `storageUnavailable`, which answers `available: false` rather than returning a URL —
*"not a fake and not a stub … the difference between the capability is not wired and the capability
is broken."*

**Documents already provides the whole boundary Relations needs, and it needs no change.**
`Document.owner_type` accepts `employment`, so evidence about a disciplinary matter files against the
same employment the violation names. Documents owns the file, its versions, its verification and its
access trail. Relations would own **only the link**.

**One precise obstacle, found by reading the migration.** `document_source_check` is a **closed
vocabulary** — `('direct', 'recruitment', 'onboarding', 'letter', 'migration')`. There is no
`relations` value, so filing evidence *as* a Documents row that names Relations as its origin would
require a **Documents migration and a Documents vocabulary change**. That is a cross-module change to
a completed module, and it is avoidable.

**Options.**
- **(a)** Relations owns a link table `relation_violation_evidence (violation_id, document_id, …)`.
  Documents is unchanged; the document is created through `documents.create-document` with
  `source='direct'` as it already permits, and Relations records that the document is evidence for a
  violation. **No Documents migration, no vocabulary widening, no storage adapter.**
- **(b)** Widen `document_source_check` to include `relations` and hang the link off
  `source_reference`. Needs a Documents migration; puts a Relations concept inside Documents' schema.
- **(c)** Relations stores its own attachment rows. Duplicates a concept Documents owns.
- **(d)** Build a `StoragePort` adapter. Out of scope and not Relations' to build.

**Recommendation: (a).** It is the only option that adds nothing to another module. It also separates
cleanly, exactly as the instruction asks: **the metadata contract** (a violation has evidence, which
is a document, added by someone at a time) is Relations'; **the physical storage** is Documents' and
remains `NOT VERIFIED` until a `StoragePort` adapter exists somewhere. Evidence can therefore be
added later **without redesigning violations or disciplinary records** — the link table is additive
and touches neither.

*Blocks Checkpoint 2?* **No.** Recommended for Checkpoint 3, alongside the investigation findings it
supports.

## D-5.2-09 — Warning expiry · **OPEN** · *investigated for Checkpoint 2*

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

### Checkpoint 2 investigation · 2026-08-23

**No new evidence argues for persistence, and two precedents argue against it.** Workflow's
`serviceLevelState` derives `within` / `overdue` and the overdue minutes from the target, the instant
the step became awaiting and an explicit reading instant — **stored nowhere**. Career's `reviewDue` is
derived on every read and *"notifies nobody. `JobPort` has no adapter."* Both are the same shape as a
warning's validity window.

**The question the instruction asks — does expiry change business state or merely eligibility — has a
clear answer here.** AD-006's operative clause is *"an expired warning no longer counts toward
escalation."* That is **eligibility**: when counting prior warnings, exclude those whose window has
closed. Nothing about the warning itself changes; it remains issued, acknowledged and true. So there
is no business state to persist.

**The one part that is genuinely a state change** would be a `WarningExpired` **event** — something
that *fires* on a date. `JobPort` has no adapter, and Phase 16E assigned the runner to Platform.

**Recommendation stands: derived at read time.** Derivation: a warning is expired at instant *T* when
`issuedOn + validityDays <= T`, computed from the warning's own window and a **supplied** reading
instant, in the Relations domain beside the escalation count that consumes it — never in a
repository, never in a controller. No `expired` column, no sweep, no timer. `WarningExpired` recorded
**`NOT VERIFIED`**, with the Platform job runner named as its dependency.

*Blocks Checkpoint 2?* **No — and it cannot.** Checkpoint 2 issues no warning, so there is nothing to
expire. This decision becomes live in the checkpoint that introduces warnings.

## D-5.2-10 — Payroll penalty intake · **OPEN** · *investigated for Checkpoint 2*

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

### Checkpoint 2 investigation · 2026-08-23

**Payroll's inbound surface re-verified, and the finding holds.** Every cross-module port it declares
is a `*SourcePort` it **reads**: `EmploymentSourcePort`, `CompensationSourcePort`,
`AttendanceSourcePort`, `LeaveSourcePort`, `OrganizationSourcePort`. Each exposes a `factsFor`-shaped
read. **There is no inbound instruction command and no subscription.**

**`payroll.record-adjustment` exists and is not the seam.** It takes a `payrollRunId`, a treatment
code, an amount and a reason — it is a **payroll clerk's manual adjustment inside a specific run**,
declared under a Payroll permission, and its own phase describes it as *"manual adjustments with a
written reason"*. Relations calling it would mean a disciplinary module writing directly into a
payroll run, choosing the run, and holding a Payroll permission to do it. That is not AD-004's
*"produces an authorized deduction instruction"* — it is Relations computing payroll, which AD-004
forbids in the same sentence.

**So the smallest contract consistent with Payroll's architecture is a read Payroll pulls.**
Relations publishes `relations.authorized-penalties` — bounded, period-scoped, returning the
`(employmentId, amount-or-basis, reasonCode, authorizedOn, disciplinaryActionId)` of penalties an
approved disciplinary action authorized. Payroll gains a `RelationsSourcePort` and calls it exactly as
it calls the other five. **Relations never writes Payroll; Payroll decides what a penalty is worth**,
which keeps ADR-0054's rule that Payroll owns what a minute or a deduction is worth.

**No event.** Phase 11's own record: *"Reconciliation is a pull, so correctness never depends on an
event having been delivered."* A financial deduction is the last fact in this product that should
depend on at-most-once dispatch.

**This still requires an owner decision**, because it adds a published Relations contract *and* a new
port and call site inside Payroll, a completed module. **Nothing about it should be built
speculatively**: the read has no consumer until Payroll is changed, and a query nobody calls is the
shape ADR-0070 warns about.

*Blocks Checkpoint 2?* **No.** Checkpoint 2 issues no disciplinary action, so no penalty is
authorized and there is nothing to publish.

## D-5.2-11 — Employment termination recommendation · **OPEN** · *investigated for Checkpoint 2*

**The requirement.** AD-005: a recommendation only — *"Employment executes, through its own lifecycle
and approvals."*

**Evidence.** Employment publishes `employment.end-employment` and `employment.change-status`. Neither
takes a recommendation, and neither should be called by Relations — that would *be* the execution
AD-005 forbids.

**Recommendation:** Relations records `TerminationRecommended` as its **own** record and publishes a
read; a human acts on it through Employment's existing lifecycle. **No Employment change, no
automatic call.** Confirmation needed that a recommendation creates no obligation in Employment.

### Checkpoint 2 investigation · 2026-08-23

**Employment owns termination, unambiguously.** It publishes `employment.end-employment` and
`employment.change-status`, each behind an Employment permission, each driving Employment's own
lifecycle and its `PERMITTED_TRANSITIONS` vocabulary. AD-005 is equally unambiguous: *"A disciplinary
action that recommends termination produces a recommendation only. Employment executes, through its
own lifecycle and approvals."*

**So the safest default the instruction names is also the specification's:** Relations records a
recommendation and **must not mutate employment status**. Concretely that means Relations holds **no
`EmploymentPort` write of any kind** — its only Employment dependency stays the existence check
Checkpoint 1 built, which returns a boolean.

**A recommendation changes no employment state**, and that is the property to preserve: an employment
whose disciplinary file contains a termination recommendation is in exactly the status it was in
before. Whether Employment should *surface* pending recommendations is Employment's decision, not
this phase's.

**Automatic termination must remain impossible**, and in this repository it already is, structurally:
Relations has no command that reaches Employment, `JobPort` has no adapter, and Employment's own
commands require a human's permission. **No code should be written to "prevent" it** — the absence is
the prevention, and a guard would imply a path exists.

**Options.** (a) Relations records the recommendation and publishes a read; a human acts in Employment.
(b) Relations calls `employment.end-employment` under a service grant — **refused**: that *is* the
execution AD-005 forbids. (c) Workflow routes the recommendation to Employment through
`BusinessDecisionPort` — plausible later, but it makes an approved recommendation *execute*, which is
(b) with more steps.

**Recommendation: (a).**

*Blocks Checkpoint 2?* **No.** A recommendation is an *outcome of a disciplinary action*, and
Checkpoint 2 issues none.

## D-5.2-12 — Workflow approval adoption · **OPEN** · *investigated for Checkpoint 2*

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

### Checkpoint 2 investigation · 2026-08-23

**Workflow needs no change, and the precedent is complete.** `ApprovalPort.request` takes an opaque
`subjectType`; Workflow's controller *"neither holds nor interprets"* it. The return path is
`BusinessDecisionPort { apply(approval): Promise<ApprovalDelivery> }`, and
`apps/api/src/workflow/recruitment-decisions.ts` is a working implementation whose own comment states
the rule: *"a terminal approval arrives, and this carries it to Recruitment's own published `decide`
command. Every other subject type … is not recognized, and is answered `not-adopted`. That is how
Workflow stays free of module names while exactly one module is adopted."*

**The one real change** is that the adapter currently adopts exactly one subject. Adopting a second
means either extending `RecruitmentDecisions` into a two-subject adapter or composing a
`RelationsDecisions` beside it — **a composition-root change in `apps/api`, not a Workflow change.**
Which of the two is cleaner is worth deciding when it is built; neither touches Workflow.

**What Relations needs Workflow for, and what it does not.**

| Capability | Workflow? | Why |
|---|---|---|
| Approving a **disciplinary action** before issue (AD-008) | **yes** | routed, multi-approver, delegation and escalation already exist |
| **Escalation** of a stuck approval | **yes, free** | Workflow 16D, no Relations work |
| **Investigation** | **no** | an investigation is an inquiry, not an approval — nobody approves *opening* one |
| **Findings** | **no** | a finding is a conclusion the investigator records |
| **Termination recommendation** | **no** | it is an outcome, and Employment executes (D-5.2-11) |
| Grievance handling | **undecided** | depends on D-5.2-13 |

**Subject identifier and lifecycle, as recommended:** `subjectType = 'relations.disciplinary-action'`,
`subjectId = disciplinaryActionId`; the action is created `pending-approval`, `ApprovalPort.request`
is called, and a terminal approval arrives at `RelationsDecisions.apply`, which calls Relations' own
`decide` command — **Relations decides whether it may be issued, in Relations' transaction, against
Relations' own lifecycle.** The adapter translates and reconciles; it evaluates nothing.

*Blocks Checkpoint 2?* **No.** Nothing is *issued* in Checkpoint 2, so nothing needs approving.

## D-5.2-13 — Grievance confidentiality · **OPEN** · *investigated for Checkpoint 2*

`Grievance` carries *"confidentiality"*. **Evidence:** Documents established that confidentiality is
applied **in** the query rather than after it, *"so a caller without `document.read-sensitive` neither
receives a confidential document nor learns how many were withheld — a count is itself a
disclosure."*

**Recommendation:** the same rule, in the query. A grievance often names the manager it is about, so
a filtered count would leak its existence to exactly the wrong reader.

### Checkpoint 2 investigation · 2026-08-23

**Confidentiality in this repository is a classification on the record plus a second permission — not
a per-row access list.** Documents' `hiddenFromCaller` is the whole mechanism: a `confidential`
document needs `document.read-sensitive` *in addition to* `document.read`, and a hit becomes **not
found** rather than forbidden, because *"a manager learning that a medical certificate exists has
learned the thing the confidentiality level was protecting."* There is **no row-level ACL anywhere in
this product**, and no role engine.

**The decisive finding — and it is a repository-wide one.** *"The raiser can see their own
grievance"* is **not implementable today**. Documents' permission file states it plainly: *"`read-own`
is declared and **enforced nowhere** … There is no authenticated-principal-to-employment resolution in
this repository (ADR-0032)."* **Ten modules** — attendance, career, compensation, documents, learning,
leave, letters, payroll, performance and workflow — each declare a `read-own` permission that nothing
enforces, for that reason. ADR-0032 resolves a principal to a **tenant membership**, which is what
makes tenancy work; it does not resolve a principal to an **employment**, which is what
self-service would need.

**So the honest model is HR-scoped, not participant-scoped:**
- `relations.grievance.read` — the grievance register, for the people who handle grievances.
- `relations.grievance.read-sensitive` — required *in addition* for a grievance a tenant classified
  confidential; a caller without it gets **not found**, and **learns no count**.
- `relations.grievance.read-own` — **declared and enforced nowhere**, matching the ten modules that
  already do this, so the contract exists for the day the Platform capability does.

**Managers see nothing by default**, and nothing derives visibility from the reporting line — the same
rule Documents' D-9 set (*"None by default and never derived from the reporting line"*). A grievance is
frequently *about* the manager.

**What is NOT recommended:** a per-row participant ACL (no precedent, and it is an authorization
model), a role engine (forbidden), a wildcard, or duplicating Platform authorization.

**The Platform dependency, documented rather than invented:** participant-scoped visibility —
raiser, handler, named respondent — requires principal→employment resolution that **does not exist**.
Until it does, self-service grievance access is **`NOT VERIFIED`**.

*Blocks Checkpoint 2?* **No.** Grievances are a later checkpoint.

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

---

# Decisions opened by the Checkpoint 2 investigation

Three, all **OPEN**, all Work-owned, and **all three block Checkpoint 2**. None existed before this
investigation; the first is the reason the other two are needed.

## D-5.2-15 — How the violation lifecycle advances, given an immutable violation row · **OPEN**

**The finding.** Checkpoint 1 delivered `relation_violation` with a trigger refusing every `UPDATE`
and `DELETE`, and a `state` column locked by
`relation_violation_state_check check (state in ('reported'))`. The specification's lifecycle runs
*Violation Reported → Under Investigation → Findings → Pending Approval → Action Issued → …*.

**Those two facts cannot both be satisfied by the column.** Advancing the lifecycle by updating
`relation_violation.state` is impossible — the trigger raises — and making it possible would mean
reopening D-5.2-03, which this checkpoint may not do. **This is not a defect.** It is AD-003 working
exactly as approved: the record of what was alleged, by whom, on what date, is evidence and does not
move. What has to move is *where the case has got to*, which is a different fact.

**Options.**
- **(a) Derived from the records that exist.** A violation is *under investigation* when an open
  investigation references it, *concluded* when that investigation has findings, and so on. No column,
  no transition log; the state is a projection computed at read time, exactly as
  `serviceLevelState` and `reviewDue` are. `relation_violation.state` stays `'reported'` for ever and
  means *"what this record was when it was written"*, which is what an immutable row should say.
- **(b) An append-only transition log**, `relation_violation_history`, whose latest row is the state.
  Mirrors `workflow_history`; gives an explicit audited transition with actor, timestamp and **reason**
  (the specification requires all three: *"Every transition is audited with actor, timestamp and
  reason"*). Costs a table and an ordering rule.
- **(c) Both**: the log is authoritative for *how it got here* and the current state is derived as the
  latest entry.
- **(d) Widen the CHECK and make the row mutable.** **Refused** — reopens D-5.2-03.

**Recommendation: (b), with the state read as the latest entry.** The specification's *"every
transition is audited with actor, timestamp and reason"* is a requirement (a) cannot meet: a derived
state has no actor and no reason, and in a labour dispute *who moved this case, when, and why* is
precisely what is asked. (b) is also the repository's own answer to the same problem —
`workflow_history` is an append-only, trigger-immutable log carrying actor and event, and Workflow
reads state from the aggregate while the log carries the narrative. (c) is (b) with the derivation
named, and is what the recommendation amounts to in practice.

**Consequence to accept openly:** `relation_violation.state` becomes a historical field meaning *the
state at recording*, and every reader of the *current* state uses the log. That is a small
awkwardness, and the alternative — a mutable evidence row — is a much larger one. The column's own
comment already says the CHECK widens *"by an approved change"*; this decision is that change not
happening, which is the cleaner outcome.

**Dependencies:** none outside Relations. **Risks:** an ordering rule is needed so two transitions in
one millisecond read deterministically (`(occurred_at, id)`, as `workflow_history` does).
**Blocks Checkpoint 2: YES.**

## D-5.2-16 — What an investigation is, and who may run one · **OPEN**

**Specification.** *"**Investigation** — investigator, statements, evidence, findings, recommendation,
dates."*

**What is undecided.** Whether an investigation is **one aggregate with a lifecycle** (opened →
concluded) or a bundle of separate records; whether **statements** are rows of their own or text on
the investigation; whether more than one investigation may be open against one violation; and which
permission opens it — `relations.investigation.manage`, or a reuse of `relations.violation.record`.

**Evidence.** The specification lists `InvestigationOpened` and `InvestigationConcluded` as separate
domain events, which reads as one aggregate with two transitions rather than a bundle. *"Statements"*
is plural and belongs to people, which argues for rows; but nothing in Checkpoint 2's value depends on
statements being separately queryable.

**Options.** **(a)** One `relation_investigation` aggregate; statements and findings are text on it;
**one open investigation per violation**, enforced by a partial unique index (ADR-0071 — never a
select-then-insert). **(b)** As (a), plus a `relation_investigation_statement` table. **(c)** Reuse
the violation permissions rather than adding any.

**Recommendation: (a), with two new permissions** — `relations.investigation.manage` and
`relations.investigation.read`. Statements as rows are deferred until something needs to read one
independently; adding a table for them later is additive. **(c) is not recommended**: opening an
investigation into somebody is a materially different act from filing a report, and AD-007's
*"restricted independently"* argues for separating them.

**Risks:** the investigator is a membership identifier, and Relations must not resolve it to a person —
the same rule Checkpoint 1 kept. **Blocks Checkpoint 2: YES.**

## D-5.2-17 — Whether findings are immutable, and how a correction is made · **OPEN**

**Specification.** AD-003: *"The record is immutable. A correction is a new, linked record with a
stated reason. Nothing is edited or deleted, including after an appeal succeeds — a successful appeal
annuls, it does not erase."*

**What is undecided.** Checkpoint 1 built the *first half* — the trigger — and deliberately left the
second: *"There is no correction path, because there is nothing to correct into."* An investigation
with findings is the first record that can plausibly need correcting, so the second half has to be
decided now.

**Options.** **(a)** The investigation is trigger-immutable once concluded, and a correction is a new
investigation row linked by `corrects_investigation_id` with a stated `correction_reason`. **(b)** The
investigation is mutable while open and trigger-immutable on conclusion. **(c)** Insert-only versions
with a `current_version_id` pointer, as `document_version` does.

**Recommendation: (b) plus (a)** — mutable while the investigation is open, because a draft an
investigator is still writing is not yet evidence; **immutable from the moment it concludes**; and a
concluded investigation corrected only by a new linked row carrying a reason. That is the shape
AD-003 describes, and (b)'s open-draft window is the same distinction Letters draws between a template
version and one that has issued a letter (`app_letter_template_version_refuse_issued` refuses a change
only *after* first issue — a conditional trigger, and the precedent for exactly this).

**Risks:** a conditional trigger is harder to reason about than an unconditional one; the assertion
must prove both directions — an open investigation *can* be amended, a concluded one *cannot*.
**Blocks Checkpoint 2: YES.**


### Owner approval · 2026-08-23 — D-5.2-15

**APPROVED.** Lifecycle state does **not** live on the violation. `relation_violation` remains
immutable, its `state` CHECK still reads `('reported')`, and its trigger is untouched — D-5.2-03 was
not reopened. Where a case has got to is a separate Relations-owned lifecycle record,
`relation_case_event`.

**Implemented** in migration `20260823060000_relations_investigations`.

### Owner approval · 2026-08-23 — D-5.2-16

**APPROVED.** The current state is **derived** from the lifecycle records — the `to_state` of the
highest `sequence`, and `reported` for a case with none. **No redundant state column** exists
anywhere: not on the violation, not on the investigation, not on a projection. **No generic
framework**: no state-machine engine, no event-sourcing library, no workflow engine. The whole state
machine is `PERMITTED_CASE_TRANSITIONS`, nine lines of data in `relations-vocabulary.ts`.

**Asserted, not promised:** `relations-lifecycle-boundaries.test.ts` fails if a `current_state`
column, a persisted `currentState` field, or any of that machinery appears.

### Owner approval · 2026-08-23 — D-5.2-17

**APPROVED.** States are explicit; transitions are validated against the state the **server** derives
from persisted history, never against one a caller supplies; every transition is persisted with
actor, timestamp and a required reason; history is immutable; a transition and the investigation that
caused it commit together; and concurrency is settled by the database.

**How each clause is met, and where it is proved:**

| Clause | Mechanism | Proof |
| --- | --- | --- |
| Explicit states | `CASE_STATES` — three, not the specification's twelve | `case-lifecycle.test.ts` |
| Validated transitions | `PERMITTED_CASE_TRANSITIONS`, all nine pairs asserted | `case-lifecycle.test.ts` |
| No caller-supplied `from` | `recordTransition` derives it; a supplied one is ignored | `case-lifecycle.test.ts`, `relations.routes.spec.ts` |
| Persisted with actor, time, reason | `relation_case_event`, `reason` NOT NULL | `investigation.test.ts` |
| Immutable history | `app_relation_case_event_immutable`, unconditional | `relations-investigation.integration.test.ts` |
| Immutable findings | `app_relation_investigation_refuse_concluded`, conditional | both directions, same suite |
| Atomic | one `unitOfWork.execute` per command | `investigation.test.ts` |
| Concurrency-safe | `relation_case_event_sequence_idx` unique per case | **two real PostgreSQL connections**, `relations-case-lifecycle.integration.test.ts` |
| No automatic transitions | no scheduler, timer, worker or machine actor | negative-space suites |

---

# Decisions opened by the Checkpoint 2 implementation

Two. **Neither was taken**, and neither blocked the checkpoint.

## D-5.2-18 — Whether investigations need permissions of their own · **OPEN**

**What Checkpoint 2 did.** Reused the four permissions Checkpoint 1 defined. Opening and concluding
an inquiry require `relations.violation.record`; the three new reads require
`relations.violation.read`. **No permission was created**, because the authorization required
stopping before creating one unless the repository proved it unavoidable — and it is not: the
capability is implementable without one, as the working implementation shows.

**The case for separating them, recorded for the owner.** AD-007 says disciplinary access is
*"restricted independently of ordinary employee access"*, and there is a real argument that filing a
report and conducting an inquiry into a colleague are different acts deserving different grants — the
same argument the Checkpoint 2 plan made for `relations.investigation.manage` / `.read`. Against it:
anyone holding `relations.violation.record` can already record an allegation against any employment
in the tenant, which is the more consequential act of the two, so the separation buys less than it
first appears.

**Consequence of today's choice, stated plainly:** a user who may record a violation may also open and
conclude an inquiry. If that is wrong for a customer, the fix is a new permission, which is additive
and needs no data migration.

## D-5.2-19 — How a concluded investigation is corrected · **OPEN**

**What Checkpoint 2 did.** Nothing. There is no `relations.correct-investigation` command, and the
negative-space suite asserts its absence.

**Why.** The approved D-5.2-17 text resolved transitions and immutability; corrections were the part
of the original D-5.2-17 recommendation — *"a correction is a new investigation row linked by
`corrects_investigation_id`"* — that the approval did not restate. Building it anyway would have been
scope expansion, which the authorization forbade in the same paragraph.

**Consequence, stated plainly:** a concluded investigation cannot be amended by any path. The
database refuses it, which is correct under AD-003 — but AD-003's other half, *"a correction is a new,
linked record with a stated reason"*, has no implementation yet. Until it does, a mistake in a
concluded investigation's findings is uncorrectable, not merely unedited. That is the honest state of
the module and the reason this decision is recorded rather than left implicit.
