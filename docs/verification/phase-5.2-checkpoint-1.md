# Phase 5.2 — Checkpoint 1 · Violation Catalogue & Violation Recording

**Status** Implemented · **Date** 2026-08-22 · **Baseline** `d5c24b7`

The first Employee Relations capability: a tenant defines the violation types its disciplinary policy
recognises, and an authorized user records that one occurred, against an employment — **immutably**,
and with **every read of the record audited**.

---

## 1. Objective

Deliver the foundation of the `relations` module: real, usable functionality that a tenant can
operate, without touching any decision that remains open and without depending on anything Platform
owns.

## 2. Approved scope

Owner approval of 2026-08-22 authorized exactly **Violation Catalogue & Violation Recording**, with
an exclusion list restated in the instruction. Everything on that list is absent, and §16 says how
that is proved rather than promised.

## 3. Decisions relied upon

| Decision | Resolution as approved | As built |
|---|---|---|
| **D-5.2-03** | the existing database immutability trigger pattern | `app_relation_violation_immutable()` + `app_relation_access_immutable()`, modelled on `app_document_access_immutable()` |
| **D-5.2-04** | the narrowest `relations.*` set | four: `category.read`, `category.manage`, `violation.read`, `violation.record` |
| **D-5.2-05** | the existing audited-read pattern | `relation_violation_access_event`, after `document_access_event` |
| **D-5.2-06** | the existing country-pack discriminator/version pattern | `source` + nullable `country_pack_id` / `country_pack_version`, after `attendance_policy` and `document_type` |
| **D-5.2-07** | an explicit deterministic sequence, persisted as data | `sequence` integer; ordering `(sequence, code)`; **no ladder execution** |
| **D-5.2-14** | Checkpoint 1 as scoped | as delivered |

**D-5.2-01 and D-5.2-02 remain settled. D-5.2-08 through D-5.2-13 are untouched and remain `OPEN`** —
none was needed. **No Phase 16D or 16E decision was reopened.**

## 4. Implementation

New module `@work/relations` at `packages/modules/relations/src/{domain,application,infrastructure,contracts,api}`,
with `apps/api/src/relations/` owning transport, composition and the one cross-module adapter.

**Commands** — `relations.define-category`, `relations.amend-category`, `relations.record-violation`.
**Queries** — `relations.categories`, `relations.read-violation`, `relations.violations`.
**Routes** — `GET|POST /v1/relations/categories`, `POST /v1/relations/categories/:id`,
`GET|POST /v1/relations/violations`, `GET /v1/relations/violations/:violationId`.

## 5. Schema

One additive migration, `20260822100000_relations_violations`. **Three tables, not the four the plan
estimated** — see §15.

| Table | Purpose |
|---|---|
| `relation_violation_category` | the tenant's catalogue; amendable, deactivatable, never deleted |
| `relation_violation` | the recorded violation; **immutable at the database** |
| `relation_violation_access_event` | who read which record; **immutable at the database** |

Indexes: `relation_violation_category_code_idx` (unique, per tenant, partial on `deleted_at is null`) ·
`relation_violation_category_order_idx` · `relation_violation_employment_idx` ·
`relation_violation_category_ref_idx` · two on the access trail (by violation, by actor).

Constraints: code shape · non-blank severity · non-negative `sequence` and `repeat_window_days` ·
`source` vocabulary · **`pack_shape_check`**, which requires a `country_pack` row to name its pack and
forbids a `tenant` row from naming one · pack version ≥ 1 · `state in ('reported')` · description
length 1…4000 · FK to the category · FK from the access event to the violation.

**There is no cross-module foreign key.** `employment_id` references Employment's table conceptually
and not in SQL: a schema-level FK between two modules couples what the modular monolith separates.
Existence is confirmed through Employment's published read before the insert.

## 6. Domain

`ViolationCategory` — code, bilingual name, tenant-chosen `severity`, `sequence`, `repeatWindowDays`,
`source`, pack provenance, `active`. `Violation` — employment, category reference **plus a frozen copy
of the code and severity**, `occurredOn`, `reportedBy`, description, state, `recordedAt`.

