import { describe, expect, it } from 'vitest';

import { ADMINISTRATOR, ask, attempt, harnessFor, send, tryAsk } from './letters-test-harness.js';
import { SALARY_BODY, publishedTemplate, requestFor } from './letters-scenarios.js';
import { LettersPermissions } from './letters-permissions.js';
import type { IssuedLetterDetailView, LetterVerificationView } from '../contracts/views.js';
import type { LetterIssued } from './letter-issue.use-case.js';

/**
 * Generating, issuing, and what a letter is allowed to say.
 *
 * The properties these suites are about: a letter that could not be resolved is **refused rather
 * than rendered blank**, an issued letter is **frozen against later source changes**, salary needs
 * **two gates**, and third-party verification discloses **no employee data**.
 */

const salaryTemplate = (
  harness: ReturnType<typeof harnessFor>,
): ReturnType<typeof publishedTemplate> =>
  publishedTemplate(harness, {
    code: 'salary-certificate',
    body: SALARY_BODY,
    variables: ['person.fullName', 'salary.monthly'],
    exposedFields: ['person', 'salary'],
  });

describe('generation', () => {
  it('substitutes declared variables and returns the body', async () => {
    const harness = harnessFor();
    const { letterTemplateId } = await publishedTemplate(harness);
    const requested = await requestFor(harness, letterTemplateId);
    const issued = await harness.as(ADMINISTRATOR, () =>
      send<LetterIssued>(harness, {
        commandName: 'letters.issue',
        letterRequestId: requested.letterRequestId,
      }),
    );

    expect(issued.body).toContain('Layla Haddad');
    expect(issued.body).toContain('2024-03-01');
    expect(issued.body).not.toContain('{{');
  });

  it('generates the Arabic body for an Arabic request', async () => {
    const harness = harnessFor();
    const { letterTemplateId } = await publishedTemplate(harness);
    const requested = await requestFor(harness, letterTemplateId, 'ar');
    const issued = await harness.as(ADMINISTRATOR, () =>
      send<LetterIssued>(harness, {
        commandName: 'letters.issue',
        letterRequestId: requested.letterRequestId,
      }),
    );

    expect(issued.body).toContain('نشهد بأن');
    expect(issued.body).toContain('Layla Haddad');
  });

  it('refuses the letter when a source cannot be asked', async () => {
    const harness = harnessFor();
    const { letterTemplateId } = await publishedTemplate(harness);
    const requested = await requestFor(harness, letterTemplateId);

    harness.employment.unavailable();

    const refused = await harness.as(ADMINISTRATOR, () =>
      attempt(harness, {
        commandName: 'letters.issue',
        letterRequestId: requested.letterRequestId,
      }),
    );

    // An outage is not "no facts". Rendering a blank is how a bank letter comes to state that an
    // employee earns nothing, over the employer's name.
    expect(refused.ok).toBe(false);
  });

  it('refuses the letter when a variable resolves to nothing', async () => {
    const harness = harnessFor();
    const { letterTemplateId } = await publishedTemplate(harness);
    const requested = await requestFor(harness, letterTemplateId);

    harness.employment.set({ jobTitle: 'Engineer' });

    const refused = await harness.as(ADMINISTRATOR, () =>
      attempt(harness, {
        commandName: 'letters.issue',
        letterRequestId: requested.letterRequestId,
      }),
    );

    expect(refused.ok).toBe(false);
  });

  it('refuses a template whose source is not wired at all', async () => {
    const harness = harnessFor({ wired: ['person'] });
    const { letterTemplateId } = await publishedTemplate(harness);
    const requested = await requestFor(harness, letterTemplateId);

    const refused = await harness.as(ADMINISTRATOR, () =>
      attempt(harness, {
        commandName: 'letters.issue',
        letterRequestId: requested.letterRequestId,
      }),
    );

    // A composition that cannot answer is reported as such, not silently accepted with a gap.
    expect(refused.ok).toBe(false);
  });
});

