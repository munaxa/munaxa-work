# ADR-0061 — Money is integer minor units carrying its own currency exponent

**Status** Accepted · **Date** 2026-08-10 · **Author** Phase 10 · **Approval** Approved before implementation (D-2)

## Context

Compensation is the first module in this product to persist money. Every module before it
deliberately refused to: Attendance produces candidate minutes (ADR-0054), Leave holds a
`paidTreatmentCode` it never interprets (ADR-0060), Recruitment holds an opaque JSON proposal it
defers to here. So the persistence convention for money was genuinely open, and choosing it wrongly
would be expensive to reverse — a stored figure is a figure somebody is paid.

The kernel's `Money` is already decided: integer minor units in `bigint`, with a
`Currency { code, exponent }` supplied rather than assumed, and an explicit `Rounding` at every call
site. What was undecided was how a *row* carries that.

Two facts constrained the choice.

**Nothing in this repository publishes a currency's exponent.** `legal_entity.currency_code` is a
bare ISO 4217 `char(3)`. There is no currency table, and `/// @global` reference data belongs to
Platform rather than to a business module (ADR-0033).

**Two decimal places is a habit, not a rule.** The Kuwaiti dinar, the Bahraini dinar and the Omani
rial all have three. A module that assumed two would be wrong by a factor of ten in three of this
product's named markets — silently, and in the direction that underpays.

## Decision

**Every persisted monetary value is three columns: `amount_minor bigint`, `currency_code char(3)`
and `currency_exponent smallint`.**

No `numeric`, no `double precision`, and no JavaScript `number` at any point on the path — not in a
row mapper, not in a view, not on the wire. `bigint` columns arrive from the driver as **strings**
and are parsed with `BigInt`; every published figure crosses the boundary as an exact decimal
string, with the decimal rendering supplied beside it for display.

The exponent is **denormalised onto every monetary row** rather than looked up.

### Alternatives considered

**`numeric(18,4)`.** Exact in the database, and lossy at the boundary in practice: `numeric` arrives
in the driver as a string, so every read would re-derive minor units — and every such derivation is
a place somebody eventually writes `Number()`. It also does not answer the exponent question, which
is what a screen needs to render and what a payslip needs to round to.

**`amount_minor bigint` plus a currency table supplying the exponent.** The cleanest normalisation
and the wrong trade. It makes a historical row unreadable without a join to a table somebody can
revise, and a compensation record has to reproduce its own figure years later in a payroll dispute.
A currency catalogue is also Platform's to own, not Compensation's.

## Consequences

- Two extra bytes and three characters per monetary row, which is the whole cost.
- A compensation record is **self-describing**: `amount_minor`, `currency_code` and
  `currency_exponent` reconstruct the exact figure with no lookup, for as long as the row exists.
- A percentage of a component in a **different currency is refused**, not converted — there is no
  conversion in this module, so an amount and its basis must agree on both code and exponent.
- Nothing sums across currencies. Every published total is one per currency, including on the
  payroll contract.
- When Platform later publishes a currency catalogue, this stays correct: the catalogue becomes the
  source a *new* row's exponent is chosen from, and existing rows keep their own.

The tests that hold this in place: an amount above 2^53 round-tripped through the real database and
compared exactly; a three-decimal currency rendered as `1234.567`; and a decimal input refused
rather than truncated.