Two rules carry the phase's weight:

**The frozen copy is AD-003.** A catalogue entry may be renamed or re-graded; a record whose meaning
changed because somebody edited a dropdown two years later is not evidence. The same reason a letter
freezes its substituted values and a running approval keeps the manager it started with.

**`severity` is deliberately not a closed set.** AD-002 says nothing is hardcoded, and a fixed list
would be this product deciding what "gross misconduct" means for every customer in every
jurisdiction. Nothing orders by it — ordering is `sequence`, which is data (D-5.2-07).

Refusals, each by name: `category_code_malformed` · `category_name_incomplete` ·
`category_severity_missing` · `category_sequence_invalid` · `category_repeat_window_invalid` ·
`category_source_unknown` · `category_pack_source_needs_pack` · `category_tenant_source_has_pack` ·
`category_pack_version_invalid` · `category_inactive` · `occurred_on_malformed` ·
`occurred_on_in_future` · `description_missing` · `description_too_long` · `reporter_unknown` ·
`access_actor_unknown` · `access_correlation_unknown`.

## 7. Permissions

Four, exactly: `relations.category.read` · `relations.category.manage` · `relations.violation.read` ·
`relations.violation.record`.

**AD-007 — restricted independently of ordinary employee access — is asserted, not asserted-to.** The
authorization suite tries fourteen permissions from other modules (`employee.read`,
`employment.read`, `document.read-sensitive`, `workflow.instance.read`, `payroll.run.manage`, …) and
five wildcards (`*`, `relations.*`, `relations.violation.*`, `relations.category.*`, `relations`), and
each opens nothing. The composition suite asserts no handler declares a permission belonging to any
other module.

## 8. API

DTOs refuse three things a caller must never send: **no `tenantId`** anywhere; **no reporter, actor or
author**; **no recording instant**. Each is taken from the execution context.

No `PUT`, no `PATCH`, no `DELETE` — asserted. The only collection read of violations takes an
employment; there is **no tenant-wide listing**, because a query returning every disciplinary matter
in an organisation is a watchlist rather than a case file. Errors go through the shared
Problem Details mapping, where a record in another tenant is **404 and never 403** — a 403 on a
violation identifier would confirm the record exists and make the identifier a probe.

## 9. RLS and tenancy

All three tables `app_protect_table`'d — **enabled and forced** (ADR-0030), asserted from `pg_class`.

Proved against real PostgreSQL as an **unprivileged role holding no `BYPASSRLS`**: tenant A cannot
read tenant B's catalogue (**with B's row confirmed to exist**, so the zero is a policy filtering
rather than a row never written), cannot read B's violation by identifier, cannot list B's violations
**even knowing the employment identifier**, and cannot write into B's rows in either table. Isolation
is proved in both directions.

## 10. Audit

`relation_violation_access_event`, written **inside the read's own transaction** — if the trail cannot
be written, the read does not happen.

- `relations.read-violation` writes one `violation_read`.
- `relations.violations` writes one `violation_listed` **per record disclosed**, not one per query:
  AD-007 audits reads *of a record*, and a single event per page would leave which records were seen
  unanswerable. The page is bounded, so the write is bounded with it.
- **Catalogue reads write nothing.** A catalogue names nobody; auditing it would be the "audit every
  query" mechanism the approval forbids.
- A miss writes nothing, so an identifier cannot be used to write into the trail. A refused caller
  writes nothing, because no handler ran.
- The row carries **no employment, category, severity or description** — asserted on its exact key
  set. Copying those in would make the audit table a second, less-guarded copy of what it audits.

## 11. Concurrency

`relation_violation_category_code_idx` settles two administrators defining one code at the same
moment. The use case checks first for a **readable** refusal; the index is what actually decides,
because a `select` followed by an `insert` is not idempotent under concurrency (ADR-0071).

Proved with **two real connections overlapping in time, no sleeps**: the loser blocks on the index,
raises, and exactly one row survives. `sequence` is deliberately **not** unique — a tenant must never
be forced to renumber a catalogue to insert an entry into it, and `(sequence, code)` is deterministic
without it.