describe('the salary gate', () => {
  it('refuses a salary template for a caller without letter.include-salary', async () => {
    const harness = harnessFor({
      permissions: [
        LettersPermissions.templateManage,
        LettersPermissions.templateRead,
        LettersPermissions.read,
        LettersPermissions.request,
        LettersPermissions.issue,
      ],
    });
    const { letterTemplateId } = await salaryTemplate(harness);
    const requested = await requestFor(harness, letterTemplateId);

    const refused = await harness.as(ADMINISTRATOR, () =>
      attempt(harness, {
        commandName: 'letters.issue',
        letterRequestId: requested.letterRequestId,
      }),
    );

    // Otherwise a letter becomes a way to read a salary the caller could not read directly.
    expect(refused.ok).toBe(false);
  });

  it('issues a salary template for a caller who holds it', async () => {
    const harness = harnessFor();
    const { letterTemplateId } = await salaryTemplate(harness);
    const requested = await requestFor(harness, letterTemplateId);
    const issued = await harness.as(ADMINISTRATOR, () =>
      send<LetterIssued>(harness, {
        commandName: 'letters.issue',
        letterRequestId: requested.letterRequestId,
      }),
    );

    expect(issued.body).toContain('1200.000 JOD');
  });

  it('refuses a template that uses a field it does not expose', async () => {
    const harness = harnessFor();
    const { letterTemplateId } = await publishedTemplate(harness, {
      code: 'leaky-certificate',
      body: SALARY_BODY,
      variables: ['person.fullName', 'salary.monthly'],
      // `salary` is declared as a variable but absent from the allow-list.
      exposedFields: ['person'],
    });
    const requested = await requestFor(harness, letterTemplateId);

    const refused = await harness.as(ADMINISTRATOR, () =>
      attempt(harness, {
        commandName: 'letters.issue',
        letterRequestId: requested.letterRequestId,
      }),
    );

    expect(refused.ok).toBe(false);
  });
});

describe('the frozen snapshot', () => {
  it('does not change when the source changes afterwards', async () => {
    const harness = harnessFor();
    const { letterTemplateId } = await salaryTemplate(harness);
    const requested = await requestFor(harness, letterTemplateId);
    const issued = await harness.as(ADMINISTRATOR, () =>
      send<LetterIssued>(harness, {
        commandName: 'letters.issue',
        letterRequestId: requested.letterRequestId,
      }),
    );

    // April's raise.
    harness.salary.set({ monthly: '1500.000 JOD' }, '2');

    const detail = await harness.as(ADMINISTRATOR, () =>
      ask<IssuedLetterDetailView>(harness, {
        queryName: 'letters.read-issued',
        issuedLetterId: issued.issuedLetterId,
      }),
    );

    // March's certificate still reads March's salary. Nothing re-reads a source after issue.
    expect(detail.substitutedValues['salary.monthly']).toBe('1200.000 JOD');
    expect(detail.sourceVersions['salary']).toBe('1');
  });

  it('records no rendered artefact, because nothing renders one', async () => {
    const harness = harnessFor();
    const { letterTemplateId } = await publishedTemplate(harness);
    const requested = await requestFor(harness, letterTemplateId);
    const issued = await harness.as(ADMINISTRATOR, () =>
      send<LetterIssued>(harness, {
        commandName: 'letters.issue',
        letterRequestId: requested.letterRequestId,
      }),
    );
    const detail = await harness.as(ADMINISTRATOR, () =>
      ask<IssuedLetterDetailView>(harness, {
        queryName: 'letters.read-issued',
        issuedLetterId: issued.issuedLetterId,
      }),
    );

    // No PDF library, renderer or headless browser exists. Absent is the honest answer (D-15).
    expect(detail.letter.documentId).toBeUndefined();
  });

  it('claims no signature, only that one is required', async () => {
    const harness = harnessFor();
    const { letterTemplateId } = await publishedTemplate(harness, {
      code: 'embassy-letter',
      requiresSignature: true,
    });
    const requested = await requestFor(harness, letterTemplateId);
    const issued = await harness.as(ADMINISTRATOR, () =>
      send<LetterIssued>(harness, {
        commandName: 'letters.issue',
        letterRequestId: requested.letterRequestId,
      }),
    );
    const detail = await harness.as(ADMINISTRATOR, () =>
      ask<IssuedLetterDetailView>(harness, {
        queryName: 'letters.read-issued',
        issuedLetterId: issued.issuedLetterId,
      }),
    );

    expect(detail.letter.signatureRequired).toBe(true);
    // Never `signed`. No provider exists, so nothing may say one occurred (D-16).
    expect(detail.letter.signatureState).toBe('required');
  });
});

