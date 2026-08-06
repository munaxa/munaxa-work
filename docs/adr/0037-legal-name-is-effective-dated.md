# ADR-0037 — A person's legal name is effective-dated; every other attribute is not

**Status** Accepted · **Date** 2026-08-06 · **Author** Phase 4 · **Approval** Pending phase approval

## Context

The Phase 3 report opened a debt and named its owner:

> **A unit's *attributes* are not queryable as at a past date.** A structure query for last March
> shows *today's* names on *that date's* structure. The structure itself is fully historical; the
> names are not. *Phase 21 (governance, risk, compliance), which owns temporal audit generally.*

That was the right call for an organizational unit. A department renamed is the same department in
the same place, so a rename is a correction rather than a structural change, and modelling it as an
effective-dated revision would have doubled the write path for every rename to answer a question
nobody asks.

Phase 4 inherits that debt and must decide whether to extend it to a person. The instruction is
explicit that inherited deferrals are checked before they are deepened.

**A person's legal name is not the same kind of attribute.** It is the thing their signature, their
identity documents and their statutory filings are matched against, and it changes for reasons the
law recognises: marriage, divorce, naturalisation, a court correction. "What was this person's legal
name on the date they signed that contract" is a question with legal force and exactly one right
answer — asked by a settlement dispute, a visa application, an end-of-service letter and a
government submission, all of them months or years after the change.

A registry that overwrote it would leave every historical contract, letter, payslip and statutory
filing naming somebody who, as far as the system is concerned, never existed.

## Decision

**`person` has no name column. A person's legal and preferred names live entirely in `person_name`,
a versioned child entity on the kernel's `Timeline`.**

- Recording a name change closes the period the previous name had and opens a new one. Nothing is
  edited and nothing is deleted.
- The `person` row holds **no cached copy** of the current name, because a cached copy is a second
  answer to a question that must have one.
- Every read that returns a person takes an `asOf` and resolves the name in force on that date.
  `PersonView.asOf` states which date was used, so a consumer cannot mistake a historical answer for
  a current one.
- A back-dated change **splits** the history rather than discarding what follows it: recording a
  June name on somebody who also changed in September closes June's predecessor at June and bounds
  the new record at September. This is the rule Phase 3 arrived at for placements, reused rather
  than rediscovered.
- The database enforces one *open* period per person with a partial unique index.

**Every other attribute in this module is deliberately not effective-dated**, and the boundary is
drawn on whether yesterday's value has force today:

| Attribute | Shape | Why |
| --------- | ----- | --- |
| Legal and preferred name | Timeline | Yesterday's value has legal force today |
| Contact points, addresses, emergency contacts, preferences | Timeline | Read *about a date*: which number did we have on the day of the incident; which address was on file when that letter was posted; did this person consent when that brochure went to print |
| Date of birth, place of birth | Corrected in place | Nobody's date of birth moves. A timeline of birth dates would model something that cannot happen; the previous value travels in the event, so the correction is reconstructible |
| Nationality, skill, language, education, certification, tag | Withdrawn, never superseded | A claim that was made or withdrawn, not a value that had a different value last March |
| Government identifier | Neither: withdrawn, and the value is not amendable | A different number is a different document. A renewed passport is a new identifier and a withdrawal of the old one |

## Consequences

- "Who was this person, on this date" has exactly one answer, forever, and it is asserted by test
  rather than argued — including for a back-dated correction placed in front of a later change.
- Every read of a person costs one extra query, and search costs a join. Measured at under 1 ms for
  a person's timeline over a register of 50,000; the search cost is in the report.
- **A person created before the date asked about still has a name.** A migration that dated every
  name from the day it ran, then a query about last year, would otherwise render a blank name — which
  looks like corrupt data rather than a question asked about a date before the record began. The view
  falls back to the earliest recorded name and says which date it resolved at.
- The Phase 3 debt is **narrowed rather than closed**: a person's *other* attributes are still not
  queryable as at a past date, and an organizational unit's are unchanged. What this ADR asserts is
  that the one attribute where the debt would have been most expensive does not carry it.
- Later phases must resolve a person's name through the contract with an `asOf`, never by reading a
  column. There is no column.

**The cost.** Two writes for a name change instead of one, and a join on every read. That is the
price of the answer, and it is not tradeable: an end-of-service letter naming the wrong person is
not a display bug.

**Alternative considered.** *A current-name column on `person`, with a history table beside it.*
Rejected. It is faster to read and it is two answers: the day the two disagree — a failed
transaction, a back-dated correction applied to one and not the other — the wrong one is the one on
the letter, and nothing in the system can tell which. The whole reason for a timeline is that the
question has one answer.

**Alternative considered.** *Defer to Phase 21 with the rest of attribute history.* Rejected. Phase
21 owns temporal audit as a general capability; this is not a reporting convenience but an invariant
of the aggregate, and retrofitting it later would mean migrating every name written until then with
no record of when it took effect.
