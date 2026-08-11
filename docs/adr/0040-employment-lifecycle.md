# ADR-0040 — The employment lifecycle, and why "on leave" belongs to Leave

**Status** Accepted · **Date** 2026-08-09 · **Author** Phase 5 · **Approval** Approved before implementation

## Context

Two specifications disagreed about Employment's states.

The task specification (v2.0) named: `Draft → Active → Suspended → On Leave → Ended`.
The in-repo approved specification (v1.0) named: `Draft → Pending Approval → Active → Suspended →
Terminated → Retired → Archived`.

They differ in three ways, and each difference is a decision rather than a wording choice.

## Decision

The lifecycle is:

```text
draft ──► pending_approval ──► active ──► suspended ──► ended
```

with `draft → active` permitted directly, `suspended → ended` permitted, and **nothing leaving
`ended`**. An ended employment carries an end date and a structured, tenant-supplied
`end_reason_code`, both required by check constraint.

**There is no `on_leave`.** **There is no `retired` and no `archived`.**

## Reason

**`on_leave` would duplicate Leave's ownership.** An employee on annual leave is employed: their
contract runs, their assignment stands, their service accrues. Leave (Phase 9) owns leave, and two
modules holding "is this person on leave" produce two answers — with no way to reconcile them, since
each would be updated by a different workflow. `DOMAIN_OWNERSHIP.md` exists to prevent exactly this.

**`retired` would be a product opinion about labour law.** Retirement is a *reason* an employment
ended, and its consequences — end-of-service entitlement, pension treatment, notice — differ in every
market this product sells into. 00B is explicit that the architecture holds the abstraction and the
country pack holds the law. So retirement is `ended` with `end_reason_code = 'retirement'`, and what
that entails is Phase 11.1's.

**`archived` is a retention decision, not a state of a working relationship.** Nothing in the
business changes when a record is archived; what changes is whether a screen shows it by default.

**`pending_approval` is kept** even though Workflow is Phase 16 and nothing here routes or escalates.
It is a state the domain refuses to leave except by an explicit command, and modelling it now is what
lets Workflow drive it later without reshaping the aggregate. Omitting it would have meant a schema
change in Phase 16.

**`draft → active` is permitted directly** because not every customer approves a hire in this system,
and forcing a `pending_approval` hop that means nothing teaches administrators to click through it.

**`ended` is terminal** because a returning employee is a new employment (AD-004). A state that can
be reopened is not terminal, and every later module — payroll, settlement, reporting — reads it as
final.

## Consequences

- Ending is a **separate command with a separate permission** (`employment.employment.end`), because
  it is the one transition that cannot be undone and the one that final settlement reads.
- The machine is **data** (`PERMITTED_TRANSITIONS`) rather than a chain of conditionals, so the test
  is exhaustive over every pair rather than over the handful somebody thought of.
- The status *history* is a table, not merely events: "what was this employment's status on the
  fourteenth of March" must be answerable to a consumer that was not subscribed — an auditor,
  arriving afterwards.
- A future Offboarding domain (Phase 11.2) orchestrates the exit *around* this transition. It needs
  Employment to already be the single authoritative answer to "is this person still employed, and if
  not, from when and why", which this lifecycle makes it.

## Alternatives considered

**The v2.0 set, including `on_leave`.** Rejected for the duplication above. This is the one place the
task specification was not followed, and the approver confirmed it.

**The v1.0 set, with three terminal states.** Rejected: `retired` and `archived` are a reason and a
retention posture wearing a status's clothes. One terminal state with a code carries the same
information and commits this product to no country's law.

**A single `inactive` state covering both suspension and ending.** Rejected: a suspended employee is
still employed and a terminated one is not, and payroll must be able to tell them apart without
reading a second field.
