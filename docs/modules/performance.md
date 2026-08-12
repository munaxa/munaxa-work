# Performance

**Performance says what somebody was rated, what that rating was measured against, and why — for as
long as the record has to answer for itself.**

Phase 13. Twenty-three tables. Package `@work/performance`.

Every score in it is a **whole number of hundredths** and every weight a **whole number of basis
points**. There is no `numeric` column anywhere in the module. That is the single most important
sentence about it, and everything below is consistent with it.

---

## What it owns

Rating scales and their ordered levels; competency frameworks, their competencies and behavioural
levels; review templates and the component weights that must total one whole; goal categories;
review cycles and the participants enrolled in them; goals, their progress history and how each
ended; reviews, the self, peer and manager assessments written against them, and the **persisted
working** each score was derived from; the 360° reviewer panel; calibration sessions and the
decisions taken in them; nine-box placements; continuous feedback; and the **completion snapshot**
that lets a rating still be explained years later.

## What it does not own, and why

| Absent | Where it belongs | Why |
| --- | --- | --- |
| Who the employee is, their name, their manager | People and Employment | Read through published contracts under a bounded service grant. A review carries an employment identifier; a screen that wants a name asks the module that owns it (AD-001) |
| Salary, bonus, any pay consequence | Compensation and Payroll | **There is no adapter and no grant that could fetch one.** A performance review must not display a salary, and Compensation pulls a rating when it wants one (AD-005, ADR-0058) |
| The bytes of an evidence document | Storage | `StoragePort` has no adapter. A goal stores a document identifier and no filename, size, hash or URL |
| Accreditation, certification, training records | Learning | Performance owns whether somebody is effective at their job; Learning owns evidence of what they were taught |
| Career paths and succession | Phase 15 | The nine-box records a placement. It does not imply a destination |
| One-to-ones and improvement plans | Excluded from this phase | No table, no port, no route, no screen. Not partially built |
| Which employment a signed-in person *is* | Nowhere in this repository | There is no principal → employment resolution (ADR-0032). Everything downstream of that absence is named in `NOT VERIFIED` below |
| Objectives and key results | Deferred | Tables exist with RLS and indexes; there is **no application port, no repository, no API route and no screen**. Schema ahead of application, recorded rather than hidden |
| Notification delivery | A transport that does not exist | Intent is recorded; nothing sends it (D-21) |
| Anything on a schedule | A scheduler that does not exist | A cycle closes because somebody closed it (D-22) |

---

## The five decisions that carry the module

### A score is an integer, and an absence is not a zero

ADR-0069. Hundredths and basis points, `bigint` in the engine, one division rounding half away from
zero. A component nobody assessed **leaves the denominator** with one of four recorded reasons
rather than being scored zero — rating somebody at the bottom of the scale for work nobody looked at
is the outcome that rule exists to prevent. The distinction between *absent* and *zero* is kept at
every layer, down to the Admin screen rendering `—` rather than `0.00`.

### A completed rating is explained from a snapshot

ADR-0068. Completion writes the scale, the levels, the template, the component weights, the working
and the placement into one immutable row, in the same transaction, **after** the version-guarded
update. Retiring the scale, retiring the template and moving the employment to a different manager
in a different unit changes nothing the review says — asserted end to end against real PostgreSQL.

### Calibration records a second number; it never replaces the first

A decision carries both the original and the calibrated score, with a mandatory reason and a named
human. A trigger refuses an update that would change the original. The published view carries both
fields, and the Admin screen shows both — a single "score" field would make a moderated rating
indistinguishable from one the engine produced, which is exactly what somebody being moderated would
want to know.

`calibrate` and `complete` are **separate permissions**, deliberately: moving a rating in a meeting
and signing a review off are different decisions, and one permission covering both would let whoever
ran the meeting finalize its outcomes unreviewed.

### Self and peer assessments are recorded, readable, and count for nothing

No weight was ever approved for either, so none was invented. The API publishes no `contribution`
field on one and the Admin screen states beside each assessment which of the three the score came
from. `NOT VERIFIED`, and visibly so.

### Confidential is not anonymous

Every 360° response is an attributed row: the table carries `created_by`, the correlation identifier
records the request, and row-level security is tenant-scoped. Below a template's configured minimum
the panel aggregate is **withheld** — the field is named `available`, not `anonymous`. The word
appears exactly once in the rendered Admin page, inside the sentence denying it. Telling an employee
their feedback was anonymous when it is not is a claim this architecture cannot make.

---

## Permissions

Seventeen, and three separations matter:

- **`review.read-team` and `review.read-all`.** A manager reading their reports and HR reading the
  organization are different capabilities. A single permission covering both is how a manager comes
  to read a peer's review.
- **`assess` and `assess-peer`.** Writing an assessment and responding to an invitation are
  different acts. What narrows the peer path is the invitation the handler looks up, not the
  permission — recorded as debt in the final report.
- **`calibrate` and `complete`.** As above.

`review.read-own` and `feedback.read-about-self` are **declared and route to nothing**. They name
capabilities the platform cannot yet grant, and `UNROUTED_PERFORMANCE_PERMISSIONS` says so in code.

---

## What is `NOT VERIFIED`

Each is a missing dependency, not a broken implementation. None is approximated anywhere in the
module, the API or the screen.

| Capability | State |
| --- | --- |
| Principal → employment resolution | No adapter exists (ADR-0032) |
| `review.read-team` without a trusted manager employment | A `read-team` caller reads **nothing**, whatever they name. The parameter is a filter honoured only alongside `read-all` |
| Notification delivery | Intent recorded; nothing delivers it |
| Scheduled execution | Nothing opens or closes on a timer |
| Binary document upload, download, signed URLs | No storage adapter |
| True 360° anonymity | Confidentiality only, and the product says so |
| Self / peer weighting | Recorded and readable; counted by nothing |
| OKR functionality | Tables and RLS; no application contract |

---

## Where to read further

- [Phase 13 final report](../verification/phase-13-final-report.md) — benchmarks, audits, defects
- [Planning checkpoint](../verification/phase-13-plan.md) — the thirty-one approved decisions
- Layer reports: [application](../verification/phase-13-application-report.md) ·
  [PostgreSQL](../verification/phase-13-postgres-report.md) ·
  [API](../verification/phase-13-api-report.md) ·
  [Admin UI](../verification/phase-13-admin-ui-report.md)
- [ADR-0068](../adr/0068-a-rating-is-explained-from-a-snapshot.md) ·
  [ADR-0069](../adr/0069-a-score-is-an-integer-and-an-absence-is-not-a-zero.md)
