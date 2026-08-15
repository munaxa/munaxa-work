# ADR-0073 — A decision is Career's; an observation stays where it was made

**Status** Accepted · **Date** 2026-08-13 · **Author** Phase 15 · **Approval** Approved as decisions D-1, D-2 and D-6 of the Phase 15 Definition of Ready

## Context

Three concepts in the Phase 15 specification already have something that looks like them in the
repository, and each looks close enough that a reasonable person would build the duplicate:

**Talent pools and the nine-box.** Performance owns `performance_talent_placement`, whose published
view carries `performanceBand`, `potentialBand` and `boxCode`. The specification asks Career to
"support high-potential identification" and to own talent pools including a "High Potential
Employees" pool. Read carelessly, Career should compute a high-potential flag from the potential
band.

**Development plans and learning paths.** Learning owns `learning_path` — an ordered set of courses
a tenant groups together — and `learning_assignment`, which is what a named person was asked to do.
The specification asks Career to own development plans whose items include "Learning Activities".
Read carelessly, Career should hold its own list of courses per person.

**Critical positions.** Covered by ADR-0072.

In each case the duplicate would be *usable*. It would also mean the product could answer the same
question two ways, and the two would disagree the first time one side changed.

## The distinction that resolves all three

**An observation belongs to the module that made it. A decision belongs to Career.**

A nine-box placement is an **observation**: one calibration meeting, in one cycle, recorded what it
saw. It is scoped to that cycle, it is Performance's evidence, and it expires in meaning when the
next cycle runs.

Membership of a talent pool is a **decision**: an organization deliberately says "we are investing
in this person", it stands across cycles, it is nobody's evidence, and it is somebody's judgement
with a name attached.

They are not the same fact, they are not derivable from each other, and a product that merged them
would lose the ability to say the most useful thing a succession review says out loud: *this person
was placed in the top box and we have still not put them in the leadership pool.*

## Decision

**Career owns standing pool membership. Performance keeps per-cycle placement. Neither derives the
other.**

`career_pool_membership` records a period, who added the person, who removed them and why. It is a
historical fact with a start and an end, never a delete. **Career computes no high-potential flag.**
Where a screen shows both, the nine-box band is displayed *beside* the pool membership and labelled
as Performance's, never merged into a single verdict.

**Career owns the development plan; a course-shaped item is a reference to Learning.**

A `career_development_item` in the `education` category that names a course carries a
`learning_assignment_id` and **no status of its own**. Its progress is Learning's answer, read
through `learning.search-assignments` or `learning.read-history`. Career never stores "completed"
for a course, because Learning already stores it and two copies drift.

What Career genuinely owns is everything Learning has no concept of: **coaching, mentoring,
projects, stretch assignments** and the target dates against them. Those have no owner anywhere in
the repository today, and they are the reason a development plan is a Career aggregate rather than a
Learning one. AD-006 is satisfied precisely: development plans reference Learning, and Learning
remains the owner of training.

## Consequences

Career's cross-module reads are all **read-only, bounded and through published contracts**:
`learning.read-history` for a person's training record, `learning.search-assignments` for one item's
status, and — subject to a bounded contract existing — Performance's placement for display.

A pool membership survives a cycle nobody ran. A nine-box placement does not, and should not.

Deleting a person from a pool is not a delete: the period closes, and the record that they were once
in it stays. A succession review a year later asks "who did we invest in and what happened", and a
deleted row cannot answer it.

Two screens may legitimately disagree about whether somebody is "high potential", because the two
statements mean different things. The Admin screen names which is which rather than reconciling
them.