## 12. Localization

`packages/modules/relations/locales/{en,ar}.json`, both complete from the first commit — 18 catalogue
sets now check complete. Category names are bilingual **in the row**, and the domain refuses an entry
named in only one language: a category named only in English is a dropdown an Arabic-speaking
administrator cannot read, and it is the dropdown somebody picks from while recording a disciplinary
matter.

## 13. Tests

| Suite | Tests |
|---|---|
| `domain/relations-domain.test.ts` | 35 |
| `application/relations-lifecycle.test.ts` | 16 |
| `application/relations-authorization.test.ts` | 42 |
| `application/relations-boundaries.test.ts` (negative space) | 63 |
| `infrastructure/relations-isolation.integration.test.ts` | 9 |
| `infrastructure/relations-immutability.integration.test.ts` | 7 |
| `infrastructure/relations-constraints.integration.test.ts` | 16 |
| **`@work/relations` total** | **188** |
| `apps/api` `relations.composition.spec.ts` | 17 |
| `apps/api` `relations.routes.spec.ts` | 9 |

Every integration suite runs against real PostgreSQL and refuses to skip in CI.

## 14. Gates

| Gate | Result |
|---|---|
| `pnpm standards` | **PASS** — no violations · 179 models · 18 catalogue sets · 1,795 files, no cycles, no unused dependencies |
| `pnpm format:check` | **PASS** |
| `prisma validate` | **PASS** |
| `prisma migrate status` | **PASS** — 26 migrations, up to date, **no drift** |
| `turbo run build lint typecheck test --force --concurrency=1` | **PASS** — **112 tasks, 112 successful, 0 cached, 12m30s** |

**Turbo's own exit code was `0`**, taken from the process itself: the wrapper ends in `exit $code` so
the shell cannot report success while turbo failed. It was not read from `tail`, `grep`, `head` or
`tee`.

**Counts across the repository at the verified commit:** `@work/relations` **188**, `@work/api`
**803**, `@work/workflow` 902, and every other package green. **No failures. No skips. No `.only`. No
new `any`. No lint suppression. No migration drift.**

## 15. Deviations, and why

**Three tables, not four.** The plan estimated a `relation_violation_history` transition log. In
Checkpoint 1 a violation is created in `reported` and is immutable, so **there are no transitions to
log** — the row's own `created_at` / `created_by` is the record of its creation. Building it now would
be a speculative table for a later checkpoint, which §9 of the instruction forbids and ADR-0070's
reasoning warns against. It arrives with the lifecycle that produces transitions.

**Fields the instruction listed that the specification does not put on this entity**, omitted rather
than added because "do not add fields simply because they seem useful": `description` (the
specification puts it on `Violation`, not on the category) and `category` (the entity *is* the
category). `repeat_window_days` **is** included — the specification names it — and nothing reads it
yet, which is stated rather than implied.

**`reportedBy` is the authenticated caller.** Where an HR administrator records a matter a supervisor
raised, this field is the administrator. A caller-supplied reporter would be the "arbitrary actor
identity" §11 forbids; a separate *raised-by* attribution is a later decision rather than something to
invent here.

**`civilDateOf` uses UTC.** Near midnight in a tenant far from UTC, "today" here may differ from
"today" there by a day, so conduct reported on the local evening could be refused as future-dated.
Reading a tenant's time zone means a cross-module contract with Organization that Checkpoint 1 was not
authorized to open. **Recorded as a known limitation**, not worked around.

**The first full-gate run was red, and the wrapper reported green.** The command ended in
`echo "TURBO_EXIT=$?"`, so the *shell* exited 0 while turbo had exited 1 — exactly the trap of reading
a pipeline's status instead of the tool's. The echoed line said `TURBO_EXIT=1`, and the failure was
real: `ViolationState_` tripped the naming-convention rule. The wrapper now ends in `exit $code` so the
two cannot disagree, and the interface was **renamed** to `ViolationRecord` rather than exempted —
`ViolationState` was already the lifecycle state, and a trailing underscore to separate two types is
the shortcut the rule exists to catch. (A follow-on: the word "hack" in the explanatory comment then
tripped `no-warning-comments`, and was reworded rather than suppressed.)

