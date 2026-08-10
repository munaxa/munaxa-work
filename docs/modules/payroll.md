# Payroll

**Employment says somebody is employed. Compensation says what they are entitled to receive. Payroll
says what is actually paid for a period.** This is the third sentence, and the last module in that
chain.

Phase 11. Fourteen tables. Package `@work/payroll`.

---

## What it owns

Payroll groups and their pay calendars; deduction definitions; payroll periods; payroll runs and
their lifecycle; the **immutable input snapshot** each run calculated from; payroll results, earning
lines and deduction lines; exceptions; manual adjustments; approval decisions; reconciliation
records; and the two outputs it prepares and nothing consumes — accounting lines and payment
instructions.

## What it does not own, and why

| Absent | Where it belongs | Why |
| --- | --- | --- |
| Approved overtime | Attendance | Attendance publishes **candidate** minutes by design (ADR-0054). A candidate is not an approved fact, and Payroll will not promote one (ADR-0065) |
| Tax, social security, GOSI, end-of-service | Country packs | No statutory rule ships in this product. A generic module computing one is the failure 00B exists to prevent |
| WPS, Mudad, Muqeem | Country compliance | Not a file format, not an endpoint, not a stub |
| Journal posting | Finance | There is no Finance module, no ledger and no chart of accounts here. Payroll prepares balanced lines and posts nothing (ADR-0067) |
| Payment execution | Bank / payment domain | No account number, no IBAN, no credential, no transfer |
| Exchange-rate conversion | Nowhere in this phase | Not a rate, not a table, not a function. Nothing is totalled across currencies |
| Payslip rendering, storage, delivery | Document domain | Payroll owns the payslip **data**. No `DocumentPort` exists |
| Benefits, loans | Their own domains (12, 10.1) | Both are declared deduction sources with **no producer** |
| Approval routing and escalation | Workflow (16) | The approval chain is recorded in `ApprovalPort`'s shape so Phase 16 changes the source and not the contract |
| Person, employment, compensation, attendance, leave, legal entity | Their own modules | Read through published contracts under a bounded service grant, never by SQL across a boundary |

---

## The four decisions that carry the module

### A run calculates from a snapshot, never from live sources (ADR-0064)

Every employment a run covers gets one `payroll_input_snapshot` row holding exactly what was read:
the employment facts, the compensation components, the attendance answer, the leave answer, and a
digest of each. The result is then a pure function of that row.

This is what makes a payslip explainable eight months later. The sources have all moved by then; the
snapshot has not. Replaying it reproduces the stored figure exactly, and a reproducibility test
asserts that rather than describing it.

### A candidate is not an approved fact (ADR-0065)

`payroll_earning_line.earning_source` includes `attendance_overtime`, and **no code path produces
it**. The value reserves the classification so the eventual approved-overtime contract needs no
migration of historical lines, and a test asserts it stays unreachable.

Overtime payroll is `NOT VERIFIED`. Payroll may consume an approved overtime result only through an
explicit published Attendance contract; it will not build a second overtime calculation or approval
engine, and Attendance was not modified to make this easier.

### Finalized payroll is immutable at the table (ADR-0066)

Finalization stamps `finalized_at` across six tables. From that moment a `before update or delete`
trigger raises `payroll_finalized_immutable` for any mutation of those rows — from any path,
including SQL nobody wrote in TypeScript.

The application refuses the same operations first. The trigger is the net, and it is the only
mechanism available: a check constraint cannot see the old row, and neither can a rule, a grant or
an RLS policy. Measured cost is **+8% on single-row updates (≈14 µs/row)** and within run-to-run
noise on a bulk update.

The remedy for a wrong finalized run is a reversal, which creates new state. Nothing edits old
state.

### Payroll publishes outputs and posts nothing (ADR-0067)

The accounting output is balanced debit and credit lines in Payroll's own table, against **opaque
tenant account codes**. The payment instruction carries an amount, a date, a method code and the
status `prepared` — and no account identifier of any kind.

There is no `posted` state and no `executed` state, because nothing posts and nothing executes.

---

## The fourteen tables

| Table | Holds |
| --- | --- |
| `payroll_group` | Who is paid together, and under what policy |
| `payroll_deduction_definition` | A fixed amount or a share of gross, with a priority |
| `payroll_period` | A pay calendar entry. Overlaps refused by a GiST exclusion constraint |
| `payroll_run` | The lifecycle, the cursor, the digests and the counts |
| `payroll_input_snapshot` | What was read, per employment, verbatim |
| `payroll_result` | One employment, one currency, one run |
| `payroll_earning_line` | An earning and the arithmetic that produced it |
| `payroll_deduction_line` | A deduction, in priority order |
| `payroll_exception` | Why an employment was not calculated |
| `payroll_adjustment` | A figure somebody changed by hand, and the sentence explaining why |
| `payroll_approval_decision` | Who decided what, and what reversed it |
| `payroll_reconciliation` | Which source moved after the run was calculated |
| `payroll_accounting_line` | Balanced lines, posted nowhere |
| `payroll_payment_instruction` | Prepared, executed by nothing |

Row-level security is applied by the creating migration (ADR-0030) on all fourteen.

`payroll_group.legal_entity_id` carries **no foreign key**, following ADR-0042 and the Phase 10
precedent: a cross-module foreign key is a coupling the modular monolith does not accept, and the
identifier is validated through Organization's published read instead.

