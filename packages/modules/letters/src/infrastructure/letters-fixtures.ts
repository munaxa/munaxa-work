import { uuidV7 } from '@work/kernel';

import { createTemplate, draftTemplateVersion } from '../domain/letter-template.js';
import { issueLetter, requestLetter } from '../domain/letter-generation.js';
import type { IssuedLetterState, LetterRequestState } from '../domain/letter-generation.js';
import type { LetterTemplateState, LetterTemplateVersionState } from '../domain/letter-template.js';

/**
 * States built through the aggregates' own constructors, for the integration suites.
 *
 * Constructed rather than hand-written so a fixture cannot describe a letter the domain would
 * refuse — which is the only way a fixture stays honest as the rules change. The suites here are
 * about what the *database* does with a valid state, so the state has to actually be one.
 */

export const EMPLOYMENT_ID = '01900000-0000-7000-8000-0000000e0001';
export const PERSON_ID = '01900000-0000-7000-8000-0000000e0002';

const built = <TState>(result: { ok: boolean } & Record<string, unknown>): TState => {
  if (!result.ok) throw new Error(`letters fixture: ${JSON.stringify(result['error'])}`);
  return result['value'] as TState;
};

export const aTemplate = (
  overrides: Partial<{ code: string; requiresApproval: boolean }> = {},
): LetterTemplateState =>
  built<LetterTemplateState>(
    createTemplate({
      letterTemplateId: uuidV7(),
      code: overrides.code ?? 'employment-certificate',
      name: { en: 'Employment certificate', ar: 'شهادة عمل' },
      category: 'employment',
      requiresApproval: overrides.requiresApproval ?? false,
      employeeRequestable: true,
    }),
  );

export const aTemplateVersion = (
  templateId: string,
  versionNumber = 1,
): LetterTemplateVersionState =>
  built<LetterTemplateVersionState>(
    draftTemplateVersion({
      letterTemplateVersionId: uuidV7(),
      letterTemplateId: templateId,
      versionNumber,
      body: {
        en: 'This certifies that {{person.fullName}} is employed.',
        ar: 'نشهد بأن {{person.fullName}} موظف لدينا.',
      },
      variables: ['person.fullName'],
      exposedFields: ['person'],
    }),
  );

export const aRequest = (
  template: LetterTemplateState,
  version: LetterTemplateVersionState,
  requestedBy = 'user:requester',
): LetterRequestState =>
  built<LetterRequestState>(
    requestLetter({
      letterRequestId: uuidV7(),
      template,
      templateVersion: { ...version, status: 'published' },
      employmentId: EMPLOYMENT_ID,
      personId: PERSON_ID,
      locale: 'en',
      requestedBy,
      requestedAt: new Date('2026-08-11T09:00:00Z'),
    }),
  );

/** A 64-character token, as the real one is. Deterministic per call so a suite can assert on it. */
export const aToken = (seed: string): string => seed.padEnd(64, '0');

export const anIssuedLetter = (
  request: LetterRequestState,
  version: LetterTemplateVersionState,
  overrides: Partial<{ referenceNumber: string; verificationToken: string }> = {},
): IssuedLetterState =>
  built<IssuedLetterState>(
    issueLetter({
      issuedLetterId: uuidV7(),
      request: { ...request, status: 'generated' },
      templateVersion: version,
      content: {
        body: 'This certifies that Layla Haddad is employed.',
        substitutedValues: { 'person.fullName': 'Layla Haddad' },
      },
      sourceVersions: { person: '1' },
      referenceNumber: overrides.referenceNumber ?? 'LTR-000001',
      verificationToken: overrides.verificationToken ?? aToken('token-a'),
      issuedAt: new Date('2026-08-11T10:00:00Z'),
      issuedBy: 'user:issuer',
    }),
  );
