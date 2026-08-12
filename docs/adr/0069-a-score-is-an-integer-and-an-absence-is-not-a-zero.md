# ADR-0069 — A score is an integer, and work nobody assessed is excluded rather than scored zero

**Status** Accepted · **Date** 2026-08-11 · **Author** Phase 13 · **Approval** Approved before implementation as decisions D-5 and D-6; this records the mechanism and the two things it refuses to do

## Context

Two separate questions decide whether a performance score can be trusted years later, and both have
an obvious wrong answer that most systems take.

**How is a score represented?** A rating looks like `3.70`, so the obvious representation is a
decimal — a `numeric` column, or a JavaScript number. Both fail. A `numeric` read through a driver
arrives as a string that somebody eventually calls `Number` on; a JavaScript number cannot represent
`0.1 + 0.2` and cannot represent an observed measurement above 2^53 at all. Neither failure is
visible: the number is simply slightly different from the one that was computed, in a system whose
whole purpose is to still agree with itself in three years.

**What happens to a component nobody assessed?** A review whose competency section was never filled
in has to score somehow. Scoring it zero is the obvious answer and it is the harmful one: it rates
somebody at the bottom of the scale for work **nobody looked at**, and the resulting number is
indistinguishable from a genuine zero.

## Decision

### A score is a whole number of hundredths; a weight is a whole number of basis points

There is **no `numeric` column in this module**. `370` is a rating of 3.70; `6000` is a weight of
60%. Both are `integer` columns, both travel as integers through the API, and the Admin screen
renders them by *inserting a decimal point into a string* rather than by dividing.

The engine computes in `bigint`. Its one division rounds explicitly, half away from zero:

```ts
const rounded = (magnitude + divisor) / (divisor * 2n);
```

Never `Math.round(a / b)`, which is a floating-point division followed by half-to-even at the
boundary. The two agree for the magnitudes a rating scale uses; agreeing by accident is not the same
as agreeing, and only one of them is still correct when somebody widens the scale.

**One value genuinely exceeds 2^53**: a goal's observed measurement — a count of transactions, of
bytes, of parts. It is a `bigint` column, arrives from the driver as a **string**, is parsed with
`BigInt`, is published as a **decimal string**, and is rendered by an identity function with a name.
`Number` is applied to it nowhere. The chain is asserted end to end at every layer, with
`9007199254740993`, whose `Number` is `9007199254740992` — the last digit simply gone.

### Work nobody assessed leaves the denominator, with its reason recorded

A component with no assessment is **excluded**, not scored zero. The denominator shrinks to the
weights that were actually assessed, and the exclusion is persisted with one of four reasons —
`missing`, `incomplete`, `cancelled`, `not_applicable` — so a rating can be explained rather than
merely reproduced. A cancelled goal leaves the denominator the same way.

The distinction the code has to keep is between **absent** and **zero**, and it appears at every
layer: an absent weight is not `0`, an unscored review renders `—` rather than `0.00`, and a
component that was assessed at zero stays in the denominator because somebody did look.

### Self and peer assessments are recorded, readable, and contribute nothing

They are stored in full, returned in full, and carry no weight — because no weighting for them was
ever approved. The API publishes no `contribution` or `weightBasisPoints` field on one, and the
Admin screen states beside each assessment which of the three counts. Inventing a weight would be
inventing a policy, and a policy about somebody's rating is not a thing to infer.

## Consequences

Every consumer works in hundredths and basis points. A client that wants `3.70` divides at the point
of display, once, having received the exact integer.

The refusal to score an unassessed component zero means a review can be scored on less than its full
weight, and the persisted working says so. That is the honest outcome and it is visible: the
component's `denominatorBasisPoints` differs from its `weightBasisPoints` exactly when something was
excluded.

A future phase that adds self or peer weighting must add it deliberately — to the domain, the
persisted working and the published view together. Nothing in this module quietly leaves room for it.
