import { describe, expect, it } from 'vitest';

import {
  ADMINISTRATOR,
  APPROVER,
  EMPLOYMENT_ID,
  IDENTIFIER_ID,
  PERSON_ID,
  VERIFIER,
  ask,
  attempt,
  harnessFor,
  send,
  type Harness,
} from './phase-twelve-harness.js';

/**
 * Documents and Letters against the rest of the product, through the **real adapters**.
 *
 * Every cross-module call here goes through `DocumentsOwnerDirectory`,
 * `DocumentsPersonIdentifiers` or one of the four letter sources — the production classes — and
 * through a real bounded service grant onto a real dispatcher. What is faked is only the *other
 * side*: People, Employment, Organization and Compensation answer as query handlers declaring the
 * permissions their real handlers declare, so an adapter naming the wrong permission is refused
 * here exactly as it would be in production.
 *
 * The property these assertions exist for: **nothing is pushed, so nothing can be lost.**
 */

const PLAIN_BODY = {
  en: '{{person.fullName}} has worked at {{organization.legalName}} since {{employment.startDate}}.',
  ar: 'يعمل {{person.fullName}} في {{organization.legalName}} منذ {{employment.startDate}}.',
};

const SALARY_BODY = {
  en: '{{person.fullName}} earns {{salary.monthly}}.',
  ar: 'يتقاضى {{person.fullName}} مبلغ {{salary.monthly}}.',
};

interface Identified {
  readonly documentTypeId: string;
}

const documentType = async (harness: Harness, code = 'passport'): Promise<string> => {
  const defined = await harness.as(ADMINISTRATOR, () =>
    send<Identified>(harness, {
      commandName: 'documents.define-type',
      code,
      name: { en: 'Passport', ar: 'جواز سفر' },
      ownerTypes: ['person'],
      expires: true,
      requiresVerification: true,
      confidentiality: 'normal',
      employeeVisible: true,
      managerVisible: true,
      noticeDays: [90, 30],
    }),
  );

  return defined.documentTypeId;
};

describe('documents against People and Employment', () => {
  it('confirms an owner through the published contract before the row exists', async () => {
    const harness = harnessFor();
    const documentTypeId = await documentType(harness);

    const created = await harness.as(ADMINISTRATOR, () =>
      send<{ documentId: string }>(harness, {
        commandName: 'documents.create-document',
        documentTypeId,
        ownerType: 'person',
        ownerId: PERSON_ID,
        title: { en: 'Passport scan', ar: 'صورة جواز' },
      }),
    );

    expect(created.documentId).toBeDefined();
  });

  it('refuses an owner People does not know', async () => {
    const harness = harnessFor();
    const documentTypeId = await documentType(harness);

    const refused = await harness.as(ADMINISTRATOR, () =>
      attempt(harness, {
        commandName: 'documents.create-document',
        documentTypeId,
        ownerType: 'person',
        ownerId: '01900000-0000-7000-8000-00000000ffff',
        title: { en: 'Passport scan', ar: 'صورة جواز' },
      }),
    );

    expect(refused.ok).toBe(false);
  });

  it('confirms an employment owner through Employment', async () => {
    const harness = harnessFor();
    const defined = await harness.as(ADMINISTRATOR, () =>
      send<Identified>(harness, {
        commandName: 'documents.define-type',
        code: 'contract',
        name: { en: 'Contract', ar: 'عقد' },
        ownerTypes: ['employment'],
        expires: false,
        requiresVerification: false,
        confidentiality: 'normal',
        employeeVisible: true,
        managerVisible: true,
      }),
    );

    const created = await harness.as(ADMINISTRATOR, () =>
      attempt(harness, {
        commandName: 'documents.create-document',
        documentTypeId: defined.documentTypeId,
        ownerType: 'employment',
        ownerId: EMPLOYMENT_ID,
        title: { en: 'Signed contract', ar: 'عقد موقّع' },
      }),
    );

    expect(created.ok).toBe(true);
  });

  it('reads the expiry from People and follows it when People changes it', async () => {
    const harness = harnessFor();
    const documentTypeId = await documentType(harness);
    const created = await harness.as(ADMINISTRATOR, () =>
      send<{ documentId: string }>(harness, {
        commandName: 'documents.create-document',
        documentTypeId,
        ownerType: 'person',
        ownerId: PERSON_ID,
        personIdentifierId: IDENTIFIER_ID,
        title: { en: 'Passport scan', ar: 'صورة جواز' },
      }),
    );
    const expiryOf = async (): Promise<string | undefined> => {
      const detail = await harness.as(VERIFIER, () =>
        ask<{ document: { expiryDate?: { gregorian: string }; expiryOwnedByPeople: boolean } }>(
          harness,
          { queryName: 'documents.read-document', documentId: created.documentId },
        ),
      );

      expect(detail.document.expiryOwnedByPeople).toBe(true);
      return detail.document.expiryDate?.gregorian;
    };

    expect(await expiryOf()).toBe('2029-05-04');

    // The passport is renewed. Documents stored no copy, so the view moves with People — which is
    // the whole of D-1a, visible from the outside.
    harness.facts.identifierExpiresOn = '2034-05-04';

    expect(await expiryOf()).toBe('2034-05-04');
  });

  it('refuses an identifier reference People cannot confirm', async () => {
    const harness = harnessFor();
    const documentTypeId = await documentType(harness);

    harness.facts.identifierPresent = false;

    const refused = await harness.as(ADMINISTRATOR, () =>
      attempt(harness, {
        commandName: 'documents.create-document',
        documentTypeId,
        ownerType: 'person',
        ownerId: PERSON_ID,
        personIdentifierId: IDENTIFIER_ID,
        title: { en: 'Passport scan', ar: 'صورة جواز' },
      }),
    );

    expect(refused.ok).toBe(false);
  });
});

