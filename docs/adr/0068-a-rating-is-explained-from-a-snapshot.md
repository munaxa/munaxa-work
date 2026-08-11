# ADR-0068 — A completed rating is explained from a snapshot, never from live configuration

**Status** Accepted · **Date** 2026-08-11 · **Author** Phase 13 · **Approval** Approved before implementation as decision D-13; this records the mechanism and what was rejected

## Context

A performance rating outlives everything that produced it. The scale it was measured against gets
replaced the following year. The template's component weights are re-tuned. The competency framework
reaches version 4. The employee moves to a different manager in a different unit, and the unit is
merged into another one. Two years later somebody — the employee, a tribunal, an acquirer's due
diligence — asks what the rating of 3.70 meant.

A system that answered by reading the *current* configuration would answer wrongly, and would answer
wrongly without saying so. The rating would silently re-render against a scale nobody was rated on,
weights nobody agreed to, and an organizational position the person did not hold at the time. That
is not a display bug: a performance rating is used in pay decisions, promotion decisions and
dismissal decisions, and one that changes retroactively is one nobody can defend.

The requirement is therefore: **a completed review must render identically forever, whatever happens
to the configuration afterwards.**

## The comparison

**Option 1 — effective-dated configuration.** Version every configuration table, and resolve each
read at the review's completion date.

Protects: the common case, and it is the pattern Employment and Organization already use.

Fails against: the cost of a second temporal model over every configuration table, and — more
seriously — it is still a *join*. Rendering the rating requires the scale row, the level rows, the
template row, the component rows and the framework rows to still exist and still be reachable. A
tenant that deletes a scale, or a migration that consolidates levels, breaks a historical rating with
no warning. It also makes every read of a completed review a six-way effective-dated join.

**Option 2 — refuse to change configuration once used.** Lock a scale as soon as a cycle references
it.

Fails against the product: a customer must be able to retire a scale and adopt a better one. A rule
that froze configuration forever would make the first year's mistake permanent.

**Option 3 — snapshot the working at completion.** When a review completes, write one row carrying
the rating scale and its levels, the template and its component weights, the competency definitions,
the computed working with each component's weight, score, contribution and exclusion reason, the
manager, the organizational unit and the governing legal entity — all as opaque structured values.

Costs: storage, and the discipline that the snapshot must be written in the same transaction as the
completion.

## Decision

**Option 3.** A completed review carries a snapshot, and reading a completed review reads the
snapshot rather than the configuration.

Three properties follow, and each is asserted against real PostgreSQL:

1. **Retiring the scale, retiring the template and moving the employment to a different manager in a
   different unit changes nothing the review says.** The cross-module suite performs all three and
   re-reads: the final score, the calculated score, the original manager, the legal entity resolved
   at completion, the four frozen scale levels and byte-identical component scores.
2. **The snapshot is written exactly once**, in the completing transaction, *after* the
   version-guarded update rather than before it. The ordering is load-bearing and was a real defect:
   inserting first left a second snapshot behind when a concurrent completion lost the race. A
   two-connection test asserts exactly one snapshot survives.
3. **The snapshot is immutable at the table.** A trigger refuses an update and a delete, so the
   guarantee does not depend on every future repository method remembering it (ADR-0066's reasoning,
   applied to a different record).

Configuration remains freely changeable. Retirement is not deletion — a retired scale stays readable
— but nothing about a completed review depends on it still being there.

## Consequences

A completed review is larger on disk than a set of foreign keys would be. That is the cost of the
guarantee, and it is paid once per review rather than on every read; the alternative was a six-way
join that could still break.

Reconciliation reports placements whose recorded band no longer matches their review's rating. It
**reports and does not repair**: a placement is a human judgement recorded at a moment, and quietly
moving it to agree with a later calibration would rewrite what a talent review actually concluded.

Nothing here applies to a review still in progress. Those read live configuration, correctly — the
rules can still change for work not yet rated, and a cycle mid-flight is not a historical record.
