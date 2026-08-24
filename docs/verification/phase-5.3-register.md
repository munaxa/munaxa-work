# Phase 5.3 — Assets & Custody · Decision Register

## Status: **CHECKPOINTS 1 AND 2 IMPLEMENTED** · Checkpoints 3–4 not started

*Opened 2026-08-23 against `3ad9fd7` (`main`, immediately after Phase 5.2 merged as PR #14).
Checkpoint 1 implemented 2026-08-23 — see
[`phase-5.3-checkpoint-1.md`](./phase-5.3-checkpoint-1.md). Checkpoint 2 implemented the same day —
see [`phase-5.3-checkpoint-2.md`](./phase-5.3-checkpoint-2.md).*

> **Historical note · the register when it opened.** The paragraph below was true when this register
> was written and is preserved rather than rewritten: *"Nothing in Phase 5.3 is implemented. There is
> no `@work/assets` package, no `asset*` table, no migration and no handler anywhere in this
> repository."* Checkpoint 1 has since built the catalogue and the inventory. **Nothing else in the
> phase has been built**, and no decision below was approved or reopened by that implementation.

---

## How to read this register

Each decision carries one of three states.

| State | Meaning |
|---|---|
| **SETTLED BY EXISTING EVIDENCE** | The repository already answers this. Recorded so the answer is traceable, **not** sent to the owner: an owner decision over a question precedent has closed is a decision nobody needs to take, and taking it invites a second answer to a settled question. |
| **OPEN** | A genuine owner choice remains. Options are stated with evidence and one recommendation. **No recommendation here is an approval.** |
| **APPROVED** | The owner has decided, with the date and the wording of the approval recorded. |

Three decisions moved from OPEN to SETTLED during this investigation. Each is explained in place, with
the code that settles it named by file. **Three remain genuinely OPEN**, and none of the three blocks
Checkpoint 1.

> *That paragraph describes the register as it stood at Checkpoint 1 and is preserved. The Checkpoint 2
> investigation later opened four more — D-5.3-07 to D-5.3-10 — so **seven are OPEN today**. They are
> recorded in their own section below rather than woven into the text above.*

---

## Summary

| # | Decision | State | Blocked Checkpoint 1? |
|---|---|---|---|
| D-5.3-01 | What custody attaches to, when an employment ends | **OPEN** | **no** — Checkpoint 1 creates no custody |
| D-5.3-02 | Whether acknowledgement can be by the employee | **SETTLED BY EXISTING EVIDENCE** | no |
| D-5.3-03 | How a non-return deduction reaches Payroll | **OPEN** | **no** — Checkpoint 1 authorizes no deduction |
| D-5.3-04 | Whether an asset may reference a document | **SETTLED BY EXISTING EVIDENCE** | no |
| D-5.3-05 | Whether the condition scale is tenant vocabulary or a closed set | **OPEN** | **no**, on one condition — §D-5.3-05 |
| D-5.3-06 | Whether liability and waiver adopt Workflow | **SETTLED BY EXISTING EVIDENCE** | no |
| D-5.3-07 | Whether issuing custody requires an *active* employment | **OPEN** *(opened at Checkpoint 2)* | n/a — opened later |
| D-5.3-08 | Whether a direct transfer is its own authority | **OPEN** *(opened at Checkpoint 2)* | n/a — opened later |
| D-5.3-09 | Whether an asset in open custody may be retired | **APPROVED 2026-08-23 · IMPLEMENTED** | n/a — opened later |
| D-5.3-10 | Whether custody may be cancelled or corrected | **OPEN** *(opened at Checkpoint 2)* | n/a — opened later |
| D-5.3-11 | Whether Assets learns that an employment has ended by subscription | **SETTLED BY EXISTING EVIDENCE** *(opened at Checkpoint 3)* | n/a — opened later |

**Checkpoint 1 depended on no open decision, and the implementation kept it that way.** The condition
scale was excluded from the catalogue precisely so D-5.3-05 would not be answered by accident, and no
column was added to prepare for one. The three OPEN decisions above are open on exactly the terms they
were open on before.

---

## D-5.3-01 — What custody attaches to, when an employment ends · **OPEN**

### The question

AD-001: *"Assets reference Employment for custody. Never Person directly."* Employment's `ended` is
terminal — `EMPLOYMENT_STATUSES` is `draft · pending_approval · active · suspended · ended`
(`packages/modules/employment/src/domain/employment-vocabulary.ts:35`), and Phase 5's AD-004 says
somebody returning is a *new* employment. So an employment that ends holding a laptop leaves a custody
record pointing at a relationship that is over.

### What the repository determines, and what it does not

**Determined.** Assets can learn that an employment has ended without any Employment change.
`employment.read-employment` is published, and `EmploymentView`
(`packages/modules/employment/src/contracts/views.ts:34`) already carries `status`, `endDate` and
`endReasonCode`. The bounded service grant that would ask it exists and has a working template in
`apps/api/src/relations/relations-sources.ts:43`. So no option below is blocked by reachability.

**Determined.** Option (b) — custody transferring to a person-level holding record — is **refused by
AD-001**, and this register does not present a forbidden option as a live one. Documents' owner
vocabulary is `person · employment · legal_entity`
(`packages/modules/documents/src/domain/documents-vocabulary.ts:16`), so the shape exists elsewhere;
AD-001 is what rules it out here, not the absence of a pattern.

**Not determined.** What "outstanding" means once the employment is over. That is a business rule
about company property and about what Offboarding is entitled to see, and no line of code in this
repository expresses it.

### Options

| | Option | Consequence |
|---|---|---|
| (a) | Custody stays attached to the ended employment; outstanding items are read through it | Custody history stays literally true. The clearance projection must read across ended employments, which means a read that deliberately does not filter by employment status |
| (c) | Non-return closes the custody with an outstanding marker and the asset returns to the pool | The asset becomes issuable again while the loss is still unresolved. "Outstanding" becomes a closed record rather than an open one, which changes what AD-006 blocks clearance on |

### Recommendation — **not an approval**

**(a).** It is the only option under which AD-003 stays true without qualification: custody history is
immutable and complete, and a record that is closed *because the person left* is a record that has been
edited by an event outside itself. Under (a) the asset simply has an open custody whose holder is an
ended employment, which is exactly what is true, and the AD-004 one-custodian invariant continues to
mean what it says — under (c) an asset could be re-issued while genuinely unreturned.

The cost of (a) is real and should be stated rather than hidden: an asset in the custody of an ended
employment cannot be issued to anybody until the matter is resolved, so a lost laptop blocks its own
inventory slot. That is arguably correct — it *is* still lost — but it is a live consequence, not a
detail.

### Blocking

**Does not block Checkpoint 1.** Checkpoint 1 builds the catalogue and the inventory; it creates no
custody record, so there is nothing yet that can outlive an employment. It blocks **Checkpoint 2**.

### Blocking, re-assessed at the Checkpoint 2 investigation · 2026-08-23

**The sentence above is left standing as the record of what was believed, and it turned out to be
wrong.** The Checkpoint 2 investigation found that custody can be built without answering this.

Checkpoint 2 implements **no termination behaviour at all**: no employment-ended listener, no Platform
job, no read of employment status, no `outstanding` closure. An employment that ends simply leaves its
custody open, because nothing is watching for the end.

That *resembles* option (a), and the difference matters: it is the **absence of behaviour**, not a
choice of one. Option (c) stays reachable **additively** — the closure vocabulary would be a CHECK that
widens by approved change, and the `closed_reason` column it needs does not exist in either direction.
**Neither option is foreclosed by Checkpoint 2**, and the owner's decision costs one migration whichever
way it is taken.

**Revised: does not block Checkpoint 2. Blocks Checkpoint 4**, where clearance must decide what an
outstanding item is. This decision remains **OPEN** and unapproved.

---

## D-5.3-02 — Whether acknowledgement can be by the employee · **SETTLED BY EXISTING EVIDENCE**

### The question

The acceptance criteria say *"Employees see their own custody in self-service and acknowledge receipt
there."*

### Why this is settled rather than open

The wall is real and unchanged: ADR-0032 resolves a principal to a **tenant membership**, not an
employment. `read-own` is declared in Attendance, Career (twice), Compensation, Documents, Learning
(twice), Leave, Letters, Payroll and Performance — **ten declarations, and it is enforced nowhere**.
Career's own permission file states it in as many words
(`packages/modules/career/src/application/career-permissions.ts:24`).

What makes this settled rather than an owner choice is that **the repository has already answered the
identical question, in code, and has a name for the answer**. Career's D-9:

> *"`party` records which side acknowledged; it is not a claim about who is calling. This repository
> cannot resolve a principal to an employment, so an API that inferred 'you are the employee' would be
> inventing the resolution rather than performing it."*
> — `packages/modules/career/src/api/development.controller.ts:37`

The mechanism is concrete and already shipped:
`career.acknowledge-development-plan` takes a `party` naming *whose* acknowledgement is recorded, takes
`recordedBy` from the authenticated context and never from the command, and persists both — the columns
are `employee_acknowledged_on` / `employee_acknowledgement_recorded_by` and their manager equivalents
(`packages/modules/career/src/infrastructure/career-development-rows.ts:37`). The domain comment is
blunt about what it is: *"The employee did not press this button, because the employee cannot sign in"*
(`development.use-case.ts:155`).

The alternatives are not owner choices about Assets. Option (b) — waiting — is a decision to leave a
capability unbuilt that precedent shows can be built honestly. Option (c) — building repository-wide
self-service principal routing inside Phase 5.3 — is a change to Identity and to ten other modules, and
Assets is not the place to take it.

### Settled position

Acknowledgement is **recorded on behalf of** the employee by an authorized administrator, with the
acknowledging party named and the recording actor taken from the request context, following Career D-9
exactly. The column names say `recorded_by` so that no screen can later present it as a signature, and
the limitation is stated in the checkpoint report rather than implied.

**Self-service acknowledgement remains `NOT VERIFIED` and unbuilt**, for the same repository-wide
reason it is unbuilt in ten other modules. Nothing is stubbed for it.

### Blocking

Does not block Checkpoint 1 — nothing is acknowledged until custody exists. Checkpoint 2 implements it
on this settled pattern with no further decision.

---

## D-5.3-03 — How a non-return deduction reaches Payroll · **OPEN**

### The question

AD-005: non-return *"produces an authorized deduction instruction for Payroll on approval. This domain
never computes payroll."*

### What the repository determines

**The blocker is confirmed at this HEAD, not carried over on trust.** Payroll's twelve commands are
`amend-group`, `approve`, `calculate`, `define-deduction`, `define-group`, `finalize`, `move-period`,
`open-period`, `reconcile`, `record-adjustment`, `reverse-approval`, `reverse-run`. The only one that
could carry an instruction from outside is `payroll.record-adjustment`, and it is **run-scoped, not an
intake**: it requires an existing `payrollRunId`, refuses a finalized or reversed run, requires
Payroll's own `kind` / `code` / `payrollTreatmentCode` vocabulary, and is gated on `payroll.adjust`
(`packages/modules/payroll/src/application/adjustment.use-case.ts:29-60`). A module holding
`payroll.adjust` and naming a run identifier is not an authorized instruction reaching Payroll; it is
Assets writing a payroll line, which AD-005 forbids in its second sentence.

So D-5.2-10 was right and remains right: **Payroll has no inbound instruction seam.** This is the same
blocker in a second domain.

### Options

| | Option | Consequence |
|---|---|---|
| (a) | Assets publishes a bounded read of authorized deductions; Payroll consumes it when Payroll decides to | No Payroll change, no obligation created, and no claim that anybody was paid or docked. Assets holds a record that says "authorized", and whether it was ever applied is `NOT VERIFIED` |
| (b) | Payroll grows an inbound command | Inverts an established boundary in a module that is pull-oriented by design, and does it for the second domain to ask rather than as a considered Payroll change |
| (c) | Deduction is out of scope for the first checkpoints | Nothing is claimed and nothing is half-built |

### Recommendation — **not an approval**

**(c) for Checkpoints 1–3, then (a).** (b) should be taken as a Payroll decision in a Payroll phase if
it is taken at all — two domains have now needed it, which is an argument for deciding it deliberately
rather than for letting Assets decide it in passing.

**This decision and D-5.2-10 are the same decision.** They should be answered once, and the answer
applied in both places.

### Blocking

Does not block Checkpoint 1 or Checkpoint 2. Blocks Checkpoint 4 only if deduction is in its scope.

---

## D-5.3-04 — Whether an asset may reference a document · **SETTLED BY EXISTING EVIDENCE**

### The question

The domain model gives `Asset` a `documents` field; the non-goals say *"Documents owns files; this
domain references them."*

### Why the premise of the original question was wrong

`docs/verification/phase-5.3-plan.md` §7 recorded that `document_source` is a closed CHECK vocabulary
with no `assets` value, and treated that as the obstacle. **Investigation shows it is not an obstacle
at all, because `document_source` answers a different question.**

`document_source` records where the *document* came from — `direct · recruitment · onboarding · letter
· migration` (`prisma/migrations/20260811120000_documents_letters/migration.sql:151`, and
`documents-vocabulary.ts:79`). It is the document's own provenance, not a list of modules permitted to
point at one. The proof is direct: **Learning and Performance both reference documents today, and
neither appears in that vocabulary.**

The pattern they use is identical in both modules, down to the comment:

> *"Evidence, as a reference and never as a byte. … This port answers one question: does the document
> a certification points at exist, and may this caller know that it does. Learning stores the
> identifier and nothing else: no filename, no size, no content hash, no URL, and above all no second
> expiry date."*
> — `packages/modules/learning/src/application/learning-cross-module-ports.ts:97`

`DocumentReferencePort { exists(documentId): Promise<boolean> }`, implemented at the composition edge
over a bounded service grant holding `documents.read` and nothing else
(`apps/api/src/performance/performance-sources.ts:236`, `apps/api/src/learning/learning-sources.ts:275`).

Option (c) — Assets storing its own file references — remains rejected on sight: a second file boundary
in the product. Option (a) is unnecessary. Option (b) — defer entirely — was only attractive while the
vocabulary looked like a blocker.

### Settled position

An asset may reference a document **by identifier**, through a `DocumentReferencePort.exists` bounded
service grant, storing the identifier and nothing else. **No `document_source` change, no Documents
change, no new permission, no widened contract.**

Two limits carry over from the precedent and are not negotiable at checkpoint level: there is **no
`StoragePort` adapter anywhere in this repository**, so upload, download and signed links stay
`NOT VERIFIED`; and an asset may not be a document *owner* — `document.owner_type` is
`person · employment · legal_entity` and an asset is none of them. A photograph of a damaged laptop is
owned by the employment it concerns, and referenced by the incident.

### Blocking

Does not block Checkpoint 1. **Recommended out of Checkpoint 1 anyway**: an identifier column nothing
reads is the stored-flag-nothing-maintains problem ADR-0070 names, and Phase 5.2 lived with exactly
that for two checkpoints in `repeat_window_days`. Document references arrive with the incident that
needs them.

---

## D-5.3-05 — Whether the condition scale is tenant vocabulary or a closed set · **OPEN**

### The question

AD-002 makes categories and rules tenant configurable; the domain model gives `AssetCategory` a
*"condition scale"*, and `CustodyAssignment` a condition at issue and a condition at return.

### Why precedent genuinely does not settle it

It points both ways, and this register says so rather than picking the convenient half.

**For an open tenant vocabulary.** `relation_violation_category.severity` is a free tenant string with
only a non-empty CHECK, and the migration states the reasoning in place: *"A tenant's own word.
Deliberately not a closed set: a fixed list of severities would be this product deciding what 'gross
misconduct' means for every customer (AD-002). **Nothing orders by it.**"*
(`prisma/migrations/20260822100000_relations_violations/migration.sql:36`).

**For a closed ordered set.** `EMPLOYMENT_STATUSES` and Phase 5.2's `DISCIPLINARY_ACTIONS` are closed
at the database, precisely because something *does* reason over them.

The distinguishing sentence is the one in the migration: **nothing orders by it.** A condition scale
that is only displayed is `severity`. A condition scale that answers *"did this come back worse than
it went out"* — which is the question an incident and a deduction both rest on — must be **ordered**,
and an ordered free string is the worst of both.

### Options

| | Option | Consequence |
|---|---|---|
| (a) | Free tenant string, nothing orders by it | AD-002 in its purest form. Damage is then a human's separate assertion, not a comparison the system can make |
| (b) | Closed ordered set owned by the product | The system can say "returned worse than issued". Decides for every customer what "fair condition" means |
| (c) | Tenant-defined scale with a tenant-assigned **rank** — the `(sequence, code)` shape D-5.2-07 already established for ordering a tenant catalogue | Tenant owns the words; the product owns only the fact that they are ordered. Comparison becomes possible without the product naming a single condition |

### Recommendation — **not an approval**

**(c).** It is the only option that keeps AD-002 whole and still lets the system answer the question the
later checkpoints actually ask. It also reuses a shape this repository already has and has argued for
once — a tenant-ordered catalogue ordered by an integer the tenant assigns, deterministic without
forcing a renumber, exactly as `relation_violation_category.sequence` works.

### Blocking

**Does not block Checkpoint 1 — on one condition**: that Checkpoint 1 does **not** create the condition
scale. Nothing in Checkpoint 1 records a condition, because nothing in Checkpoint 1 issues an asset. If
Checkpoint 1 were to create the scale anyway, this decision would block it, and the checkpoint would
ship a configuration surface no code reads — the `repeat_window_days` mistake, knowingly repeated. The
Checkpoint 1 plan therefore excludes it. **Blocks Checkpoint 2.**

---

## D-5.3-06 — Whether liability and waiver adopt Workflow · **SETTLED BY EXISTING EVIDENCE**

### The question

AD-006 requires a clearance waiver to carry *"a reason and an approval"*; `AssetIncident` carries a
*"liability decision"*. Workflow exists. Phase 5.2 left the identical question open at D-5.2-12.

### What the repository determines

The seam is real, and better-formed than the original plan assumed. The kernel has published
`ApprovalPort { request, status, cancel }` since Phase 2 (`packages/kernel/src/ports/approval.ts:42`,
ADR-0024), and `WorkflowApprovals` implements it over `workflow.start-instance` with an opaque
`subjectType` (`apps/api/src/workflow/workflow-approvals.ts:101`). So "adopt Workflow" would need no
Workflow change and no new contract.

**And no module in this repository consumes it.** That is not an omission; it is a stated, repeated,
seven-module position, and the adapter itself says so:

> *"Nothing here is wired to a consumer yet. … this is the capability sitting ready rather than a path
> in use. Said plainly because an implementation nobody calls is easy to mistake for one that is
> load-bearing."* — `workflow-approvals.ts:60`

Attendance: *"There is deliberately no `ApprovalPort`."* Onboarding: the same sentence. Payroll:
*"**No `ApprovalPort`.** The only adapter is `AutoApprovingPort`."* Compensation and Leave both record
their own decision **and publish the chain in `ApprovalPort`'s shape** so the *source* can change later
without the contract changing (`compensation-dependencies.ts:22`, `leave-dependencies.ts:18`). Letters
mirrors the same view shape (`letter-approval.ts:12`). Relations, at D-5.2-12, made the same choice
again three weeks later.

Seven modules, one answer, and a migration path deliberately left open. The original plan said
*"consistency matters more than the individual answer"* — the repository already **has** the consistent
answer, so sending it to the owner as an open question invites an eighth module to answer it
differently.

### Settled position

A liability decision and a clearance waiver are recorded as **Assets' own decisions by a named human**
(ADR-0045), and the chain is published **in `ApprovalPort`'s shape** so the source can move to Workflow
later without a contract change. Assets does **not** consume `ApprovalPort`, does not start a workflow
instance, and does not define a `subjectType`.

The one thing that would reopen this is a deliberate repository-wide decision to route approvals through
Workflow — which would move seven modules at once and is not an Assets decision.

### Blocking

Does not block Checkpoint 1: nothing is approved or waived in a catalogue.

---

## Decisions this investigation deliberately did **not** open

Recorded so no chain of planning documents forms, and so the absence of each is traceable to evidence
rather than to oversight.

| Question | Why it is not an owner decision |
|---|---|
| **Whether `issued` / `in_custody` / `returned` are persisted asset statuses** | Two settled precedents point the same way. ADR-0070: *"a stored flag that nothing maintains is worse than no flag."* D-5.2-16: derived reads rather than persisted projections. Custody is the authority on who holds an asset; a second copy on `asset` would be a flag that goes stale the moment a custody row is written. Persisted status is confined to what custody cannot answer — `registered`, `available`, `under_repair`, `retired` — and the rest is derived |
| The AD-004 one-custodian invariant | A partial unique index, per ADR-0071 (*"a `select` followed by an `insert` is not idempotent under concurrency"*); `relation_investigation_open_idx` is the shape |
| Custody history immutability (AD-003) | Append-only table, unconditional trigger, as `relation_case_event` and `relation_disciplinary_action` have |
| RLS | `app_protect_table`, enabled **and forced** (ADR-0030) |
| Reaching Employment | Bounded service grant returning the least it can (ADR-0043); `RelationsEmploymentDirectory` is the template |
| Catalogue ordering | `(sequence, code)` — D-5.2-07 |
| Civil dates | Named in every select and projected with `to_char`, never reached by `select *` — the Checkpoint 3 defect |
| Whether custody reads are audited | A per-resource judgement at checkpoint level, not an architecture decision. An asset register is not an allegation; blanket auditing is the mechanism D-5.2-05 rejected |

---

# Decisions opened by the Checkpoint 2 investigation

*Opened 2026-08-23 against `7aedf7a`, while preparing
[`phase-5.3-checkpoint-2-plan.md`](./phase-5.3-checkpoint-2-plan.md). None is approved. Nothing above
this line was rewritten.*

---

## D-5.3-07 — Whether issuing custody requires an *active* employment, or merely an existing one · **OPEN**

### The question

Custody references Employment (AD-001). Assets must confirm the employment is real before opening a
custody against it — but *how much* should it learn?

### Evidence

**Precedent gives one boolean and nothing more.** `RelationsEmploymentDirectory.exists()` asks
`employment.read-employment` under a bounded grant and returns `found.ok`, with the file stating why:
*"A boolean, and deliberately nothing more … returning any of those would make this a directory a
disciplinary module has no business holding."* (`apps/api/src/relations/relations-sources.ts:43`).

**A status is nevertheless reachable without any Employment change.** `EmploymentView` already carries
`status`, `endDate` and `endReasonCode` (`packages/modules/employment/src/contracts/views.ts:34`), so
option (b) below costs no new contract — only a wider disclosure into Assets.

**There is no narrow standing query for an employment.** Identity publishes
`identity.membership-standing` — one identifier in, one predicate out — precisely so a consumer does
not receive a whole record. **Employment publishes no equivalent**, so "is this employment active" can
only be answered today by reading the whole view.

### Options

| | Option | Consequence |
|---|---|---|
| (a) | `exists()` only — the Relations precedent | Assets holds no workforce information whatsoever. An administrator can issue a laptop to an employment that has ended, and nothing refuses it |
| (b) | Read `status` and refuse a non-active employment | Catches a real data-entry error. Assets now learns an employment's lifecycle state — the beginning of the directory Relations refused to become |
| (c) | Ask Employment for a narrow standing predicate, as Identity publishes for memberships | The cleanest boundary, but it is **a new contract in a module this checkpoint may not modify** |

### Recommendation — **not an approval**

**(a) for Checkpoint 2**, with the limitation stated in the report: an asset can be issued to an ended
employment, and nothing refuses it. It is the precedent, it is the narrowest disclosure, and tightening
later is additive. (c) is the right long-term answer and should be taken as an *Employment* decision
in an Employment phase, not decided in passing here.

### Blocking

**Does not block Checkpoint 2.**

---

## D-5.3-08 — Whether a direct transfer is its own authority · **OPEN**

### The question

AD-003 names transfer explicitly: *"every handover, return and transfer is a new record."* A transfer
closes one custody and opens another in one act. Which permission may perform it?

### Evidence

**A handler declares exactly one permission.** `CommandHandler.permission` is a single string
throughout the kernel and every module, so a transfer command *cannot* require both
`assets.custody.assign` and `assets.custody.return`.

**The two grants are separated on risk** (Checkpoint 2 plan §12): a false *return* is what makes an
outstanding asset disappear from the register offboarding clearance reads. Letting `assign` alone
perform the closing half of a transfer would hand that capability to the weaker grant.

**Nothing is lost by waiting.** A handover is recordable today as *return then issue* — two true
records, no history lost. Only the fact that the handover was *direct* is not distinguished, and the
`closed_reason` column that would distinguish it does not exist in either direction.

### Options

| | Option | Consequence |
|---|---|---|
| (a) | Transfer rides on `assets.custody.assign` | One command, but `assign` gains the ability to close a custody — the separation in §12 becomes partly decorative |
| (b) | A fourth grant, `assets.custody.transfer` | The separation holds. A permission for one command, which D-5.2-04 warns against when the capability is thin |
| (c) | No transfer command; a handover is return then issue | Nothing new at all. The history says the asset returned and was re-issued the same day, which is true but not the whole truth |

### Recommendation — **not an approval**

**(c) for Checkpoint 2**, then (b) if a tenant genuinely needs the distinction. (a) should be refused:
it quietly widens the grant this module separated on purpose.

### Blocking

**Blocks transfer only.** Transfer is therefore excluded from Checkpoint 2, and Checkpoint 2 is not
blocked.

---

## D-5.3-09 — Whether an asset in open custody may be retired · **APPROVED 2026-08-23**

### The question

`assets.change-asset-status` can move an asset to `retired`, which is terminal. Checkpoint 1 wrote that
command before custody existed, so it cannot ask whether anybody is holding the item. Should it now?

### Evidence

Retiring an asset somebody holds removes it from service while the obligation is still outstanding —
and the register offboarding clearance will read is exactly the set of open custodies. This is the
same territory as D-5.3-01: what "outstanding" means when something ends.

**No precedent settles it.** It is a business rule about company property, and no line of code in this
repository expresses one.

### Options

| | Option | Consequence |
|---|---|---|
| (a) | Refuse retirement while a custody is open | The register cannot lose an outstanding item. A genuinely destroyed asset must have its custody closed first, which is arguably the correct order of events |
| (b) | Permit it | A written-off laptop can be retired immediately. Clearance must then read closed-and-outstanding custodies as well as open ones — which is D-5.3-01's question, answered by accident |

### Recommendation — **not an approval**

**(a).** It is the reversible direction: a refusal can be relaxed later, whereas rows written under (b)
cannot be un-written. It also keeps D-5.3-01 genuinely open rather than pre-empting it.

Note that (a) makes `assets.change-asset-status` consult the custody store — a change in *behaviour* to
a Checkpoint 1 command, not a change to any Checkpoint 1 *decision*: the status vocabulary, the
transition table and the persisted/derived split are all untouched.

### Blocking

**Checkpoint 2 must choose a behaviour**, so the owner should confirm this at authorization. It blocks
no schema and no other capability, and the recommendation is the reversible one.

### Owner approval · 2026-08-23

Option **(a)** approved, in the owner's own terms:

> *"An asset cannot be retired while it has an open custody. This is an operational invariant, not a
> new persisted status. Therefore: `asset.status` remains unchanged; no new status is introduced; no
> custody is automatically returned; retirement does not mutate custody; `change-asset-status` must
> reject `retired` when an open custody exists; the rejection must be transactional and race-safe; the
> error must be explicit and deterministic."* — with the instruction *"do not reinterpret this as a
> termination rule."*

### As implemented · 2026-08-23

`assets.change-asset-status` refuses `asset_in_custody` when a retirement is attempted against an asset
with an open custody. Nothing else changed: no status was introduced, no custody is closed, no other
transition is affected — an asset in custody can still go for repair, and that is asserted.

**Race-safety is a row lock, not a pre-check.** The invariant spans two tables, so no constraint
expresses it. `change-asset-status` and `issue-custody` both take `select … for update` on the asset row
**before** either checks, so the two transactions serialize on that row and the second re-reads the
committed truth on unblocking. Proved against two real connections: exactly one survives, and the
database is queried directly for the forbidden combination — `retired` **and** held — which never
occurs. The `LockRows` node is asserted in the query plan, so the lock is verified rather than assumed.

**It is not a termination rule**, and D-5.3-01 remains untouched below.

---

## D-5.3-10 — Whether custody may be cancelled or corrected, and with what semantics · **OPEN**

### The question

A custody opened against the wrong employment, or closed by mistake. What may be done about it?

### Evidence

**Both repository precedents are substantial mechanisms, not details.**

* Attendance built an entire `attendance_correction_request` table with its own kind and state CHECKs
  and three foreign keys (`20260810140000_attendance`, line 570), and its migration states the rule:
  a correction writes a *new* event rather than editing the original.
* D-5.2-19 corrected a concluded investigation with a **backward reference on a new record**
  (`corrects_investigation_id`), a self-FK, a "correction must itself be concluded" CHECK and a partial
  unique index — and left the original untouched.

Both confirm the direction — **a new corrective record, never a mutation** — and both show that the
*semantics* are the work: what a corrected custody means to the register, whether it ever counted, and
what clearance should see.

### Options

| | Option | Consequence |
|---|---|---|
| (a) | No correction; a closed custody is final | Honest and smallest. A mistake stands in the history, visible |
| (b) | A corrective custody with a backward reference, in D-5.2-19's shape | The established pattern, and it needs its own decision about what the correction means downstream |
| (c) | Cancellation as a third closure state | Invents a state whose meaning to clearance nobody has agreed |

### Recommendation — **not an approval**

**(a) for Checkpoint 2**, and (b) when a checkpoint genuinely needs it — with its downstream meaning
decided at the same time, not afterwards. (c) should be refused: a cancelled custody that clearance
might or might not count is the ambiguity this register exists to prevent.

### Blocking

**Does not block Checkpoint 2.** The limitation — a closed custody is final — is stated rather than
worked around.

---

## A defect found during this investigation · **not a decision**

Recorded here because it is the reason a Checkpoint 2 test exists, and because it is not Assets' to fix.

**`RelationsEmploymentDirectory`'s bounded grant names a permission no handler declares.**
`GrantAwarePermissionChecker` matches by exact string
(`packages/kernel/src/tenancy/service-context.ts:114`); `employment.read-employment` declares
`employment.employment.read`; Relations' adapter permits `'employment.read'`
(`apps/api/src/relations/relations-sources.ts:9`). Seven other adapters name the correct string.
Grepping the repository finds **no handler declaring `'employment.read'`**.

The consequence is that `relations.record-violation` refuses every violation as `employment_unknown`
unless the calling user personally holds `employment.employment.read`.

**It is a Relations defect, outside Phase 5.3's authorized scope, and it is not fixed here.** Its
bearing on this phase is that Assets must name `employment.employment.read` and must **reconcile that
string against Employment's own export in a test**, so the same one-character-class mistake cannot be
made twice.

---

# Decision opened by the Checkpoint 3 investigation

---

## D-5.3-11 — Whether Assets learns that an employment has ended by subscription · **SETTLED BY EXISTING EVIDENCE**

### The question

Checkpoint 2 implemented no termination behaviour, and the register recorded that this was the *absence*
of behaviour rather than a choice. The Checkpoint 3 authorization put the choice explicitly: **Option A**
— Assets subscribes to an existing Employment contract and reacts to an employment ending; **Option B** —
Assets keeps custody independent of termination and answers through reads when somebody asks.

This decision settles the **mechanism** only. It does **not** settle what *should* happen to a custody
whose employment has ended — that is D-5.3-01, it is a business rule, and it stays OPEN.

### Why this is settled rather than open

**Option A is reachable, which is why the refusal has to be a real one.** The mechanism exists:
`EventHandler` (`packages/kernel/src/persistence/unit-of-work.ts:43`), `InProcessEventDispatcher`
(`packages/kernel/src/domain/in-process-dispatcher.ts`), and `ModuleRegistry.eventHandlers`. Employment
already raises the event: `EmploymentEvents.employmentEnded = 'employment.employment.ended'`
(`packages/modules/employment/src/domain/employment-events.ts:35`), raised at
`packages/modules/employment/src/domain/employment.ts:195`. Nothing is missing.

**But no module in this repository subscribes to another module's event.** The only `EventHandler` that
exists is `onMembershipEnded`
(`packages/modules/identity/src/application/on-membership-ended.ts`, registered at
`identity-module.ts:70`), and it is Identity reacting to Identity's own event — *intra*-module. Eight
module declarations state the rule in their own words.

**`EmploymentEvents` is not exported from Employment's contract.**
`packages/modules/employment/src/contracts/index.ts` publishes views, statuses and transitions, and no
event name. A subscriber would have to reach past the file whose entire purpose is to be the only thing
consumers depend on.

**Three ADRs answer the question directly, and they agree.**

- **ADR-0050** states the delivery facts as verified properties of `PostgresUnitOfWork`: commit then
  dispatch, in-process, no broker, no retry, **no outbox**, no replay — and *"no published event contract
  and no cross-module subscription contract."* Its conclusion: an event is at-most-once, and that it was
  raised is not evidence anything happened.
- **ADR-0058** is the closest structural analogue — a downstream module needing an upstream change. It
  refuses the push design: *"The dependency points one way, and the module that needs the information
  asks for it,"* and refuses a stored cursor with it: *"No cursor table, no feed, no subscription."*
- **ADR-0053** supplies the positive half: *"Reconciliation is a first-class query … the count is on the
  administrator's dashboard rather than in an operations script. It is the number that reveals a failure,
  and a number a human can see is a number a human notices growing."*

**What Option A would cost here specifically.** Automatic custody closure driven by the ended event means
a process that restarts mid-dispatch leaves an asset permanently recorded as held by somebody who has
left, with nothing able to replay the event and nothing recording that it was owed. The failure is silent
and unrecoverable by design, and the subject is company property.

### Settled position

Assets does not subscribe to any event, consumes no Employment event, closes no custody automatically,
and schedules nothing. It answers when it is asked. Whichever way D-5.3-01 is later settled, the trigger
will be a command or a read — never a subscription.

Checkpoint 3 implements the ADR-0053 half of this: custody ageing and an aggregate outstanding summary,
both derived, so the situation is **visible** without anything reacting to it.

### What this decision does not do

It does not decide D-5.3-01, and Checkpoint 3's reads are built so they cannot decide it by accident:
the custody reads never ask Employment anything, so a custody held by an ended employment ages exactly
like one held by an active employment. Options (a) and (c) of D-5.3-01 both remain reachable, and each
still costs one migration.

### Blocking

Blocks nothing. It removes a question from Checkpoint 4's path rather than adding one.

---

## Change log

| Date | Change |
|---|---|
| 2026-08-24 | **Checkpoint 3 investigation and implementation.** **D-5.3-11 opened and settled by existing evidence** — Assets does not subscribe to Employment; ADR-0050, ADR-0058 and ADR-0053 answer it, and the repository's only `EventHandler` is intra-module. **D-5.3-01 remains OPEN and undecided**, and the new reads are built so they cannot decide it by accident. D-5.3-03, D-5.3-05, D-5.3-07, D-5.3-08 and D-5.3-10 remain OPEN and untouched; D-5.3-02, D-5.3-04, D-5.3-06 and D-5.3-09 were not reopened or weakened. Checkpoint 3 added **no table, no column, no migration and no permission**. |
| 2026-08-23 | **Checkpoint 2 implemented.** One table, two commands, two reads, three permissions, one additive migration, one cross-module read that creates no contract. **D-5.3-09 approved and implemented**; D-5.3-01, D-5.3-03, D-5.3-05, D-5.3-07, D-5.3-08 and D-5.3-10 all remain **OPEN and untouched**, and no settled decision was reopened. Seven negative-space assertions became stale because the approved capability genuinely changed the boundary; each was **replaced with a more exact statement**, none deleted. |
| 2026-08-23 | **Checkpoint 2 investigation.** Four decisions opened — D-5.3-07 (active versus existing employment), D-5.3-08 (transfer authority), D-5.3-09 (retirement while in custody), D-5.3-10 (correction and cancellation). **None approved.** D-5.3-01, D-5.3-03 and D-5.3-05 remain OPEN and unchanged. A shipped Relations defect was found and recorded rather than fixed. Checkpoint 2 confirmed to be blocked by no decision; D-5.3-09 is a behaviour the owner should confirm at authorization. |
| 2026-08-23 | **Checkpoint 1 implemented.** Two tables, five commands, three reads, four permissions, one additive migration, zero cross-module dependencies. **No decision approved, none reopened.** D-5.3-01, D-5.3-03 and D-5.3-05 remain OPEN and unchanged; the recommendations for D-5.3-01 and D-5.3-05 are documented and were **not** turned into behaviour or into columns. |
| 2026-08-23 | Register opened against `3ad9fd7`. D-5.3-02, D-5.3-04 and D-5.3-06 moved from OPEN to **SETTLED BY EXISTING EVIDENCE** with the settling code named. D-5.3-01, D-5.3-03 and D-5.3-05 confirmed **OPEN** with evidence, options and one recommendation each. Checkpoint 1 confirmed to depend on no open decision. **No decision approved.** |
