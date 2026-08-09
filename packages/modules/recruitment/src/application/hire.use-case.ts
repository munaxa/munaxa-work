import type { Command, CommandHandler } from '@work/kernel';

import { RecruitmentPermissions } from './recruitment-permissions.js';
import {
  beginHire,
  completeHire,
  createEmployment,
  failHire,
  recordEmploymentStep,
  recordPersonStep,
  resolvePerson,
  type CandidateHired,
} from './hire-steps.js';
import type { RecruitmentDependencies } from './recruitment-dependencies.js';

/**
 * The hire: the transition from an accepted offer to a Person and an Employment.
 *
 * **This cannot be one transaction, and it does not pretend to be** (ADR-0046). The unit of work
 * opens a new transaction on a new connection per call, so creating a Person (People's write),
 * creating an Employment (Employment's write) and completing the application (this module's write)
 * are separate. A distributed transaction is not attempted; what is built instead is a **saga with a
 * recoverable state**, and the properties that make that honest are:
 *
 * 1. **Ordered.** Person first, then Employment, then completion — each step's output is the next
 *    step's input, and each commits what it achieved before the next is attempted, so a crash always
 *    leaves a state the next attempt resumes from.
 * 2. **Write-once, uniquely indexed.** `candidate.person_id` and `application.employment_id` are
 *    each written once and protected by a unique index, so a retry converges instead of creating a
 *    second Person or a second Employment.
 * 3. **Idempotent.** Every step checks whether it has already been done and skips rather than
 *    repeating. Running this command twice on the same application is the *supported* recovery path,
 *    not an error.
 * 4. **Detectable.** A stopped hire leaves `hire_state` at the step it reached and the application
 *    *not* `hired`. A failed transition never looks like a successful one, and the reconciliation
 *    query is an index scan (`recruitment_application_hire_state_idx`).
 * 5. **Reported.** A failure raises `recruitment.candidate.hire-incomplete`, so operations learns
 *    from an event rather than from a customer.
 *
 * **Recruitment writes to no other module's tables and duplicates no other module's logic.** It
 * sends the commands an administrator would send, through their published application services,
 * under a bounded service grant — which is what keeps `people.person.manage` off every recruiter's
 * role (ADR-0043).
 *
 * **On AD-003.** The in-repo specification hands the successful candidate to Onboarding and has
 * *Onboarding* create the Employment. Phase 7 does not exist, and a hire that stopped at a Person
 * would leave a workforce record uncreated with nothing to complete it. The approved decision has
 * Recruitment invoke Employment's application service directly; Phase 7 will orchestrate around the
 * same services rather than replacing them.
 */

export interface HireCandidateCommand extends Command {
  readonly commandName: 'recruitment.hire-candidate';
  readonly applicationId: string;
  /** Overrides the accepted offer's proposed start date, when the business agreed a different one. */
  readonly startDate?: string;
  /** Required when the accepted offer named no employment type. */
  readonly employmentTypeCode?: string;
  /**
   * The customer's own person number, required when this candidate is not already a Person.
   *
   * Not generated here: it is People's caller-supplied identifier, and inventing one would be
   * Recruitment deciding another module's numbering.
   */
  readonly personNumber?: string;
  readonly expectedVersion: number;
}

export type { CandidateHired } from './hire-steps.js';

export const hireCandidateHandler = (
  dependencies: RecruitmentDependencies,
): CommandHandler<HireCandidateCommand, CandidateHired> => ({
  commandName: 'recruitment.hire-candidate',
  permission: RecruitmentPermissions.hire,

  handle: async (command) => {
    // Step 0, in its own transaction: check the application is ready and mark the saga started, so
    // that a crash before People is reached still leaves a resumable state rather than nothing.
    const started = await dependencies.unitOfWork.execute((transaction) =>
      beginHire(transaction, dependencies, command),
    );

    if (!started.ok) return started;

    const { application, candidate, offer } = started.value;

    // Step 1 — People. Its own transaction, by construction: the unit of work cannot span modules.
    const person = await resolvePerson(dependencies, candidate, command.personNumber);

    if (!person.ok) {
      return failHire(dependencies, application.id, 'person', 'hire_person_step_failed');
    }

    await dependencies.unitOfWork.execute((transaction) =>
      recordPersonStep(transaction, dependencies, {
        applicationId: application.id,
        candidateId: candidate.id,
        personId: person.value,
      }),
    );

    // Step 2 — Employment, then its identifier made durable before completion is attempted.
    const employment = await createEmployment(dependencies, {
      personId: person.value,
      employmentTypeCode: command.employmentTypeCode ?? offer.employmentTypeCode ?? 'unspecified',
      startDate: command.startDate ?? offer.startDate,
    });

    if (!employment.ok) {
      return failHire(dependencies, application.id, 'employment', 'hire_employment_step_failed');
    }

    await dependencies.unitOfWork.execute((transaction) =>
      recordEmploymentStep(transaction, dependencies, {
        applicationId: application.id,
        employmentId: employment.value,
      }),
    );

    // Step 3 — completion, in this module's own transaction.
    return dependencies.unitOfWork.execute((transaction) =>
      completeHire(transaction, dependencies, {
        applicationId: application.id,
        candidateId: candidate.id,
        personId: person.value,
        employmentId: employment.value,
      }),
    );
  },
});
