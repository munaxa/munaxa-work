# Phase 16D — Definition of Ready

**Investigation only.** No domain, application, repository, schema, migration, API, Admin or
completed-module code was written or modified. This document establishes what can be implemented
without violating a locked invariant, and stops where it cannot.

Baseline: Phase 16C complete at `d30d504`. Phase 16D has not started.

---

## 1. What this phase would be about

Six subjects, and they do not all survive contact with the tree:

| Subject | Finding | §|
| --- | --- | --- |
| Service level beyond the target/read model | **Nothing further is required.** The read model is complete | 4 |
| Overdue semantics | **Already delivered in 16C.** `overdue` is one of three derived states | 4 |
| Approval expiry semantics | **Already delivered, in two halves** — observed in 16C, acted on by 16A's `cancel-instance` | 6 |
| Escalation semantics | **BLOCKED.** Cannot be defined as approved without changing 16B's denominator | 5 |
| Scheduled execution | **Not 16D's to own.** No phase owns the durable runner | 7 |
| Business-day SLA | **BLOCKED.** Requires a new Organization query that does not exist | 9 |

The honest summary is that **Phase 16D as scoped is mostly already built**, and the one genuinely new
capability — escalation — meets a stop condition. That is the finding, not a shortfall in the
investigation.

---

## 2. What the tree actually contains

Established by reading the final tree, not by trusting a document.

### `JobPort` — exists, and **nothing calls it**

```ts
export interface JobPort {
  enqueue<TPayload>(request: JobRequest<TPayload>): Promise<void>;
  schedule<TPayload>(request: JobRequest<TPayload>, cron: string): Promise<void>;
}
```

`JobRequest` carries `name`, `payload`, `tenantId`, `correlationId`, a caller-supplied
`idempotencyKey` — *"so a retried enqueue does not run the work twice"* — and an optional `runAt`.

**It guarantees nothing, because nothing implements it.** A repository-wide search for `.enqueue(`
and `.schedule(` returns **zero** call sites (the one `.schedule(` match is Recruitment's
`Interview.schedule` domain factory, unrelated). Every mention of `JobPort` outside the kernel is
**prose in a comment saying there is no adapter** — in Letters, Performance and Workflow. There is no
adapter, no runner, no worker and no queue table anywhere.

### `NotificationPort` — exists, **is wired, and delivers nothing**

```ts
export interface NotificationPort { notify(request: NotificationRequest): Promise<void> }
```

Unlike `JobPort`, this one is **live in production compositions**: Performance and Learning both
construct a `RecordingNotificationPort` and call `notify` synchronously from inside a command, through
a module-local intent port. The kernel's own comment is the governing rule:

> A domain says *what happened and to whom*. It never says "send an email": the channel is the
> recipient's preference and the tenant's configuration.

And the composition's:

> `RecordingNotificationPort` is not a fake and not a stub. A fake would claim delivery; this records
> the intent and says nothing about whether anybody was told.

So a Workflow command *could* emit an intent synchronously without inventing infrastructure — the
pattern is two modules old. Whether it *should* is D-16D-06.

### Delegation expiry — observed on read, and a written transition that nothing can reach

`delegation` carries `effective_from`, `effective_to` and a four-value `status`
(`scheduled|active|revoked|expired`). The query Workflow uses,
`identity.active-delegations-for(delegateMembershipId, atInstant)`, filters:

```sql
where status <> 'revoked' and effective_from <= $3 and effective_to > $3
```

**Validity is a function of the instant, and `status` is consulted only to exclude a revocation.** An
elapsed delegation simply stops matching. So delegation expiry is *already* observed-not-written for
every purpose Workflow has.

**And the written half exists but is orphaned.** `Delegation.expire()` and `Delegation.activate()` are
fully implemented in Identity's domain — idempotent by refusal, guarded by the period — and **no
Identity command calls either.** Phase 16C's §4.5 recorded this; it is still true in the final tree.
Two absences, not one: a scheduler, and a command for it to call.

