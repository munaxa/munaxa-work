# Career

**Career records the ladders a tenant defines, who is on one, the benches it keeps, what people have
been judged ready for, what they agreed to do, and where somebody suggested they move next — and it
recommends and executes nothing.**

Phase 15. Twelve tables. Package `@work/career`.

No employment, position, assignment or salary changes because of anything in this module, and there
is no port through which one could ([ADR-0072](../adr/0072-a-career-recommendation-is-advisory-and-writes-nothing.md)).
There is **no `numeric`, no `double precision`, no `real`, no `bigint` and no `money` column anywhere
in the schema**: every number Career stores is a small bounded integer a human chose — a stage
sequence (≤ 500), a successor rank (≤ 50), a readiness ordinal (≤ 100). Nothing here is computed, so
there is nothing to round.

---

## What it owns

Career paths and their ordered stages; a person's plan against a path; talent pools and the
memberships in them; succession plans for a position and the successors nominated, confirmed or
withdrawn against each; the readiness levels a tenant defines and the assessments somebody recorded;
development plans and the items on them; and the mobility recommendations somebody made.

## What it does not own, and why

| Absent | Where it belongs | Why |
| --- | --- | --- |
| A position's title, grade or **criticality** | Organization | AD-004: a position's properties are the org structure's facts. Career stores a `position_id` and no property of it (D-3) |
| The nine-box placement, high-potential rating | Performance | [ADR-0073](../adr/0073-a-decision-is-careers-an-observation-stays-where-it-was-made.md): pool membership is a **standing decision**, a placement is an **observation of one cycle**. Neither derives the other |
| A course, its assignment and its completion | Learning | A course item on a development plan is a *reference*. Career stores no status of its own for one, and a check constraint refuses to move one |
| The promotion, transfer or salary change itself | Employment, Compensation | ADR-0072. `accepted` means a human agreed with a suggestion; the move is another module's act, and Career would not know if it happened |
| Who the employee is, their name, their manager | People and Employment | Read through published contracts under a bounded service grant. Career confirms an identifier and stores no employment fact |
| A computed readiness score, percentage or nine-box | Nowhere — it was never specified | [ADR-0074](../adr/0074-readiness-is-stated-by-a-person.md). No column stores one, no query produces one, no label prints one |
| A balance verdict on the 70-20-10 mix | Nowhere — it was never specified | Categories are counted; no rule, target or tolerance exists. The API returns the literal `NOT VERIFIED` (D-12) |
| Which employment a signed-in person *is* | Nowhere in this repository | No principal → employment resolution (ADR-0032). Everything downstream is named in `NOT VERIFIED` below |
| Anything on a schedule | A scheduler that does not exist | `JobPort` has no adapter. A review coming due and a recommendation expiring are **derived on read** against a stated day |
| Notification delivery | A transport that does not exist | Career composes no notification port at all |
| A critical-position list | Organization, if it ever publishes one | D-4 refused. Organization has no `criticality` filter, and the additive change authorized for this phase was deliberately narrower |

---

## The four decisions that carry the module

### A recommendation is advisory, and Career writes nothing outside itself

[ADR-0072](../adr/0072-a-career-recommendation-is-advisory-and-writes-nothing.md). A mobility
recommendation is a suggestion with a decision recorded against it. `accepted` does not create an
assignment, change a grade or start anything. This is enforced structurally rather than by
convention: every cross-module adapter takes `Asking`, which declares `ask` and **no `send`**, so an
adapter that tried to write another module's data would not compile.

### A decision is Career's; an observation stays where it was made

[ADR-0073](../adr/0073-a-decision-is-careers-an-observation-stays-where-it-was-made.md). Putting
somebody in a high-potential pool is a standing decision an organization took and revisits
deliberately. A nine-box placement is what one review cycle observed. Copying either into the other
would produce a second answer that goes stale, and the staler of two answers is the one somebody
acts on. The same rule runs through the development plan: a course item **references** a Learning
assignment and carries no status Career maintains — `career_development_item_course_status_check`
refuses to let one move.

### Readiness is stated by a person, and no formula is invented to replace them

[ADR-0074](../adr/0074-readiness-is-stated-by-a-person.md). The specification defines no formula, so
an authorized human states a level and gives a rationale, and their name is on it. Assessments are
**immutable at the table** — one trigger refuses `update` and `delete` (D-14). A correction is a new
assessment, and `latest` is a *selection* of the most recent statement, never an average of two.

### A civil date is a day, end to end

Every date Career stores is a `date` column read as a `YYYY-MM-DD` string, and every instant is a
`timestamptz`; the two are never confused. **There is no `Date` anywhere on the path** — the domain
compares strings, the command carries a string, the API validates a pattern and the screen renders
it untouched. `2026-02-28` is `2026-02-28` in the database, the response and the HTML, in English
and Arabic, never the 27th a `Date` round trip produces west of UTC. Impossible days are refused
rather than normalized: `2026-02-30`, `2025-02-29` and `2026-04-31` each earn a named 422.

---

## Boundaries

Career reads five operations from three modules, each through a **published contract under a bounded
service grant** ([ADR-0043](../adr/0043-bounded-service-grant.md)), and writes nothing outside
itself. No grant is a wildcard or a prefix.

| Adapter | Operation | Permits | Contract consumed |
| --- | --- | --- | --- |
| `CareerEmployment` | `read-employment` | `employment.employment.read` | `employment.read-employment` |
| `CareerEmployment` | `read-position-employments` | `employment.employment.read` | `employment.search` |
| `CareerOrganization` | `confirm-position` | `organization.position.read` | `organization.list-positions` |
| `CareerOrganization` | `confirm-organization-unit` | `organization.hierarchy.read` | `organization.unit-ancestry` |
| `CareerLearning` | `confirm-learning-assignment` | `learning.assignment.read`, `learning.assignment.read-all` | `learning.read-history` |

