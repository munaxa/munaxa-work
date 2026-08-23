# Phase 5.2 — Employee Relations & Disciplinary · Checkpoint 2

**Investigations and the Relations case lifecycle.**

Branch `claude/phase-5-employment-workforce-xaxasu`. Baseline `c4928d2` (Checkpoint 2 plan and
decision analysis). Owner approval of D-5.2-15, D-5.2-16 and D-5.2-17 received 2026-08-23.

---

## 1. What was built

A case is a violation plus what has happened to it. Checkpoint 1 delivered the violation, immutably.
Checkpoint 2 delivers the "what has happened to it": inquiries, and the lifecycle they move.

**Two tables.** `relation_investigation` — the inquiry into a violation, mutable while open and
immutable from the moment it concludes. `relation_case_event` — one row per accepted transition,
append-only, carrying who, when, from where to where, and why.

**Two commands.** `relations.open-investigation` moves a case `reported → under_investigation` and
writes the inquiry. `relations.conclude-investigation` records findings and a recommendation and
moves it `under_investigation → findings`. Each writes its investigation row and its transition row
in **one transaction**.

**Three queries.** One inquiry, a violation's inquiries, and a case's history with its current state.
Every one of them writes an access event.

**No new permission.** See §6.

---

## 2. The finding that shaped it, and how it was resolved

The Checkpoint 2 investigation found that **the specification's lifecycle cannot be implemented by
updating `relation_violation`**: Checkpoint 1 made that row trigger-immutable and CHECK-locked its
`state` to `'reported'`. That is the reason D-5.2-15 existed at all.

The approval resolved it by **separating the two facts**. A violation row is the factual record of
what was reported, and a factual record does not move. Where the *case* has got to is a different
fact, and it lives in its own append-only table. `relation_violation` was not altered by this
checkpoint — not its columns, not its CHECK, not its trigger. **D-5.2-03 was not reopened.**

---

## 3. Where the current state lives

**Nowhere.** It is derived (D-5.2-16): the `to_state` of the case's highest-numbered event, and
`reported` for a case with none — because the violation being recorded is what reported it, and
writing an event to say so would be recording that a thing is itself.

There is no `current_state` column on any table, no `currentState` field on any persisted record, and
no projection. A second copy is a second thing that can disagree with the first, which is what
ADR-0070 means by *"a stored flag that nothing maintains is worse than no flag"*. No projection was
built for performance either: the derivation is one indexed lookup over a handful of rows per case,
and inventing a cache before measuring would be the redundant column the approval forbids.

`CaseHistoryView.currentState` exists so a screen need not re-derive it, and it is computed by
`caseHistoryView` at read time from the history published beside it — using the same function the
command handlers validate against, so what a screen shows and what the server enforces cannot drift.

**Asserted:** `relations-lifecycle-boundaries.test.ts` fails if a `current_state` column, a persisted
`currentState` field, a state-machine engine, an event-sourcing library, or a projection appears.

---

## 4. The state machine

Three states — `reported`, `under_investigation`, `findings` — and two edges.

```
reported ──open an inquiry──▶ under_investigation ──conclude it──▶ findings
```

**Three, not the specification's twelve.** The lifecycle continues through pending-approval,
action-issued, acknowledged, appealed, upheld, annulled, expired and archived. Every one of those is
reached by a capability this checkpoint does not build, and a vocabulary listing a state nothing can
produce is a promise the code cannot keep — the promise Checkpoint 1 declined to make when it shipped
`VIOLATION_STATES` with one value. The database CHECK widens by an approved change, exactly as
`workflow_history`'s event CHECK was widened for `step-reminded`.

**A negative-space test asserts the later states are not nameable anywhere in the module**, so the
restraint survives a refactor.

Nothing returns to `reported` and nothing leaves `findings`. Reopening a concluded case and acting on
findings are both later capabilities; leaving their edges out means a request for them is refused by
name rather than silently accepted into a state nothing can act on.

**All nine pairs are asserted exhaustively**, not sampled.

---

## 5. How a transition is decided

The server derives the current state from persisted history and validates the request against it.
**No command carries a `from` state**, no DTO has a field for one, and no route accepts one — and
`recordTransition` ignores a supplied `fromState` even if one reached it, which a test proves. A
caller who could name the state their transition needs would be having the server validate their
claim rather than the case.

