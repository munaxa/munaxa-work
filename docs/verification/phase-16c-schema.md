# Phase 16C — Checkpoint 3 — Schema

**Schema only.** No application handler, command, query, permission, repository, API route, Admin
screen or cross-module adapter. No completed module was touched, and no Identity or Organization
change was needed.

One migration: `20260816100000_workflow_routing_resolution`. It is the twenty-third in the repository
and the third belonging to Workflow.

---

## The two findings that shaped it

**The manager needed no column.** A `manager` template names nobody — whose manager it means is the
requester, fixed rather than configured (P-1) — so there is no target to store. The resolved person
lands in `workflow_step.approver_membership_id`, exactly where a group's members land. A running
approval therefore still names a concrete membership and depends on no live organizational lookup,
which is the 16B invariant this had to preserve rather than a coincidence.

**`workflow_step_template_approver_check` did not have to change**, and that is worth reading twice.
16B wrote it as two biconditionals — `(kind = 'membership') = (membership_id is not null)` and
`(kind = 'group') = (group_id is not null)` — rather than as a list of permitted shapes. For
`manager` both sides of both are false, so a template with **neither** identifier satisfies it and one
carrying **either** violates it. That is precisely the approved rule, enforced by a constraint written
a phase earlier for a different vocabulary. A disjunction would have needed editing; a biconditional
generalized for free. Two probes prove it rather than leaving it to be inferred.

---

## What changed

| Object | Change |
| --- | --- |
| `workflow_step_template_approver_kind_check` | **replaced**, strictly wider: `membership`, `group`, `manager` |
| `workflow_step_template.service_level_count` | new, `integer`, nullable |
| `workflow_step_template.service_level_unit` | new, `varchar(8)`, nullable |
| `workflow_step_template_service_level_check` | new: both-or-neither, count ≥ 1, unit in (`hours`, `days`) |
| `workflow_step.service_level_count` | new, `integer`, nullable — copied at instance start |
| `workflow_step.service_level_unit` | new, `varchar(8)`, nullable — copied at instance start |
| `workflow_step_service_level_check` | new, the same three rules |
| `workflow_step.awaiting_at` | new, `timestamptz`, nullable |

Two tables altered, both Workflow's own. **No table created, no column dropped, no index changed, no
row touched.** The one replacement is a strict widening — the shape of change that cannot lose a row
that was legal before.

`workflow_step_approver_kind_check` is untouched and still enumerates `membership` alone: a group is
resolved into its members and a manager into one membership *before* a step row exists, so at the
moment somebody is actually asked there is only ever a person.

---

## Why `awaiting_at`, and why not `due_at`

**`awaiting_at` is the one genuinely new fact.** A target is meaningless without the instant it counts
from, and the approved rule is that the clock starts when *this step* becomes awaiting rather than
when the approval started (P-5). For a sequential chain the third step's clock starts when the second
is answered; for a parallel branch every step starts its own when the branch opens. Neither is
derivable from `workflow_instance.started_at`.

**`workflow_history` already records the instant**, as `(event = 'step-awaiting', step_id,
occurred_at)`, and it stays there as the narrative. It was not reused as the operative input for two
reasons. History is an **audit log**: making it load-bearing for a live computation would mean a
routing answer depended on a record whose purpose is to describe what happened, and neither 16A nor
16B ever reads it to decide anything. And it is a row in another append-only table that grows without
bound, so every overdue reading would join per step — on a read that is a queue somebody opens every
morning.

**No `due_at`, and no `expired`.** Due-ness is derived from the target, the awaiting instant and an
explicit reading instant, every time it is asked. A stored due time would disagree with its own inputs
the first time a target was corrected; a stored `expired` would need something to write it, and the
only candidates are a scheduler this phase does not have (D-16C-01) or a synthetic actor ADR-0045
refuses (D-16C-02). A test scans `information_schema` for fifteen such names — `due_at`, `expires_at`,
`overdue`, `breached`, `escalation_level`, `scheduled_at`, `notified_at` among them — and finds none.

**Nullable, and not backfilled.** A step with no instant has no clock, which is exactly what `dueAt`
answers for one. No existing row needs one: `service_level_count` is null on every template and step
this migration touches, so no approval already running has a target for a missing instant to be
measured against. A backfill would have changed data to no effect.

