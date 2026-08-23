# Phase 5.3 — Assets & Custody · Definition of Ready

*Prepared 2026-08-23 against `b0020a1`, immediately after Phase 5.2 closed. **Planning only** — no
module, no schema, no migration and no code exists for this phase.*

---

## 1. Objective

Own the company property issued to employees: **who holds what, since when, and in what condition.**

Not a fixed-asset register and not an accounting system — Finance owns value and depreciation. This
domain owns custody.

## 2. Business capability

Every item a company issues becomes traceable to an employment and a date, and an exit checklist has
something to check. The specification's own Definition of Done puts it well: *"offboarding clearance
is computed rather than remembered."*

Today it is remembered. There is no asset record anywhere in this repository, so a laptop issued to
somebody who leaves is tracked in a spreadsheet or not at all.

## 3. Why this phase, and not another

Every unbuilt phase was checked against the repository rather than against the ledger. **Seventeen
modules exist and are substantial**; most "Not started" rows in `PHASES.md` are stale, so numeric
order alone would have selected a phase that is already built.

Genuinely unbuilt — no package, no tables, no handlers: `assets` (5.3), `loans` (10.1), `statutory`
(11.1), `offboarding` (11.2), `benefits` (12), `claims` (12.1), `engagement` (13.1),
`communications` (17), and everything from 20 up.

| Candidate | Prerequisites | Platform needed? | Blocked by | Verdict |
|---|---|---|---|---|
| **5.3 Assets & custody** | **0–5 and 4.1 — all built** | **No** | **Nothing for the core capability** | **Selected** |
| 10.1 Loans & advances | Compensation ✅ | No | Payroll has **no inbound instruction seam** — the same blocker as D-5.2-10, and loans are *mostly* that seam | Deferred |
| 11.1 Statutory & country packs | Broad | No | Cross-cutting framework touching every module that defers to it; highest blast radius in the product | Later, deliberately |
| 11.2 Offboarding & settlement | **Needs 5.3 custody** (AD-006) and statutory settlement | No | **Depends on this phase** | After 5.3 |
| 12 Benefits | Compensation ✅ | No | Nothing obvious, but no phase depends on it yet | Lower priority |
| 12.1 Medical & claims | Benefits | No | Depends on 12 | After 12 |
| 13.1 Engagement | Performance ✅ | No | Nothing depends on it | Lower priority |
| 17 Communications | **Benefits (12)**, and the delivery runner | **Yes** — Delivery Queue / Retries / Scheduled Message need the **Platform job runner (D-16E-03, BLOCKED)** | Platform | Blocked |

**5.3 is the lowest-numbered genuinely unbuilt phase whose prerequisites are all satisfied**, it needs
nothing from Platform, and **Offboarding explicitly depends on it** — so it is on the critical path
rather than beside it. It is also incrementally implementable: a catalogue, then custody, then
incidents, each useful alone.

## 4. Prerequisites — all satisfied

| Prerequisite | State |
|---|---|
| Phases 0–5 | Built. `employment` is 54 source files with a full status lifecycle |
| Phase 4.1 Documents | Built. 42 source files, document types, versions, verification, access trail |
| Employment reachable without coupling | **Precedent exists**: Relations reads `employment.read-employment` through a bounded service grant (ADR-0043) and learns one boolean |
| Tenant configuration pattern | `relation_violation_category`, `learning_mandatory_rule`, `attendance_policy` |
| Immutable-history pattern | `relation_case_event`, `letter_issued`, Attendance corrections |
| "At most one at a time" invariant | **Precedent exists**: `relation_investigation_open_idx`, a partial unique index (ADR-0071) |

## 5. Existing components to reuse — not rebuild

* **The bounded service grant** for reaching Employment — `RelationsEmploymentDirectory` is the
  template, and it returns a boolean rather than a record.
* **The partial unique index** for the AD-004 invariant (§7 below).
* **`app_protect_table`** for RLS, enabled and forced (ADR-0030).
* **The immutability trigger shape** for custody history.
* **`(sequence, code)` ordering** for a tenant-ordered catalogue (D-5.2-07).
* **Civil dates projected as text** — the defect Checkpoint 3 found; every date column must be named
  in its select rather than reached by `select *`.
* **Documents' `document_source` vocabulary** — a closed CHECK that will need an `assets` value if
  assets reference documents (§7, D-5.3-04).

## 6. Module ownership

A **new module, `@work/assets`**, following the modular monolith (ADR-0023):
`domain` · `application` · `infrastructure` · `contracts` · `api`, with `apps/api` owning transport.

`DOMAIN_OWNERSHIP.md` already reserves *"Asset, custody assignment | `assets` | Phase 5.3"*.

Nothing here belongs to an existing module: Employment owns the relationship, Documents owns files,
Payroll owns money, and none of them owns a laptop.

