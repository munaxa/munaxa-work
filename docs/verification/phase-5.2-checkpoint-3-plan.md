# Phase 5.2 · Checkpoint 3 — Definition of Ready

*Prepared 2026-08-23 against `2a2950c`. Planning only: no schema, no production code, no test for new
behaviour changed by this document.*

---

## 1. Checkpoint identity

**Escalation context — repeat-violation counting within the configured window.**

Module `@work/relations`. Third checkpoint of Phase 5.2, after the violation catalogue (Checkpoint 1),
violation recording (Checkpoint 1) and the investigation lifecycle (Checkpoint 2).

## 2. Objective

Answer one question, from records this module already holds: **is this the employment's first
violation of this category, or its third?** — counted within the window the tenant configured on the
catalogue entry.

## 3. Business value

Nobody decides a disciplinary outcome without knowing whether the conduct is repeated. Today the
product cannot answer that: an administrator reads a list of violations and counts by eye, per
category, against a window they must remember. This is the fact every subsequent capability in Phase
5.2 consumes — the ladder, the action, the appeal — and it is the smallest one that is useful before
any of them exists.

It also closes a real defect. `repeat_window_days` has been tenant-configurable since Checkpoint 1
and **nothing reads it**: it reaches the domain, the view and the API and is used by no logic
anywhere. That is exactly ADR-0070's *"a stored flag that nothing maintains is worse than no flag"* —
a customer configures a 180-day window today and nothing in the product behaves differently.
Checkpoint 3 makes the setting mean something. (Recorded as D-5.2-20.)

## 4. Scope

1. **A derivation**: for one employment and one category, the count of prior violations whose
   `occurred_on` falls within `repeat_window_days` of a reference civil date, and the occurrence
   ordinal of a given violation.
2. **One query**, `relations.escalation-context`, taking an employment and a category, returning the
   count, the window applied, the reference date and the bounded list of contributing violation
   identifiers.
3. **Enrichment of the existing violation read** with its own occurrence ordinal.
4. Audit of both, through the existing access trail.
5. Localization, English and Arabic.

## 5. Explicit non-goals

Not built, and each for a stated reason:

| Not built | Why |
|---|---|
| **The penalty ladder** | D-5.2-20, OPEN. Its output is a disciplinary action type that does not exist. |
| **Disciplinary actions, warnings** | Later checkpoint; needs due process (AD-008) and Letters. |
| **Warning expiry (AD-006)** | No warning exists to expire. |
| **Grievances** | D-5.2-13 — `read-own` is unimplementable under ADR-0032. Avoided deliberately. |
| **Appeals** | Nothing to appeal until an action exists. |
| **Evidence attachments** | D-5.2-08, OPEN. No `StoragePort` adapter exists anywhere. |
| **Payroll penalties** | AD-004 needs an action first. |
| **Termination recommendations** | AD-005 needs an action first. |
| **A stored count, or any `escalation_*` table** | The count is derived. See §9. |
| **A new lifecycle state** | Counting moves no case. |
| **Investigation permissions (D-5.2-18)** | Recommended, not approved. Not required here. |
| **Investigation correction (D-5.2-19)** | Recommended, not approved. Not required here. |
| **Scheduler, worker, timer, cron, `JobPort`** | Nothing here is scheduled. |
| **Any generic state-machine framework** | Forbidden by D-5.2-16 and asserted against. |

## 6. Decisions required before implementation

**None.** No OPEN decision blocks this checkpoint — which is the principal reason it was chosen.

D-5.2-18, D-5.2-19 and D-5.2-20 are all recommended-but-unapproved and all avoided by scope. If the
owner approves D-5.2-18 before this checkpoint ships, the escalation query's permission would be
reconsidered; it does not otherwise interact.

## 7. Decisions not required

D-5.2-03 · 04 · 05 · 06 · 07 · 14 · 15 · 16 · 17 — all approved, none reopened, none modified.
`relation_violation` stays immutable, `relation_case_event` stays immutable, current case state stays
derived, transitions stay explicitly validated.

## 8. Domain ownership

Entirely **Relations**. The count is over `relation_violation` and `relation_violation_category`,
both Relations-owned. No other module owns any part of this fact and none is asked anything new:
Employment is not consulted (the violations are already filed against a known employment), Identity is
not consulted, People is never reached (AD-001).

