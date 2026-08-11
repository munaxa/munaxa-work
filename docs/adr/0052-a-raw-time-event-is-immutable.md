# ADR-0052 — A raw time event is immutable, and a correction inserts rather than edits

**Status** Accepted · **Date** 2026-08-11 · **Author** Phase 8 · **Approval** Approved before implementation

## Context

Attendance data is evidence. Somebody disputing a month's pay is disputing what a reader captured at
07:58 on a Tuesday, and the only defensible answer is the row exactly as it was written. A system
that can amend a punch cannot give that answer, whatever its audit table says — because the audit
table is a second record of the same edit, written by the same code path.

Corrections are nonetheless ordinary and frequent: a reader was offline, somebody forgot to clock
out, two devices recorded one arrival.

## Decision

**`attendance_time_event` is inserted and read. There is no update and no delete, anywhere.** The
repository offers neither method, the row mapper has no update mapping, and the migration comments
say so. The cheapest guarantee that a history cannot be amended is to have no method that could.

**A correction produces a new event, or no event at all.**

- `amend_event` inserts a *new* event carrying `supersedes_event_id`. Both rows stay; the pairing
  excludes the superseded one from the arithmetic and the day view returns both, so a reviewer sees
  what was originally captured.
- `remove_event` writes **no event**. The correction record is the tombstone:
  `appliedRemovals` names the events an approved removal took out, and the calculation leaves them
  out of the sum. Nothing invents a compensating punch that never happened.

**The chain survives end to end.** Original event → request (who asked, why, and what they propose)
→ decision by a *different* named human → resulting event or removal → the day marked stale →
recalculation. Every link is a row.

**Self-approval is refused twice.** The domain refuses it, and
`attendance_correction_self_approval_check` refuses it in the database. A control that lives only in
application code is a control that any future path around that code silently removes.

## Consequences

- The event table grows monotonically. That is the cost of evidence, and the indexes are built for
  it.
- A corrected day is explainable from the screen: the original punch, the correction, the reason, the
  decider and the new figure are all readable together.
- Nothing in this module can "clean up" duplicate punches by deleting them. A duplicate is flagged as
  an exception and, if it should not count, removed by a correction somebody signed.

## Alternatives considered

**Update the event and write an audit row.** Rejected. The audit row is written by the same code that
made the edit; if that code is wrong, both are wrong, and the original is gone.

**Soft-delete the event on removal.** Rejected as weaker than a correction record: a `deleted_at`
says something was removed but not who decided it, why, or which day's figure changed as a result.
