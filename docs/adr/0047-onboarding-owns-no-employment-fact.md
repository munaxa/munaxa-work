# ADR-0047 — Onboarding owns no employment fact, and creates neither a Person nor an Employment

**Status** Accepted · **Date** 2026-08-10 · **Author** Phase 7 · **Approval** Approved before implementation (D-3)

## Context

The in-repo Phase 7 specification (v1.0, AD-002 and AD-003) has Onboarding receive an accepted
candidate and **create the Person and the Employment**. Phase 6 had already implemented the hire as a
saga that does exactly that, through People's and Employment's published application services
(ADR-0046), because Phase 7 did not yet exist and a hire that stopped at a Person would otherwise
have left a workforce record uncreated with nothing to complete it.

Building Phase 7 to the letter of AD-002/AD-003 would therefore mean a **second implementation of the
hire**: a second place that decides whether a Person already exists, a second place that allocates an
employment number, and two answers to "when did this person become an employee". The approved
decision (D-3) is that Phase 7 must not do that.

Separately, an onboarding screen wants to show a joiner's unit, their manager and whether they have
started. The tempting shortcut is to copy those onto the onboarding row at creation.

## Decision

**Onboarding creates no Person and no Employment, and owns no employment fact.**

Concretely:

- `EmploymentDirectoryPort` and `PeopleDirectoryPort` expose **reads only**. There is no `create` on
  either, in the port, in the adapter or anywhere else in the module.
- `onboarding_instance.employment_id` and `person_id` carry **foreign keys** to `employment(id)` and
  `person(id)`, and both are absent from the update set. Onboarding could not create an employment
  even if a defect tried: the database would refuse the row, and it could not repoint an existing
  instance at a different human being.
- The instance holds **no employment status, no unit, no position, no manager and no employee
  number**. A consumer wanting any of those asks Employment or Organization, as at a date.
- Completing an onboarding does not make anybody an employee, and cancelling one **ends no
  employment**. A withdrawn hire and a no-show are employment facts Employment records; the exit
  process is Offboarding's.

What Onboarding does own is the *process*: which plan version it came from, when it is planned to
start, where it has got to, and how it ended.

The one thing copied from Employment is `employment_start_on`, and it is copied because it is the
**anchor a task's due date was computed from**. It is documented as "the start date as it stood when
tasks were generated", never as the authoritative start date — moving a deadline afterwards is a
deliberate, audited reschedule.

## Reason

**Two implementations of the hire are two answers to the same question.** The failure is not that the
second implementation is wrong; it is that both are right about different rows, and the disagreement
surfaces months later in a headcount report.

**A copied fact is a fact that goes stale.** An onboarding row carrying a unit is correct until the
first reorganization, after which the induction record says one thing and the organization chart says
another — and the induction record is the one somebody reads in a dispute.

**Structural beats procedural.** "The application does not call create" is a promise a future
contributor can break in one line. "The port has no create and the foreign key would refuse the row"
is not.

## Consequences

- An onboarding cannot be started for somebody who does not yet have an employment. That is correct
  and is what makes the reconciliation query answerable, but it means a customer who wants to prepare
  an induction before the contract exists must create the employment first.
- The onboarding screens show employment identifiers rather than names, because resolving one is
  People's read behind People's permission. Stated on the screen rather than left looking unfinished.
- The in-repo Phase 7 v1.0 AD-002 and AD-003 are **obsolete**. This ADR supersedes them.
- `recruitment.candidate.hired` names the application, the candidate, the Person and the Employment,
  so an accelerator can start an onboarding from it without Onboarding needing to create anything.

## Alternatives considered

**Implement AD-002/AD-003 as written and remove the creation from Phase 6.** Rejected on the approved
instruction not to reopen Phase 6, and independently on merit: the hire saga is where the
headcount check, the duplicate-person protection and the recoverable state live, and moving it would
re-litigate ADR-0046 to no benefit.

**Copy the employment's status onto the instance and keep it fresh with an event handler.** Rejected.
Event delivery here is at-most-once with no outbox, so the copy would be wrong exactly when it
mattered — and a stale employment status on an induction record is worse than no status at all.
