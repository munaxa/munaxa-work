import { success, type Command, type CommandHandler, type Transaction } from '@work/kernel';

import { Candidate } from '../domain/candidate.js';
import { normalizeEmail } from '../domain/recruitment-vocabulary.js';
import type { Metadata } from '../domain/recruitment-aggregate.js';

import {
  conflicted,
  currentTenant,
  notFound,
  originOfCurrentRequest,
  refusedBy,
} from './recruitment-context.js';
import { RecruitmentPermissions } from './recruitment-permissions.js';
import { allocateNumber } from './recruitment-numbering.js';
import type { RecruitmentDependencies } from './recruitment-dependencies.js';

/**
 * Candidates: the people who might join, and what they say about themselves.
 *
 * **Creating a candidate creates no Person.** That is the boundary this module exists to keep: a
 * speculative applicant who is never contacted leaves nothing in the master registry of human
 * identity, because they are not one of the tenant's people (ADR-0044). A Person appears only at
 * hire, and only through People's own application service.
 *
 * **Duplicate protection is by email, and it refuses rather than merges.** Two candidate records
 * for one human being split their application history and their interview feedback, so a create
 * that finds the address already present returns the existing candidate's identifier as a conflict
 * — the recruiter adds an application to the candidate they already have. It does *not* silently
 * reuse the record: a create that quietly became an update is how a name gets overwritten.
 *
 * **Matching against People is a suggestion, never an action.** `link-person` is explicit and
 * permissioned, because two people share a family email address more often than a product designer
 * expects, and a system that linked automatically would attach somebody's career to their spouse.
 */

export interface CreateCandidateCommand extends Command {
  readonly commandName: 'recruitment.create-candidate';
  readonly displayName: Readonly<Record<string, string>>;
  readonly email: string;
  readonly phone?: string;
  readonly sourceCode: string;
  /** Set when a recruiter already knows the Person — an internal applicant, or a returner. */
  readonly personId?: string;
  readonly metadata?: Metadata;
}

export interface CandidateCreated {
  readonly candidateId: string;
  readonly candidateNumber: string;
}

export const createCandidateHandler = (
  dependencies: RecruitmentDependencies,
): CommandHandler<CreateCandidateCommand, CandidateCreated> => ({
  commandName: 'recruitment.create-candidate',
  permission: RecruitmentPermissions.candidateManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const existing = await dependencies.stores.candidates.byEmail(
        transaction,
        normalizeEmail(command.email),
      );

      // Checked here as well as by the unique index, so the caller gets "that candidate exists"
      // rather than a constraint violation they cannot act on.
      if (existing !== undefined) return conflicted('candidate_email_already_known');

      const linked = await checkedPersonLink(transaction, dependencies, command.personId);

      if (!linked.ok) return linked;

      const now = dependencies.clock.now();
      const number = await allocateNumber(transaction, dependencies, 'candidate', 'CAN', now);
      const candidate = Candidate.create(
        {
          tenantId: currentTenant(),
          candidateNumber: number,
          displayName: command.displayName,
          email: command.email,
          ...(command.phone === undefined ? {} : { phone: command.phone }),
          sourceCode: command.sourceCode,
          ...(command.personId === undefined ? {} : { personId: command.personId }),
          ...(command.metadata === undefined ? {} : { metadata: command.metadata }),
        },
        originOfCurrentRequest(),
        now,
      );

      if (!candidate.ok) return refusedBy(candidate.error);

      await dependencies.stores.candidates.insert(transaction, candidate.value.snapshot());
      transaction.collect(candidate.value.pullEvents());
      return success({ candidateId: candidate.value.id, candidateNumber: number });
    }),
});

/**
 * A person a caller named must exist, be in this tenant, not be merged away, and not already belong
 * to another candidate.
 *
 * The merged check is Phase 4's request made good here as it was in Employment: People merges by
 * redirection, so the losing record still reads, and linking a candidate to it would attach their
 * career to a record every future lookup redirects away from.
 */
const checkedPersonLink = async (
  transaction: Transaction,
  dependencies: RecruitmentDependencies,
  personId: string | undefined,
): Promise<ReturnType<typeof success<undefined>>> => {
  if (personId === undefined) return success(undefined);

  const person = await dependencies.people.find(personId);

  if (person === undefined) return notFound<undefined>('person');
  if (person.mergedIntoPersonId !== undefined) {
    return refusedBy({
      reason: 'person_merged',
      messageKey: 'recruitment.rejection.person_merged',
    });
  }

  const already = await dependencies.stores.candidates.byPersonId(transaction, personId);

  if (already !== undefined) return conflicted('person_already_a_candidate');
  return success(undefined);
};

export interface CandidateAffected {
  readonly candidateId: string;
}

export interface AmendCandidateCommand extends Command {
  readonly commandName: 'recruitment.amend-candidate';
  readonly candidateId: string;
  readonly displayName?: Readonly<Record<string, string>>;
  readonly email?: string;
  readonly phone?: string;
  readonly sourceCode?: string;
  readonly expectedVersion: number;
}

export const amendCandidateHandler = (
  dependencies: RecruitmentDependencies,
): CommandHandler<AmendCandidateCommand, CandidateAffected> => ({
  commandName: 'recruitment.amend-candidate',
  permission: RecruitmentPermissions.candidateManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const state = await dependencies.stores.candidates.byId(transaction, command.candidateId);

      if (state === undefined) return notFound<CandidateAffected>('candidate');

      const candidate = Candidate.rehydrate(state);
      const amended = candidate.amend(command, originOfCurrentRequest(), dependencies.clock.now());

      if (!amended.ok) return refusedBy(amended.error);

      await dependencies.stores.candidates.update(
        transaction,
        candidate.snapshot(),
        command.expectedVersion,
      );
      transaction.collect(candidate.pullEvents());
      return success({ candidateId: candidate.id });
    }),
});

export interface LinkCandidateToPersonCommand extends Command {
  readonly commandName: 'recruitment.link-candidate-to-person';
  readonly candidateId: string;
  readonly personId: string;
  readonly expectedVersion: number;
}

/**
 * Links a candidate to a Person a recruiter has identified.
 *
 * Explicit and permissioned, never inferred. The link is also **write-once**: a candidate already
 * linked to a different Person is refused rather than repointed, because moving a link moves a
 * career.
 */
export const linkCandidateToPersonHandler = (
  dependencies: RecruitmentDependencies,
): CommandHandler<LinkCandidateToPersonCommand, CandidateAffected> => ({
  commandName: 'recruitment.link-candidate-to-person',
  permission: RecruitmentPermissions.candidateManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const state = await dependencies.stores.candidates.byId(transaction, command.candidateId);

      if (state === undefined) return notFound<CandidateAffected>('candidate');

      const linked = await checkedPersonLink(transaction, dependencies, command.personId);

      if (!linked.ok) return linked;

      const candidate = Candidate.rehydrate(state);
      const result = candidate.linkToPerson(
        command.personId,
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!result.ok) return refusedBy(result.error);

      await dependencies.stores.candidates.update(
        transaction,
        candidate.snapshot(),
        command.expectedVersion,
      );
      transaction.collect(candidate.pullEvents());
      return success({ candidateId: candidate.id });
    }),
});