const letterTemplate = async (
  harness: Harness,
  options: {
    readonly code?: string;
    readonly body?: { readonly en: string; readonly ar: string };
    readonly variables?: readonly string[];
    readonly exposedFields?: readonly string[];
    readonly requiresApproval?: boolean;
  } = {},
): Promise<string> => {
  const defined = await harness.as(ADMINISTRATOR, () =>
    send<{ letterTemplateId: string }>(harness, {
      commandName: 'letters.define-template',
      code: options.code ?? 'employment-certificate',
      name: { en: 'Employment certificate', ar: 'شهادة عمل' },
      category: 'employment',
      requiresApproval: options.requiresApproval ?? false,
      employeeRequestable: true,
    }),
  );
  const drafted = await harness.as(ADMINISTRATOR, () =>
    send<{ letterTemplateVersionId: string }>(harness, {
      commandName: 'letters.draft-version',
      letterTemplateId: defined.letterTemplateId,
      body: options.body ?? PLAIN_BODY,
      variables: options.variables ?? [
        'person.fullName',
        'employment.startDate',
        'organization.legalName',
      ],
      exposedFields: options.exposedFields ?? ['person', 'employment', 'organization'],
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

  return defined.letterTemplateId;
};

const requestAndIssue = async (
  harness: Harness,
  letterTemplateId: string,
): Promise<{ readonly issuedLetterId: string; readonly body: string }> => {
  const requested = await harness.as(APPROVER, () =>
    send<{ letterRequestId: string }>(harness, {
      commandName: 'letters.request',
      letterTemplateId,
      employmentId: EMPLOYMENT_ID,
      personId: PERSON_ID,
      locale: 'en',
    }),
  );

  return harness.as(ADMINISTRATOR, () =>
    send<{ issuedLetterId: string; body: string }>(harness, {
      commandName: 'letters.issue',
      letterRequestId: requested.letterRequestId,
    }),
  );
};

describe('letters against People, Employment, Organization and Compensation', () => {
  it('resolves every variable through the real adapters', async () => {
    const harness = harnessFor();
    const letterTemplateId = await letterTemplate(harness);
    const issued = await requestAndIssue(harness, letterTemplateId);

    expect(issued.body).toBe('Layla Haddad has worked at Munaxa LLC since 2024-03-01.');
  });

  it('refuses the letter when a source cannot be asked', async () => {
    const harness = harnessFor();
    const letterTemplateId = await letterTemplate(harness);

    harness.facts.employmentPresent = false;

    const requested = await harness.as(APPROVER, () =>
      send<{ letterRequestId: string }>(harness, {
        commandName: 'letters.request',
        letterTemplateId,
        employmentId: EMPLOYMENT_ID,
        personId: PERSON_ID,
        locale: 'en',
      }),
    );
    const refused = await harness.as(ADMINISTRATOR, () =>
      attempt(harness, {
        commandName: 'letters.issue',
        letterRequestId: requested.letterRequestId,
      }),
    );

    // An outage is not "no facts". A letter with a blank where an employer belongs is worse than
    // no letter at all.
    expect(refused.ok).toBe(false);
  });

  it('freezes the salary at issue and does not follow a later raise', async () => {
    const harness = harnessFor();
    const letterTemplateId = await letterTemplate(harness, {
      code: 'salary-certificate',
      body: SALARY_BODY,
      variables: ['person.fullName', 'salary.monthly'],
      exposedFields: ['person', 'salary'],
    });
    const issued = await requestAndIssue(harness, letterTemplateId);

    expect(issued.body).toBe('Layla Haddad earns 1200.000 JOD.');

    // April's raise, and a new legal name. Neither reaches the certificate already issued.
    harness.facts.salaryMinor = '1500000';
    harness.facts.legalNameEn = 'Layla Al-Haddad';

    const detail = await harness.as(VERIFIER, () =>
      ask<{ substitutedValues: Record<string, string> }>(harness, {
        queryName: 'letters.read-issued',
        issuedLetterId: issued.issuedLetterId,
      }),
    );

    expect(detail.substitutedValues['salary.monthly']).toBe('1200.000 JOD');
    expect(detail.substitutedValues['person.fullName']).toBe('Layla Haddad');
  });

  it('refuses a salary template to an issuer without letter.include-salary', async () => {
    const harness = harnessFor({
      permissions: [
        'letter.template.manage',
        'letter.template.read',
        'letter.read',
        'letter.request',
        'letter.issue',
      ],
    });
    const letterTemplateId = await letterTemplate(harness, {
      code: 'salary-certificate',
      body: SALARY_BODY,
      variables: ['person.fullName', 'salary.monthly'],
      exposedFields: ['person', 'salary'],
    });
    const requested = await harness.as(APPROVER, () =>
      send<{ letterRequestId: string }>(harness, {
        commandName: 'letters.request',
        letterTemplateId,
        employmentId: EMPLOYMENT_ID,
        personId: PERSON_ID,
        locale: 'en',
      }),
    );
    const refused = await harness.as(ADMINISTRATOR, () =>
      attempt(harness, {
        commandName: 'letters.issue',
        letterRequestId: requested.letterRequestId,
      }),
    );

    // Both of AD-005's gates. Without the second, a letter is a way to read a salary the caller
    // could not read directly.
    expect(refused.ok).toBe(false);
  });

  it('refuses a template declaring a source nobody wired', async () => {
    const harness = harnessFor();
    const letterTemplateId = await letterTemplate(harness, {
      code: 'payslip-letter',
      body: {
        en: 'Net pay: {{payroll.net}}.',
        ar: 'صافي الراتب: {{payroll.net}}.',
      },
      variables: ['payroll.net'],
      exposedFields: ['payroll'],
    });
    const requested = await harness.as(APPROVER, () =>
      send<{ letterRequestId: string }>(harness, {
        commandName: 'letters.request',
        letterTemplateId,
        employmentId: EMPLOYMENT_ID,
        personId: PERSON_ID,
        locale: 'en',
      }),
    );
    const refused = await harness.as(ADMINISTRATOR, () =>
      attempt(harness, {
        commandName: 'letters.issue',
        letterRequestId: requested.letterRequestId,
      }),
    );

    // `payroll` is in the vocabulary and has no adapter. Reported as unconfigured, never resolved
    // to something adjacent.
    expect(refused.ok).toBe(false);
  });
});

describe('the lost-event scenario', () => {
  it('is not a scenario, because neither module subscribes to anything', async () => {
    const harness = harnessFor();
    const documentTypeId = await documentType(harness);
    const letterTemplateId = await letterTemplate(harness);

    // Nothing in this run published an event, and nothing waited for one. Every upstream fact was
    // pulled at the moment it was needed, so there was no delivery to lose (ADR-0064).
    await harness.as(ADMINISTRATOR, () =>
      send(harness, {
        commandName: 'documents.create-document',
        documentTypeId,
        ownerType: 'person',
        ownerId: PERSON_ID,
        title: { en: 'Passport scan', ar: 'صورة جواز' },
      }),
    );

    const issued = await requestAndIssue(harness, letterTemplateId);

    expect(issued.body).toContain('Munaxa LLC');

    // The upstream change nobody announced is found by the next read, not by a notification.
    harness.facts.legalNameEn = 'Layla Al-Haddad';

    const second = await harness.as(APPROVER, () =>
      send<{ letterRequestId: string }>(harness, {
        commandName: 'letters.request',
        letterTemplateId,
        employmentId: EMPLOYMENT_ID,
        personId: PERSON_ID,
        locale: 'en',
      }),
    );
    const later = await harness.as(ADMINISTRATOR, () =>
      send<{ body: string }>(harness, {
        commandName: 'letters.issue',
        letterRequestId: second.letterRequestId,
      }),
    );

    expect(later.body).toContain('Layla Al-Haddad');
  });
});
