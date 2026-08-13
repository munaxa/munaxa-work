# ADR-0074 — Readiness is stated by a person, and no formula is invented to replace them

**Status** Accepted · **Date** 2026-08-13 · **Author** Phase 15 · **Approval** Approved as decisions D-10 and D-12 of the Phase 15 Definition of Ready

## Context

The Phase 15 specification asks for readiness assessments with tenant-configurable levels — "Not
Ready", "Ready in 1–2 Years", "Ready in 6–12 Months", "Ready Now" — and for development plans
validated against a 70-20-10 experience / exposure / education mix.

It gives no rule for either.

For readiness it names the levels and stops. It does not say what produces one. The inputs are
sitting right there and the derivation would write itself: Performance publishes a potential band,
Learning publishes completions and certifications, Employment publishes tenure. Something like
*potential band 3 plus the leadership path completed equals Ready Now* is ten lines of code and
would be indistinguishable from a specified rule to anybody reading the output.

For the development mix it gives a default weighting and the word "validated", and nothing else: not
what validation does when a plan is unbalanced, not the tolerance, not how an item's contribution is
measured — by count, by hours, by the span of its target dates — and not what happens to an item
nobody categorized.

## Why this is not a gap to fill

A readiness level decides who is put forward for a director's post and who is not. It is read in a
succession review by people who will act on it, and the person it describes will not be in the room.

Inventing the rule that produces it would mean this product deciding, on a rule nobody wrote, that
somebody is not ready. When the rule is later found to be wrong — and it would be, because it was
never specified — every assessment produced by it is wrong too, and there is no record of which
figure a human would have chosen instead.

The repository has met this exact shape twice and refused both times. Phase 13 refused to weight
self and peer assessments because no weighting was approved, and recorded them as contributing
nothing rather than guessing. Phase 14A refused to compute an aggregate assessment score because the
specification defined no threshold, weighting, rounding or attempt policy, and recorded that as
`NOT VERIFIED` rather than shipping an average.

## Decision

**Readiness is stated by an authorized person, with a rationale, against a tenant-configured level.
Nothing computes it.**

`career_readiness_assessment` records who assessed, on which civil day, at which level, and why. It
is append-only: a correction is a new assessment, never an edit, so the trail shows what was thought
and when it changed. `career.readiness.record` is a permission of its own, separate from
`career.readiness.read`, because stating that a colleague is not ready is a different capability
from reading that somebody said so.

`career_readiness_level` is tenant configuration: a code, a name and an **ordinal**. The ordinal
orders the levels least to most so a screen can sort them and a consumer can compare by index. **No
numeric scale is published** — the same construction Organization uses for `POSITION_CRITICALITIES`,
and for the same reason: publishing a number means promising it stays stable and means something,
and neither is true of a tenant's own vocabulary.

**The 70-20-10 development mix is `NOT VERIFIED`.**

A development item carries a category — `experience`, `exposure` or `education` — because that is a
fact somebody states about the item, and recording it costs nothing and loses nothing. Career counts
items by category and displays the counts.

Career does **not** validate a plan for balance, does not compute a mix percentage, does not warn,
and does not refuse. There is no target column, no tolerance column and no balance verdict anywhere
in the module, because a column would invite a tenant to configure a rule nothing enforces. If the
parameters are supplied later — what validation does, the tolerance, how contribution is measured,
and how an uncategorized item counts — this becomes a specified feature and can be built. Until
then the Admin screen says the counts are counts.

## Consequences

A readiness assessment is only as good as the person who made it, and the record says who that was.
That is a weaker guarantee than a formula and an honest one.

Performance's potential band and Learning's completions are **displayed beside** a readiness
assessment where a screen shows both, so an assessor has the evidence in front of them. They are
never inputs to a calculation, and no field on the assessment is derived from them.

Nothing in Career produces a percentage, a score or a weighted value. The module holds no money, no
rate and no computed number at all — the only numeric values are small ordered integers a human
chose: a stage's sequence, a successor's rank, a readiness level's ordinal. There is consequently no
rounding rule to get wrong and no floating-point arithmetic anywhere in it.
