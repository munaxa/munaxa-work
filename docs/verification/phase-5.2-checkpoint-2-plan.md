# Phase 5.2 — Checkpoint 2 · Definition of Ready

**Status** Planning · **Date** 2026-08-23 · **Baseline** `2e00e61`, working tree clean ·
**Code changes** NONE

This is a planning checkpoint. **No module, schema, migration, command, query, permission, route,
test or UI was written.** Checkpoint 1 is accepted and untouched.

Three voices are kept apart, as in the Checkpoint 1 plan:

> **SPEC** — what `06B_PHASE_5.2_EMPLOYEE_RELATIONS.md` requires.
> **EXISTS** — what the repository already implements, cited.
> **RECOMMEND** — what this plan proposes. **A recommendation is not an approval.**

---

## 1. Checkpoint identity

**Phase 5.2 · Checkpoint 2 — Investigations and the case lifecycle.**

## 2. Objective

Let a tenant **investigate** a recorded violation: open an inquiry, name the investigator, record what
was found and what is recommended, and conclude it — with the case's progress **audited by actor,
timestamp and reason**, and the violation record itself still immutable.

## 3. Business value

Checkpoint 1 lets a tenant record that something happened. On its own that is a filing cabinet: the
lifecycle stops at *reported* and nothing can move. Checkpoint 2 is what makes it a **process** — the
first step of *due process*, which AD-008 requires be *"enforced structurally, not by convention"*.

It is also the step that makes later checkpoints possible: a disciplinary action must rest on
findings, an appeal must have something to challenge, and a penalty must have something that
authorized it.

## 4. Exact scope

- **Open an investigation** into a recorded violation: investigator (a membership), opening date, a
  statement of what is being investigated.
- **Record findings and a recommendation** on it.
- **Conclude it.**
- **Read** one investigation, and the investigations for one violation.
- **The case lifecycle**: an append-only, immutable transition log carrying **actor, timestamp and
  reason** for every transition — the mechanism D-5.2-15 must settle.
- **Audited reads**, extending the Checkpoint 1 trail to the new record type.

## 5. Explicit non-goals

Disciplinary actions · penalties · warnings · grievances · appeals · **evidence attachment**
(D-5.2-08) · Workflow approval (D-5.2-12) · Letters · Payroll (D-5.2-10) · termination
recommendations as an *outcome* (D-5.2-11) · expiry (D-5.2-09) · confidentiality classification
(D-5.2-13) · Admin UI · any scheduler, worker, timer, sweep or job runner · any country-pack rule ·
any change to Workflow, Employment, People, Payroll, Documents, Letters, Identity or Platform · any
reopening of D-5.2-03, 04, 05, 06, 07 or 14.

## 6. Decisions required

**Three, all opened by this investigation, all Work-owned, none needing another repository:**

| ID | Question | Recommendation |
|---|---|---|
| **D-5.2-15** | How the lifecycle advances, given an immutable violation row | An append-only transition log; current state is its latest entry |
| **D-5.2-16** | What an investigation is, and who may run one | One aggregate; one open per violation by partial unique index; two new permissions |
| **D-5.2-17** | Whether findings are immutable, and how a correction is made | Mutable while open, trigger-immutable on conclusion, corrected by a new linked row with a reason |

Each is argued with evidence in [`phase-5.2-register.md`](phase-5.2-register.md). **None is
approved.**

## 7. Decisions not required

**Six, and each is genuinely not needed rather than deferred by convenience:**

| ID | Why Checkpoint 2 does not need it |
|---|---|
| D-5.2-08 Evidence | An investigation can record what was found before a file is attached to it. Recommended for Checkpoint 3 |
| D-5.2-09 Expiry | Checkpoint 2 issues no warning, so nothing can expire |
| D-5.2-10 Payroll | No disciplinary action is issued, so no penalty is authorized |
| D-5.2-11 Termination | A recommendation is an *outcome of an action*; none is issued |
| D-5.2-12 Workflow | Nothing is issued, so nothing needs approving. **Nobody approves the opening of an inquiry** |
| D-5.2-13 Confidentiality | Grievances are a later checkpoint |

## 8. Domain ownership

`relations` owns the investigation, its findings and the case lifecycle —
`DOMAIN_OWNERSHIP.md:49` already assigns *"Violation, disciplinary action, grievance"* to it.

