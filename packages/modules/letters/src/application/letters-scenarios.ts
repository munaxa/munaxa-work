import { ADMINISTRATOR, REQUESTER, send, type Harness } from './letters-test-harness.js';
import type { LetterRequested } from './letter-request.use-case.js';
import type { TemplateDefined, VersionDrafted } from './template.use-case.js';

/**
 * The setup every suite repeats, in one place.
 *
 * Written as sends through the dispatcher rather than as direct writes to the stores, so a scenario
 * cannot construct a state the handlers would refuse — which is the only way a fixture stays honest
 * as the rules change.
 */

export const PLAIN_BODY = {
  en: 'This certifies that {{person.fullName}} joined on {{employment.startDate}}.',
  ar: 'نشهد بأن {{person.fullName}} التحق بتاريخ {{employment.startDate}}.',
};

export const SALARY_BODY = {
  en: '{{person.fullName}} earns {{salary.monthly}} monthly.',
  ar: 'يتقاضى {{person.fullName}} مبلغ {{salary.monthly}} شهريا.',
};

export interface TemplateOptions {
  readonly code?: string;
  readonly requiresApproval?: boolean;
  readonly body?: { readonly en: string; readonly ar: string };
  readonly variables?: readonly string[];
  readonly exposedFields?: readonly string[];
  readonly requiresSignature?: boolean;
}

/** A template with one published version — the state most assertions start from. */
export const publishedTemplate = async (
  harness: Harness,
  options: TemplateOptions = {},
): Promise<{
  readonly letterTemplateId: string;
  readonly letterTemplateVersionId: string;
}> => {
  const defined = await harness.as(ADMINISTRATOR, () =>
    send<TemplateDefined>(harness, {
      commandName: 'letters.define-template',
      code: options.code ?? 'employment-certificate',
      name: { en: 'Employment certificate', ar: 'شهادة عمل' },
      category: 'employment',
      requiresApproval: options.requiresApproval ?? false,
      employeeRequestable: true,
    }),
  );
  const drafted = await harness.as(ADMINISTRATOR, () =>
    send<VersionDrafted>(harness, {
      commandName: 'letters.draft-version',
      letterTemplateId: defined.letterTemplateId,
      body: options.body ?? PLAIN_BODY,
      variables: options.variables ?? ['person.fullName', 'employment.startDate'],
      exposedFields: options.exposedFields ?? ['person', 'employment'],
      ...(options.requiresSignature === undefined
        ? {}
        : { requiresSignature: options.requiresSignature }),
    }),
  );

  await harness.as(ADMINISTRATOR, () =>
    send(harness, {
      commandName: 'letters.move-version',
      letterTemplateVersionId: drafted.letterTemplateVersionId,
      status: 'published',
      expectedVersion: 1,
    }),
  );

  return {
    letterTemplateId: defined.letterTemplateId,
    letterTemplateVersionId: drafted.letterTemplateVersionId,
  };
};

export const EMPLOYMENT_ID = '01900000-0000-7000-8000-000000000001';
export const PERSON_ID = '01900000-0000-7000-8000-000000000002';

export const requestFor = (
  harness: Harness,
  letterTemplateId: string,
  locale = 'en',
): Promise<LetterRequested> =>
  harness.as(REQUESTER, () =>
    send<LetterRequested>(harness, {
      commandName: 'letters.request',
      letterTemplateId,
      employmentId: EMPLOYMENT_ID,
      personId: PERSON_ID,
      locale,
      purpose: 'Bank account opening',
    }),
  );
