# Phase 5.2 — Employee Relations & Disciplinary · Definition of Ready

**Status** Planning · **Date** 2026-08-22 · **Baseline** `7d20c02`, working tree clean ·
**Code changes** NONE

This is a planning checkpoint. **No module, schema, migration, command, query, permission, route or
UI was written.**

Three voices are kept apart throughout, because conflating them is how a plan becomes an
unauthorized decision:

> **SPEC** — what `06B_PHASE_5.2_EMPLOYEE_RELATIONS.md` requires.
> **EXISTS** — what the repository already implements, cited.
> **RECOMMEND** — what this plan proposes. **A recommendation is not an approval.**

---

## 1. Objective

Implement the Employee Relations domain: violations, investigations, disciplinary actions, warnings,
grievances and appeals — as a record that **stands up in a labor dispute**.

That last clause is the phase's real requirement and it drives every design choice below. SPEC:
*"This domain carries legal weight. Its records are evidence in a labor dispute, so its history is
immutable, its access is restricted, and its process is configurable."*

## 2. Authoritative specification

`work prompts/06B_PHASE_5.2_EMPLOYEE_RELATIONS.md` — **Version 1.0, Status: Approved**. 179 lines,
read end to end. Nine mandatory architecture decisions (AD-001…AD-009), seven aggregate roots, two
lifecycles, ten domain events, seven acceptance criteria.

Supporting evidence: `docs/PHASES.md` (row 5.2, *Not started*) · `docs/DOMAIN_OWNERSHIP.md:49`
(module `relations`) · `docs/verification/post-16e-next-phase.md` (why 5.2 is next) ·
`work prompts/12B_PHASE_11.2_OFFBOARDING.md:32` (11.2 requires 5.2).

## 3. Business scope

**SPEC** — seven aggregate roots:

| Root | What it holds |
|---|---|
| **ViolationCategory** | code, severity, penalty ladder, statutory constraints, repeat window |
| **Violation** | employment, category, occurrence date, reporter, description, evidence attachments, state |
| **Investigation** | investigator, statements, evidence, findings, recommendation, dates |
| **DisciplinaryAction** | violation, action type, ladder position, penalty, effective date, issued letter reference, acknowledgement, validity period, appeal state |
| **Warning** | the issued warning, its validity window and its expiry |
| **Grievance** | raiser, subject, confidentiality, handler, resolution, escalation |
| **Appeal** | the challenge to an action, its reviewers and its outcome |

**Lifecycles.** Violation Reported → Under Investigation → Findings → Pending Approval → Action
Issued → Acknowledged → Appealed → Upheld / Annulled → Expired → Archived. Grievance: Raised →
Acknowledged → Under Review → Resolved → Escalated → Closed. *"Every transition is audited with
actor, timestamp and reason."*

**Capability classification** — checked against the specification, not inferred from the module name:

| Capability | Existing | Required | Dependency | Owner |
|---|---|---|---|---|
| Violation categories | no | **yes** — AD-002 | country pack (absent) | Relations |
| Violations | no | **yes** | Employment | Relations |
| Investigations | no | **yes** | Documents (evidence) | Relations |
| Warnings | no | **yes** — AD-006 | — | Relations |
| Disciplinary actions | no | **yes** | Workflow, Letters | Relations |
| Hearings / due process | no | **yes** — AD-008 | Workflow | Relations |
| Grievances | no | **yes** | — | Relations |
| Appeals | no | **yes** — AD-003 | — | Relations |
| Case history | no | **yes** | kernel audit | Relations |
| Evidence attachments | **partly** — Documents holds files against an employment | reference only | Documents; `StoragePort` has no adapter | Documents |
| Approvals | **yes** — Workflow 16A–16E | adopt, never rebuild | `ApprovalPort` | Workflow |
| Notifications | **no delivery anywhere** | out of scope | Phase 17 | Communications |
| Penalty → payroll | no inbound seam | **yes** — AD-004 | Payroll contract | Payroll |
| Termination recommendation | no | **yes** — AD-005 | Employment | Employment executes |
| Expiry firing | no | **event listed**, nothing can fire it | job runner (Platform) | Platform |
| Reporting | no | not in this phase's scope | — | Phase 20 |