## 9. Data model

**No new table, and no new column.**

This is the design, not an omission. Every input already exists: `relation_violation.occurred_on`,
`relation_violation.violation_category_id`, `relation_violation.employment_id` and
`relation_violation_category.repeat_window_days`. A count derived from them is correct the moment a
violation is recorded; a stored count is correct until somebody records one and forgets to update it.
The same argument D-5.2-16 made for case state applies unchanged, and §11 of the authorization asks
for exactly this preference.

**Rejected candidate — `relation_escalation_count`.** A speculative table. It would need maintaining
on every violation insert, would disagree with the violations the first time that failed, and would
answer no question the derivation cannot.

**One index is likely required** and is the only schema change contemplated:

| Item | Detail |
|---|---|
| Owner | Relations |
| Purpose | Serve the count predicate `(tenant_id, employment_id, violation_category_id, occurred_on)` |
| Existing | `relation_violation_employment_idx` is `(tenant_id, employment_id, occurred_on, id)` — it does **not** lead with the category |
| Decision | **Measure before adding.** If the existing index serves the query at realistic row counts, add nothing. |
| Mutability | n/a | 
| RLS | Unchanged — `relation_violation` is already enabled and forced |
| Audit | Unchanged |
| Deletion | n/a |

If measurement shows an index is needed, it is additive, creates no table, and touches no trigger.

## 10. Commands

**None.** This checkpoint adds no command. It changes no state, so it needs none.

## 11. Queries

| Query | Input | Returns |
|---|---|---|
| `relations.escalation-context` | `employmentId`, `violationCategoryId`, optional `asAt` civil date | `{ occurrences, windowDays, windowFrom, asAt, violationIds[] }` |
| `relations.read-violation` *(extended)* | unchanged | plus `occurrence` — this violation's ordinal within its own window |

`asAt` defaults to the server's civil date. It is a *reference date for the window*, not a recording
timestamp: it cannot backdate anything because nothing is written.

`violationIds` is bounded by the same page limits the module already enforces and carries identifiers
only — no description, no reporter, nothing about the person.

## 12. Permissions

**`relations.violation.read`. No new permission.**

The escalation count is an aggregate over violations the caller may already read one at a time; a
separate grant would protect a fact the existing grant already discloses. Consistent with §11 of the
authorization — no new permission unless the repository proves it unavoidable, and it does not.

No wildcard. No role logic. No new authorization engine. No `PermissionChecker` is required, so
`RelationsDependencies` is unchanged.

## 13. API

One route, on the existing violations controller prefix:

```
GET /v1/relations/violations/escalation?employmentId=…&violationCategoryId=…&asAt=…
```

No body, no mutation, no `tenantId`, no actor, no timestamp a caller can set. The extension to
`GET /v1/relations/violations/:violationId` is an added response field only — additive, no breaking
contract change.

## 14. RLS

Unchanged. `relation_violation` and `relation_violation_category` are already `enable` **and**
`force` row-level security under `app_protect_table` (ADR-0030). The count runs inside the caller's
tenant context, so a violation in another tenant is not counted because it is not visible — not
because a predicate excludes it.

A tenant-isolation test must assert that a second tenant's violations do not contribute to a count,
against a real database and as an unprivileged role.

## 15. Audit

An escalation read discloses how many disciplinary matters an employment has, which is a disciplinary
disclosure under AD-007 and is audited.

**A new access action, `escalation_read`**, added to the existing vocabulary and CHECK — the same
additive widening Checkpoint 2 performed for `investigation_read`. One event per query, keyed to the
employment's contributing violations, written inside the read's own transaction so a read whose trail
cannot be written does not return. A query that matches nothing writes nothing, so identifiers cannot
be used to write into the trail by guessing.

## 16. Immutability

Nothing here writes a business record, so nothing here can rewrite one. The access trail it appends to
is already trigger-immutable.

The negative-space suite must gain an assertion that no escalation result is persisted — no
`escalation` column, no cached count, no projection.

## 17. Concurrency

**No new concurrency surface.** No write, therefore no race. A violation recorded concurrently with a
count is either committed before the read's snapshot or not; both answers are correct as of the
instant asked, and the response carries `asAt` so the answer is self-describing.

No `select`-then-`insert` pattern is introduced, so ADR-0071 has nothing to arbitrate here.