**Nothing else is owned or duplicated.** The investigator is a **membership identifier held as a
value**; Relations resolves it to nobody. Employment stays behind the boolean existence check
Checkpoint 1 built. **No People, no manager resolution, no approval, no storage, no payroll, no
authorization model, no scheduling.**

## 9. Data model

**RECOMMEND two tables, pending D-5.2-15 and D-5.2-16.** Each is justified below; neither is
speculative.

### `relation_investigation`

| Property | Value |
|---|---|
| **Owner** | `relations` |
| **Purpose** | one inquiry into one recorded violation |
| **Lifecycle** | `open` → `concluded`. Two states, both reachable in this checkpoint |
| **Mutability** | mutable **while open**; trigger-immutable **on conclusion** (D-5.2-17) |
| **Tenant scope** | `tenant_id`, `app_protect_table`, enabled **and forced** |
| **Foreign keys** | `violation_id` → `relation_violation`. **No cross-module FK** — `investigator_membership_id` is a value, as `employment_id` is on the violation |
| **Uniqueness** | **one open investigation per violation**, a partial unique index on `(tenant_id, violation_id) where state = 'open' and deleted_at is null` — never a select-then-insert (ADR-0071) |
| **Indexes** | the partial unique index; `(tenant_id, violation_id, opened_on desc, id desc)` for the per-violation read |
| **RLS** | required, forced |
| **Audit** | standard audit columns; **reads audited** through the existing trail |
| **Deletion** | none. A concluded investigation is evidence; an open one is superseded by conclusion, never removed |

Fields: `violation_id`, `investigator_membership_id`, `opened_on` (date), `subject` (text — what is
being investigated), `findings` (text, null until concluded), `recommendation` (text, null until
concluded), `concluded_on` (date, null while open), `state`, `corrects_investigation_id` (nullable
self-reference, D-5.2-17), `correction_reason` (text, null unless correcting), audit columns,
`version`.

### `relation_case_event`

| Property | Value |
|---|---|
| **Owner** | `relations` |
| **Purpose** | the case lifecycle — SPEC: *"Every transition is audited with actor, timestamp and reason"* |
| **Lifecycle** | append-only. There is no update path and no delete path |
| **Mutability** | **immutable at the database**, by the Checkpoint 1 trigger pattern |
| **Tenant scope** | `tenant_id`, forced RLS |
| **Foreign keys** | `violation_id` → `relation_violation` |
| **Uniqueness** | none. The same transition may legitimately recur across a case's life |
| **Indexes** | `(tenant_id, violation_id, occurred_at, id)` — the ordering pair, so two transitions in one millisecond read deterministically |
| **RLS** | required, forced |
| **Audit** | it *is* the audit. Actor from the execution context, never a field |
| **Deletion** | none — the trigger refuses update and delete, and a soft delete is an update |

**Why not a third table.** Statements are deliberately **not** a table (D-5.2-16): nothing in this
checkpoint reads one independently, and adding the table later is additive. **Prefer derived state:**
there is no `current_state` column on the violation and none is added — the current state is the
latest `relation_case_event`, and `relation_violation.state` keeps its Checkpoint 1 meaning and its
`'reported'` CHECK **unchanged**.

## 10. Commands

`relations.open-investigation` · `relations.record-findings` · `relations.conclude-investigation` ·
`relations.correct-investigation` (pending D-5.2-17).

Each writes its `relation_case_event` **in the same transaction** as the change it records.

## 11. Queries

`relations.read-investigation` · `relations.investigations` (for one violation, bounded and paged) ·
`relations.case-history` (the transition log for one violation, bounded).

**No tenant-wide enumeration of any of them** — the Checkpoint 1 rule, unchanged: the collection reads
take a violation, never a tenant.

## 12. Permissions

**RECOMMEND two new, pending D-5.2-16:** `relations.investigation.manage` and
`relations.investigation.read`.

The four Checkpoint 1 permissions are **unchanged and not reused for investigations** — opening an
inquiry into somebody is a different act from filing a report, and AD-007's *"restricted independently
of ordinary employee access"* argues for keeping them apart. **No wildcard, no `relations.admin`, no
permission for a capability that does not yet exist.** The composition suite's exact-count assertions
move from four to six, which is a scope change visible in the diff rather than a detail.

## 13. API