`actor` comes from the authenticated execution context and `occurredAt` from the clock port. Neither
is a field a request can set: a transition attributable to whoever asked for it is not an audit
trail, and a recording time a client chooses is one a client can backdate. `reason` is required with
no default — a defaulted reason is an absent one wearing a label.

---

## 6. Permissions — and the STOP that was honoured

**No permission was created.** The authorization required stopping before creating one unless the
repository proved an additional capability unavoidable. It is not: Checkpoint 2 is fully implementable
with `relations.violation.record` (open, conclude) and `relations.violation.read` (the three reads),
and the shipped implementation is the proof.

The case for separating investigation permissions is real and is **recorded as D-5.2-18, open**, not
implemented. The consequence of today's choice is stated there plainly: a user who may record a
violation may also open and conclude an inquiry.

`ALL_RELATIONS_PERMISSIONS` is still exactly four, asserted. No wildcard, no prefix, no role logic,
no permission belonging to another module.

---

## 7. Concurrency

**Settled by the database, proved with two real connections.**

`relation_case_event_sequence_idx` is unique on `(tenant_id, violation_id, sequence)`. Two requests
that read the same current state compute the same next number, and exactly one commits — ADR-0071
applied to a lifecycle: *a `select` followed by an `insert` is not idempotent under concurrency*, so
the index arbitrates rather than the read. An optimistic version column on the violation could not
have done this job, because that row is immutable and never updated.

`relation_investigation_open_idx` is a **partial** unique index on `(tenant_id, violation_id) where
state = 'open' and deleted_at is null` — one inquiry in progress per violation, any number of
concluded ones. The application's `openFor` read gives the ordinary caller a business refusal; it is
explicitly *not* what makes the rule true.

`relations-case-lifecycle.integration.test.ts` starts both transactions against a real PostgreSQL and
asserts the **outcome** — exactly one row, exactly one caller refused, and the refusal naming the
index. It asserts no winner, because asserting a winner would be asserting a race. **No sleep, no
fake timer, no timing assumption.**

---

## 8. Immutability

| Table | Rule | Trigger |
| --- | --- | --- |
| `relation_violation` | unchanged from Checkpoint 1 | untouched |
| `relation_case_event` | every update and delete refused, always | `app_relation_case_event_immutable` |
| `relation_investigation` | refused **once concluded**; permitted while open | `app_relation_investigation_refuse_concluded` |

The conditional trigger follows `app_letter_template_version_refuse_issued`, which refuses a change
only after first issue. **Both directions are asserted** — an open inquiry can still be corrected, a
concluded one cannot — because a trigger that refused both would be wrong in the other direction and
a one-sided test would not notice.

Soft deletes are refused too: a soft delete is an update. The `deleted_at` columns exist because
every table carries them and are unusable by construction, which is asserted rather than commented.

Not relying on application checks alone: the application layer also has no method that could rewrite
a case event — `CaseEventStore` offers `forViolation` and `insert` and nothing else.

---

## 9. Audit

Three new access actions — `investigation_read`, `investigation_listed`, `case_history_read` — added
to the existing vocabulary rather than to a second trail, because *"who looked at this case"* is one
question and answering it from two tables would mean joining them to answer it. Every access event is
keyed by the **violation**, so one case has one trail.

Events are written **inside the read's own transaction**: a read whose trail cannot be written does
not return a record. A read that found nothing writes nothing, so a caller cannot write into the
trail by guessing identifiers.

The catalogue is still unaudited. A list of the words a policy is written in names nobody, and
auditing it would be the "audit every query" mechanism D-5.2-05 forbids.

Disciplinary content stays out of generic audit metadata: the access trail carries who looked at
which record and nothing about the record — no findings, no recommendation, no description.

---

## 10. The one new cross-module dependency

An investigator is a membership the caller **assigns**, so the identifier arrives on the command — and
a value a command supplies is a value a command can invent. Without a check, a tenant could accumulate
inquiries attributed to memberships that never existed, and nothing would notice until a tribunal
asked who conducted one.

`RelationsMembershipDirectory` asks Identity's **already published** `identity.membership-standing` —
one identifier in, one boolean out — under a bounded service grant (ADR-0043) naming
`identity.membership.read` for the operation `relations.open-investigation`. **No Identity change, no
new query, no new permission, no widened contract.** Workflow reaches the same query the same way for
escalation; this is that adapter with a different reason attached.

