# Phase 5.2 · Checkpoint 4 — Disciplinary actions · Verification

*Implemented 2026-08-23 on `claude/phase-5-employment-workforce-xaxasu`, from the baseline `be8ea9e`,
under the owner's approval of D-5.2-20.*

---

## 1. What was built

Two tables, three commands, three reads, three permissions, one lifecycle edge.

| | |
|---|---|
| **The ladder** | `relation_disciplinary_rule` — tenant configuration: category, threshold, action, sequence, active. |
| **The evaluation** | `relations.applicable-action` — derived at read time, writes nothing, prescribes nothing where the tenant configured nothing. |
| **The act** | `relations.issue-disciplinary-action` — a named human's decision, recorded immutably, moving the case to `action_issued`. |

## 2. D-5.2-20's principle, as code

**Counting and prescribing stayed separate.** `relations.escalation-context` is unchanged: it still
reports a count and no outcome. The ladder consumes that derivation — through the same
`occurrenceOf` function, not a second count — and reports what the tenant's configuration makes of
it. Neither persists anything.

**Where a tenant has configured no rule, nothing is prescribed.** This is asserted in the domain, in
the application suite, and expressed in the published contract by `action` being optional. It is the
property that separates decision support from an engine that invents outcomes, and the reason an
absent answer is returned rather than a lowest rung, a default, or a guess.

**Nothing is punished automatically.** Issuing is a command a human sends holding
`relations.action.issue`. Nothing observes a violation being recorded, nothing reacts to a threshold,
and there is no path from evaluation to issue. Asserted structurally: no event handler, no
subscription, no `autoIssue`, no `onViolationRecorded`.

## 3. The vocabulary, and where it stops

`verbal_warning` · `written_warning` · `final_warning` · `suspension_recommendation` ·
`termination_recommendation`

Five rungs, each with a business meaning this module can represent. **The two most serious are
recommendations** because Employment owns `suspended` and `ended` (AD-005) — and a value called
`termination` would promise something Relations must never do. `suspension`, `termination`,
`dismissal`, `payroll_deduction` and `fine` are asserted **not** nameable anywhere in the module.

The vocabulary is closed at the database too, so an operator writing raw SQL cannot store a value the
product cannot represent — asserted against a direct `insert`.

## 4. Frozen versus derived

The distinction the approval asked for, drawn exactly:

* **A recommendation is derived from current configuration.** Amend the ladder and the recommendation
  changes — asserted. Nothing is frozen, because nothing was decided.
* **An issued action freezes what it meant.** `action`, `occurrence_at_issue` and
  `prescribed_by_rule` are copied at issue (AD-003); `disciplinary_rule_id` keeps the link. Re-grading
  the rule to `termination_recommendation` and deactivating it afterwards leaves the issued written
  warning untouched — asserted.

**No snapshot beyond that.** The rule's text is not copied: the link plus the frozen action answers
both questions a tribunal asks — which rule, and what was actually issued.

## 5. Grounding in the investigation

An action **requires a concluded inquiry**, enforced twice: the handler refuses
`no_concluded_investigation`, and the transition `findings → action_issued` is validated against the
state the server derives from persisted history.

**The operative conclusion is the one that counts.** After a correction (D-5.2-19), an action rests on
the correcting investigation, not the superseded one — asserted, along with the fact that neither
investigation is mutated by issuing.

## 6. Concurrency, proved against PostgreSQL

Two real connections contending, no sleeps and no timing assumptions:

| Race | Arbiter |
|---|---|
| Two administrators configuring the same rung | `relation_disciplinary_rule_threshold_idx` (partial unique) |
| Two officers issuing on one case | `relation_disciplinary_action_violation_idx` (unique per violation) |

A deactivated rung does not block its replacement — the index is partial for exactly that — asserted.
Rule amendment uses the `expected` version, so two administrators editing one rung do not silently
overwrite each other.

## 7. Immutability, RLS and audit

* **An issued action refuses every update and delete**, from any path — including a soft delete,
  which is an update. Asserted against raw SQL.