`GET|POST /v1/relations/investigations`, `GET /v1/relations/investigations/:investigationId`,
`POST /v1/relations/investigations/:investigationId/findings`,
`POST /v1/relations/investigations/:investigationId/conclusion`,
`GET /v1/relations/violations/:violationId/history`.

**No `PUT`, no `PATCH`, no `DELETE`** — the Checkpoint 1 rule. **No `tenantId`, no actor, no
timestamp** in any body. Problem Details as established; another tenant's record is **404, never
403**.

## 14. RLS

Both tables `app_protect_table`'d, **enabled and forced** (ADR-0030), proved against real PostgreSQL
as an **unprivileged role with no `BYPASSRLS`**, in both directions, with the other tenant's row
confirmed to exist so a zero is a policy filtering rather than a row never written.

## 15. Audit

Two distinct things, and they stay distinct:

- **`relation_case_event`** records *what changed* — actor, timestamp, reason.
- **`relation_violation_access_event`** (Checkpoint 1) records *who looked*. **RECOMMEND** extending
  its action vocabulary to cover investigation reads, which widens a CHECK rather than adding a table.

**Catalogue reads stay unaudited**, unchanged from Checkpoint 1.

## 16. Immutability

`relation_case_event`: **unconditionally immutable**, by the Checkpoint 1 trigger pattern.

`relation_investigation`: **conditionally immutable** — amendable while `open`, refused once
`concluded` (D-5.2-17). The precedent is `app_letter_template_version_refuse_issued`, which refuses a
change only after a version has issued a letter.

**`relation_violation` is not touched.** Its trigger, its CHECK and its columns stay exactly as
Checkpoint 1 delivered them.

## 17. Concurrency

**One open investigation per violation**, enforced by a **partial unique index** — the application may
check first for a readable refusal, but the index decides, because *a `select` followed by an
`insert` is not idempotent under concurrency* (ADR-0071). To be proved with **two real connections
overlapping in time, no sleeps**.

Optimistic concurrency (`version` + `expectVersion`) on the investigation while it is open.

## 18. Localization

`packages/modules/relations/locales/{en,ar}.json` extended — both languages complete in the same
commit, or `check-localization.mjs` fails. Every new refusal key and every user-facing label in both.
**No English-only terminology, no raw keys.**

## 19. Cross-module contracts

**None new, and that is the point.**

| Dependency | State |
|---|---|
| Employment existence check | **already exists** — Checkpoint 1's bounded service grant, unchanged |
| Documents | **not used** (D-5.2-08 deferred) |
| Workflow | **not used** — nothing is issued |
| Payroll | **not used** |
| Identity | **not used** — the investigator is a value, resolved to nobody |
| Organization | **not used** |

## 20. Platform dependencies

**None.** Checkpoint 2 requires no scheduler, no worker, no job runner, no machine execution, no
automatic action, no expiry execution and no notification delivery. Every transition is made by a
person, in a request, inside one transaction.

## 21. Country-pack boundary

**Unchanged from Checkpoint 1, and nothing is added.** No warning limit, disciplinary interval,
termination restriction, statutory penalty or mandatory escalation rule. The investigation model is
**jurisdiction-neutral**: it records who investigated, what was found and what was recommended, and
takes no view on what a jurisdiction requires. Legal enforcement remains
**NOT VERIFIED / DEFERRED TO PHASE 11.1**, and the negative-space suite's no-legal-content assertions
extend to the new files.

## 22. Migration plan

**One additive migration.** Two `create table`, their indexes, two trigger functions and two triggers,
three `app_protect_table` calls' worth of protection for the new tables, and **one widened CHECK** on
`relation_violation_access_event.action`.

**No table is altered destructively, no column is dropped, and `relation_violation` is not touched.**
Rollback is discussed in §26.

## 23. Test plan

**Domain** — investigation invariants; the open/concluded transition; correction requires a reason;
findings absent while open.
**Application** — authorization one permission at a time, including that no Checkpoint 1 permission
and no other module's permission opens an investigation handler; a second open investigation refused;
the case event written in the same transaction as the change.
**PostgreSQL** — RLS forced, both directions, under an unprivileged role; cross-tenant denial where
another tenant's identifier is indistinguishable from one that never existed; **immutability of the
case log**; **conditional immutability of the investigation, proved in both directions**;
**concurrency with two real connections and no sleeps**.
**API** — contract, validation, authorization, tenant isolation, exact response shape, and route
resolution order.
**Negative space** — no `tenantId`, actor or timestamp accepted; no scheduler, storage, notification,
legal content or persisted derived temporal state; no tenant-wide enumeration; no reach into People;
no duplicated manager resolution; **`relation_violation` unchanged**.