**Not in scope, by the specification's own Non-Goals:** employment termination · payroll deduction
computation · performance improvement plans · a workflow engine.

## 4. Existing-system mapping

Verified by inspection at `7d20c02`:

| Area | Finding |
|---|---|
| Employment | module present, 85 handlers; publishes `employment.read-employment`, `.search`, `.read-history`, `.export-workforce` |
| People | present, 176 handlers — **not referenced by Relations** (AD-001) |
| Organization | present, 163 handlers; `legal_entity.country_code` is the statutory anchor (ADR-0035) |
| Identity | present, 90 handlers; `identity.membership-standing` / `-recipient` are the bounded-port precedent (ADR-0043) |
| Documents | present, 72 handlers, 5 tables; `Document.owner_type` ∈ {`person`, `employment`, `legal_entity`}; `document_access_event` is the audited-read precedent |
| Letters | present, 78 handlers, 6 tables; `letters.issue` produces an issued letter with a frozen snapshot |
| Payroll | present; **all cross-module ports are `*SourcePort` reads — no inbound instruction seam** |
| Workflow | 16A–16E complete; `ApprovalPort.subjectType` is opaque, `recruitment.requisition` is the precedent |
| Performance | present — owns improvement plans; Relations must not |
| `packages/country-packs` | **empty shell**: *"deliberately exports nothing yet … Filled in Phase 11.1"* |
| `StoragePort` | **no adapter anywhere in the repository** |
| `JobPort` | **no adapter anywhere**; execution assigned to Platform (D-16E-03) |
| `relations` module | **absent** — no code, no tables, no domain terms |

## 5. Reuse / Extend / New

Verified rather than assumed:

| Area | Decision | Evidence |
|---|---|---|
| Employee identity | **REUSE** | People owns it; AD-001 forbids referencing it from here |
| Employment | **REUSE** | `employment.read-employment` published |
| Manager resolution | **REUSE** | Workflow 16C resolves it; **Relations must not duplicate it** |
| Audit / history columns | **REUSE** | kernel + persistence conventions on every table |
| RLS | **REUSE** | `app_protect_table`, enabled **and forced** (ADR-0030) |
| Optimistic concurrency | **REUSE** | `version` column + `expectVersion` |
| Immutability trigger | **REUSE the pattern, NEW instance** | `workflow_history_immutable`, ADR-0066 |
| Approvals | **REUSE** | kernel `ApprovalPort`; no second mechanism |
| Localization | **REUSE** | `<package>/locales/{en,ar}.json`, checked by `check-localization.mjs` |
| Document storage | **NEITHER** — reference only | `StoragePort` has no adapter; do not build one |
| Country pack | **DEFER** | empty by design until Phase 11.1 |
| Relations domain | **NEW** | nothing exists |
| Relations permissions | **NEW**, pending D-5.2-04 | no `relations.*` permission exists |
| Relations API | **NEW** | `apps/api/src/relations/` |
| Relations Admin UI | **NEW**, later checkpoint | read-only first, as 16D's screen was |

## 6. Data model requirements

**SPEC** — seven roots (§3). **AD-009**: audit, soft delete, optimistic concurrency, effective dating
and metadata on all of them.

**RECOMMEND** for the first checkpoint, pending D-5.2-03 / D-5.2-07:

- `relation_violation_category` — `tenant_id`, `code`, `name` (bilingual JSON), `severity`,
  `repeat_window_days`, `source` (`tenant` | `country_pack`), nullable `country_pack_id` /
  `country_pack_version`, status, effective dating, audit columns, `version`.
- `relation_violation` — `tenant_id`, `employment_id`, `category_id`, `occurred_on`,
  `reported_by_membership_id`, `description`, `state`, audit columns, `version`.
- `relation_violation_history` — append-only transition log: actor, timestamp, **reason**.
- `relation_access_event` — the AD-007 read trail, pending D-5.2-05.

Every table `app_protect_table`'d. **No `expired` column** (D-5.2-09). **No attachment table**
(D-5.2-08).

## 7. Domain requirements

- **Immutability** (AD-003) — a correction is a new linked record with a stated reason; a successful
  appeal **annuls, it does not erase**.
