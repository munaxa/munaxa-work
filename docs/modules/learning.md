# Learning

**Learning records what somebody was asked to do, what they sat, what an assessor observed, and what
they hold — and it evaluates nobody.**

Phase 14A. Twelve tables. Package `@work/learning`.

There is **no `numeric` column, no `bigint` and no money anywhere in the module**. Every number it
stores is a small schema-constrained integer — a duration in minutes, a recurrence in months, a
step's position. The one freely-typed value is `learning_assessment_result.raw_mark`, a
`varchar(32)` that nothing in this product parses. That is the single most important sentence about
it, and everything below is consistent with it.

---

## What it owns

Course categories; courses and every version each has had; the assessments a version asks somebody
to demonstrate; learning paths and their ordered steps; the rules a tenant makes mandatory and of
whom; the assignments those rules generate and the direct ones somebody makes; enrolments and the
course version each pinned; the outcomes assessors recorded against them; the certifications issued,
revoked and superseded; and the instructors who deliver training.

## What it does not own, and why

| Absent | Where it belongs | Why |
| --- | --- | --- |
| Who the employee is, their name, their manager | People and Employment | Read through published contracts under a bounded service grant. A training record carries an employment identifier; a screen that wants a name asks the module that owns it (AD-001) |
| What somebody *claims* they can do | People (`person_capability`) | A claimed capability and an attained one are different facts about a person, and conflating them is how an unverified claim becomes evidence |
| What a manager *observed of the job* | Performance | AD-002: **course completion does not imply competency.** No column here implies it, and Learning writes no capability, rating or status anywhere outside itself (AD-005) |
| Training cost, budget, chargeback | Nowhere in this repository | No owner exists. Inventing one would create a second answer to a finance question |
| The bytes of a course or a certificate | Storage | `StoragePort` has no adapter. A version stores an opaque `content_reference`; a certification stores a document identifier and no filename, size, hash or URL |
| Sessions, seats, capacity, waitlists | Phase 14B | **No column, no port, no route, no screen.** Not partially built |
| Which employment a signed-in person *is* | Nowhere in this repository | There is no principal → employment resolution (ADR-0032). Everything downstream of that absence is named in `NOT VERIFIED` below |
| Anything on a schedule | A scheduler that does not exist | `JobPort` has no adapter. A requirement is generated because somebody ran the command |
| Notification delivery | A transport that does not exist | Intent is recorded; nothing sends it |
| An aggregate assessment score | Nowhere — it was never specified | The specification names five assessment kinds and defines no threshold, weighting, rounding or attempt policy. An assessor states an outcome and nothing computes one |

---

## The four decisions that carry the module

### Expiry is derived, never stored

[ADR-0070](../adr/0070-learning-owns-the-expiry-of-what-it-issues.md). A certification's
`valid_until` is a civil date; whether it is `valid`, `expiring_soon`, `expired` or `no_expiry` is a
function of that date, the day somebody asked, and how far ahead they said counts as soon. **No
column holds the answer**, because a stored flag would need something to move it overnight and
nothing in this repository runs. A forklift licence that lapsed in March would still read `valid` in
June. The day the answer was computed against is echoed in every response and displayed on every
screen, so nothing ever says "expiring" without saying expiring as of when.

Learning owns the expiry of what Learning issues: a certificate from a completion takes its validity
from the course version the enrolment pinned. A supplied `valid_until` is for a certificate somebody
else issued, where the date on the paper is the only truth there is.

### A recurring requirement is computed, not scheduled

[ADR-0071](../adr/0071-a-recurring-requirement-is-computed-not-scheduled.md). Reconciliation is a
**bounded, idempotent command an administrator sends**. It examines one page of the audience and
says whether more remain. Idempotency is arbitrated by a partial unique index over a derived
`occurrence_key` civil date with `insert … on conflict do nothing` — never a read-then-write, which
is idempotent only when nobody is watching. A retried run creates nothing, and two simultaneous runs
converge.

The next occurrence opens only once the previous one is satisfied. **A dependency that cannot answer
is a refusal, never a zero**: if Employment cannot resolve the audience, reconciliation returns 422
rather than reporting "0 examined, 0 generated" — a compliance report claiming everybody is up to
date about an organization it never looked at is the one outcome worse than an error.

### A mark is the tenant's text, and nothing parses it

`raw_mark` is what an assessor wrote. `18.50` is stored, returned and rendered as `18.50`;
`Number('18.50')` is `18.5`, a different mark on a transcript and one nobody could explain a year
later. Nothing in this module computes with a mark, so nothing is entitled to normalize one. Within
the domain's twelve-integer-digit range every value survives a float round trip on magnitude — the
real risk is **trailing zeros**, and it is guarded at the repository, the API and the rendered HTML.

