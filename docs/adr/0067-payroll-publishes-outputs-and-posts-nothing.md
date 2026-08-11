# ADR-0067 — Payroll publishes outputs and posts nothing, and an absent capability is named

**Status** Accepted · **Date** 2026-08-10 · **Author** Phase 11 · **Approval** Approved before implementation (D-4, D-5, D-6, D-7, D-8, D-13)

## Context

Payroll sits at the point where an HR product touches money that leaves the company. Downstream of a
calculation sit five things this repository does not have: a general ledger, an exchange-rate
source, a bank or payment domain, a document renderer, and a country compliance pack. Verified
rather than assumed — there is no `finance` module, `packages/contracts` is `export {};`,
`packages/country-packs` is `export {};`, and no exchange-rate, journal or bank-account table exists
in ninety-five Prisma models.

The temptation at each of those five edges is identical and it is strong, because each has an
obvious-looking stub: a rate table seeded with a few currencies, a `posted` boolean, a payment file
in some plausible format, a PDF written to disk, a tax bracket for one country to prove the engine
works.

Every one of those would produce a system that *appears* complete and reports things that are not
true. A payroll marked posted that no ledger received. A payslip converted at a rate nobody owns. A
statutory deduction computed from a bracket somebody typed from memory.

## Decision

**Payroll publishes contracts and persists its own outputs. It posts nothing, pays nothing, converts
nothing, renders nothing and computes no statutory figure. Each absent capability is named
`NOT VERIFIED` rather than approximated, and no state claims progress the system cannot make.**

### Accounting (D-6)

Payroll publishes `payroll.accounting-output` and persists balanced debit/credit lines in a
**payroll-owned** table. It writes into no Finance table — there is none, and §36 forbids it even
when there is, absent an explicit permitting contract. Lines carry an opaque tenant-configured
account reference; Payroll owns no chart of accounts.

**`accounting_prepared_at` exists. There is no `posted` state**, because nothing posts. An invariant
test asserts Σ debits = Σ credits per run and currency: an unbalanced export is worse than none.

### Payment (D-7)

Payroll publishes `payroll.payment-instructions` and persists one row per finalized result: run,
employment, net amount, currency, payment date, method code, and a Payroll-generated reference for
idempotent downstream consumption.

**No account number, no IBAN, no sort code, no card token, no credential of any kind.** An opaque
`payee_account_ref` is reserved and is null in this phase. **There is no `executed` state.** No
transfer, no WPS file, no gateway, no bank API.

### Currency (D-5)

**Payroll converts nothing.** No exchange-rate service, table, port or function exists, and inventing
one is the single most dangerous thing this phase could do — a wrong rate applied silently to a
hundred thousand payslips is unrecoverable in a way a wrong allowance is not.

Results are per currency, with no total across currencies anywhere in the module. A compensation
block in a currency the payroll group does not permit produces a recorded **currency conflict
exception** and that employment is not calculated. A refusal is a real answer; a converted figure
would be a fabricated one.

### Payslip (D-8)

Payroll owns the payslip **data** — reproducible from persisted rows with no live source read.
Rendering, storage and delivery belong to a future Document domain. No `DocumentPort` exists, so
rendering and storage are `NOT VERIFIED`: no PDF is written, no blob column is created. The payslip
data contract carries no personal data (ADR-0038); whatever renders it resolves a name under its own
permissions.

### Country compliance (D-4)

A pure `CountryRulePort`, resolved by `(countryCode, packVersion)` where the country comes from
`organization.governing-legal-entity` (ADR-0035) and the version is pinned on the run. It takes the
immutable snapshot plus the generic lines and returns additional earning lines, additional deduction
lines, an optional net floor, and an optional rounding override for its own lines. It cannot query
the database. Every line it produces carries a `statutory_source_code`, so a statutory figure is
distinguishable from a tenant one on a payslip and in an audit.

**No pack ships.** No rate, threshold, bracket, formula or authority name appears anywhere in Phase
11 — not Jordanian, Saudi or UAE law, not GOSI, not Mudad, not Muqeem, not WPS, not a tax rate, not a
social-security rate, not a minimum wage, not an end-of-service formula. A tenant with no pack gets a
payroll with no statutory lines, which is a correct generic payroll rather than a broken one.

### Deductions (D-13)

Payroll owns deductions — the first module permitted to, since Compensation deliberately shipped
none. Implemented generically: unpaid leave, voluntary, manual adjustment. **Input contract only, no
table, no entity**: statutory (a country pack), benefit (Phase 12), loan or advance (a future
domain) — all `NOT VERIFIED`.

Defining a port shape is not implementing a domain. Creating a `payroll_loan` table would be, and it
is exactly the failure Phase 10 avoided by refusing deductions outright rather than shipping half of
them.

## Consequences

- Phase 11 delivers a payroll that calculates, approves, finalizes, reverses and explains — and does
  not post, pay, convert, render or tax. The boundary is visible in the state machine rather than
  buried in a comment.
- Six capabilities are reported `NOT VERIFIED` in the phase report. That is the honest completion
  status, and a reader can tell exactly what is missing and who owns it.
- Multi-currency tenants are partly blocked: an employment paid in a currency outside the group's
  policy is refused rather than converted. Correct, and inconvenient.
- Each downstream domain, when it arrives, consumes a stable persisted record rather than asking
  Payroll to recompute — which is why the outputs are persisted and not merely projected.
- Five extension points exist with no implementation behind them. Phase 11.1 and Phase 12 will find
  gaps in them; a narrow interface is cheaper to widen than a speculative one is to narrow.

## Alternatives considered

**A minimal Finance module to post into.** Would make the accounting output demonstrable end to end,
and would put the general ledger in the hands of the phase least equipped to own it. Finance is a
domain, not a table.

**A seeded exchange-rate table.** Makes multi-currency payroll appear to work. Every figure it
produces is wrong by an unknown amount, and nobody downstream can tell.

**One country pack "to prove the interface".** The most persuasive of the alternatives, and rejected:
a pack written without a compliance owner is a guess about somebody's tax law that ships as a
statutory calculation. The interface is proved instead by a test double that exercises every hook
and asserts no statutory line appears when no pack is configured.

**A `posted` flag set when the output is generated.** The specification names this explicitly as the
thing not to do, and it is worth restating why: it converts "we produced a file" into "the money is
in the accounts", and the two are separated by everything that actually goes wrong.
