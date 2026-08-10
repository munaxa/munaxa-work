# Leave & Absence Management

**Leave explains authorized absence. Attendance records what happened. Payroll decides what it
costs.**

Phase 9. Fourteen tables, twenty-one commands, seventeen queries, fourteen permissions, forty-one
endpoints across seven controllers.

## What this module owns

Leave types and versioned leave policies; policy assignment; entitlement; the leave ledger; the
balance projection derived from it; leave requests and their per-date breakdown; decisions;
cancellations and amendments; adjustments; accrual runs, leave-year closure and carry-over expiry;
blackout periods; and the published answer to "is there approved leave on this date".

## What it does not own, and never will

| Absent from this module | Where it lives | Why |
| --- | --- | --- |
| Money — any rate, multiplier or amount | Compensation, Payroll | `paidTreatmentCode` is a code Leave stores and never interprets; `encashableMinutes` is eligibility, not worth |
| A working-time schedule or holiday calendar | Attendance, Organization | Two owners of "was Tuesday a working day" give two answers |
| An `on_leave` employment status | Nowhere | An employee on leave is employed (ADR-0040) |
| A person, an employee number, contracted hours | People, Employment | Referenced by identifier, read as at a date (ADR-0051) |
| A workflow engine — escalation, timeout, routing | Workflow (Phase 16) | Multi-level approval here is a sequence, not routing |
| Document bytes | Documents | An attachment is a *reference*; nothing verifies it resolves |
| Any statutory rule, figure or leave type | Country packs | If a new country needs a change here, that is an architecture defect (00B) |

## The five decisions worth knowing

**The ledger is authoritative; the balance is a projection** ([ADR-0059](../adr/0059-the-leave-ledger-is-authoritative.md)).
`leave_ledger_entry` is inserted and read — no update, no delete, no method that could. A correction
is a reversal plus a replacement. `leave_balance` is never written except by recalculation, carries a
digest and a stale mark, and `leave.balance-as-of` re-derives the same figure from the ledger
without reading the projection at all.

**Every duration is integer minutes.** Half a day is 240 of 480 and is exact. Fractional days are a
presentation conversion through contracted hours, with the basis stated on the contract.

**Overlapping leave is refused by the database.** `leave_request_day_overlap` is a GiST exclusion
constraint over a generated minutes-of-day range, so two people racing for the same morning collide
there rather than both passing an application check. A first and a second half of one date coexist;
two overlapping *hourly* requests do not — which a partial unique index could not have expressed.

**Attendance pulls; Leave never pushes** ([ADR-0058](../adr/0058-attendance-pulls-leave-changes.md)).
Attendance already depends on Leave, so a Leave-to-Attendance write would close the cycle. Leave
publishes `leave.approved-leave-for` and `leave.approved-leave-affecting`; Attendance's
`attendance.reconcile-leave` asks and marks its own days.

**Nothing statutory ships, and approval is recorded rather than delegated**
([ADR-0060](../adr/0060-leave-ships-no-statutory-content.md)). No leave type, no entitlement figure,
no accrual formula. Approval is by a named human from the authenticated context; self-approval is
refused by the domain, by the permission separation and by a check constraint.

## The two cross-module reads

Both go through published application services under bounded service grants (ADR-0043), never
through another module's tables.

| Leave asks | Of | For |
| --- | --- | --- |
| `employment.read-employment`, `employment.search` | Employment | That the employment is real as at the leave date, and its scope |
| `attendance.expected-working-days` | Attendance | Which dates the employment works, and for how long |

`attendance.expected-working-days` is a Phase 9 addition to Attendance: a new read over the
resolution logic Attendance already had, with no schema change. A `working_days` request against an
Attendance that cannot answer is **refused by name** (`no_working_pattern`), never counted as
calendar days.

## The request lifecycle

```text
draft ──► submitted ──► pending_approval ──► approved ──► taken ──► closed
            │                │                   │
            │                ├──► rejected       ├──► cancelled
            └──► withdrawn                       └──► (superseded by an amendment)
```

The machine is data and is tested exhaustively over every ordered pair. Consumption is written at
`approved`, not at `taken`: an approved future absence is already committed, and the balance an
employee sees must not include leave they have been granted.

A policy requiring no approval sends a request straight to `approved` with **no decision row**. The
absence of the row is the record.

## Reliability

Event delivery in this repository is **post-commit, in-process, at-most-once, with no outbox**.
Nothing in this module depends on an event for correctness:

- every ledger write marks the balance stale **in the same transaction**;
- `leave.balances-awaiting-recalculation` names what is outstanding, using the same predicate as the
  partial index — presence of the mark, never a comparison against `calculated_at`;
- `leave.recalculate-balances` is idempotent and bounded, and clears the mark whether or not the
  figures moved;
- accrual, leave-year closure and carry-over expiry are bounded and restartable, each backed by a
  unique index that makes a retry a no-op.

## What is not built

- **No employee or manager self-service.** The portals stay shells; Phase 18 owns them.
- **No scheduled execution.** Nothing in this repository runs on a timer. Accrual, closure and
  expiry are operator commands; Phase 24 owns scheduling.
- **No document verification.** An attachment reference is stored and never resolved.
- **No notification delivery.** Leave raises domain events; Communications (Phase 17) subscribes
  when it can address a recipient.
- **No cross-midnight hourly leave.** Refused by name, because attributing leave to a shift rather
  than a civil date is a schedule question Attendance owns.