### A civil date is a day, end to end

Every date Learning stores is a `YYYY-MM-DD` string: the column is read with `to_char`, the domain
compares strings, the command carries a string, the API validates a pattern and the screen renders
it untouched. **There is no `Date` anywhere on the path**, so there is nothing to get wrong — a due
day, an expiry and a completion day are the same day in every time zone, and
`new Date('2026-08-12').toLocaleDateString()` on a server west of UTC renders the 11th.

---

## Boundaries

Learning reads four things from three modules, each through a **published contract under a bounded
service grant** ([ADR-0043](../adr/0043-bounded-service-grant.md)), and
writes nothing outside itself:

| Contract | Grant | Why |
| --- | --- | --- |
| `employment.read-employment` | `employment.employment.read` | A training record names an employment; an unconfirmed one is refused |
| `employment.search` | `employment.employment.read` | Resolving a rule's audience at the moment it is reconciled, so somebody who transfers in tomorrow is covered without anybody editing anything |
| `organization.unit-ancestry` | `organization.hierarchy.read` | A rule naming a unit that does not exist would cover nobody, and a compliance rule covering nobody is worse than no rule |
| `documents.read-document` | `document.read` | A certification may cite evidence; a citation nobody can find is refused |

No grant is wildcard. Nothing is published and nothing subscribes: Performance, Compensation and
Career **pull** a completion or a certification when they want one (AD-005), so there is no delivery
to lose and no outbox to maintain ([ADR-0064](../adr/0064-payroll-calculates-from-a-snapshot.md)).

## Published contracts

Views only — `CourseView`, `CourseVersionView`, `AssessmentView`, `AssessmentResultView`,
`PathView`, `PathDetailView`, `PathStepView`, `MandatoryRuleView`, `AssignmentView`,
`EnrolmentView`, `CertificationView`, `InstructorView`, `LearningHistoryView`, `ReconciliationView`,
`CourseCategoryView`, `LocalizedTextView`. No handler, no store, no dependency type and no domain
aggregate: a consumer that could reach a handler could bypass this module's permission checks.

## Permissions, and the separations that matter

`catalogue.manage` and `assignment.manage` are separate — building a catalogue is an
administrator's job, putting a named requirement on a named person's queue is a manager's.
`assignment.waive` is **not** implied by `assignment.manage`: waiving is the one act that excuses
somebody from a compliance obligation and the one an auditor asks about a year later.
`certification.revoke` is separate from `certification.manage`, and `enrolment.complete` from
`enrolment.manage`, for the same reason — recording that somebody finished is the evidence a
certificate is issued from.

## `NOT VERIFIED`

Each of these is a capability the product does not have. None is partially built, and every one is
stated on the Admin screen rather than left for somebody to infer from an empty table.

| Capability | Why it is not verified |
| --- | --- |
| Scheduled reconciliation | `JobPort` has no adapter anywhere in this repository. Somebody runs the command |
| Aggregate assessment scoring | The specification defines no threshold, weighting, rounding or attempt policy. Inventing one would decide who passes mandatory safety training on a rule nobody wrote |
| `assignment.read-team` | Resolving a manager's team needs to know which employment the caller *is*. Honouring a caller-supplied `managerEmploymentId` would be an IDOR wearing a permission's name, so the scope resolves to nothing |
| `assignment.read-own`, `certification.read-own` | Same absence (ADR-0032). Declared so the contract exists; enforced nowhere |
| Principal → employment resolution | No authentication adapter exists. Every business endpoint returns 401 until Platform supplies one |
| Notification delivery | `NotificationPort` has only a recording adapter. An intent is stored; nothing sends it |
| Binary document storage, upload, download, signed URLs | `StoragePort` has no adapter. A document reference is confirmed to exist and nothing more |
| A course-category listing | No query enumerates a tenant's categories. Nothing in this product branches on one (AD-003), so the gap has never mattered; the Admin screen shows the categories in use on the page it fetched and says exactly that |
| The certificate that superseded another | `supersedes_certification_id` is written when the next certificate is issued and is not carried by the read contract. A superseded certificate says it was superseded |

## Measured

25 workloads at 500, 10,000 and 100,000 employments per tenant, with a second tenant at the same
volume, as an unprivileged role with RLS enabled and forced. **All within budget at every tier** —
compliance queue 17 ms and expiring certificates 3.8 ms at 100,000, both against a 100 ms budget.
`scripts/measure-learning-performance.mjs`; figures and query plans in
[`../verification/phase-14a-final-report.md`](../verification/phase-14a-final-report.md).
