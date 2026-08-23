# Phase 5.2 · Checkpoint 3 — Verification

*Implemented 2026-08-23 on `claude/phase-5-employment-workforce-xaxasu`, from the baseline `274e386`.*

Three things landed together, because the owner approved them together: the two decisions Checkpoint
2 left open, and the capability that was planned to follow them.

---

## 1. What was built

| | |
|---|---|
| **D-5.2-18** | Two permissions. Conducting an inquiry is no longer implied by recording a violation; an inquiry's findings need a second grant, applied inside the query. |
| **D-5.2-19** | Correction as a **new** immutable investigation linked backward to the conclusion it corrects. The corrected row is never written to. |
| **Checkpoint 3** | `relations.escalation-context` — repeat-violation counting over the tenant's configured window, derived and persisted nowhere. |

One migration, `20260823090000_relations_corrections`. One column, two CHECKs, two indexes, one
widened CHECK. **No table created, no trigger created or altered, no CHECK narrowed, no policy
changed, no data backfilled.**

## 2. The approved decisions, as implemented

### D-5.2-18 — investigation permissions

```
relations.investigation.conduct        open · conclude · correct
relations.investigation.read-findings  required *in addition to* relations.violation.read
```

**Six permissions in total, and no seventh.** There is deliberately no
`relations.investigation.read`: an inquiry's *existence* is part of the case, which
`relations.violation.read` already reaches. A test asserts exactly two investigation permissions
exist, which is D-5.2-18's "no fifth investigation permission" written as an assertion.

**The findings rule is Documents' rule.** `mayReadFindings` is one function, called by every read
that could carry findings, in the shape of `hiddenFromCaller`. A caller without the grant meets:

* **`not_found`** on a concluded inquiry fetched by identifier — never `forbidden`, because
  "forbidden" confirms that findings exist about somebody, and in this domain that confirmation is
  the disclosure;
* a **listing that still shows the inquiry exists**, with findings and recommendation **absent** —
  not blanked, not marked redacted, and therefore indistinguishable from an inquiry still open;
* **an open inquiry returned normally**, because it has concluded nothing to withhold.

**No access event is written for a read that was refused.** An audit trail that recorded reads which
did not happen would answer its own question wrongly.

**The leak paths are tested, not assumed.** Each payload is serialized and asserted not to contain
the findings text — the listing and the case history included — so a future mapper that forgot the
flag fails a test rather than shipping a disclosure.

**One earlier assumption was corrected in place rather than deleted.** Checkpoint 1 recorded that
Relations needed no `PermissionChecker`, *"because a caller either may read a violation or may not"*.
`relations-dependencies.ts` now records why that stopped being true and what replaced it.

### D-5.2-19 — correcting a concluded investigation

`relations.correct-investigation` inserts a new investigation carrying `corrects_investigation_id`,
its own findings and recommendation, and a **required** correction reason.

**The corrected row is never written to.** Not updated, not stamped, not re-pointed, not
soft-deleted — there is no `update` call anywhere on the correction path. The proof is two
assertions in the integration suite:

1. the corrected row is read back **byte-for-byte identical** after a correction, `version` included;
2. a direct `update` and a direct `delete` on it **still raise `relation_investigation_concluded`** —
   the Checkpoint 2 trigger is exactly as it was, so **D-5.2-17 was not reopened**.

That is what a backward pointer buys. `letter_issued` had to narrow its trigger to admit a forward
supersession stamp; Relations needed no such exception, because it already derives "which one is
operative" from persisted history the way it derives case state.

| | |
|---|---|
| Operative conclusion | **Derived** — the concluded investigation nobody has corrected. No `is_current`, no `superseded_at`. |
| Chain shape | Linear. `relation_investigation_corrects_idx` is partial-unique on `(tenant_id, corrects_investigation_id)`. |
| Concurrency | Two simultaneous corrections of one conclusion: **one commits, one raises on the index**, proved with two real connections. |
| Correcting a correction | Permitted — the newest link is what a second correction attaches to. |
| Case lifecycle | **Untouched.** A correction restates findings; the case is at `findings` and stays there. `PERMITTED_CASE_TRANSITIONS` is unchanged. |
| Audit | The correcting row *is* the record — its own actor, timestamps and reason. No second audit system. |

**A defect found and fixed while implementing this.** An early draft refused to correct any row that
*was itself* a correction, which would have made a correction permanently uncorrectable. A test
caught it; the guard was removed rather than worked around, because "has this been corrected" is a
question about the chain — which the use case reads and the index settles.

## 3. Checkpoint 3 — the capability

`relations.escalation-context` answers *how many violations of this category fall inside the
configured window*, and the single violation read now carries its own `occurrence` ordinal.

**`repeat_window_days` is operational.** It had been tenant-configurable since Checkpoint 1 and **no
logic read it** — the ADR-0070 shape, a setting nothing maintains. A test seeds identical data under
two categories whose windows differ and asserts the counts differ, which is the whole point.

### Window semantics

