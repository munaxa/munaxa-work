# ADR-0072 — A career recommendation is advisory, and Career writes nothing outside itself

**Status** Accepted · **Date** 2026-08-13 · **Author** Phase 15 · **Approval** Approved as decisions D-3, D-8 and the AD-002 / AD-005 boundary of the Phase 15 Definition of Ready

## Context

Career & Succession produces the most consequential-sounding records in the product: "this person
should succeed the operations director", "this person is ready now", "recommend a promotion". Every
one of them is a sentence about somebody's future employment.

The specification is unambiguous that none of them *is* an employment change — Non Goals excludes
promotions, transfers, salary changes and employment modifications; AD-002 says career
recommendations never modify Employment; AD-005 says successor recommendations are advisory and do
not trigger promotions automatically.

That is easy to write and easy to erode. Three erosions are specific, plausible, and each would look
like a small convenience at the time:

1. A `career_successor` row gains a `promote()` command "because the data is already there".
2. `career_succession_plan` gains its own `criticality` column "so the dashboard does not need a
   cross-module read", and the tenant now has two answers to whether a position is critical.
3. A mobility recommendation moving to `accepted` writes an Employment assignment "because that is
   obviously what accepted means".

Each would make Career a second writer of a fact another module owns, and the second writer is
always the one that goes stale.

## Decision

**Career writes nothing outside itself, and no Career state transition causes a change in another
module.**

Three consequences are structural rather than conventions:

**There is no adapter, port or grant through which Career could write.** The cross-module ports
Career declares are read-only by type — they return views and answer questions. A future
contributor who wanted to write to Employment from Career would have to add a port, an adapter, a
grant and a permission, and each of those is a reviewable step. This is the same construction
Learning uses (AD-005 there, and no write to People anywhere) and Performance uses (no adapter that
could fetch a salary).

**`accepted` on a mobility recommendation means a human agreed with the suggestion.** It does not
mean a transfer happened. Nothing is assigned, no letter is issued, no assignment row is written.
The Admin screen says this in words, because a status word alone would be read as an action.

**Career stores no copy of a fact another module owns.** In particular it stores no position
criticality: `organization_position.criticality` exists, `POSITION_CRITICALITIES` is a published
vocabulary and `PositionView.criticality` is on the published contract. Career owns
`career_succession_plan` *for* a position and reads criticality when it needs it. The
specification's `CriticalPositionReference` aggregate root is therefore not a Career table — AD-004
already assigns critical positions to Organization, and a Career copy would be a staler second
answer.

**Confirmation is a named human act, not an `ApprovalPort` call.** Confirming a successor is the
moment an organization commits to a name, and it is what an auditor asks about. `AutoApprovingPort`
is the only approval adapter in this repository and its own comment says it "does not pretend a
chain of approvers considered anything"; consuming it would put `system:auto-approval` on a
succession record. So `career.successor.confirm` is a separate permission from
`career.successor.nominate`, the actor comes from the authenticated context, and a check constraint
refuses `system:auto-approval` — exactly as Performance does for `complete`, Learning for `waive`
and `revoke`, and Payroll for finalization.

## Consequences

Employment consumes Career's outputs through a separate business process that a human drives. That
process does not exist in this product, and Career does not pretend otherwise.

The module is therefore *safe to be wrong*. A nomination made on bad information costs nothing but a
correction, because nothing downstream fired. That is the property that makes advisory records
worth keeping at all.

Workflow routing of a confirmation remains `NOT VERIFIED`: when Phase 16 lands, `ApprovalPort` gains
a real adapter and the question can be reopened. Until then the honest statement is that one
authorized person confirmed, and the record names them.