- **Due process** (AD-008) — *structural*, not conventional: an action cannot be issued without the
  process steps its configuration requires. **RECOMMEND** the domain refuse by name, one refusal per
  missing step, following 16D's eight-named-refusals pattern where each refusal sends a different
  person to fix a different thing.
- **Repeat window** — how far back prior violations count toward escalation; a read-time computation
  over occurrence dates, excluding expired warnings (D-5.2-09).
- **Nothing hardcoded** (AD-002) — no severity, ladder or window is a constant in code.

## 8. Commands

**Checkpoint 1 (RECOMMEND):** `relations.define-category`, `relations.amend-category`,
`relations.record-violation`.

**Later checkpoints (SPEC):** open/conclude investigation · issue disciplinary action · acknowledge ·
raise/resolve grievance · lodge/decide appeal · annul.

## 9. Queries

**Checkpoint 1 (RECOMMEND):** `relations.categories`, `relations.read-violation`,
`relations.violations` (bounded, paged).

**Later:** case history · prior violations within the repeat window · authorized penalties for a
period (D-5.2-10) · termination recommendations (D-5.2-11) · the AD-007 access trail.

## 10. Permissions

**OPEN — D-5.2-04.** No `relations.*` permission exists and none may be created before approval.
**RECOMMEND** four for checkpoint 1: `relations.category.read`, `relations.category.manage`,
`relations.violation.read`, `relations.violation.record`.

**AD-007 constraint:** access is restricted **independently of ordinary employee access** — no
existing HR grant may imply any of these. One explicit permission per handler; no wildcard, no
prefix.

## 11. API requirements

`apps/api/src/relations/` owns transport; controllers hold no business rule (ADR-0023, 150-line
budget). REST under `/relations`, bilingual error bodies, DTOs with OpenAPI annotations.
**No `tenantId` in any request body** — tenancy comes from the execution context.

## 12. Admin requirements

**RECOMMEND: not in checkpoint 1.** 16D's precedent is a read-only screen added after the capability
exists. Admin authentication is Platform's (ADR-0001, ADR-0019; D-16D-10) and must not enter this
module.

## 13. Localization

`packages/modules/relations/locales/{en,ar}.json`, both complete from the first commit —
`check-localization.mjs` requires every catalogue to carry every key the reference language carries.
Category names are bilingual JSON in the row, as `LeaveType` and `DocumentType` are. Definition of
Done: *"in both languages"*.

## 14. Audit / history

Audit columns on every table (AD-009) plus an **append-only transition log** carrying actor,
timestamp and **reason** for every transition. **RECOMMEND** a trigger refusing `UPDATE`/`DELETE`
on it, as `workflow_history` has (D-5.2-03). Plus the AD-007 **read** trail (D-5.2-05) — which is
separate: one records what changed, the other records who looked.

## 15. RLS / tenancy

`app_protect_table` on every table, **enabled and forced** (ADR-0030). Tenancy from the execution
context only — never a request body, never a query parameter. Proved both ways in integration tests
under an **unprivileged role**, with both rows confirmed to exist so a count is a policy filtering
rather than a row never written.

## 16. Security

- **AD-007** — restricted access, every read audited.
- **Confidentiality applied in the query, not after it** (D-5.2-13): a caller without the grant
  neither receives the record nor learns how many were withheld. **A count is itself a disclosure.**
- A record identifier from another tenant must be **indistinguishable from one that never existed** —
  16D's rule, so an identifier is not a probe.
- No fake actor, no wildcard permission, no `tenantId` from input, no weakening of RLS or
  append-only history.

## 17. Concurrency

`version` column and optimistic concurrency (AD-009). Where uniqueness matters — one open
investigation per violation, one category code per tenant — **a partial unique index, not a
read-then-write**: ADR-0071, *a `select` followed by an `insert` is not idempotent under concurrency*.
Proved with two real connections overlapping in time, no sleeps.

## 18. Documents / evidence

**OPEN — D-5.2-08.** **RECOMMEND** a document *reference*; Documents owns the file.
**`StoragePort` has no adapter and none will be built here** — upload, download, hashing and malware
scanning stay `NOT VERIFIED`, as Phase 4.1 recorded them. **Not required by checkpoint 1.**

## 19. Country / legal dependencies