## 7. Decisions required from the owner — all OPEN

Six, and no more. Each is a **materially different architectural choice that existing precedent
cannot settle**; implementation details that precedent *does* settle are listed in §5 and are not
decisions.

### D-5.3-01 — What custody attaches to, when an employment ends · **OPEN**

AD-001 says custody references Employment, never Person. Employment's `ended` state is terminal and
*"somebody returning is a new employment"* (AD-004 of Phase 5). So when an employment ends with an
asset outstanding, the custody record points at a relationship that no longer exists.

**Options.** (a) Custody stays attached to the ended employment and outstanding items are read
through it. (b) Custody transfers to a person-level holding record. (c) Non-return closes the custody
with an outstanding marker and the asset returns to the pool.

**Materially different**, because (b) would put a *person* in this domain, which AD-001 forbids, and
(c) changes what "outstanding" means to Offboarding. **No precedent settles it.**

### D-5.3-02 — Whether acknowledgement can be by the employee · **OPEN**

The acceptance criteria say *"Employees … acknowledge receipt there"* in self-service.

**This is not implementable today**, and it is the same wall Phase 5.2 hit at D-5.2-13: ADR-0032
resolves a principal to a **tenant membership**, not an employment, so `read-own` is declared in ten
modules and **enforced in none**. An employee cannot be identified as the custodian of their own
asset.

**Options.** (a) Acknowledgement is recorded *on behalf of* the employee by an administrator, with
the acknowledger named — implementable now. (b) The capability waits for repository-wide
self-service routing. (c) Phase 5.3 builds that routing — which is a repository-wide change, not an
Assets one.

**Recommendation:** (a), with the limitation stated, exactly as Phase 5.2 handled the same gap. **Not
an approval.**

### D-5.3-03 — How a non-return deduction reaches Payroll · **OPEN**

AD-005: non-return *"produces an authorized deduction instruction for Payroll on approval. This
domain never computes payroll."*

**The blocker is known and unchanged**: Payroll is **pull-oriented and has no inbound instruction
seam**. Phase 5.2 recorded exactly this at D-5.2-10 and left it open rather than inventing one.

**Options.** (a) Assets publishes a bounded read of authorized deductions and Payroll consumes it
when Payroll decides to — no Payroll change, and no obligation created. (b) Payroll grows an inbound
command — inverts an established boundary. (c) Deduction is out of scope for the first checkpoints.

**Recommendation:** (c) for the first checkpoint and (a) thereafter. **Not an approval**, and it is
the same decision as D-5.2-10 in a second domain, which is itself an argument for taking them
together.

### D-5.3-04 — Whether an asset may reference a document · **OPEN**

The domain model gives `Asset` a `documents` field and the non-goals say *"Documents owns files; this
domain references them."*

`document_source` is a **closed CHECK vocabulary** with no `assets` value — the same obstacle
Phase 5.2 found for evidence (D-5.2-08) and left open.

**Options.** (a) Widen `document_source` by approved change and reference documents by identifier.
(b) Defer document references entirely to a later checkpoint. (c) Assets stores its own file
references — **rejected on sight**: it would put a second file boundary in the product.

### D-5.3-05 — Whether the condition scale is tenant vocabulary or a closed set · **OPEN**

AD-002 makes categories and rules tenant configurable; the domain model gives `AssetCategory` a
*"condition scale"*.

**Precedent points both ways**, which is exactly why this is a decision: `severity` on a violation
category is a **free tenant string that nothing orders by** (AD-002, D-5.2-06), while
`EMPLOYMENT_STATUSES` and the disciplinary actions are **closed and ordered**. A condition scale that
drives a deduction valuation is closer to the second; one that is only displayed is closer to the
first.

### D-5.3-06 — Whether liability and waiver adopt Workflow · **OPEN**

AD-006 requires a clearance waiver to carry *"a reason and an approval"*, and `AssetIncident` carries
a *"liability decision"*.

Workflow exists and publishes an approval model with an opaque `subjectType`. Phase 5.2 faced the
identical question at D-5.2-12 and left it open, issuing actions directly instead.

**Options.** (a) Adopt Workflow's existing `subjectType` — no Workflow change. (b) Record approvals
as Assets' own named-human decisions, as Relations does. (c) Defer waivers.

**Consistency matters more than the individual answer**: two domains approving things two different
ways is worse than either way chosen twice.

## 8. Explicitly *not* decisions

Recorded so no chain of planning documents forms — §16 of the authorization:

* **The AD-004 one-custodian invariant** — a partial unique index on
  `(tenant_id, asset_id) where custody is open`. `relation_investigation_open_idx` settles the shape;
  ADR-0071 settles why a read cannot.
* **Custody history immutability (AD-003)** — an append-only table with an unconditional trigger, as
  `relation_case_event` has.