---

## The lifecycle

```
draft → calculating → calculated → approved → finalized
             ↑            ↓                       ↓
             └───────── stale                  reversed
```

`processing` is `calculating`. There is no `paid`, no `posted` and no `executed`.

A run is `calculated` only once its cursor has covered the population — `complete: false` means the
run is partial, and a partial run cannot be approved. A run becomes `stale` when reconciliation
finds a source that moved after calculation; a stale run cannot be approved or finalized, and its
existing figures stay byte-identical until it is recalculated.

`payroll_run_active_idx` permits **one non-terminal run per period**, so two concurrent calculation
commands cannot fork a period into two payrolls.

---

## Calculation at scale

A hundred-thousand-employee run is roughly two hundred transactions, not one. Each batch of 500:

1. reads its four sources **once** — never per employment;
2. assembles a snapshot per employment;
3. calculates purely — no database, no clock, no source call;
4. clears the employments it is about to write, then writes five multi-row inserts;
5. commits, and advances the cursor.

A crash at employee sixty thousand leaves sixty thousand results committed and a cursor pointing at
the next one. `maxBatches` bounds one invocation, so a long run is driven by repeated calls rather
than by one request that holds a connection for forty minutes.

**Recalculation replaces rather than accumulates.** Each batch clears the rows its own employments
previously produced — narrow by design, so an employment that did not go stale is never touched.

---

## Cross-module reads

Five sources, every one through a published contract under a bounded service grant (ADR-0043). **No
Payroll SQL references another module's tables.**

| Source | Contract | On failure |
| --- | --- | --- |
| Employment | Paged identifier search, then facts per batch | Exception per employment; never a silent omission |
| Compensation | `compensation.payroll-period` | Exception `compensation_missing` |
| Attendance | Period facts | Exception; **candidate overtime is never payable** |
| Leave | `leave.payroll-period` (added in this phase, D-15) | Exception `leave_unavailable` |
| Organization | Legal-entity read | **Refuses the run.** Calculating a workforce under no statutory rules because Organization was briefly unreachable would be silently wrong |

`organization.export-structure` is not on any calculation path (D-17), and Employment was not
modified to carry a payroll-eligibility field (D-18) — the eligibility rule is versioned on the
group and recorded in the snapshot.

---

## Reconciliation

A **pull**, not a subscription. It asks every source whether it has moved since the run was
calculated and records what it finds. Nothing it finds is repaired automatically.

Correctness therefore never depends on an event having been delivered. A lost `compensation.changed`
event does not leave a payroll quietly wrong; the next reconciliation finds the difference by digest
and marks the run stale.

---

## Permissions

| Permission | Sees or does |
| --- | --- |
| `payroll.read` | Groups, periods, runs, exceptions — **not figures** |
| `payroll.read-result` | What a named person was paid |
| `payroll.manage` | Configure groups, deductions and periods |
| `payroll.calculate` | Run and recalculate |
| `payroll.approve` | Accept responsibility for what a workforce is about to be paid |
| `payroll.finalize` | Make it immutable |
| `payroll.reverse` | Undo a finalized run into new state |
| `payroll.adjust` | Record an adjustment, and read the reason on one |
| `payroll.accounting` | The accounting export |
| `payroll.payment` | The payment instructions |

The separation between `payroll.read` and `payroll.read-result` is the one that matters most:
collapsing them would make every payroll administrator a reader of every salary in the company. The
accounting and payment exports are separate again, and from each other — a full accounting export is
a full salary list by another name, and a payment file is the same list with dates attached.

`decided_by` is taken from the authenticated context and never from a request body. The database
refuses `decided_by = requested_by`. There is no `system:auto-approval` anywhere.

---

## API

`/api/v1/payroll`, four controllers. Every collection is bounded (default 50, maximum 200); there is
no unbounded payroll result read on any route.

**Every monetary amount crosses as an exact decimal string** with its currency code and exponent,
in and out. A JSON number loses precision above 2^53, and a payroll is exactly where that matters:
`9007199254740993` minor units is carried through HTTP, the controller, the application, the
repository, a `bigint` column and back, exact.

No business rule lives in a controller. Each application handler declares the permission it
requires and the kernel pipeline enforces it, so the HTTP edge can neither widen nor narrow access.

---

## Admin workspace

Seventeen read-only sections at `/payroll`, English and Arabic with direction following language.

The screen offers only the actions a run's state permits — a finalized run shows Reverse and nothing
else; a stale or incomplete run shows neither Approve nor Finalize; an unresolved
`eligibility_rule_failed` blocks Finalize. **This is usability, not authorization.** The API refuses
each independently, and the PostgreSQL suite proves it for a caller who never loaded the page.

Exceptions are shown and never replaced with zeros. Nothing on the page claims progress this system
does not make.

---

## What is not verified

Approved overtime. Country compliance of any kind. Tax and social security. GOSI, WPS, Mudad,
Muqeem. Finance posting. Bank and payment execution. Exchange-rate conversion. Payslip rendering,
storage and delivery. Benefits. Loans. Workflow routing. Notifications.

Each is absent rather than stubbed. Where a classification is reserved for one — `attendance_overtime`,
`statutory`, `benefit`, `loan_advance` — a test asserts it has no producer.