Relations learns whether the membership may act and nothing else — not a name, not a role, not an
employment. AD-001 holds: this module still knows no people. `not_found` collapses to `false`; every
other failure raises, because a database that cannot answer has not said no.

---

## 11. What was deliberately not built

Asserted by negative-space suites, not promised in prose:

- **No disciplinary action, warning, grievance, appeal, penalty, hearing, evidence, attachment or
  termination** — each arrives with the checkpoint that builds it.
- **No scheduler, worker, timer, cron, machine actor, `JobPort`, automatic expiry or background
  execution.** Nothing moves a case on its own; every transition is a named human's act (ADR-0045).
- **No Payroll change and no inbound Payroll command.** A recommendation is text; nothing acts on it.
- **No Employment mutation from Relations.**
- **No Workflow change and no second approval system.**
- **No labour-law enforcement and no jurisdiction-specific rules.**
- **No event raised.** `InvestigationOpened` and `InvestigationConcluded` are command *results*
  returned to the caller; the case-event row is the durable record. Dispatch is at-most-once with no
  outbox (ADR-0053/0064), and an event nobody consumes is a promise about delivery to nobody.
- **No route that sets a state**, no `PATCH`, no `PUT`, no `DELETE`, no tenant-wide listing, no route
  accepting a tenant.
- **No correction path for a concluded investigation** — deferred, recorded as D-5.2-19.

---

## 12. Assertions that were updated, and why none was weakened

Five Checkpoint 1 assertions failed once Checkpoint 2 built what Checkpoint 1 declared absent. Each
was updated to stay at least as exact:

| Assertion | Change | Why it is not weaker |
| --- | --- | --- |
| `holds no Investigation type` | entry removed from the exclusion list | Removed **only** because the capability was approved; every other entry stayed, and the protection is replaced by tests of how investigations actually behave. |
| exact query-name set | three names added | Still an exact set; a new query added later still fails it. Plus a new assertion that every Checkpoint 2 list is scoped to one violation. |
| exact command-name set | two names added | Still exact, and the forbidden list **grew** — `correct-investigation`, `delete-investigation`, `transition-case`, `set-case-state`. The original point (nothing mutates a violation) is unchanged and still true. |
| `ACCESS_ACTIONS` strict equality | three actions added | Still strict equality. |
| handler-count assertions | 6 → 11 | The load-bearing assertions — every handler declares a published permission, and the declared set equals the published set — are untouched, and the permission count is still asserted at four. |

Two assertions I wrote in this checkpoint were themselves imprecise and were made exact rather than
deleted: `EventStore` matched the tail of `CaseEventStore` (narrowed to a word boundary, plus a
positive assertion that those two ports still exist), and `currentState:` matched the view that
legitimately derives it (narrowed to the domain and infrastructure layers, plus a positive assertion
that the view computes it).

---

## 13. Gates

| Gate | Result |
| --- | --- |
| `pnpm standards` | no violations · 181 models · 18 catalogue sets complete · no cycles |
| `pnpm format:check` | all files match Prettier |
| `prisma validate` | schema valid |
| `prisma migrate status` | 27 migrations, database up to date |
| `pnpm exec turbo run build lint typecheck test --force --concurrency=1` | see §14 |

Localization: `en.json` and `ar.json` both extended with the lifecycle vocabulary, both complete.

---

## 14. Known limitations, stated rather than hidden

1. **`concluded` is terminal and uncorrectable.** AD-003's *"a correction is a new, linked record"*
   has no implementation. D-5.2-19, open.
2. **Civil dates are computed in UTC.** Near midnight far from UTC, "today" here may differ from
   "today" in the tenant by a day, so an inquiry opened on the local evening of the 5th could be
   refused as future-dated. The same limitation Checkpoint 1 recorded, for the same reason: reading a
   tenant's time zone is a cross-module contract no checkpoint has been authorized to open.
3. **A user who may record a violation may also open and conclude an inquiry.** D-5.2-18, open.
4. **The Documents concurrency test (`lets two simultaneous supersessions produce one stamp`) is
   intermittently flaky.** It asserts *which* of two racing transactions won. No Documents file is in
   this change set. Recorded in the Checkpoint 1 report and still out of scope.