### Organization's calendar — **not published at all**

16C's §4.4 said holidays are unpublished but weekends are answerable from `workingDays`. **The final
tree is stricter than that.** `calendarView()` is defined in
`organization/src/application/organization-views.ts` and **is called by no query**: a search for
`calendarView(` outside its own definition returns nothing. Organization publishes eleven queries and
none returns a calendar, a calendar day, or a working-day set.

So business days are not "a dependency 16D could take" — they are **a completed-module change 16D
would have to request**.

### The precedent three modules already set

This exact problem has been solved three times, and the solutions are ADRs:

- **ADR-0070** (Learning): *"a stored flag that nothing maintains is worse than no flag"* — expiry
  derived on read.
- **ADR-0071** (Learning): *"A recurring requirement is computed, not scheduled, and generation is
  idempotent."* A bounded, deterministic, idempotent **administrator command**, idempotent **by
  partial unique index** rather than read-then-write, keyed by a **derived occurrence key**, bounded
  by a page — and explicitly *"safe for a future scheduler to invoke without any change to the
  command."*
- **Performance**: *"overdue review is not detected by a sweep — `JobPort` has no adapter, so overdue
  is a question a read answers"*, and its reconciliation *"reports; it repairs nothing."*

**ADR-0071 is the template Phase 16D should follow**, and it is the reason a durable runner is not on
16D's critical path: a command written to that shape is correct now and correct later.

---

## 3. Contradiction audit

The specification (`work prompts/17_PHASE_16_WORKFLOW.md`) is terse — headings and one-line
definitions — and three of its lines conflict with approved decisions.

| ID | Contradiction | Evidence | Status |
| --- | --- | --- | --- |
| **C-1** | 16B/16C prose vs. the kernel on `JobPort` | **No contradiction.** The prose says "the port exists and has no adapter"; the kernel agrees, and zero call sites confirm it | Resolved — no action |
| **C-2** | Spec names `SLARule` as an **entity**; 16C put the target as two fields on the step template | Spec §"SLA Rule"; `workflow_step_template.service_level_{count,unit}` | **Open — D-16D-01** |
| **C-3** | "Expiry is observed" vs. any spec expecting an `expired` state | Spec: `Automatic Expiration` (under Delegation). `ApprovalPort.expired` declared, never produced | **Open — D-16D-03**, but see §6: likely no change needed |
| **C-4** | Escalation "adds an approver" vs. spec's **"Automatic reassignment after SLA breach"** | Spec line 341 — *reassignment*, i.e. replacement | **Real. D-16C-07 already chose "adds". The spec needs amending, as D-16C-03 amended AD-005** |
| **C-5** | Escalation vs. denominator semantics | `assigned = branch.length`, computed live at read | **BLOCKING — see §5** |
| **C-6** | Escalation vs. immutable recorded decisions | `decision.ts` excludes answered steps from skipping | No contradiction: adding a step touches no decision |
| **C-7** | Escalation vs. original `awaiting_at` | A *new* step gets its own `awaiting_at`; the original is untouched | No contradiction, but see D-16D-04 |
| **C-8** | Automatic execution vs. D-16C-02 *"nothing terminal fires without a human request"* | Spec: `Time-based Escalation`, `Automatic Expiration` | **Real. Automatic firing stays `NOT VERIFIED`** |
| **C-9** | Business-day SLA vs. D-16C-05 elapsed time | Spec: `Configurable SLA`; no Organization calendar query exists | **Real. Requires a completed-module change — not authorized** |
| **C-10** | Delegation expiry vs. no scheduler | `Delegation.expire()` orphaned; `forDelegate` filters by instant | Resolved: expiry is already observed. The written transition stays unreachable |
| **C-11** | Notification delivery vs. Phase 17 | Spec Phase 17 owns `DeliveryQueue`, `ScheduledMessage`, `Retry` | No contradiction: **intent** is not delivery |
| **C-12** | Analytics / tenant-wide aggregates vs. Phase 20 | Phase 20 owns `ScheduledReport` and states *"scheduled reports execute in background jobs"* | No contradiction. Out of 16D |
| **C-13** | Completed-module adoption vs. D-16C-09 zero-by-default | Nothing in 16D requires an adoption | No contradiction |
| **C-14** | Any requirement needing a new cross-module query | Only business days (§9) and role/HR escalation (§5) | **Both blocked, neither authorized** |

