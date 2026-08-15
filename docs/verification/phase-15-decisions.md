# Phase 15 — approved decisions, as encoded

The Definition of Ready recorded twenty-one decisions and recommended a resolution for each. The
plan was approved. This file records **what each decision resolved to**, what encodes it, and the
three places where the approval leaves a capability unbuilt rather than a rule invented.

Baseline: [`phase-15-plan.md`](phase-15-plan.md) at commit `4be42b9`.

---

## The three that do not become features

These are approved outcomes, not gaps. Each is the plan's own stated fallback, and each is now
carried in the `NOT VERIFIED` matrix rather than approximated.

### D-4 and D-5 — the two additive contract changes are **not authorized**

The plan proposed a `criticality` filter on `organization.list-positions` (C-1) and a filtered,
paged talent-placement query on Performance (C-2). It also said, twice and deliberately:

> Neither will be built without approval. … Nothing in Phase 15 may modify a completed module
> without the specific approval recorded against D-4 and D-5.

No such specific approval accompanies the implementation instruction, and its Rule 5 permits
modifying a completed module only where the plan **explicitly authorizes** the change. The plan
explicitly withholds that authorization pending an approval that has not been given.

**Therefore: neither contract is added. Organization and Performance are not touched.** The plan
already states the consequence — "If either is refused, the dependent capability becomes
`NOT VERIFIED` rather than being approximated with an unbounded read" — so this blocks nothing.

| Capability | Status |
| --- | --- |
| List a tenant's critical positions | `NOT VERIFIED`. Career shows the succession plans it holds, and cannot enumerate positions it has no plan for |
| Show a nine-box band beside a nomination | `NOT VERIFIED`. `performance.talent-matrix` is unpaged and cycle-wide; consuming it on a per-nomination path would be an unbounded read at 100,000 employments |

Career confirms a position exists through `organization.list-positions` as it stands, and reads no
placement at all. If either contract is authorized later, both capabilities become buildable without
redesign: the adapter interface is written to take the bounded question, and there is simply no
adapter behind it.

### D-12 — the 70-20-10 development mix is `NOT VERIFIED`

The plan's recommendation was "**supply the parameters or mark it `NOT VERIFIED`**". No parameters
accompany the approval, so the second branch applies. ADR-0074 records what is built instead: an
item category recorded, counts displayed, no validation, no target, no tolerance, no verdict.

---

## The full register, as resolved

| | Question | Resolved to | Encoded by |
| --- | --- | --- | --- |
| **D-1** | Standing talent pool vs per-cycle nine-box | Career owns **membership** (a decision); Performance keeps **placement** (an observation). Neither derives the other | ADR-0073 |
| **D-2** | Development plan vs Learning paths and assignments | Career owns the plan and the **non-course** items — coaching, mentoring, projects, stretch assignments. A course item is a **reference** to a `learning_assignment` with no status of its own | ADR-0073 |
| **D-3** | Is `CriticalPositionReference` a Career table? | **No.** Career owns `career_succession_plan` *for* a position and stores no criticality | ADR-0072 |
| **D-4** | `criticality` filter on Organization | **Not authorized.** Capability `NOT VERIFIED` | This file, §above |
| **D-5** | Paged talent-placement query on Performance | **Not authorized.** Capability `NOT VERIFIED` | This file, §above |
| **D-6** | Does Career compute high-potential? | **No.** Pool membership is a deliberate decision; Performance's band is displayed beside it, never merged | ADR-0073 |
| **D-7** | Lifecycle state lists | **Adopt plan §7** as written | Domain vocabulary (Checkpoint 2) and check constraints (Checkpoint 3) |
| **D-8** | Does confirming a successor consume `ApprovalPort`? | **No.** A named human act with its own permission, `system:auto-approval` refused by check constraint | ADR-0072 |
| **D-9** | Development plan "jointly owned by employee and manager" | **`NOT VERIFIED`.** An administrator records both acknowledgements as named acts. No client-supplied identifier is ever treated as identity | ADR-0032 stands; matrix entry |
| **D-10** | Readiness stated or computed? | **Stated** by an authorized human, with a rationale, against a tenant-configured level | ADR-0074 |
| **D-11** | Civil dates or timestamps? | **Civil dates.** `date` columns, `YYYY-MM-DD` strings end to end, no `Date` on any Career date path | Domain and repository layers |
| **D-12** | The 70-20-10 development mix | **`NOT VERIFIED`.** Category recorded and counted; no validation, target, tolerance or verdict | ADR-0074 |
| **D-13** | Does a mobility recommendation expire? | A `valid_until` civil date stored; `expired` **derived on read** against a stated day | Domain; ADR-0070's pattern |
| **D-14** | Readiness assessments immutable at the table? | **Yes.** One trigger refusing update and delete, raised here rather than introduced silently | Migration (Checkpoint 3) |
| **D-15** | Successor for more than one position? | **Yes.** Uniqueness is per (succession plan, employment), not per employment | Partial unique index |
| **D-16** | Is `CareerSummaryProjection` a table? | **No.** A derived read model rebuilt by query | Application queries |
| **D-17** | Career path stages: gates or order? | **Order.** No progression is enforced | Domain |
| **D-18** | Does a career plan require a path? | **Optional.** `path_id` nullable | Schema |
| **D-19** | Import / export | **Deferred**, consistent with every phase since Phase 2 | Not built |
| **D-20** | Human-readable record numbers? | **No.** No numbering facility exists and none is built | Not built |
| **D-21** | Phase size | **No split.** Eleven tables, one coherent module | Scope |

---

## Ownership boundaries, as encoded

Career owns: career paths and their stages; career plans; talent pools and membership periods;
succession plans and the successors nominated against them; readiness levels and readiness
assessments; development plans and their items; mobility recommendations.

Career owns **none** of these, and stores no copy of any:

| Fact | Owner | How Career reaches it |
| --- | --- | --- |
| Position criticality | Organization | `organization.list-positions` (existence and criticality on the view) |
| Nine-box placement, potential band | Performance | Not read this phase — see D-5 |
| Course, assignment, enrolment, certification, expiry | Learning | `learning.read-history`, `learning.search-assignments` |
| Employment, position held, manager, status | Employment | `employment.read-employment`, `employment.search` |
| Person identity and name | People | **Never referenced.** AD-001 |
| Document bytes | Nowhere — `StoragePort` has no adapter | A document identifier confirmed via `documents.read-document` |

**Career writes nothing outside itself.** No port it declares is capable of a write.

---

## Deviations from the plan

**One, and it is the plan's own fallback rather than a departure from it.** D-4 and D-5 resolve to
*not authorized* rather than to the plan's recommended *yes*, because the specific approval those
decisions required was not given. The plan states the consequence for exactly this case, and it is
applied unchanged.

No other decision deviates from its recommendation. No approved decision has been silently changed.