---

## Exactness

`integer`, never `numeric`. The five column types across all nine Workflow tables are still exactly
`character varying`, `integer`, `jsonb`, `timestamp with time zone` and `uuid` — asserted as a set, so
a sixth arriving is a failure.

A fraction cannot reach the column, and the reason is the column's own type rather than a constraint:
PostgreSQL **rounds** `1.5` into an `integer` instead of refusing it, so a check could never have
caught it. The domain refuses the fraction before it gets there (`serviceLevelTarget`), and the test
records what the column alone does rather than claiming a refusal that does not happen.

`awaiting_at` is a `timestamptz` and deliberately not a `date`: a civil date would answer "which day
did this become awaiting", which is the wrong question for a target measured in hours and a value
whose meaning would depend on a time zone nobody chose.

---

## Security and invariants, re-verified on a clean database

The full 23-migration chain was applied to an **empty database**, and the result inspected:

- **9 tables**, RLS **enabled and forced on all nine**, **9 policies** — one per table.
- **11 foreign keys**, all inside Workflow; **0 cross-module**.
- **41 check constraints** (39 before, plus the two service-level ones).
- **2 append-only triggers**, unchanged.
- **28 indexes**, unchanged — none added, none dropped, none altered.

No uniqueness constraint moved, so no concurrency guarantee moved: `workflow_decision_step_idx`,
`workflow_instance_open_subject_idx`, the group code and member indexes and the two non-unique
branch indexes are all exactly as 16B left them. Branch parallelism, group snapshot semantics, the
assigned denominator, condition semantics and deterministic ordering are untouched by construction —
this migration adds three columns and widens one vocabulary.

**No index was added for the service level.** No query reads it yet; Checkpoint 4 owns the reads and
Checkpoint 5 owns the plans, and adding one now would be the speculative schema change this
checkpoint is told not to make. Recorded here so it is a decision rather than an omission.

---

## Tests

| Suite | Proves |
| --- | --- |
| `workflow-resolution` (9) | three approver kinds and no fourth; a manager template refused with either identifier; a running step still membership-only; the resolved person stored in the existing column with no second one; tenant boundary intact |
| `workflow-service-level-schema` (6) | the target's columns and types; `awaiting_at` as a `timestamptz`; empty on a step that has neither; a real target and instant round-tripping; both-or-neither; zero, negative and unknown units refused; a fraction rounded by the column; no derived/expiry/escalation/scheduling column; no new table; no inexact type |
| `workflow-parity` | **the previously red parity test is green** — the constraint now enumerates exactly what `APPROVER_KINDS` exports, compared by machine rather than by a retyped list |
| `workflow-schema-boundaries` | three Workflow migrations, none touching another module's table |

Repository-wide, uncached, `--concurrency=1`: **3,552 passed, 0 failed, 0 skipped**, 344 files, 47/47
tasks. Workflow 596, API 614, Admin 224. `pnpm standards`, `format:check`, `lint`, `typecheck`,
`build` clean; `prisma validate` valid; `migrate status` up to date at 23 migrations.

---

## Defects

**One, in a test I wrote, corrected to the truth rather than to my expectation.** I asserted that
`'business-days'` as a unit is refused by the service-level check constraint. It is refused by the
**column**: thirteen characters into a `varchar(8)` that fits `hours` and `days` and nothing longer.
That is the stronger of the two refusals — a type cannot be dropped by a later migration without the
column going with it — and the test now says so.

Two 16B assertions moved by authorization and were **rewritten rather than deleted**: the migration
count is now three Workflow migrations named explicitly, and the altered-table assertion says both
16B and 16C alter the same two tables and create none.

---

## Not verified

- Nothing reads or writes the new columns yet. `service_level_*` and `awaiting_at` exist and no
  repository maps them, no handler sets them and no view publishes them — Checkpoints 4 and 5.
- No index supports an overdue query, because no overdue query exists.
- Everything Phase 16C defers is unchanged and asserted absent: scheduler, `JobPort` adapter, job
  runner, cron, timer, notification delivery, outbox, broker, worker, role directory, external
  approver, business-day calendar, automatic expiry, escalation execution and analytics.
