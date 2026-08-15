# Phase 16B — Checkpoint 3 — Database Schema

**Schema only.** No application command, query, permission, API route, Admin screen, port or
cross-module adapter was implemented in this checkpoint. Two tables were created, two were altered,
and the domain completed in Checkpoint 2 now has somewhere to live.

Migration: `prisma/migrations/20260815100000_workflow_routing/migration.sql`.

---

## What the schema now holds

### Two new tables

`workflow_approval_group` — a code, a localized name, and the audit columns every table in this
repository carries. **No `status`, no `archived_at`, no effective period, no owner, no role and no
query.** A group is a list somebody wrote down; a list that is no longer wanted is soft-deleted like
anything else. Inventing `active | archived` would have added a vocabulary, a check constraint and a
transition table to express something nobody asked for, and the domain
(`domain/approval-group.ts`) deliberately has none.

`workflow_approval_group_member` — one membership's place in one group, with `added_at`, because
"when was this person put on the list" is the question asked after an approval went somewhere
unexpected. `membership_id` is Identity's identifier held as an opaque value with no foreign key
(ADR-0042).

### Two altered tables

`workflow_step_template` gains `approver_group_id`, `branch_rule`, `quorum` and `condition`, and
`approver_membership_id` stops being mandatory because a `group` template names no person. Its
approver-kind check widens to `('membership', 'group')`, which is the widening 16A anticipated in as
many words.

`workflow_step` gains `source_group_id`, `branch_rule`, `quorum` and `condition`. **Its approver-kind
check does not change**, and that is the point of the group snapshot: a template may name a group, a
running step never does, because the group was expanded into its members before the row existed.

---

## The composite foreign key, and why it is not the repository's usual shape

Every other reference to a group could have been `references workflow_approval_group (id)`. Both are
`references workflow_approval_group (id, tenant_id)` instead.

PostgreSQL checks a foreign key **without consulting a row-level policy**. A single-column reference
would therefore let one tenant attach a member row — or point a step template — at a group they
cannot read, see or count: the parent row exists, and the referential check never asks whose it is.
Naming `(id, tenant_id)` puts the tenant inside the key. Two probes in
`workflow-groups.integration.test.ts` prove it rather than assume it.

This is the one place in the module where an intra-module foreign key does isolation work, because it
is the one place a child names a parent the writer may not read. The rule stated in 16A's migration —
*"a foreign key is not isolation"* — is unchanged; this is the narrower claim that a key **carrying**
the tenant refuses what a key omitting it accepts.

---

## The three invariants that moved, and the one that did not

| Object | 16A | 16B |
| --- | --- | --- |
| `workflow_step_template_ordinal_idx` | `UNIQUE (tenant_id, workflow_version_id, ordinal)` | the same key, not unique |
| `workflow_step_ordinal_idx` | `UNIQUE (tenant_id, instance_id, ordinal)` | the same key, not unique |
| `workflow_step_awaiting_idx` | `UNIQUE (tenant_id, instance_id) WHERE awaiting` | `(tenant_id, instance_id, ordinal) WHERE awaiting`, not unique |
| `workflow_decision_step_idx` | `UNIQUE (tenant_id, step_id)` | **unchanged** |

A **branch** is the set of steps sharing an ordinal, and every one of them is asked at the same
moment. The three uniqueness rules above expressed "sequential" while an ordinal held one step; they
now refuse the ordinary case of parallel approval rather than an illegal state. Each was widened —
the key survives as an ordinary index, serving the read it was incidentally serving — and each
widening is asserted **positively**, in `workflow-parallel.integration.test.ts`, rather than by
deleting the assertion that used to refuse it.

The template's index is in that list although the authorizing instruction named only the two on
`workflow_step`. It is the same change one level up and it is unavoidable: two templates at one
ordinal is how an administrator configures a branch in the first place, so leaving it unique would
have made the domain unrepresentable.

**One decision per step did not move**, and it is what still settles a race between two people
clicking on the same step.

### What no index replaced it with, and why

"At most one **ordinal** among an instance's awaiting steps" — one branch open at a time — looks like
the same invariant one level up. It is not expressible as a unique index: it is a condition on a
*set*, and a unique index would refuse the second and third member of the single branch that must
exist.