| Question | Answer |
|---|---|
| Boundary | **Closed at both ends.** 180 days back from `2026-08-23` is `2026-02-24`, and that day counts. |
| Day before | Excluded — asserted in both directions, in the domain and against SQL `between`. |
| Reference date | The server's civil date, or an explicit `asAt`. A malformed `asAt` is **refused**, never silently replaced. |
| The violation asked about | Counts. |
| After the reference date | Excluded. |
| `windowDays = 0` | The reference date alone. |
| Ordering | `(occurred_on, violationId)` ascending — same-day violations are deterministic. |
| Ordinal stability | Measured from **the violation's own conduct date**, so it does not renumber as time passes. |
| Daylight saving | UTC arithmetic on date-only values; a spring-forward and a leap day are both asserted. |

### What it does not do

**Nothing is persisted**: no `occurrence`, `repeat_count`, `is_repeat`, `breached` or
`escalation_level` column exists, the migration adds none, and tests assert none appears on any row.

**Nothing is decided**: no penalty, no action, no warning, no case movement, no Payroll adjustment,
no notification. The result carries no field resembling a conclusion, asserted by name.
**D-5.2-20 remains OPEN** — what a repeat *produces* is still undecided, and no disciplinary action
vocabulary exists in this module.

**Audited.** A new `escalation_read` action, one event per violation the count actually disclosed and
none when it disclosed nothing — so identifiers cannot be used to write into the trail by guessing.

## 4. A pre-existing defect this checkpoint surfaced

`ViolationRow.occurred_on` was typed `string` since Checkpoint 1, but `node-postgres` returns a
`date` column as a JavaScript `Date`. **No test had ever read one back from the database**, so the
type lie was invisible for two checkpoints.

Checkpoint 3 is the first code whose correctness depends on it: the repeat window compares civil
dates as strings, and a `Date` on the left of that comparison silently produces the wrong set. Every
read of `relation_violation` and `relation_investigation` now names its columns and wraps the dates
in `to_char` instead of `select *`.

**Proved pre-existing before being classified as such** — a probe against the live driver confirmed
the behaviour independently of this branch.

## 5. Assertions updated, and why none was weakened

Eight assertions became stale because the approved capability genuinely changed the module. Each was
replaced with an **exact** statement of the new boundary; none was deleted.

| Assertion | Before | After |
|---|---|---|
| Permission set | exactly four, listed | exactly six, listed |
| Absent capabilities | included `investigation` | `investigation` removed **only because D-5.2-18 approved it**; replaced by an assertion that exactly two investigation permissions exist |
| Declared vs published | the two sets are equal | every declared permission is published, and **exactly one** published permission is undeclared — named as `read-findings`, because it guards a payload rather than an operation |
| Commands | five, listed | six, listed; `correct-investigation` left the forbidden list and was replaced by assertions that the correction **adds a record rather than editing one** |
| Queries | six, listed | seven, listed |
| Access actions | five | six |
| Module surface | 5 commands / 6 queries / 4 permissions | 6 / 7 / 6 |
| Route dispatch | eleven names | thirteen names |

The forbidden-command list *gained* four entries while losing one — `amend-investigation`,
`update-investigation`, `transition-case`, `set-case-state` — so the negative space is tighter after
this checkpoint than before it.

## 6. Regression protection

| Decision | State | Evidence |
|---|---|---|
| D-5.2-03 | intact | `relation_violation` untouched; its migration not modified |
| D-5.2-07 | intact | catalogue ordering unchanged |
| D-5.2-15 | intact | lifecycle still lives in `relation_case_event` |
| D-5.2-16 | intact | current state still derived; no `current_state` column, asserted |
| D-5.2-17 | intact | both Checkpoint 2 triggers unchanged, proved after a correction |
| D-5.2-20 | **OPEN** | no ladder, no action vocabulary, no prescription |
| Workflow | unchanged | no file under `modules/workflow` in the diff |
| Payroll | unchanged | no file under `modules/payroll` in the diff |
| Platform | unchanged | not touched; nothing scheduled |

## 7. Stated limitations

1. **UTC "today"** — inherited from Checkpoints 1 and 2 and unchanged. Near midnight far from UTC,
   the server's default reference date may differ from the tenant's by a day. `asAt` lets a caller
   be explicit; reading a tenant's time zone remains an unopened cross-module contract.
2. **No performance index was added.** §9 of the plan asked for measurement first, and the existing
   indexes serve the query at the volumes the suites produce. A decision, not an oversight.
3. **Legal validity is `NOT VERIFIED`.** The repeat window is tenant configuration and asserts
   nothing about what any jurisdiction permits. Deferred to Phase 11.1 (D-5.2-06); no pack exists.
4. **The occurrence ordinal is on the single read only**, not the listing — an ordinal per row would
   turn a page of fifty into fifty-one queries to decorate a list nobody counts from.
5. **`read-findings` is undeclared by any handler**, by design, and therefore does not appear in a
   handler's permission declaration. It is enforced inside the query and asserted as the single
   permitted exception.