**One completed module changed.** `organization.list-positions` gained `positionId?: string`, an
exact-identifier predicate. The response, the permission, the tenant boundary, the pagination and the
behaviour when it is absent are all unchanged, and it adds no way to *discover* a position by any
property. There is no `criticality` filter: the only occurrence of the word in Organization's query
file is the sentence explaining that it does not exist.

**One planned contract was not published, and the deviation was the better question.** Learning never
published `assignmentExists(assignmentId)`. Career uses `assignmentIsFor(employmentId, assignmentId)`
through `learning.read-history` instead — narrower, and it additionally proves the assignment belongs
to the employee. `assignmentExists` would have accepted a colleague's real assignment on this
person's development plan. Learning was not modified.

Every cross-module read is a **single confirmation of an identifier the caller already holds**, made
during a command. None is made per row, so there is no N+1 and no upstream dataset is fetched to be
filtered here.

## Published contracts

Views only — `CareerPathView`, `CareerPathDetailView`, `CareerStageView`, `CareerPlanView`,
`TalentPoolView`, `PoolMembershipView`, `SuccessionPlanView`, `SuccessionPlanDetailView`,
`SuccessorView`, `BenchStrengthView`, `ReadinessLevelView`, `ReadinessAssessmentView`,
`DevelopmentPlanView`, `DevelopmentPlanDetailView`, `DevelopmentItemView`, `DevelopmentMixView`,
`MobilityRecommendationView`, `CareerSummaryView`, `LocalizedTextView`. No handler, no store, no
dependency type and no domain aggregate: a consumer that could reach a handler could bypass this
module's permission checks.

## Permissions, and the separations that matter

Twenty-one, and each handler declares the one it needs. **Succession data is more sensitive than most
of this product** — a list of named successors for a director's post, or a "not ready" assessment, is
material somebody can act on against a colleague who is not in the room. So a record the caller may
not see answers **404, never 403**: confirming that a bench exists for a named position is itself
most of the disclosure.

Four separations are deliberate, and each has a test:

- **`successor.confirm` is not implied by `successor.nominate`.** Suggesting somebody could succeed a
  director is not the same act as recording that the organization agrees, and the second is the one
  an auditor asks about a year later.
- **`pool.assign` is not implied by `pool.manage`.** Creating a "high potential" pool is
  configuration; putting a named person in it is a judgement about them.
- **`readiness.record` is separate from `readiness.read`.** Reading who is ready and stating that
  somebody is not are different capabilities.
- **`mobility.decide` is separate from `mobility.recommend`.** Making a suggestion and settling it
  are different acts.

Confirming a successor consumes no approval port (D-8): it is a named human act with its own
permission, and `career_successor_confirmation_check` refuses `system:auto-approval` at the table.

## `NOT VERIFIED`

Sixteen capabilities the product does not have. None is partially built, none has a placeholder
success state, and every one is stated on the Admin screen in both languages rather than left for
somebody to infer from an empty table.

| Capability | Why it is not verified |
| --- | --- |
| Employee self-service (`plan.read-own`, `development.read-own`) | No principal → employment resolution (ADR-0032). Declared so the contract exists; routed nowhere |
| Manager self-service (`plan.read-team`) | Same absence. A caller-supplied `managerEmploymentId` is a filter, never proof of identity — honouring it would be an IDOR wearing a permission's name |
| Delegated access | No delegation model exists in this repository |
| Principal → employment resolution | ADR-0032. No authentication adapter is supplied |
| Joint employee/manager ownership | Neither party can be identified, so an administrator records **both acknowledgements as named acts**, with the day and who recorded them. These are records, **not signatures** (D-9) |
| Scheduled succession review | `JobPort` has zero implementors. `review_on` is stored and `reviewDue` derived on read against a stated day; nothing fires and nobody is notified |
| Scheduled mobility expiry | Same. `valid_until` is stored and `standing` derived on read — the same row reads as current if asked about an earlier day |
| Notification delivery | Career composes no notification port at all. A recorded intent nobody reads is a "sent" state waiting to be misread |
| Evidence document on a readiness assessment | The column was **removed** rather than confirmed and discarded. Career has nowhere to persist the identifier, and confirming one and dropping it is validation theatre |
| Document upload / download | `StoragePort` has zero implementors |
| Signed URLs | Same absence |
| 70-20-10 validation | No balance rule, target or tolerance was ever specified (D-12). Three category counts are returned; the verdict is the literal `NOT VERIFIED` |
| Computed readiness | No formula exists in the specification (ADR-0074). A level is stated by a human, with a rationale and their name |
| Critical-position enumeration (D-4) | Organization publishes no `criticality` filter, and the change authorized for this phase was deliberately narrower. Career answers from the succession plans it holds itself |
| Nine-box / high-potential listing (D-5) | `performance.talent-matrix` is unpaged, so the read would be unbounded. **No Performance adapter exists** |
| Analytics, readiness distribution | Named in the specification's "Future Consumers". A distribution is an aggregate over a population; nothing predictive or aggregate was built |

## Measured

26 workloads at 500, 10,000 and 100,000 employments per tenant, with a second tenant at the same
volume, as an unprivileged role with RLS enabled **and forced** on all twelve tables. **Zero misses
at any tier, no budget redefined and no index added** — the slowest read at 100,000 employments is
15.0 ms against a 100 ms budget. Bench strength across forty positions stayed flat on an index-only
scan, which is the O(n×m) shape Phase 13 was caught by.
`scripts/measure-career-performance.mjs`; figures and query plans in
[`../verification/phase-15-final-report.md`](../verification/phase-15-final-report.md).