A trigger could read the other rows. It would not hold. Under read-committed, a transaction opening
branch 2 and a transaction opening branch 3 each see the other's pre-image, both pass, and both
commit — a read-then-write check inside the database is still a read-then-write check, which is the
failure mode every unique index in this module exists to avoid. So the branch invariant is held where
it can be held, by `chooseBranch`, and the schema holds the things a schema can.

The same reasoning applies to "a skipped step cannot later receive a decision": it spans two tables,
and it is `decide`'s. `workflow-parallel.integration.test.ts` asserts the gap explicitly rather than
leaving whoever writes the repository to discover it.

---

## Conditions

`condition` is `jsonb`, and `jsonb` accepts any JSON at all — so a column with no constraint would
accept `{"drop": true}` and call it a condition. `app_workflow_condition_shaped(jsonb)` is an
immutable function behind a check constraint (a check may not contain a subquery, and walking an
array requires one). It enforces **structure**: an array of objects, each naming a non-empty key, one
of the five operators, and a value.

It enforces no meaning. Whether `'50000'` suits `greater-than`, and whether a key exists in a
particular instance's context, depend on the operator's semantics and on a payload that does not
exist when a template is written. Those are `conditionIsWellFormed` and `evaluateCondition`, and
re-expressing them in SQL would be a second definition of the rule that drifts from the first. The
split is pinned by a test, so acceptance at the table is never mistaken for approval.

---

## Numbers

`quorum` is `integer` on both tables. There is no `numeric`, `real`, `double precision`, `bigint` or
`money` column anywhere in the module, and the schema suite asserts both halves — that none of those
types appears, and that both quorums are integers. Every voter has one vote; there is nowhere for a
weight or a percentage to be stored even if somebody wanted one.

No tally is persisted. A tally is a function of the decisions that exist; a stored counter would be a
second source of truth that disagrees with `workflow_decision` the moment two approvers commit at
once, and the decision table is the one an auditor reads.

---

## Absences carried forward from 16A

No `due_at`, no `expires_at`, no `escalation_level`, no `breached`, no scheduler column, no manager or
`reports_to`, no notification, no analytics, no external approver. `JobPort` still has no adapter
anywhere in this repository, so nothing runs when nobody is asking — a branch whose quorum can no
longer be reached waits, visibly, until a person acts. `workflow-schema-boundaries.integration.test.ts`
asserts this against `information_schema.columns` rather than against the migration's prose, because a
capability can only actually be half-built in a column.

---

## Verification

- Row-level security: enabled **and** forced on all nine tables, exactly one permissive `ALL`
  `tenant_isolation` policy for PUBLIC on each, `USING` and `WITH CHECK` both
  `tenant_id = app_current_tenant()`. Asserted as an unprivileged role (`rolsuper = false`,
  `rolbypassrls = false`), with both tenants seeded at equal volume on every table.
- Migration applied to `work_test` from an empty database through all 22 migrations.
- Repository-wide, uncached, `--concurrency=1`: **3,308 passed, 0 failed**, 322 files, 47/47 tasks.
- `pnpm standards`, `format:check`, `lint`, `typecheck`, `build`, `prisma validate`,
  `prisma migrate status`: all clean.

**The one test left red at the end of Checkpoint 2 is green.**
`workflow_step_template_approver_kind_check` now enumerates exactly `['membership', 'group']`, which
is what the domain's `APPROVER_KINDS` exports, compared by machine rather than by a second list of
strings typed into the test.

---

## Not verified

Nothing in this checkpoint exercises an application path. In particular:

- No repository reads or writes either group table; the mapper-parity suite covers the seven tables
  that have a mapper and says so.
- No command, query, permission, API route or Admin screen touches a group, a branch rule, a quorum
  or a condition.
- Group expansion, condition evaluation and tally arithmetic have not been run end to end through
  `ApprovalPort`.
- `apps/api/src/workflow/workflow.tenancy.spec.ts` still asserts row-level security over the seven
  16A tables. The module's own isolation suite covers all nine; extending the API-level spec is
  application-test work and was left for the checkpoint that owns it.
- Performance at volume: Checkpoint 3 asserts only that the new indexes are *reachable*, with
  `enable_seqscan = off` at fixture size. Index choice under load belongs to the performance
  checkpoint.
