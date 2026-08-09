# ADR-0051 — Attendance owns no employment fact, and attaches to an employment rather than to a person

**Status** Accepted · **Date** 2026-08-11 · **Author** Phase 8 · **Approval** Approved before implementation

## Context

Attendance is the module a payroll integrator will reach for first, and the temptation is to make it
self-sufficient: copy the employee number so a screen can render one, copy the contracted hours so a
shortfall can be computed, copy the manager so an approval can be routed. Every one of those copies
is a second answer to a question Employment already answers, and the second answer is wrong from the
first correction onwards.

The second question is which side attendance hangs from. A punch is made by a human being, so
`person_id` reads naturally. It is also wrong: somebody who leaves and is rehired is one Person and
two Employments, and hanging attendance from the Person merges two working lives into one register.

## Decision

**Attendance references `employment_id` and copies no fact from Employment.** There is no employee
number, no employment status, no contracted hours, no manager, no unit and no `person_id` in any of
the thirteen tables. `EmploymentDirectoryPort` offers exactly two reads — one employment as at a
date, and a bounded page of active employments — and has no `create` and no `update`.

**`employment_id` carries a foreign key.** It points *backward* to a module Attendance already
depends on, which is the rule ADR-0042 states, and it means Attendance could not invent an
employment if a defect tried.

**Historical attendance stays with the employment under which it occurred.** A later employment
change — a transfer, a new manager, a termination — does not rewrite a day already recorded. The day
stores the schedule, the shift, the policy and the versions it was calculated from, so a
recalculation of March reproduces March.

**Every cross-module read runs under a bounded service grant** (ADR-0043). A supervisor recording a
punch is checked for the attendance operation; the *module*, not the user, holds the narrow
`employment.employment.read`, and the elevation is logged.

## Consequences

- A screen showing attendance shows an employment identifier, not a name. Resolving it to a human
  being is People's read behind People's permission, and this module has not asked.
- Absence is measured against the **schedule**, never against contracted hours, because contracted
  hours are Employment's and this module does not hold them.
- A rehire has two registers, which is correct: two employments, two working lives, two sets of days.
- The `AttendanceDayView` contract carries no employment fact, and adding one is a breaking change
  requiring an ADR.

## Alternatives considered

**Cache the employment's contracted hours on the attendance day.** Rejected. It would go stale on the
first contract change, and the day would then compute a shortfall against hours nobody works.

**Attach to `person_id` as well, "for convenience".** Rejected. Two references to the same fact are
two chances to disagree, and the disagreement would surface as a rehire's days appearing under the
wrong employment in a payroll run.