* **RLS** — `app_protect_table`, enabled and forced.
* **Reaching Employment** — a bounded service grant returning a boolean.
* **Catalogue ordering** — `(sequence, code)`.
* **Audit of custody reads** — follow the module's own sensitivity; an asset is not a disciplinary
  record, so blanket auditing is *not* assumed and is a checkpoint-level judgement, not a decision.

## 9. Database scope, indicatively

Expected tables, none speculative, each earning its place:

| Table | Mutability | Notes |
|---|---|---|
| `asset_category` | mutable configuration | Tenant-ordered; the acknowledgement and return requirements |
| `asset` | mutable | Status lifecycle; serial number unique per tenant |
| `asset_custody` | **append-only** | The AD-004 partial unique index lives here |
| `asset_incident` | mutable until assessed, then frozen | Loss, damage, liability decision |

`ClearanceItem` is named in the specification as *"the projection Offboarding consumes"* — expected to
be a **derived read**, not a table, following D-5.2-16. Confirmed at checkpoint definition, not now.

## 10. Permissions, indicatively

Per-resource-per-capability, as every module does: catalogue read/manage, asset read/manage, custody
read/assign/return, incident record/assess. **No wildcard, no `assets.admin`.** The exact set is a
checkpoint-level judgement, and Phase 5.2 showed that inventing permissions ahead of the capability is
how a grant over nothing appears.

## 11. Audit · 12. RLS · 13. API · 14. Localization

* **Audit** — the repository's `created_by`/`updated_by`/`version` on every table. Whether *reads* are
  audited is a per-resource judgement: Relations audits reads because a violation is an allegation; an
  asset register is not, and blanket auditing would be the "audit every query" mechanism D-5.2-05
  rejected.
* **RLS** — enabled and forced on every table, verified as an unprivileged role, both directions.
* **API** — `apps/api` transport only. No `PUT`, `PATCH` or `DELETE`: things leave service by
  deactivation, and history is appended to.
* **Localization** — `en.json` and `ar.json`, both complete or the gate fails.

## 15. Testing strategy

Domain rules in isolation · application behaviour through the real dispatcher and real handlers ·
**real PostgreSQL** for RLS, unique constraints, immutability triggers and concurrency, with two real
connections and **no sleeps** · negative-space assertions for every boundary this phase could cross.

## 16. Negative-space constraints

Asserted, not promised: no Payroll write · no Employment mutation · no Person reference (AD-001) · no
storage adapter · no Platform scheduler · no fixed-asset accounting, depreciation or procurement · no
invented country rules · no wildcard permission · no persisted derived state.

## 17. Deferred scope

Fixed-asset accounting, depreciation, procurement (non-goals) · Offboarding clearance consumption
(11.2 owns the consumer) · Onboarding provisioning (7 owns it) · anything D-5.3-01…06 leaves
undecided.

## 18. Implementation checkpoints, proposed

1. **Asset catalogue and inventory** — categories and assets. Entirely inside the new module; depends
   on no open decision.
2. **Custody** — assignment, acknowledgement, return, and the AD-004 invariant. Needs D-5.3-01 and
   D-5.3-02.
3. **Incidents and liability** — loss, damage, assessment. Needs D-5.3-05, and D-5.3-06 if waivers
   are in scope.
4. **The clearance projection** — the read Offboarding will consume. Needs D-5.3-03 if deduction is
   in scope.

**Checkpoint 1 depends on no open decision** and could begin immediately on the owner's word.

## 19. Definition of Ready checklist

| # | Item | State |
|---|---|---|
| 1 | Phase selected from repository evidence, not ledger order | ✅ §3 |
| 2 | Prerequisites verified as built | ✅ §4 |
| 3 | No Platform dependency | ✅ §3 |
| 4 | No locked decision reopened | ✅ |
| 5 | Module owner clear | ✅ §6 |
| 6 | Reusable precedent identified | ✅ §5 |
| 7 | Decisions recorded as OPEN, none inferred | ✅ §7 |
| 8 | Non-decisions recorded so no planning chain forms | ✅ §8 |
| 9 | Database scope indicative, nothing speculative | ✅ §9 |
| 10 | Negative space defined | ✅ §16 |
| 11 | Incremental checkpoints, first one unblocked | ✅ §18 |
| 12 | **Owner approval of D-5.3-01…06** | ⏳ **Pending** |

**Checkpoint 1 is ready to implement on the owner's word.** Checkpoints 2–4 need the decisions above,
and three of them — D-5.3-02, D-5.3-03, D-5.3-06 — are the *same questions* Phase 5.2 left open at
D-5.2-13, D-5.2-10 and D-5.2-12. **They should be taken together**, in whichever domain the owner
prefers to settle them, because answering them differently in two modules is worse than either answer.