* **RLS enabled *and forced*** on both new tables, verified as an unprivileged role that cannot
  bypass it, in **both directions**: a tenant sees its own rows and none of its neighbour's.
* **Reading an issued action is audited** under a new `disciplinary_action_read`; a case with no
  action writes no event, so identifiers cannot be used to write into the trail by guessing.
* **The ladder read is not audited** — a list of thresholds names nobody, exactly as the catalogue
  read is not audited.

## 8. Boundaries

| Boundary | State |
|---|---|
| Payroll | **untouched** — no file in the diff, no deduction, no adjustment, no inbound command |
| Employment | **untouched** — no suspension, no termination, no status write |
| Workflow | **untouched** — no subject, no approval, no second approval mechanism |
| Platform | **untouched** — nothing scheduled |
| Documents / storage | **deferred** — D-5.2-08 not reopened, no adapter, no bytes, no URL |
| Country pack | **preserved** — D-5.2-06 intact; enforcement `NOT VERIFIED` |

Each is a test, not a promise: 79 assertions in `relations-lifecycle-boundaries.test.ts`.

## 9. Assertions updated, and why none was weakened

Twelve became stale because the approved capability genuinely changed the boundary. Each was replaced
with an exact statement of the new one.

| Assertion | Before | After |
|---|---|---|
| Permission set | six, listed | nine, listed |
| Absent capability list | included `action` | removed **only because D-5.2-20 approved it**; replaced by an assertion that exactly three disciplinary permissions exist, and that `relations.admin`, `relations.manage` and `relations.write-all` do not |
| Absent type list | included `DisciplinaryAction` | removed for the same reason; the capability's behaviour is now asserted directly |
| Unreachable lifecycle states | included `action_issued` | removed; **replaced** by an assertion pinning the exact reachable set and that `action_issued` is terminal |
| Case states / transitions | three states, two edges | four states, three edges, all sixteen pairs asserted |
| A Checkpoint 2 integration test | asserted `action_issued` is CHECK-refused | now asserts `acknowledged` — a state *still* unreachable, so the protection moved with the boundary rather than being dropped |
| Commands / queries / routes | six / seven / thirteen | nine / ten / nineteen |
| Access actions | six | seven |

**The negative space is tighter after this checkpoint than before it**: 79 boundary assertions were
added covering Payroll, Employment, Workflow, Platform, storage, country law, expiry and automatic
punishment — none of which existed before there was a disciplinary action to tempt them.

## 10. Two defects found and fixed during implementation

1. **A legitimate departure from the ladder was refused.** The handler attached the matched rule even
   when the human issued a *different* action, so the domain's provenance guard rejected it. A rule
   that prescribes something else did not prescribe this: the rule is now attached only when it
   matches, and the record says `prescribedByRule: false`. Caught by a test written for the
   approval's own requirement that the ladder must not override human judgement.
2. **An occurrence was clamped rather than derived.** An early draft used `Math.max(…, 1)` for a
   violation that had fallen out of its own window — writing a plausible number nobody could justify
   onto a disciplinary record. Replaced with the Checkpoint 3 ordinal measured from the violation's
   own conduct date; an unanswerable case is refused instead of guessed.

## 11. Stated limitations

1. **UTC "today"**, inherited and unchanged. Near midnight far from UTC the server's date may differ
   from the tenant's by a day.
2. **No approval step.** A disciplinary action is issued directly by an authorized human. The
   specification's *Pending Approval* state is not built and `pending_approval` is asserted absent —
   Workflow integration is a separate bounded capability nobody has authorized.
3. **No acknowledgement, appeal, expiry or annulment.** Each needs a capability this checkpoint does
   not build; none is stubbed.
4. **One action per case**, enforced by a unique index. Whether a matter can ever attract a second
   action is a decision nobody has taken, so it is refused rather than left to a caller's discipline.
5. **Legal validity is `NOT VERIFIED`.** The ladder is tenant configuration and asserts nothing about
   what any jurisdiction permits — no maximum warning count, no mandatory suspension period, no
   dismissal precondition. Phase 11.1 owns country packs.
6. **No letter is produced.** A written warning records that one was issued, not the document itself;
   Letters owns that, and no integration is authorized.