describe('correction', () => {
  it('supersedes the original rather than rewriting it', async () => {
    const harness = harnessFor();
    const { letterTemplateId } = await publishedTemplate(harness);
    const first = await requestFor(harness, letterTemplateId);
    const original = await harness.as(ADMINISTRATOR, () =>
      send<LetterIssued>(harness, {
        commandName: 'letters.issue',
        letterRequestId: first.letterRequestId,
      }),
    );

    harness.person.set({ fullName: 'Layla Al-Haddad' }, '2');

    const second = await requestFor(harness, letterTemplateId);
    const correction = await harness.as(ADMINISTRATOR, () =>
      send<LetterIssued>(harness, {
        commandName: 'letters.issue',
        letterRequestId: second.letterRequestId,
        supersedesId: original.issuedLetterId,
      }),
    );

    const detail = await harness.as(ADMINISTRATOR, () =>
      ask<IssuedLetterDetailView>(harness, {
        queryName: 'letters.read-issued',
        issuedLetterId: original.issuedLetterId,
      }),
    );

    // Somebody may be holding a printed copy of the original, so it stays exactly as issued.
    expect(detail.substitutedValues['person.fullName']).toBe('Layla Haddad');
    expect(detail.letter.supersededById).toBe(correction.issuedLetterId);
    expect(correction.referenceNumber).toBe('LTR-000002');
  });
});

describe('third-party verification', () => {
  it('confirms a genuine letter and discloses no employee data', async () => {
    const harness = harnessFor();
    const { letterTemplateId } = await salaryTemplate(harness);
    const requested = await requestFor(harness, letterTemplateId);

    await harness.as(ADMINISTRATOR, () =>
      send(harness, { commandName: 'letters.issue', letterRequestId: requested.letterRequestId }),
    );

    const confirmed = await harness.as(ADMINISTRATOR, () =>
      ask<LetterVerificationView>(harness, {
        queryName: 'letters.verify',
        verificationToken: harness.tokens.nth(1),
      }),
    );

    expect(confirmed.genuine).toBe(true);
    expect(confirmed.referenceNumber).toBe('LTR-000001');
    // No name, no employer, no salary, no purpose (AD-006).
    expect(Object.keys(confirmed).sort()).toEqual([
      'genuine',
      'issuedOn',
      'referenceNumber',
      'superseded',
    ]);
  });

  it('answers a wrong token with `genuine: false` and nothing else', async () => {
    const harness = harnessFor();
    const answered = await harness.as(ADMINISTRATOR, () =>
      ask<LetterVerificationView>(harness, {
        queryName: 'letters.verify',
        verificationToken: 'x'.repeat(64),
      }),
    );

    // Not "no such letter": over enough attempts that would let somebody enumerate the register.
    expect(answered).toEqual({ genuine: false });
  });

  it('is refused for a caller holding nothing', async () => {
    const harness = harnessFor({ permissions: [] });
    const refused = await harness.as(ADMINISTRATOR, () =>
      tryAsk(harness, { queryName: 'letters.verify', verificationToken: 'x'.repeat(64) }),
    );

    // The anonymous public route is NOT VERIFIED: every read here resolves a tenant first.
    expect(refused.ok).toBe(false);
  });
});