**Also found, not on the required list:** `docs/PHASES.md`'s phase table still lists Phase 16 as
"Not started", and lists Phases 5 and 8 as "Awaiting approval" although both are delivered. The table
is a **specification index rather than a status tracker** and is stale across many rows; correcting
only Phase 16's would imply the others are accurate. **Recorded, not changed** — fixing it is a
separate documentation decision and this checkpoint may not invent one.

---

## 4. Service level and overdue — nothing further is required

16C delivered the whole read model, and re-reading it against 16D's brief finds no gap:

- target on the template, copied to the step; `awaiting_at` persisted;
- `dueAt`, `serviceLevelState` (`none|within|overdue`), `overdueByMinutes` — **all derived** from the
  target, `awaiting_at` and an explicit reading instant;
- exactly at due is `within`; three seconds past is **zero** minutes overdue;
- nothing stored, no `due_at`, no `expired`, no clock in domain logic.

**"Overdue semantics" is a solved problem in the delivered tree.** The only open question about the
read model is C-2 — whether an `SLARule` entity is required — and the answer affects configuration
shape, not time behaviour.

---

## 5. Escalation — **BLOCKED**

D-16C-07 approved *"a bounded, idempotent administrator command that **adds an approver**, is recorded
in history, never restarts the clock, and never removes anybody."* Investigating what that means in
this codebase produces a blocker.

### The blocker, exactly

A branch is a set of `workflow_step` rows sharing an ordinal. The tally is **computed at read time**
and the denominator is the **live row count**:

```ts
tallyOf(branchOf(first), branch.length, votes)   // workflow-queries.ts:274
tallyOf(branchOf(step),  branch.length, [...])   // decision.ts:188
```

So **adding a step to a branch increases `assigned`, and therefore `threshold` and `outstanding`, for
a branch already under way** — retroactively, on the next read, because nothing is stored.

Worked through the real arithmetic:

| Before | After escalation |
| --- | --- |
| `majority`, assigned 3, 2 approved → threshold 2 → **`approved`** | assigned 4, threshold 3, approvals 2, outstanding 2 → **`awaiting`** |
| `unanimous`, assigned 2, 1 approved, 1 outstanding → `awaiting` | assigned 3, threshold 3 → a third approval nobody configured is now required |

**A branch that had already been decided reverts to awaiting.** That is not a rare edge: escalation is
invoked *because* an approval is late, which is exactly when some approvers have answered.

This collides with a locked 16B invariant stated two ways — *"the denominator is the set of approvers
snapshotted at start"* and *"the tally is computed from the decisions at read time and stored
nowhere"* — and the two together are what make the collision unavoidable: the first forbids the
denominator moving, the second means it moves automatically.

### Every escape, and why each is a decision rather than a fix

| Option | Consequence |
| --- | --- |
| **(a)** Escalated step counts normally | Denominator, threshold and outcome of a running or decided branch change. **Violates the locked 16B rule.** |
| **(b)** Escalated step excluded from `assigned` | Their vote cannot reach the threshold. What does their approval *do*? An approver who cannot affect the outcome is theatre. |
| **(c)** Persist `assigned` as a column | Contradicts *"the tally is stored nowhere"*, the invariant that exists so no counter can disagree with the decisions. **Schema change to a locked rule.** |
| **(d)** Permit escalation only before any decision is recorded | Excludes the case escalation exists for. |
| **(e)** Escalation adds **nobody** — it is an attention/history act only | Preserves every invariant. **Contradicts D-16C-07's "adds an approver".** |

