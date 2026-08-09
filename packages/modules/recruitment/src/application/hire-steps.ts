import {
  success,
  type Command,
  type HandlerFailure,
  type Result,
  type Transaction,
} from '@work/kernel';

import { Application } from '../domain/application.js';
import { Candidate } from '../domain/candidate.js';
import { Requisition } from '../domain/requisition.js';
import type { ApplicationState } from '../domain/application.js';
import type { CandidateState } from '../domain/candidate.js';
import type { HireState } from '../domain/recruitment-vocabulary.js';

import { conflicted, notFound, originOfCurrentRequest, refusedBy } from './recruitment-context.js';
import { recordMovement } from './application.use-case.js';
import type { RecruitmentDependencies } from './recruitment-dependencies.js';

/**
 * The steps of the hire saga, each in its own transaction, in the order a retry resumes them.
 *
 * They live beside the handler rather than inside it because each one is a separate durable point:
 * what makes this design honest is that every step *commits what it achieved* before the next is
 * attempted, so an interruption leaves a state the next attempt continues from rather than a hire
 * that half happened and reads as though it did not (ADR-0046).
 */

export interface HireContext {
  readonly application: ApplicationState;
  readonly candidate: CandidateState;
  readonly offer: {
    readonly startDate: string;
    readonly employmentTypeCode?: string;
  };
}

export interface StartHire extends Command {
  readonly applicationId: string;
  readonly expectedVersion: number;
}

/**
 * Checks the application is genuinely ready, checks the headcount is still available, and opens the
 * saga.
 *
 * "Ready" is an **accepted offer**, not merely an application somebody moved to `offered`. Hiring
 * against an offer the candidate never accepted is the failure this guards, and it is easy to reach
 * by accident on a busy pipeline.
 *
 * The headcount is checked *here*, before a Person or an Employment is created, because a hire
 * refused at the last step would already have produced both. The requisition is counted at the end
 * and the aggregate refuses there too — this check is what stops the common case reaching it.
 */
export const beginHire = async (
  transaction: Transaction,
  dependencies: RecruitmentDependencies,
  command: StartHire,
): Promise<Result<HireContext, HandlerFailure>> => {
  const state = await dependencies.stores.applications.byId(transaction, command.applicationId);

  if (state === undefined) return notFound<HireContext>('application');

  const candidate = await dependencies.stores.candidates.byId(transaction, state.candidateId);

  if (candidate === undefined) return notFound<HireContext>('candidate');

  const offers = await dependencies.stores.offers.forApplication(transaction, state.id);
  const accepted = offers.find((offer) => offer.status === 'accepted');

  if (accepted === undefined) return conflicted<HireContext>('no_accepted_offer');

  const authorized = await headcountAvailable(transaction, dependencies, state.vacancyId);

  if (!authorized) return conflicted<HireContext>('requisition_headcount_exhausted');

  const application = Application.rehydrate(state);
  const begun = application.beginHire();

  if (!begun.ok) return refusedBy<HireContext>(begun.error);

  await dependencies.stores.applications.update(
    transaction,
    application.snapshot(),
    command.expectedVersion,
  );

  return success({
    application: application.snapshot(),
    candidate,
    offer: {
      startDate: accepted.proposedStartDate,
      ...(accepted.proposedEmploymentTypeCode === undefined
        ? {}
        : { employmentTypeCode: accepted.proposedEmploymentTypeCode }),
    },
  });
};

const headcountAvailable = async (
  transaction: Transaction,
  dependencies: RecruitmentDependencies,
  vacancyId: string,
): Promise<boolean> => {
  const vacancy = await dependencies.stores.vacancies.byId(transaction, vacancyId);

  if (vacancy === undefined) return false;

  const requisition = await dependencies.stores.requisitions.byId(
    transaction,
    vacancy.requisitionId,
  );

  return requisition !== undefined && requisition.headcountFilled < requisition.headcountRequested;
};

/**
 * Finds or creates the Person, through People's own application service.
 *
 * A candidate already linked returns that person unchanged — the retry path. Otherwise matching runs
 * against People's own search, and **a single unambiguous match is reused**: creating a second
 * Person for somebody already in the register is the duplicate this whole design exists to prevent.
 *
 * More than one match is **refused rather than guessed**. Two people sharing a family email address
 * is ordinary, and a system that picked one would attach somebody's career to their spouse. The
 * recruiter links the right person explicitly and retries.
 */