## 18. Localization

`en.json` and `ar.json`, both complete or `check-localization.mjs` fails:
labels for occurrence, window, first/repeat occurrence; a notice that the window is tenant
configuration and carries no legal meaning; rejection keys for a malformed or future `asAt` and an
unknown category.

## 19. Cross-module contracts

**None — no new contract, in either direction.** No module is asked anything new and no module is
given anything new. The two adapters Relations already holds (`EmploymentDirectoryPort`,
`MembershipDirectoryPort`) are not used by this checkpoint.

## 20. Platform dependencies

**None.** Nothing is scheduled, so the blocked Platform job runner (D-16E-03) is not required, not
referenced, and not waited on.

## 21. Country-pack boundary

**D-5.2-06 preserved. No jurisdiction-specific rule is introduced.**

`repeat_window_days` is **tenant configuration**, not statute. Counting within it is arithmetic over
the tenant's own setting and asserts nothing about what any labour law permits.

**Enforcement status: `NOT VERIFIED`.** Many jurisdictions constrain how far back prior conduct may
count and what a repeat may attract. This checkpoint enforces none of that, claims none of it, and
defers it to Phase 11.1. No pack exists — `packages/country-packs` still exports nothing.

## 22. Evidence / storage boundary

**Not required. `StoragePort` stays deferred (D-5.2-08, OPEN, not reopened).**

Counting reads dates and identifiers. It opens no attachment and reaches no bytes. No adapter is
implemented, referenced or planned, and the negative-space suite's existing storage assertions stay
exactly as they are.

## 23. Payroll boundary

**Not required, and deferred.** No penalty is computed, authorized or instructed. AD-004 arrives with
disciplinary actions.

The pull-oriented architecture is preserved and untested by this checkpoint: **no inbound Payroll
command, no Relations write to Payroll, no duplicate payroll calculation.** When AD-004 does arrive,
the evidence from Checkpoints 1–2 says Payroll should consume a bounded Relations read rather than
Relations instructing Payroll — Payroll has no inbound instruction seam, and creating one would invert
an established boundary.

## 24. Workflow boundary

**Workflow requires no modification. Stated explicitly, as asked.**

Nothing in this checkpoint is approved, routed or escalated. No workflow instance is started, no
`subjectType` is registered, and **no second approval mechanism is created**. Workflow ownership is
untouched and no new contract is needed.

## 25. Migration plan

Expected: **one migration, and possibly none.**

If measurement shows the existing index suffices, the only migration is the additive widening of
`relation_violation_access_event_action_check` for `escalation_read` — the same one-statement pattern
Checkpoint 2 used. If an index is needed, it is added in the same migration.

No table is created, no column is added to an existing table, no trigger is created or altered, no
CHECK is narrowed, and no data is backfilled. Forward-only, consistent with every migration in this
repository.

## 26. Test plan

**Domain** — the window arithmetic: inclusive boundary at exactly `windowDays` ago, exclusive beyond
it, zero-window behaviour, a violation on the reference date itself, ordinal numbering with ties on
`occurred_on` broken deterministically.

**Application** — counts scoped to one employment *and* one category, so a different category does
not contribute; an inactive catalogue entry still counts historic violations; permission enforcement;
refusal outside a tenant context; the access event written on a hit and **not** on a miss.

**Integration (real PostgreSQL, unprivileged role)** — tenant isolation of the count; the audit row
written inside the read's transaction; `asAt` behaviour across a window boundary.

**Negative space** — no persisted count, no `escalation` column, no projection, no scheduler, no new
permission, no ladder vocabulary, no disciplinary action type, no jurisdiction name.

## 27. Verification gates

`pnpm standards` · `pnpm format:check` · `prisma validate` · `prisma migrate status` ·
`pnpm exec turbo run build lint typecheck test --force --concurrency=1`, with **turbo's own exit code
captured directly** — never a trailing command's, and never a pipeline's.

## 28. Risks

| Risk | Mitigation |
|---|---|
| A count read as a legal threshold | Localized notice: tenant configuration, no legal meaning; `NOT VERIFIED` recorded |
| Window arithmetic near a boundary | Civil-date arithmetic, inclusive boundary asserted explicitly in both directions |
| The UTC "today" limitation inherited from Checkpoints 1–2 | Same limitation, restated not hidden; `asAt` lets a caller be explicit |
| Query cost as violations accumulate | Measure before indexing; add only if measurement shows the need |
| Scope creep into the ladder | D-5.2-20 records the line; a negative-space test asserts no action vocabulary appears |

