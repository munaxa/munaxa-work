# Phase 16B — Checkpoint 5 — PostgreSQL Repositories

**PostgreSQL repositories only.** No schema change, no migration, no application command or query, no
permission, no API route, no Admin screen and no cross-module adapter. No completed module was
touched.

Checkpoint 4 shipped the approval-group store as a **declared-unimplemented** object whose every
method threw by name. This checkpoint replaces it with the real thing and verifies the whole of the
16B persistence layer against a live database.

---

## What was written

`infrastructure/group.repository.ts` — `PostgresApprovalGroupRepository`, one repository over both
group tables. A member has no life outside the list it is on, so there is no second exported store
through which somebody could edit a list without going through the group.

`infrastructure/workflow-group-rows.ts` — the two mappers. `membership_id` is Identity's identifier
held as an opaque `uuid`: no join, no lookup, no foreign key (ADR-0042).

The two existing mappers gained the 16B columns: `approver_group_id`, `branch_rule`, `quorum` and
`condition` on a step template (with `approver_membership_id` now nullable), and `source_group_id`,
`branch_rule`, `quorum` and `condition` on a running step.

`postgresWorkflowStores()` now returns seven repositories over nine tables — the counts differ by two
for the same reason twice: a step template belongs to its version, and a group member belongs to its
group.

---

## The two properties that are not ordinary CRUD

**`membersOfAll` is one statement, whatever the number of groups.** It is what an instance start
calls, so a per-group read would make raising an approval cost a query per list. The identifiers go
in as a single `uuid[]`. A test wraps the real transaction, records the SQL PostgreSQL actually
received, and asserts **one statement for six groups** — and none at all for a version that names no
group.

**The composite foreign key is proved rather than assumed.** Tenant B naming tenant A's group is
refused by `workflow_approval_group_member_group_fk`. PostgreSQL checks a foreign key without
consulting a row-level policy, so a single-column reference would have accepted that write: the
parent row exists, and the referential check never asks whose it is.

---

## One defect found, and where it was fixed

**A group's members outlived the group.** Soft-deleting a list left its member rows readable, so
`membersOfAll` answered about a group `byId` refuses to return — and an approval could start from a
list that no longer exists, asking the people who used to be on it.

Classified as a **repository** defect: a store must not hand back the children of a row it hides.
Fixed in `membersOfAll` with a join to the group on `deleted_at is null`, so the two reads agree —
no group, no members — and the start then fails closed.

The refusal it produces is `branch-group-empty` rather than `branch-group-unresolved`, because the
application resolves a group *through its members*. That is an honest limit rather than a wrong
answer: both refusals stop the same approval for the same reason, and telling them apart would need a
second read of the groups themselves — a port the application does not have, and adding one is not
this checkpoint's. It is recorded in the test that pins the behaviour.

---

## What the suites establish

| Property | Where |
| --- | --- |
| Group and member round trips, including the instant on `added_at` | `workflow-group-repository` |
| Code unique per tenant, reusable across tenants; membership unique per group, free across groups | same |
| Cross-tenant reads, counts, exact-identifier lookups and removals all refused | same |
| Removal is soft, removes exactly one membership, and lets the same person be re-added | same |
| Paging: first, middle, last, past the end; total over the whole set; tenant-scoped | `workflow-group-reads` |
| `membersOfAll` bounded to one statement | same |
| Branch columns round-trip, including an empty condition distinct from an absent one | `workflow-branch-persistence` |
| Several templates and several steps at one ordinal; several awaiting at once | same |
| Quorum and ordinal stay integers | same |
| Plans: index reachable, tenant inside the index condition, one scan for many groups | same |
| Concurrent group code, duplicate member, two people, two lists, two removals | `workflow-group-races` |
| A list and its members commit together or not at all | `workflow-repository-transaction` |
| Mapper/schema parity over all nine tables | `workflow-repository-parity` |
| The whole phase end to end, through real handlers and real repositories | `workflow-application` |

The end-to-end suite is the one that would have caught the Checkpoint 4 stub: it creates a group,
fills it, starts an approval from it, **empties the group afterwards**, and proves the running
approval still asks the three people it snapshotted, still has a denominator of three, and still
completes on two of them.

Every race runs on **two real connections** with no sleeps and no disabled constraints, and every
outcome is classified: a duplicate names its index, a stale version is a `ConcurrencyException` by
type, and a domain refusal is neither.

---

## Preserved

`workflow_step_template_ordinal_idx`, `workflow_step_ordinal_idx` and `workflow_step_awaiting_idx`
remain non-unique — the repository does not make the schema stricter than Checkpoint 3 left it.
`workflow_decision_step_idx` remains unique. `workflow_decision` and `workflow_history` remain
append-only: no update, no soft delete, no restore, and no method that exists only to throw.

Nothing opens a transaction. Every repository takes the one the application's unit of work
established, and a failure after a group and its members are written leaves neither.

---

## Gates

- `pnpm standards`: clean — 176 architecture models, 17 catalogues, 1,665 files, no cycles, no unused
  dependencies.
- `format:check`, `lint`, `typecheck`, `build`: clean, 47/47 and 27/27.
- Repository-wide, uncached, `--concurrency=1`: **3,398 passed, 0 failed, 0 skipped**, 331 files,
  47/47 tasks. Workflow: 530 in 46 files.
- Prisma validate and migrate status: clean, 22 migrations, database up to date.

One earlier full run showed a single Documents failure that did not reproduce: Documents passes in
isolation and passed in both subsequent full runs. It is recorded here rather than omitted, and it is
not a Workflow suite.

---

## Not verified

- No HTTP route reaches a group. Five handlers are composed, permission-checked and now fully
  persisted, and remain unreachable over the API until Checkpoint 6.
- No Admin screen shows a group, a branch tally, a quorum or a condition.
- Performance at volume: the plan assertions are about **reachability** at fixture size, with
  `enable_seqscan = off`. Index choice under load, and the three benchmark tiers, belong to the
  performance checkpoint.
- The distinction between `branch-group-unresolved` and `branch-group-empty` for a deleted group, as
  described above.
- Everything the Phase 16B plan lists as `NOT VERIFIED` remains so: SLA, escalation, scheduling,
  notification, analytics, manager routing, role approvers, external approvers, approval expiry.
