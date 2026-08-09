# ADR-0046 — The hire is a saga with a recoverable state, not a distributed transaction

**Status** Accepted · **Date** 2026-08-09 · **Author** Phase 6 · **Approval** Approved before implementation (A-4)

## Context

Hiring a candidate means three writes in three modules: a **Person** (People's), an **Employment**
(Employment's), and the application's own completion (Recruitment's).

`PostgresUnitOfWork.execute` opens a **new transaction on a new connection per call**, and each
module's application service opens its own. There is no ambient transaction to join, no two-phase
commit, and no shared connection. The three writes therefore cannot be atomic, and the approved
decision (A-4) accepted that limitation on the condition that the implementation not pretend
otherwise.

Ten behaviours were required, including: Employment creation is invoked through the **Employment
application service**; `person_id` is write-once with a unique constraint; the transition is safely
retryable; a partially completed transition is **detectable**; a failed transition must not silently
appear successful; and the recoverable state is exposed for operational retry and reconciliation.

## Decision

A **saga in four steps**, each committing what it achieved before the next is attempted, with the
state it reached stored on the application row.

```
0. begin      → check the accepted offer and the requisition's remaining headcount;
                mark hire_state = 'pending'                              (Recruitment's transaction)
1. person     → reuse a single unambiguous match, or create through People;
                write candidate.person_id; hire_state = 'person_linked'  (People's, then Recruitment's)
2. employment → create through Employment's application service;
                write application.employment_id; hire_state = 'employment_created'
3. complete   → count the hire against the requisition, move the application to 'hired',
                hire_state = 'completed', raise recruitment.candidate.hired
```

`recruitment_application.hire_state` is the recoverable state: `pending`, `person_linked`,
`employment_created`, `completed`, `failed`. The properties that make this honest:

- **Ordered.** Each step's output is the next step's input, so an interruption always leaves a state
  the next attempt resumes from.
- **Write-once, uniquely indexed.** `recruitment_candidate.person_id` and
  `recruitment_application.employment_id` are each written once and protected by a partial unique
  index, so a retry converges instead of creating a second Person or a second Employment.
- **Idempotent.** Every step checks whether it has already been done and skips rather than repeating.
  Sending `recruitment.hire-candidate` again is the **supported recovery path**, not an error.
- **Detectable.** A stopped hire leaves the application *not* `hired`, carrying the state it reached.
  `recruitment_application_hire_state_idx` is a partial index, and the reconciliation query is exposed
  as an ordinary filter: `GET /api/v1/recruitment/applications?unfinishedHire=true`.
- **Never silently successful.** The application only reads `hired` when an employment identifier is
  present and the requisition has been counted. A failure returns a conflict and raises
  `recruitment.candidate.hire-incomplete`.
- **Headcount checked first.** The requisition's remaining headcount is checked at step 0, before a
  Person or an Employment exists, so the common refusal costs nothing. It is enforced again by the
  aggregate and by a check constraint at step 3.

Recruitment **writes to no other module's tables**. It sends the commands an administrator would send,
through their published application services, under a bounded service grant (ADR-0043).

## Reason

**A false distributed transaction is worse than an honest saga.** Wrapping the three calls and
catching an error would leave a Person created and no employment, with nothing recorded to say so —
the exact failure this design makes visible.

**Detectability is what makes the limitation acceptable.** The cost of a non-atomic hire is that it
can stop half way. That cost is bounded when a half-finished hire is one indexed query away and
carries the state it stopped in; it is unbounded when it looks like a hire that never started.

**On AD-003.** The in-repo specification hands the successful candidate to Onboarding and has
*Onboarding* create the Employment. Phase 7 does not exist, and a hire that stopped at a Person would
leave a workforce record uncreated with nothing to complete it. The approved decision has Recruitment
invoke Employment's application service directly. `recruitment.candidate.hired` names the application,
the candidate, the Person and the Employment, so Phase 7 orchestrates around the same services rather
than replacing them.

## Consequences

- Two of the three writes can outlive a failure of the third. That is stated in the module guide and
  in the completion report rather than described as atomic.
- A candidate matching **more than one** live Person is refused rather than guessed. The recruiter
  links the right Person explicitly and retries.
- Creating a Person requires the customer's own `personNumber` on the hire command: People takes a
  caller-supplied number, and inventing one would be Recruitment deciding another module's numbering.
- People's duplicate detection is **not** suppressed. If People thinks the new Person might be
  somebody it already holds, the hire stops with a resumable state rather than acknowledging the
  warning from inside another module.