## 29. Rollback considerations

The lowest-risk checkpoint of the three so far. No table, no trigger, no state, no destructive
statement. Rolling back is removing a query, a route and a localization block; the only migration is
an additive CHECK widening, and rows written under it are audit events that the module tolerates
without interpreting. **No data is lost by reverting, because no business data is created.**

## 30. Definition of Ready checklist

| # | Item | State |
|---|---|---|
| 1 | Checkpoint identified and justified against alternatives | ✅ §1, §3 |
| 2 | Business value stated | ✅ §3 |
| 3 | Scope bounded | ✅ §4 |
| 4 | Non-goals explicit, each with a reason | ✅ §5 |
| 5 | No OPEN decision blocks it | ✅ §6 |
| 6 | No approved decision reopened | ✅ §7 |
| 7 | Domain ownership unambiguous | ✅ §8 |
| 8 | Data model minimal; speculative tables rejected | ✅ §9 |
| 9 | Commands and queries named | ✅ §10, §11 |
| 10 | Permissions decided, no new one needed | ✅ §12 |
| 11 | API surface defined | ✅ §13 |
| 12 | RLS unchanged and asserted | ✅ §14 |
| 13 | Audit defined | ✅ §15 |
| 14 | Immutability preserved | ✅ §16 |
| 15 | Concurrency analysed | ✅ §17 |
| 16 | Localization planned, both languages | ✅ §18 |
| 17 | Cross-module contracts: none | ✅ §19 |
| 18 | Platform dependencies: none | ✅ §20 |
| 19 | Country-pack boundary preserved, enforcement `NOT VERIFIED` | ✅ §21 |
| 20 | Evidence/storage deferred | ✅ §22 |
| 21 | Payroll boundary preserved | ✅ §23 |
| 22 | Workflow requires no modification | ✅ §24 |
| 23 | Migration plan forward-only and additive | ✅ §25 |
| 24 | Test plan covers domain, application, integration, negative space | ✅ §26 |
| 25 | Gates named, turbo exit code captured directly | ✅ §27 |
| 26 | Risks identified with mitigations | ✅ §28 |
| 27 | Rollback considered | ✅ §29 |
| 28 | Confidentiality architecture not required | ✅ §5, D-5.2-13 avoided |
| 29 | No scheduler, worker, timer or `JobPort` | ✅ §5, §20 |
| 30 | Owner approval required before implementation | ⏳ **Pending** |

**Ready to implement on the owner's word.** Nothing in this checkpoint waits on a decision; row 30 is
the authorization itself, not a dependency.

---

## Why this checkpoint, and not the others

Every remaining Phase 5.2 capability was assessed against repository evidence:

| Candidate | Repository dependencies | Unresolved decisions | External | Verdict |
|---|---|---|---|---|
| **Escalation counting** | **None — Relations only** | **None** | **None** | **Selected** |
| Disciplinary actions | Letters, Workflow, Payroll, Employment | AD-008 due process undesigned; D-5.2-20 | Four modules | Largest remaining; needs the count first |
| Warnings + expiry | Requires an action to issue | AD-006 validity rules | — | Depends on actions |
| Penalty ladder | Requires action vocabulary | **D-5.2-20** | Country pack | Cannot be specified honestly yet |
| Due process | Workflow approvals, notice, hearing | AD-008 wholly undesigned | Workflow | Needs actions to gate |
| Grievances | **`read-own` unimplementable (ADR-0032)** | **D-5.2-13** | Platform authorization | Explicitly avoided |
| Appeals | Requires an issued action | — | Workflow | Depends on actions |
| Evidence | **No `StoragePort` adapter exists** | **D-5.2-08** | Storage | Deferred |
| Payroll integration | Requires a penalty | AD-004 | Payroll | Nothing to instruct |
| Termination recommendation | Requires an action | AD-005 | Employment | Depends on actions |

Escalation counting is the only remaining capability that is implementable entirely inside Relations,
depends on no unresolved decision, requires no cross-module contract, needs nothing from Platform,
and is a prerequisite of the largest remaining capability rather than a dependant of it.