**STOP.** Per stop condition *"escalation cannot be defined without changing the denominator
semantics"*, escalation is not ready for Checkpoint 2. It requires an explicit approval choosing among
(a)–(e), and (a) and (c) each require amending a locked 16B invariant.

### What was established anyway, so the decision can be taken quickly

**Actor.** No existing permission fits. `instance.cancel` is the closest precedent — an administrator
acting on somebody else's running approval — and the permissions file's own reasoning points at a
separate grant: *"the capability to write the process and the capability to write the people are two
grants"*, and escalation changes who approves on an approval **already running**, which is strictly
more powerful than `group.manage`. A tenth permission, `workflow.approval.escalate`, is the
defensible shape. **Adding it is a decision (D-16D-02).**

**Target.** A **step**, identified by instance and ordinal — i.e. a branch. Targeting an instance is
ambiguous where several branches are open; targeting one step of a branch is what "add an approver to
this branch" means.

**Added approver source.** Only `membership` is safe. `group` would resolve a list into several steps
and multiply the denominator problem; `manager` re-enters routing 16C fixed at instance start;
`role` does not exist. **No new approver kind.**

**Idempotency.** ADR-0071's shape applies exactly: a **partial unique index** over
`(tenant_id, instance_id, ordinal, approver_membership_id) where deleted_at is null`, so escalating
the same person onto the same branch twice creates nothing under concurrency. No read-then-write.