export const resolvePerson = async (
  dependencies: RecruitmentDependencies,
  candidate: CandidateState,
  personNumber: string | undefined,
): Promise<Result<string, HandlerFailure>> => {
  if (candidate.personId !== undefined) return success(candidate.personId);

  const matches = await dependencies.people.findByContact(candidate.email, candidate.phone);
  const live = matches.filter((match) => match.mergedIntoPersonId === undefined);
  const only = live[0];

  if (live.length > 1) return conflicted<string>('candidate_matches_several_people');
  if (only !== undefined) return success(only.personId);
  // The customer's own numbering, and theirs to choose. Refusing here rather than inventing one is
  // what keeps People's identifiers meaningful to the people who read them.
  if (personNumber === undefined) return conflicted<string>('person_number_required');

  const created = await dependencies.people.create({
    personNumber,
    legalName: candidate.displayName,
    email: candidate.displayEmail,
    ...(candidate.phone === undefined ? {} : { phone: candidate.phone }),
  });

  return success(created.personId);
};

/**
 * Commits the person half: the candidate carries the link, and the saga records the step.
 *
 * Idempotent, and the link is write-once — a unique index refuses a second person for one candidate,
 * so a retry converges rather than branching.
 */
export const recordPersonStep = async (
  transaction: Transaction,
  dependencies: RecruitmentDependencies,
  hire: { readonly applicationId: string; readonly candidateId: string; readonly personId: string },
): Promise<void> => {
  const state = await dependencies.stores.candidates.byId(transaction, hire.candidateId);

  if (state !== undefined && state.personId !== hire.personId) {
    const candidate = Candidate.rehydrate(state);
    const linked = candidate.linkToPerson(
      hire.personId,
      originOfCurrentRequest(),
      dependencies.clock.now(),
    );

    if (linked.ok) {
      await dependencies.stores.candidates.update(transaction, candidate.snapshot(), state.version);
      transaction.collect(candidate.pullEvents());
    }
  }

  await advance(transaction, dependencies, hire.applicationId, (application) =>
    application.recordPersonLinked(),
  );
};

export const createEmployment = async (
  dependencies: RecruitmentDependencies,
  request: {
    readonly personId: string;
    readonly employmentTypeCode: string;
    readonly startDate: string;
  },
): Promise<Result<string, HandlerFailure>> => {
  try {
    const created = await dependencies.employment.create(request);

    return success(created.employmentId);
  } catch {
    // Employment refused, or was unreachable. Either way this hire stops here with a state the next
    // attempt resumes from — it does not become a `hired` application with no employment.
    return conflicted<string>('employment_creation_failed');
  }
};

/**
 * Commits the employment half **before** completion is attempted.
 *
 * This is the step that makes a retry safe: the employment identifier is durable the moment
 * Employment returned it, so an interruption between here and completion cannot produce a second
 * workforce record for one hire.
 */
export const recordEmploymentStep = async (
  transaction: Transaction,
  dependencies: RecruitmentDependencies,
  hire: { readonly applicationId: string; readonly employmentId: string },
): Promise<void> => {
  await advance(transaction, dependencies, hire.applicationId, (application) =>
    application.recordEmploymentCreated(hire.employmentId),
  );
};

/** Loads the application, applies one saga step to it, and persists the result. */
const advance = async (
  transaction: Transaction,
  dependencies: RecruitmentDependencies,
  applicationId: string,
  step: (application: Application) => { readonly ok: boolean },
): Promise<void> => {
  const state = await dependencies.stores.applications.byId(transaction, applicationId);

  if (state === undefined) return;

  const application = Application.rehydrate(state);

  if (!step(application).ok) return;

  await dependencies.stores.applications.update(transaction, application.snapshot(), state.version);
  transaction.collect(application.pullEvents());
};

export interface CandidateHired {
  readonly applicationId: string;
  readonly candidateId: string;
  readonly personId: string;
  readonly employmentId: string;
  readonly hireState: HireState;
}

