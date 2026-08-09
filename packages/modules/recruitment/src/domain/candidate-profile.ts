import { uuidV7 } from '@work/kernel';

import {
  bilingualFrom,
  checkedDocumentReference,
  checkedOptionalCivilDate,
  checkedOptionalCode,
  optionalBilingualFrom,
  type BilingualText,
} from './recruitment-aggregate.js';
import { accept, refuse, type RecruitmentResult } from './recruitment-rejection.js';
import type { ProfileEntryKind } from './recruitment-vocabulary.js';

/**
 * A skill, a period of experience, a qualification or a certificate the candidate claims.
 *
 * **Not `person_capability` and not `person_history`**, and the difference is the whole reason this
 * exists separately: a candidate's claims are unverified, and the register stands behind what it
 * holds. Copying them into People at hire would be the register adopting somebody's own account of
 * themselves as fact.
 *
 * Withdrawn rather than deleted, so a screening decision taken on what somebody claimed in March is
 * still explainable in June.
 */
export interface CandidateProfileEntryState {
  readonly id: string;
  readonly tenantId: string;
  readonly candidateId: string;
  readonly kind: ProfileEntryKind;
  readonly code?: string;
  readonly title: BilingualText;
  readonly organizationName?: BilingualText;
  readonly fromDate?: string;
  readonly toDate?: string;
  readonly levelCode?: string;
  readonly documentReference?: string;
  readonly withdrawnAt?: Date;
  readonly version: number;
}

export interface RecordProfileEntry {
  readonly tenantId: string;
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

export const candidateProfileEntry = (
  request: RecordProfileEntry,
  recordedAt: Date,
): RecruitmentResult<CandidateProfileEntryState> => {
  const names = checkedProfileNames(request);

  if (!names.ok) return names;

  const codes = checkedProfileCodes(request);

  if (!codes.ok) return codes;

  const period = checkedProfilePeriod(request);

  if (!period.ok) return period;

  return accept({
    id: uuidV7(recordedAt.getTime()),
    tenantId: request.tenantId,
    candidateId: request.candidateId,
    kind: request.kind,
    ...names.value,
    ...codes.value,
    ...period.value,
    version: 0,
  });
};

/** What the claim is called, in both languages, and who they say they did it for. */
const checkedProfileNames = (
  request: RecordProfileEntry,
): RecruitmentResult<
  Pick<CandidateProfileEntryState, 'title'> &
    Partial<Pick<CandidateProfileEntryState, 'organizationName'>>
> => {
  const title = bilingualFrom(request.title, 'title');

  if (!title.ok) return title;

  const organizationName = optionalBilingualFrom(request.organizationName, 'organizationName');

  if (!organizationName.ok) return organizationName;

  return accept({
    title: title.value,
    ...(organizationName.value === undefined ? {} : { organizationName: organizationName.value }),
  });
};

/** The tenant codes beside it, and the document that is a reference rather than bytes. */
const checkedProfileCodes = (
  request: RecordProfileEntry,
): RecruitmentResult<
  Partial<Pick<CandidateProfileEntryState, 'code' | 'levelCode' | 'documentReference'>>
> => {
  const code = checkedOptionalCode(request.code, 'code');

  if (!code.ok) return code;

  const levelCode = checkedOptionalCode(request.levelCode, 'levelCode');

  if (!levelCode.ok) return levelCode;

  const documentReference = checkedDocumentReference(request.documentReference);

  if (!documentReference.ok) return documentReference;

  return accept({
    ...(code.value === undefined ? {} : { code: code.value }),
    ...(levelCode.value === undefined ? {} : { levelCode: levelCode.value }),
    ...(documentReference.value === undefined
      ? {}
      : { documentReference: documentReference.value }),
  });
};

const checkedProfilePeriod = (
  request: RecordProfileEntry,
): RecruitmentResult<{ readonly fromDate?: string; readonly toDate?: string }> => {
  const fromDate = checkedOptionalCivilDate(request.fromDate, 'fromDate');

  if (!fromDate.ok) return fromDate;

  const toDate = checkedOptionalCivilDate(request.toDate, 'toDate');

  if (!toDate.ok) return toDate;
  if (fromDate.value !== undefined && toDate.value !== undefined && toDate.value < fromDate.value) {
    return refuse('period_ends_before_it_begins', { field: 'toDate' });
  }

  return accept({
    ...(fromDate.value === undefined ? {} : { fromDate: fromDate.value }),
    ...(toDate.value === undefined ? {} : { toDate: toDate.value }),
  });
};