**History.** `workflow_history_event_check` is a **closed eight-value constraint**. Recording
escalation needs a ninth value — so **escalation implies a migration** (#24). D-16C-13's "additive
only, widened closed vocabularies" permits it; it is still a schema change to plan for.

**Timing.** Uncontroversial: the new step gets its own `awaiting_at`; the original step's is untouched;
the target is unchanged; nothing restarts. **No conflict found** (C-7).

**Branches.** Unanswered, and each is a decision: may escalation target a branch that is **not
currently awaiting**, one already **skipped** by a condition, or one already **completed**? Given the
blocker above, completed must at minimum be refused.

---

## 6. Approval expiry — likely nothing to build

D-16C-06 approved *observed, never written*. Investigating what that means operationally:

**The state already exists.** `overdue` is one of the three derived service-level states. The brief
asks whether the product needs `expired`, `stale`, `blocked` or `unavailable` in addition — and
nothing in the tree or the specification distinguishes them from `overdue`. Adding one would be adding
a state, which is forbidden.

**The command already exists.** The brief asks whether an administrator command is required to act on
an overdue approval, and whether it cancels, closes, escalates, reassigns or does nothing.
**`workflow.cancel-instance` is that command, and it has existed since 16A**: it requires
`workflow.instance.cancel` (deliberately not implied by `instance.start`), demands a non-empty reason,
refuses anything not running, skips remaining steps and writes `instance-cancelled` to history.

So expiry decomposes into two halves that are **both already delivered**: 16C observes it, 16A acts on
it, and the human is in the loop exactly as D-16C-02 requires.

**Open only as confirmation** (D-16D-03): is anything further wanted, and if so, what does it do that
`cancel-instance` does not? No answer should be inferred.

---

## 7. Automatic execution — the stop boundary

Every time-triggered behaviour the specification names, assessed against the seven questions:

| Behaviour | Required? | Permitted by 16C? | Needs scheduler | `JobPort` | Outbox | Notification | New actor model | Owner |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| "Notify when overdue" | Not established | Intent yes, delivery no | **Yes** | Yes | No | Yes (intent only) | **Yes** — no human request | **Unowned** |
| "Expire after X" | No — see §6 | **No** (D-16C-06) | Yes | Yes | No | No | **Yes** | **Unowned** |
| "Escalate after X" | Not established | **No** (D-16C-07: human command) | Yes | Yes | No | No | **Yes** | **Unowned** |
| "Run manager escalation after X" | Not established | **No** — also re-opens routing | Yes | Yes | No | No | **Yes** | **Unowned** |

**Every row requires an actor for an act no human requested, which D-16C-02 refuses outright**, and an
infrastructure capability no phase owns. **All four are stopped and recorded as unresolved.** None
may be built inside Workflow, and Workflow must not grow a scheduler to host them.

**What survives.** A command written to ADR-0071's shape — bounded, deterministic, idempotent by
index, invoked by a human — is correct today *and* is the thing a future runner would call unchanged.
That is how 16D can be complete without a runner: **it builds the verb, not the trigger.**

---

## 8. `JobPort` ownership — unresolved, and deliberately not assigned

Investigated as §4 required:

- **What it guarantees:** nothing. An interface with a caller-supplied `idempotencyKey` and an
  optional `runAt`, and no implementation.
- **Who consumes it:** nobody. Zero call sites.
- **Whether an implementation exists elsewhere:** no.
- **Whether Phase 20 references it:** Phase 20 owns `ScheduledReport` and states *"scheduled reports
  execute in background jobs"* — it **assumes** a runner and does not claim to build one.
- **Phase 17** owns `DeliveryQueue`, `ScheduledMessage` and `Retry`; **Phase 22** owns `RetryQueue`
  and `DeadLetterQueue`; **Phase 24** owns *"Background Job Optimization"* and *"Queue Monitoring"* —
  **operating** a job system, not creating one.

**Four phases assume a durable runner and none builds it.** That is the same conclusion 16C reached,
now confirmed against the specifications themselves.

**Recorded as an explicit open decision (D-16D-07). It is not assigned to Phase 16D.** A separate
infrastructure phase is the obvious shape, but naming one is inventing ownership and this checkpoint
may not.

**16D can be implemented completely without a durable runner** — every capability that survives §5–§7
is a human-invoked command or a derived read. **What remains impossible without one:** time-triggered
escalation, time-triggered notification, automatic delegation expiry, and any sweep.

---

## 9. Business-day SLA — blocked, and worse than 16C recorded

D-16C-05 chose elapsed time. The specification still says `Configurable SLA` and names
`Time-based Escalation`, neither of which explicitly demands business days — so **the specification
does not clearly require it**, and it is recorded as **deferred**.

**If it were ever required**, the dependency is larger than 16C stated. 16C recorded that holidays are
unpublished but `workingDays` is available; the final tree shows `calendarView()` is **called by no
query at all**. Organization publishes no calendar, no calendar day and no working-day set.

So business-day SLA needs a **new Organization query** — a completed-module change under D-16C-09's
zero-by-default rule — plus a decision about holidays, plus a time-zone decision that P-6 fixed at UTC.
**Not authorized, not proposed, not implemented.**

---

## 10. Delegation expiry — 16D should not touch it

- **Representation:** `effective_from`/`effective_to` plus a `status` including `expired`.
- **Observed on read:** yes — `forDelegate` filters by instant and consults `status` only to exclude
  `revoked`.
- **Existing command:** none. `Delegation.expire()` and `activate()` exist in the domain and **no
  command calls either.**
- **Automatic expiry:** none, and D-16C-12 declined to add it.
- **Does Workflow depend on it:** only through `identity.active-delegations-for`, asked at the instant
  of the decision. An elapsed delegation stops matching. Workflow keeps no expiry state.
- **Does 16D need to touch it:** **no.**

Making `expire()` reachable would be an Identity command — a completed-module change nobody has
authorized — and would still need something to call it. Both absences remain.

---

## 11. Decision register

None of these is approved. Nothing may be implemented from them.

| ID | Question | Blocks CP2 |
| --- | --- | --- |
| D-16D-01 | Is an `SLARule` **entity** required, or is the per-template target sufficient? | Yes, if configuration changes |
| D-16D-02 | Escalation: which of options (a)–(e), and does it get a tenth permission? | **Yes** |
| D-16D-03 | Is anything required for expiry beyond `overdue` + `cancel-instance`? | Yes |
| D-16D-04 | Which branch states may be escalated — awaiting, non-awaiting, skipped, completed? | Yes |
| D-16D-05 | Does 16D exist at all, given §1? | **Yes** |
| D-16D-06 | May a Workflow command emit a notification **intent**? | Yes, if any notification is wanted |
| D-16D-07 | Who owns the durable job runner? | No — 16D can complete without it |

### D-16D-01 — `SLARule` as an entity

*Evidence.* The specification names `SLARule` beside `EscalationRule` as domain entities. 16C
implemented a target as two nullable columns on `workflow_step_template`, approved under P-5
("attaches to the step template").

*Options.* **(a)** Keep the per-template target; amend the specification as D-16C-03 amended AD-005.
**(b)** Add an `SLARule` entity with its own table, referenced by templates. **(c)** Both, with the
columns as a denormalization.

*Recommendation.* **(a).** P-5 is approved and delivered; a rule entity adds a table, a lifecycle and
a resolution step for no behaviour the target does not already provide. (b) and (c) both add a second
place the target lives.

*Requires:* completed-module authorization — no. Schema — (b)/(c) yes. Infrastructure — no.

### D-16D-02 — Escalation semantics ⛔

*Evidence.* §5. `assigned = branch.length`, computed live; the locked 16B rules say the denominator is
snapshotted at start and the tally is stored nowhere.

*Options.* (a) counts normally · (b) excluded from the tally · (c) persist `assigned` · (d) only before
any decision · (e) attention-only, adds nobody. Consequences in §5.

*Recommendation.* **None offered.** Every option either amends a locked 16B invariant or contradicts
D-16C-07, and choosing between those is not an implementer's call. If a recommendation is wanted:
**(e)** is the only option that preserves every invariant, and it means D-16C-07 must be amended from
"adds an approver" to something narrower.

*Requires:* completed-module authorization — no. Schema — yes (a ninth history event; a partial unique
index; possibly `assigned`). Infrastructure — no. **Blocks Checkpoint 2.**

### D-16D-03 — Expiry beyond what exists

*Evidence.* §6. `overdue` is derived; `cancel-instance` exists with its own permission and reason.

*Options.* **(a)** Nothing further. **(b)** A distinct command that closes an overdue approval without
the `cancelled` vocabulary. **(c)** A written `expired` state — **refused by D-16C-06.**

*Recommendation.* **(a).** Both halves are delivered and the human is in the loop.

*Requires:* nothing, under (a). Under (b), a thirteenth command and a widened instance-status
vocabulary.

### D-16D-04 — Which branches may be escalated

*Evidence.* Branch outcomes are `awaiting`, `approved`, `rejected`; steps may be `skipped` by a
condition.

*Options.* awaiting only · awaiting + not-yet-reached · any including completed.

*Recommendation.* **Awaiting only**, and a refusal otherwise. §5 shows escalating a completed branch
reverts it to awaiting, which is the most damaging case.

*Requires:* nothing beyond D-16D-02. **Blocks Checkpoint 2.**

### D-16D-05 — Does Phase 16D exist?

*Evidence.* §1. Overdue and expiry are delivered; escalation is blocked; automatic execution is
refused and unowned; business days are blocked.

*Options.* **(a)** Proceed with escalation only, once D-16D-02 is approved. **(b)** Close 16D as
already-delivered and move escalation to a later phase with the runner. **(c)** Reduce 16D to
documentation.

*Recommendation.* **(a) or (b), and the choice is the user's.** If D-16D-02 resolves to (e)
— attention-only — then 16D is a small phase; if it resolves to (a) or (c), it amends a locked
invariant and deserves its own approval trail.

*Requires:* nothing. **Blocks Checkpoint 2.**

### D-16D-06 — Notification intent from a Workflow command

*Evidence.* §2. Performance and Learning both emit intent synchronously through
`RecordingNotificationPort` in production. Nothing delivers.

*Options.* **(a)** No notification port in Workflow — the status quo. **(b)** Emit intent on escalation
only. **(c)** Emit intent on every awaiting step.

*Recommendation.* **(a) unless escalation ships.** (c) would emit on every approval start, which is a
delivery-shaped decision inside a module that owns no channel. (b) is defensible if escalation exists:
an escalation nobody is told about is a record rather than an act.

*Requires:* completed-module authorization — no. Schema — no. Infrastructure — no. **Delivery remains
Phase 17's.**

### D-16D-07 — Durable job runner ownership ⛔

*Evidence.* §8. Zero call sites; four phases assume a runner; none builds one.

*Options.* **(a)** A separate infrastructure phase. **(b)** Phase 17, as the first phase that needs
one. **(c)** Phase 24, which already speaks of operating one. **(d)** Leave unowned.

*Recommendation.* **None.** Naming an owner is inventing an ownership decision, which this checkpoint
is forbidden to do. Recorded as unresolved, exactly as 16C left it.

*Requires:* a phase-level decision. Does **not** block Checkpoint 2 — nothing in 16D needs it.

---

## 12. Proposed checkpoint structure

The nine-checkpoint structure in the brief is **evaluated and not endorsed as written**, for one
reason: it presumes a phase with a domain, a schema and repositories, and §1 shows most of 16D is
already delivered.

**If D-16D-02 resolves to (e) — attention-only escalation:**

| # | Checkpoint |
| --- | --- |
| 1 | Definition of Ready *(this document)* |
| 2 | Domain — the escalation act and its refusals |
| 3 | Schema — one migration: the ninth history event, the partial unique index |
| 4 | Application — one command, idempotent by index |
| 5 | Repositories |
| 6 | API — one route |
| 7 | Admin — read-only display of what was escalated |
| 8 | Audit |
| 9 | Final closure |

**If D-16D-02 resolves to (a) or (c)** — either amends a locked 16B invariant — **a Checkpoint 1.1 is
required first**: a written amendment to the 16B tally rule, approved on its own, before any domain
work. Amending a locked invariant inside an implementation checkpoint is how an invariant stops being
one.

**If D-16D-05 resolves to (b)** — close 16D as delivered — only Checkpoints 8 and 9 apply.

**No infrastructure checkpoint is proposed.** Per §14 of the brief, a scheduler would be a separate
phase, and per §8 nobody owns it.

---

## 13. NOT VERIFIED, unchanged

Phase 16C's twenty-two stand. Nothing in this investigation reduced the list, and nothing may until a
decision is approved:

business days · escalation · scheduled firing · `JobPort` · durable scheduler · role approvers ·
dynamic role or group directory · external approvers · notification delivery · analytics · approval
expiry · automatic delegation expiry · outbox · broker · worker · self-service portals · routing
intelligence beyond the approved manager resolution · cohort query · tenant-wide branch or tally
aggregates · volumes above 100,000 · concurrency beyond two connections · authentication through the
real Platform adapter.

---

## 14. Stop conditions met

Three, and each halts a different part of the phase:

1. **Escalation cannot be defined without changing the denominator semantics** (§5) — the blocker the
   brief names explicitly.
2. **Automatic execution requires an unowned infrastructure capability** (§7, §8) — all four
   time-triggered behaviours.
3. **Business-day SLA requires a completed-module change that is not authorized** (§9).

A fourth is borderline and is recorded rather than claimed: **D-16D-05** asks whether the phase exists
at all, and answering it by inference would be exactly the assumption this checkpoint exists to
prevent.

---

**Phase 16D Checkpoint 1 is complete. Checkpoint 2 must not begin until D-16D-02, D-16D-04 and
D-16D-05 are explicitly approved.**