/**
 * Records that the saga stopped, and why, in its own transaction.
 *
 * The application does **not** become `hired`. It keeps the status it had and carries a hire state a
 * reconciliation query finds, and the event tells operations without waiting for somebody to run the
 * query.
 */
export const failHire = async (
  dependencies: RecruitmentDependencies,
  applicationId: string,
  step: 'person' | 'employment',
  reason: string,
): Promise<Result<CandidateHired, HandlerFailure>> => {
  await dependencies.unitOfWork.execute(async (transaction) => {
    const state = await dependencies.stores.applications.byId(transaction, applicationId);

    if (state === undefined) return;

    const application = Application.rehydrate(state);

    application.failHire(
      `${step} step did not complete`,
      originOfCurrentRequest(),
      dependencies.clock.now(),
    );
    await dependencies.stores.applications.update(
      transaction,
      application.snapshot(),
      state.version,
    );
    transaction.collect(application.pullEvents());
  });

  return conflicted<CandidateHired>(reason);
};

/**
 * The last step: count the hire against the requisition that authorized it, close the application,
 * and hand the result to whatever comes next.
 *
 * The count runs **first**, and a requisition with no headcount left stops the completion with
 * nothing written: the application stays at `employment_created`, which is exactly the reconciliation
 * state an operator resumes from once the requisition is amended. This is what makes a requisition a
 * control rather than a label.
 */
export const completeHire = async (
  transaction: Transaction,
  dependencies: RecruitmentDependencies,
  hire: {
    readonly applicationId: string;
    readonly candidateId: string;
    readonly personId: string;
    readonly employmentId: string;
  },
): Promise<Result<CandidateHired, HandlerFailure>> => {
  const state = await dependencies.stores.applications.byId(transaction, hire.applicationId);

  if (state === undefined) return notFound<CandidateHired>('application');

  const counted = await countHireAgainstRequisition(transaction, dependencies, state.vacancyId);

  if (!counted) return conflicted<CandidateHired>('requisition_headcount_exhausted');

  const application = Application.rehydrate(state);

  application.recordPersonLinked();

  const recorded = application.recordEmploymentCreated(hire.employmentId);

  if (!recorded.ok) return refusedBy<CandidateHired>(recorded.error);

  const now = dependencies.clock.now();
  const origin = originOfCurrentRequest();
  const completed = application.completeHire(origin, now);

  if (!completed.ok) return refusedBy<CandidateHired>(completed.error);

  application.raiseHired({ personId: hire.personId, employmentId: hire.employmentId }, origin, now);
  await dependencies.stores.applications.update(transaction, application.snapshot(), state.version);
  transaction.collect(application.pullEvents());
  await recordMovement(transaction, dependencies, {
    applicationId: application.id,
    fromStatus: state.status,
    toStatus: 'hired',
  });
  await markCandidateHired(transaction, dependencies, hire.candidateId);

  return success({
    applicationId: application.id,
    candidateId: hire.candidateId,
    personId: hire.personId,
    employmentId: hire.employmentId,
    hireState: 'completed',
  });
};

const markCandidateHired = async (
  transaction: Transaction,
  dependencies: RecruitmentDependencies,
  candidateId: string,
): Promise<void> => {
  const state = await dependencies.stores.candidates.byId(transaction, candidateId);

  if (state === undefined || state.status === 'hired') return;

  const candidate = Candidate.rehydrate(state);
  const marked = candidate.markHired(originOfCurrentRequest(), dependencies.clock.now());

  if (!marked.ok) return;

  await dependencies.stores.candidates.update(transaction, candidate.snapshot(), state.version);
  transaction.collect(candidate.pullEvents());
};

const countHireAgainstRequisition = async (
  transaction: Transaction,
  dependencies: RecruitmentDependencies,
  vacancyId: string,
): Promise<boolean> => {
  const vacancy = await dependencies.stores.vacancies.byId(transaction, vacancyId);

  if (vacancy === undefined) return false;

  const state = await dependencies.stores.requisitions.byId(transaction, vacancy.requisitionId);

  if (state === undefined) return false;

  const requisition = Requisition.rehydrate(state);

  if (!requisition.recordHire().ok) return false;

  await dependencies.stores.requisitions.update(transaction, requisition.snapshot(), state.version);
  transaction.collect(requisition.pullEvents());
  return true;
};