**Three defects the tests caught before the gate**, each fixed at the source:
`version` was emitted in the values maps and collided with `updateRow`'s own `version = version + 1`
(the repository convention is that `version` never appears in a values map — now stated in the
mapper); a constraints-suite helper reused one catalogue code and made a description-length assertion
pass for the wrong reason; and an unknown `source` is caught by `pack_shape_check` **before**
`source_check`, so the assertion was made exact about which constraint fires rather than loosened.

**A pre-existing flaky test was observed in Documents, and deliberately not touched.**
`documents-concurrency.integration.test.ts > lets two simultaneous supersessions produce one stamp`
fires two `supersede` calls concurrently — one stamping `11:00`, one `12:00` — and then asserts the
survivor is **`11:00`**, i.e. that the first-listed promise won the race. Whichever transaction takes
the row lock first stamps and the other finds nothing to stamp, so the surviving value is a scheduling
tie-break rather than a property: the same class of thing Workflow's own suite declines to pin.

**It is not a regression from this checkpoint.** Documents passed 92/92 on an earlier full-gate run
with this entire change set present, passes 3/3 in isolation, and **no Documents file appears in this
diff**. It is recorded here rather than fixed, because §19 puts unrelated modules out of scope — the
honest action is to report it, not to edit another module's suite to make this gate green.

**One assertion in Workflow went stale and was narrowed, not deleted.**
`workflow-schema-boundaries.integration.test.ts` asserted that `directories.at(-1)` — the newest
migration in the **whole repository** — was Workflow's reminder. That held only while Workflow was the
newest phase in the product, so Phase 5.2's migration broke it with nothing about Workflow changing.
The property worth protecting is that **no sixth Workflow migration exists and the reminder is still
the last of Workflow's**, and the assertion now says exactly that. It is *more* exact than the
original: another module adding a migration is none of that suite's business, and a new Workflow
migration still fails there. **This is the only file outside `relations` whose behaviour was touched,
and no Workflow behaviour changed.**

**Two assertions were narrowed from substrings to concepts**, never weakened: `active` matched inside
`includeInactive` (a query-string flag a controller legitimately parses), and `ViolationRecorded` — the
command's *result* type, named by the repository's `DocumentTypeDefined` convention — collided with
the specification's event of the same name. The event boundary is now asserted **structurally**: the
module registers no event handlers and reaches no event machinery.

## 16. Non-goals — absent, and proved absent

The negative-space suite asserts, against comment-stripped source, that this module contains **no**
`Investigation` · `DisciplinaryAction` · `Warning` · `Grievance` · `Appeal` · `Penalty` · `Hearing` ·
`Evidence` · `Attachment` · `Termination`; **no** `JobPort` · `setInterval` · `setTimeout` · cron ·
scheduler · worker · outbox · broker · queue · notification port · SMTP/email/SMS; **no** storage of
any kind; **no** jurisdiction, statute or legal limit; **no** persisted derived temporal state; **no**
reach into People; **no** duplicated manager resolution; **no** `tenantId` from a caller; and **no**
command that could change or remove a recorded violation. The `ViolationStore` interface itself offers
no `update` and no `remove`, so crossing that boundary requires changing the port first.

**No Admin UI was built** — the plan defers it, and the instruction says not to build one where the
scope defers it.

## 17. Remaining Phase 5.2 scope

**Not started, and not claimed complete:** investigations · the penalty ladder · disciplinary actions
and structural due process · warnings and escalation counting · grievances · appeals · evidence
attachment (D-5.2-08) · warning expiry (D-5.2-09) · the Payroll penalty contract (D-5.2-10) · the
Employment termination recommendation (D-5.2-11) · Workflow approval adoption (D-5.2-12) · grievance
confidentiality (D-5.2-13) · Admin screens.

Eight decisions remain `OPEN`. Two acceptance criteria of the phase remain unmeetable in this
repository today and are recorded rather than approximated: categories *"constrained by country pack"*
(Phase 11.1 unbuilt) and the `WarningExpired` event (the job runner is Platform's).