**OPEN — D-5.2-06.** The country pack is an empty shell until Phase 11.1. **RECOMMEND** the
Attendance/Leave precedent: a `source` discriminator plus nullable `country_pack_id` /
`country_pack_version`; categories are tenant configuration; **statutory constraint enforcement is
`NOT VERIFIED`**.

**No labor-law rule for any jurisdiction will be invented here.** 5.2's Prerequisites do not list
11.1, and Phase 11.2 lists 5.2 as *its* prerequisite — so blocking on 11.1 would stall the milestone
on a dependency the specification never declared.

**The cost, stated plainly:** until Phase 11.1, a tenant can configure a ladder its country's labor
law would not permit, and nothing will stop it.

## 20. Expiry / temporal behaviour

**OPEN — D-5.2-09.** **RECOMMEND** expiry **derived at read time**; no `expired` column; the
`WarningExpired` event **not emitted** and recorded `NOT VERIFIED` with the job runner named as its
dependency.

AD-006's operative clause — *"an expired warning no longer counts toward escalation"* — is a
read-time predicate and needs nothing to fire. **No scheduler, no sweep, no timer, no `setInterval`,
no background process.**

## 21. Cross-module dependencies

| Dependency | Direction | State |
|---|---|---|
| Employment — read the employment | Relations → Employment | **A. available** |
| Documents — evidence reference | Relations → Documents | **C. contract** (D-5.2-08) |
| Workflow — route approvals | Relations → Workflow | **A. available**; return path needs `RelationsDecisions` in `apps/api` (**B**) |
| Letters — issue the disciplinary letter | Relations → Letters | **C. contract** |
| Payroll — authorized penalty | Payroll → Relations (pull) | **C. contract, touches a completed module** (D-5.2-10) |
| Employment — termination recommendation | human-mediated | **C. contract** (D-5.2-11) |
| Communications — notify | — | **out of scope**, Phase 17 |

**Checkpoint 1 uses only the first row.**

## 22. Platform dependencies

**None for Phase 5.2's first checkpoint, and none for the domain as specified**, with one exception:
the `WarningExpired` **event** would need the durable job runner that D-16E-03 assigned to Platform
and that does not exist. Recorded as `NOT VERIFIED` (D-5.2-09) rather than worked around.

**Not to be built here:** scheduler · job runner · machine-principal provisioning · scheduled job
delivery · retry/lease infrastructure · Platform-side execution lifecycle · authentication.

## 23. Open decisions

Fourteen, in `phase-5.2-register.md`. **Six block the first checkpoint:** D-5.2-03 (immutability),
D-5.2-04 (permissions), D-5.2-05 (read auditing), D-5.2-06 (country pack), D-5.2-07 (ladder
sequencing), D-5.2-14 (checkpoint scope).

**All six are Work-owned.** None is Platform's, and each is a choice between options this repository
has already exercised.

## 24. Implementation checkpoints

**RECOMMEND**, each ending at an approval gate:

| # | Capability | Adds |
|---|---|---|
| **1** | **Violation catalogue + recording a violation** | module, 4 tables, 3 commands, 3 queries, 4 permissions, REST, 1 migration |
| 2 | Investigations, and the penalty ladder | evidence references (D-5.2-08), ladder (D-5.2-07) |
| 3 | Disciplinary actions and due process | Workflow adoption, Letters, structural refusals |
| 4 | Warnings and escalation counting | read-time expiry and repeat window |
| 5 | Grievances and appeals | confidentiality, annulment |
| 6 | Outbound contracts | Payroll penalties (D-5.2-10), termination recommendations (D-5.2-11) |
| 7 | Admin | read-only screens |

## 25. Explicit non-goals

Employment termination execution · payroll computation · performance improvement plans · a workflow
engine · a second approval mechanism · a storage adapter · a country pack · a scheduler, cron, worker,
sweep or timer · notification delivery · analytics · Admin authentication · any change to Workflow,
Employment, People, Payroll, Documents, Letters, Identity or Platform · any reopening of D-16D-08,
D-16D-16, D-16D-10 or any Phase 16E decision.

## 26. Definition of Ready