## 24. Verification gates

`pnpm standards` · `pnpm format:check` · `prisma validate` · `prisma migrate status` ·
`turbo run build lint typecheck test --force --concurrency=1`, with **turbo's own exit code captured
from the process** — the Checkpoint 1 report records what happens when it is not.

**This planning checkpoint runs only `pnpm standards` and `pnpm format:check`**, because no production
code changed.

## 25. Risks

| Risk | Mitigation |
|---|---|
| **`relation_violation.state` becomes misleading** — it says `'reported'` for ever while the case has moved on | Name it in the schema comment as *the state at recording*; every current-state reader uses the log. The alternative is a mutable evidence row |
| A conditional immutability trigger is subtler than an unconditional one | Assert **both** directions: an open investigation can be amended, a concluded one cannot |
| Two transitions in one millisecond order non-deterministically | Order by `(occurred_at, id)`, as `workflow_history` does |
| Permission count grows | Two, both named, both asserted exactly; the composition suite's counts move visibly |
| Scope creep toward disciplinary actions | The non-goals in §5 are asserted by the negative-space suite, not promised |

## 26. Rollback considerations

The migration is **purely additive**: two new tables and one widened CHECK. Reverting it means
dropping the two tables and narrowing the CHECK back — **no Checkpoint 1 data is touched, and no
column it wrote is altered**, so a rollback loses only Checkpoint 2's own rows.

**The honest caveat:** once investigations exist, dropping them destroys evidence in the legal sense.
Rollback is therefore a decision for the window before a tenant uses the capability, not a routine
operation — the same property finalized payroll has.

## 27. Definition of Ready checklist

| Condition | State |
|---|---|
| Checkpoint 1 preserved and untouched | ✅ |
| Specification re-read for the remaining scope | ✅ |
| Authoritative open-decision set taken from the register, not assumed | ✅ — six open, and three more found |
| Every open decision investigated with evidence, options and a recommendation | ✅ |
| Next checkpoint chosen on dependency evidence rather than specification order | ✅ — §Why below |
| Cross-module contracts checked for existing reuse | ✅ — none new required |
| Platform dependencies determined | ✅ — **none** |
| Data model justified table by table | ✅ |
| Security, RLS, audit, immutability and concurrency settled against existing patterns | ✅ |
| Country-pack boundary preserved | ✅ |
| **Blocking decisions approved by the owner** | ❌ — **three OPEN** |

**Checkpoint 2 is NOT READY to implement.** It is ready to *decide*: everything needed to answer
D-5.2-15, D-5.2-16 and D-5.2-17 is gathered, and none of them waits on another repository, another
module, or Platform.

---

## Why this is the correct next checkpoint

The instruction asks not to follow specification order if dependency evidence points elsewhere. It
does, and it points here.

**Every other candidate is blocked by an open decision or another module.**

| Candidate | Blocked by |
|---|---|
| Disciplinary actions | Workflow adoption (D-5.2-12), the penalty ladder, Letters, and — if it carries a penalty — Payroll (D-5.2-10) |
| Warnings and escalation | expiry (D-5.2-09) and the ladder; and a warning is an *outcome of an action*, which does not exist |
| Grievances | confidentiality (D-5.2-13), whose honest answer depends on a Platform capability that does not exist |
| Appeals | there is nothing to appeal until an action exists |
| Evidence | `StoragePort` has no adapter, and the link belongs beside the investigation that gathers it |

**Investigations are blocked by nothing outside Relations.** They need no Platform work, no Payroll
change, no storage adapter and no confidentiality architecture; they build directly on the violation
Checkpoint 1 records; and they are the *next step of the specification's own lifecycle* — *Violation
Reported → **Under Investigation** → Findings*.

They are also the checkpoint that **forces the lifecycle question to be answered honestly**. Any slice
that moves a case past *reported* meets D-5.2-15, and meeting it here — over a record type that is new,
rather than by retrofitting one that is already evidence — is the cheapest place in the phase to
settle it.
