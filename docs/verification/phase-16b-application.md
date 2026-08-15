# Phase 16B — Checkpoint 4 — Application

**Application only.** No repository, no migration, no schema change, no API route, no Admin screen
and no cross-module adapter was implemented. The domain decides; this checkpoint is the layer that
reads what a decision needs, hands it over, and persists what comes back.

---

## What was added

**Three commands**, each named and each with its own permission:

| Command | Permission |
| --- | --- |
| `workflow.create-approval-group` | `workflow.group.manage` |
| `workflow.add-group-member` | `workflow.group.manage` |
| `workflow.remove-group-member` | `workflow.group.manage` |

**Two queries**: `workflow.search-approval-groups` and `workflow.read-approval-group`, both under
`workflow.group.read`.

**Two permissions**, exactly the two the Phase 16B plan authorized. `group.manage` is deliberately
not implied by `definition.manage`: whoever may edit a group changes who approves, which is a
different authority from writing the process. `group.read` is separate again — reading who approves
capital expenditure and being able to change it are different risks.

`workflow.add-step` gained the 16B configuration — a group approver, a branch rule, a quorum, a
condition — without gaining a `approverKind` field. The kind is **derived** from which approver the
caller named, so a caller cannot send a kind that disagrees with the field they filled in, and `role`
is not reachable because there is no field it could arrive in.

---

## Group semantics

A group is a list. It has no status, no lifecycle and no activate/archive command, because the domain
gave it none.

- One code per tenant, one membership per group, and a membership free to belong to several groups —
  the last of which is the difference between a list and a directory.
- A membership is an **opaque value**. Nothing here resolves one through Identity: an approver is a
  person named individually, and a lookup would be the first half of the directory this product has
  committed not to build.
- `remove-group-member` is the one removal in the module. Decisions and history entries still have
  none, anywhere.

**The snapshot.** `startInstanceHandler` reads every group the version names — in one call, not one
per group — expands each into individual membership approvers, and records `sourceGroupId` as
provenance. From that moment the group is irrelevant to the approval. The suite proves it by removing
every member and adding a stranger *after* the start: the same three people are still asked, the
denominator is still three, the stranger has nothing to decide, and two approvals still complete it.

An empty group refuses the start (`branch-group-empty`) rather than producing an approval that
completes instantly while looking like a process. A group that no longer exists refuses with
`branch-group-unresolved` rather than being silently omitted.

---

## Parallel semantics

A branch is the set of steps sharing an ordinal, and the application asks all of them at once.

- Every step of the opening branch is written `awaiting`; the write ordering 16A needed is gone
  because the index that forced it was widened in Checkpoint 3.
- **The caller answers their own step.** 16A read the instance's single awaiting step and asked
  whether the caller could decide it; there are now several, so the question became "which of these
  is mine" — resolved from the membership on the request against each step's own approver.
- An optional `stepId` narrows that set and cannot widen it. It exists for the one case a branch asks
  the same person twice (named individually *and* through a group at one ordinal), where answering
  "one of them" would record a decision against a step nobody chose. Naming a colleague's step is
  refused exactly as sending nothing would be.
- Identity is asked **once** per decision, whatever the size of the branch.

---

## Tally semantics

The application computes no arithmetic. It reads the decisions, hands them to `decide`, and maps the
returned `BranchTally` field for field into `BranchTallyView`. `workflow.read-instance` derives one
tally per branch the same way, through `tallyOf`.

Every number is an integer: denominator, approvals, rejections, responses, outstanding, threshold,
quorum. No percentage, no weight, no fraction, and no stored counter — a tally is a function of the
decisions that exist.

---

## Conditions

Evaluated at two moments: when an instance starts, and when a decision chooses the branch that
follows. Both go through the domain.

The distinction the whole capability rests on is preserved rather than made here: a missing key
(`condition-key-missing`), an unsupported operand (`condition-operand-unsupported`) and a type
mismatch (`condition-operand-mismatched`) are three different refusals, and none of them is `false`.
A refused start writes nothing at all — no instance, no steps, no timeline. A refused decision leaves
the approval exactly where it was, with the approver still asked and no decision recorded.

---

## Delegation

Unchanged. Identity remains the owner and is asked through the existing `DelegationPort`, at the
instant of the decision, under a scope Workflow honours. A delegated decision records the deputy as
actor and the approver as authority, and counts as **one** vote for the approver's step — proved
against a branch of three, where the tally reads one response of three rather than two.

Somebody who is both an approver on a branch and a deputy for a colleague on it answers their own
step: delegation is consulted only when the caller has no step of their own.

---

## Two defects found and fixed

1. **The tally counted votes from branches that had already finished.** `decide` accepted "the
   decisions already recorded on this instance" and counted all of them against the current branch's
   denominator — so an approval that had approved two earlier branches would have reached a majority
   of three on its *first* response to the third. Fixed in the domain, which is the layer that can
   make it unrepresentable: the votes are narrowed to the branch being tallied inside `decide`, so a
   caller passing the wrong subset cannot change an outcome. A test asserts a second branch tallies
   from its own votes and nobody else's.

2. **The in-memory stores were stricter than PostgreSQL.** They still refused a second template at
   one ordinal, a second step at one ordinal, and a second awaiting step — three rules Checkpoint 3
   dropped from the schema. A fake stricter than the database is exactly as wrong as a permissive
   one, and worse here: it would have refused the feature while every schema test said it was
   allowed. Removed, with the reason recorded where the mapping table lives.

---

## Deviations — one, stated

`postgresWorkflowStores()` returns a **declared-unimplemented** approval-group store whose every
method throws by name. The two group tables exist and the application needs the store; the repository
is Checkpoint 5. Leaving the field off would stop the composition root compiling and take the whole
module out of the API; returning an in-memory store would serve group reads and writes from process
memory while every test passed. Throwing fails loudly at the one place the capability is missing and
names the checkpoint that closes it. No SQL was written.

---

## Gates

- `pnpm standards`: clean — 176 architecture models, 17 catalogues, 1,654 files, no cycles, no unused
  dependencies.
- `format:check`, `lint`, `typecheck`, `build`: clean, 47/47 and 27/27.
- Repository-wide, uncached, `--concurrency=1`: **3,353 passed, 0 failed, 0 skipped**, 326 files,
  47/47 tasks. Workflow: 485 in 41 files.
- Prisma validate and migrate status: clean, 22 migrations, database up to date.

No test was deleted or skipped; six existing assertions were **inverted** where an invariant
legitimately moved, each with the reason recorded beside it.

---

## Not verified

- **Nothing group-related is persisted.** No PostgreSQL repository reads or writes either group
  table; every group assertion here runs against the in-memory stores.
- The in-memory stores are a single process with no concurrency and no rollback: they demonstrate the
  *rule*, never the *race*. Real concurrency was proved against PostgreSQL in Checkpoint 3, and the
  repository-level races are Checkpoint 5's.
- No HTTP route reaches a group: five handlers are composed and enforced while being unreachable over
  the API. The composition and routes specs now count those two surfaces separately, which is the
  honest state of a half-built phase.
- No Admin screen shows a group, a branch tally, a quorum or a condition.
- Performance at volume, for any of it.
- Everything the Phase 16B plan lists as `NOT VERIFIED` remains so: SLA, escalation, scheduling,
  notification, analytics, manager routing, role approvers, external approvers, approval expiry.
