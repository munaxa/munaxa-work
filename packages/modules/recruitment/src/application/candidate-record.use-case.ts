import { success, type Command, type CommandHandler } from '@work/kernel';

import { Candidate } from '../domain/candidate.js';
import { candidateProfileEntry } from '../domain/candidate-profile.js';
import type { ProfileEntryKind } from '../domain/recruitment-vocabulary.js';

import {
  currentTenant,
  notFound,
  originOfCurrentRequest,
  refusedBy,
} from './recruitment-context.js';
import { RecruitmentPermissions } from './recruitment-permissions.js';
import type { CandidateAffected } from './candidate.use-case.js';
import type { RecruitmentDependencies } from './recruitment-dependencies.js';

/**
 * What is attached to a candidate: what they claim about themselves, and the erasure of their
 * personal data.
 *
 * Apart from the candidate's own commands because these two are the ones with a different
 * permission: a claim is recorded by whoever manages candidates, and an erasure is irreversible and
 * separately held.
 */

export interface RecordProfileEntryCommand extends Command {
  readonly commandName: 'recruitment.record-profile-entry';
  readonly candidateId: string;
  readonly kind: ProfileEntryKind;
  readonly code?: string;
  readonly title: Readonly<Record<string, string>>;
  readonly organizationName?: Readonly<Record<string, string>>;
  readonly fromDate?: string;
  readonly toDate?: string;
  readonly levelCode?: string;
  readonly documentReference?: string;
}

export interface ProfileEntryRecorded {
  readonly candidateId: string;
  readonly entryId: string;
}

/**
 * Records a claim: a skill, a period of experience, a qualification, a certificate.
 *
 * The document is a **reference**. Recruitment stores no bytes and builds no document management —
 * that is Phase 4.1's, and until it exists a résumé is a reference to whatever system holds it. The
 * completion report says so rather than claiming candidate documents work.
 */
export const recordProfileEntryHandler = (
  dependencies: RecruitmentDependencies,
): CommandHandler<RecordProfileEntryCommand, ProfileEntryRecorded> => ({
  commandName: 'recruitment.record-profile-entry',
  permission: RecruitmentPermissions.candidateManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const state = await dependencies.stores.candidates.byId(transaction, command.candidateId);

      if (state === undefined) return notFound<ProfileEntryRecorded>('candidate');

      const entry = candidateProfileEntry(
        { tenantId: currentTenant(), ...command },
        dependencies.clock.now(),
      );

      if (!entry.ok) return refusedBy(entry.error);

      await dependencies.stores.profileEntries.insert(transaction, entry.value);
      return success({ candidateId: command.candidateId, entryId: entry.value.id });
    }),
});

export interface AnonymizeCandidateCommand extends Command {
  readonly commandName: 'recruitment.anonymize-candidate';
  readonly candidateId: string;
  readonly expectedVersion: number;
}

/**
 * Removes a candidate's personal data, keeping the record that they existed.
 *
 * The minimum data-lifecycle operation the approved scope calls for, and the shape it insists on:
 * **nothing is physically deleted**. Applications, interviews and offers still resolve, the audit
 * trail still reads, and what goes is the name, the address and the telephone number.
 *
 * It invents **no retention period**. *When* to run this is a policy question a country pack and
 * the future GRC phase own; this is the operation they will drive, and it is separately permissioned
 * because it cannot be undone.
 */
export const anonymizeCandidateHandler = (
  dependencies: RecruitmentDependencies,
): CommandHandler<AnonymizeCandidateCommand, CandidateAffected> => ({
  commandName: 'recruitment.anonymize-candidate',
  permission: RecruitmentPermissions.candidateAnonymize,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const state = await dependencies.stores.candidates.byId(transaction, command.candidateId);

      if (state === undefined) return notFound<CandidateAffected>('candidate');

      const candidate = Candidate.rehydrate(state);
      const anonymized = candidate.anonymize(originOfCurrentRequest(), dependencies.clock.now());

      if (!anonymized.ok) return refusedBy(anonymized.error);

      await dependencies.stores.candidates.update(
        transaction,
        candidate.snapshot(),
        command.expectedVersion,
      );
      transaction.collect(candidate.pullEvents());
      return success({ candidateId: candidate.id });
    }),
});
