# ADR-0045 — A requisition approval is a real decision by a named human, not an auto-approving port

**Status** Accepted · **Date** 2026-08-09 · **Author** Phase 6 · **Approval** Approved before implementation (A-3)

## Context

The kernel declares `ApprovalPort` and ships `AutoApprovingPort` as the in-process adapter, so domains
can depend on the contract before Workflow (Phase 16) exists (ADR-0024). Leave, expenses and other
future domains will route their approvals through it.

A requisition is different in kind. It is the control that **authorizes headcount spending**: the
record that says somebody with budget authority agreed to hire. An auto-approving adapter would make
every requisition approved the moment it was submitted, by nobody, and the approval record would say
so only to a reader who knew what the adapter did.

The approved decision (A-3) was explicit: *do not use `AutoApprovingPort` as if it represented real
human approval for a control that authorizes headcount spending.*

## Decision

Recruitment records its own decision, in its own table, and does not consult `ApprovalPort`.

- `recruitment_requisition_decision` holds the decision, the reason, the note, **who decided** and
  **when**. The actor is taken from the authenticated context — a caller cannot supply it.
- `recruitment.requisition.approve` is a **separate permission** from `recruitment.requisition.manage`.
  The person who drafts the request is not automatically the person who may commit the budget.
- A decision is **never amended**. The correction mechanism is a **reversal**: a new row naming the
  decision it reverses, written in the same transaction as the status change back to
  `pending_approval`.
- A reversal is refused once hiring has begun against the requisition. Unmaking the authority for a
  hire that already happened would leave the hire unauthorized rather than undone.
- The row carries an `approval_id` column, null today.

## Reason

**An approval nobody made is not an approval.** The shipped adapter is honest about being automatic;
the dishonesty would be in this module treating its answer as evidence that a human agreed. In a
headcount audit, "the system approved it" is the answer that ends the audit badly.

**Separation of duties is the point of the control**, and it cannot be expressed through a port that
approves everything.

**An edited decision is not evidence.** The same reasoning behind People's notes and Employment's
status history: the cheapest way to guarantee a record was not rewritten is to give the code no way to
rewrite it.

## The migration path to Workflow (Phase 16)

Deliberately small, and stated now so it is not rediscovered later:

- The aggregate already models `pending_approval` as a distinct state.
- The row already carries `approval_id`.
- Workflow adds **routing, delegation, escalation and multi-step chains** by requesting through
  `ApprovalPort`, storing the returned identifier in `approval_id`, and calling the module's existing
  `decide` command when the outcome arrives.
- **No table changes, no state changes, and no change to the decision record.** What changes is who
  the request is routed to and how it gets there.

## Consequences

- Recruitment ships no workflow engine, no routing rules and no delegation. A requisition is approved
  by somebody who holds the permission, which is the whole of the mechanism in this phase.
- The same reasoning is applied to **offer approval**, which has its own permission
  (`recruitment.offer.approve`) and records its decider on the offer.
- A tenant needing multi-step approval waits for Phase 16. Building a second workflow engine here to
  fill the gap would be the thing this repository's rules exist to prevent.