| Condition | State |
|---|---|
| Authoritative specification located and read end to end | ✅ |
| Prerequisites verified from the repository | ✅ — §Prerequisites below |
| Scope mapped against existing implementation | ✅ |
| Reuse / Extend / New classified | ✅ |
| Cross-module dependencies classified A–E | ✅ |
| Blockers identified and attributed | ✅ |
| Decision register created, all entries `OPEN` or evidenced | ✅ |
| First checkpoint identified | ✅ |
| **Blocking decisions approved by the owner** | ❌ — **six OPEN** |

**Phase 5.2 is NOT READY to implement.** Ready to *decide*: everything needed to answer the six
questions is gathered, and none of them waits on another repository.

## 27. Definition of Done

**SPEC:** *"A tenant can operate its disciplinary policy end to end, defensibly, in both languages,
with a record that stands up in a labor dispute."*

Plus the seven acceptance criteria: configurable categories, ladders and validity periods · due
process enforced **structurally, not by convention** · records immutable, corrections and annulments
linked additions · penalties reaching Payroll **only** as authorized instructions · termination a
recommendation, **never** an execution · access restricted and every read audited · quality gates
pass.

**Two criteria cannot be fully met in this repository today**, and are recorded rather than
approximated: *"constrained by country pack"* (Phase 11.1 unbuilt) and the `WarningExpired` event
(job runner is Platform's).

---

## Prerequisites

**SPEC:** *"Phases 0 through 5, plus Phases 4.1 and 5.1."* Each verified at `7d20c02`:

| Prerequisite | Status | Evidence |
|---|---|---|
| Phase 0 — bootstrap | ✅ | workspace: `kernel`, `persistence`, `config`, `contracts`, `sdk`, `testing`, `country-packs`, `modules` |
| Phase 1 — foundation | ✅ | kernel: CQRS dispatcher, `ExecutionContext`, ports, events, audit |
| Phase 1.1 — architecture verification | ✅ | `docs/verification/phase-1.1-report.md`, passed 2026-08-05 |
| Phase 2 — workforce identity | ✅ | `identity`, 90 handlers |
| Phase 3 — organization | ✅ | `organization`, 163 handlers |
| Phase 4 — people | ✅ | `people`, 176 handlers |
| Phase 5 — employment | ✅ | `employment`, 85 handlers |
| Phase 4.1 — documents | ✅ | `documents`, 72 handlers, 5 tables |
| Phase 5.1 — letters | ✅ | `letters`, 78 handlers, 6 tables |

**On 4.1 and 5.1 specifically** — the previous ledger correction is confirmed by the code, not just
by the ledger: `DocumentType`, `Document`, `DocumentVersion`, `DocumentVerification`,
`DocumentAccessEvent`, `LetterTemplate`, `LetterTemplateVersion`, `LetterRequest`, `LetterIssued`,
`LetterApprovalDecision` and `LetterNumberSequence` are all in `prisma/schema.prisma`, and both
modules ship handlers and tests. `phase-12-plan.md` **D-0** — *"Deliver as 4.1 + 5.1 … update
`PHASES.md` accordingly"* — is the decision the ledger correction actioned.

**One caveat, recorded rather than smoothed over:** Phase 4.1 carries ten `NOT VERIFIED` capabilities,
all downstream of `StoragePort` having no adapter — Documents *"holds no bytes"*. That does **not**
make 4.1 incomplete for 5.2's purposes: Relations needs a document *reference*, which works, and it
is why evidence attachment is deferred (D-5.2-08) rather than assumed.

## Verification of this checkpoint

Planning-only; **no production code changed**, so the full gate was not run.

| Gate | Result |
|---|---|
| `pnpm standards` | recorded in the commit |
| `pnpm format:check` | recorded in the commit |

## Testing the first checkpoint will require

Defined, **not written** — no test may be written before implementation is authorized:

domain invariants · application authorization, one permission at a time, including that no existing
HR grant opens a `relations` handler · tenancy from the execution context · **RLS proved both ways
under an unprivileged role** · cross-tenant denial where another tenant's identifier is
indistinguishable from one that never existed · concurrency with two real connections, no sleeps ·
uniqueness by partial unique index · append-only history, `UPDATE` and `DELETE` both refused · the
AD-007 read trail written on every read · API contract in both directions · localization complete in
`en` and `ar` · **negative-space assertions** — no scheduler, no storage adapter, no hardcoded
severity or ladder, no `expired` column, no People reference, no duplicated manager resolution.
