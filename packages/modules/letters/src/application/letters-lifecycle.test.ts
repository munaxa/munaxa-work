import { describe, expect, it } from 'vitest';

import {
  ADMINISTRATOR,
  APPROVER,
  REQUESTER,
  ask,
  attempt,
  harnessFor,
  send,
} from './letters-test-harness.js';
import { PLAIN_BODY, publishedTemplate, requestFor } from './letters-scenarios.js';
import type { LetterIssued } from './letter-issue.use-case.js';
import type { RequestDetail, TemplateDetail } from './letters-queries.js';

/**
 * Templates, requests and approval, through the real dispatcher.
 *
 * These suites exercise **behaviour**, not persistence: the stores are in memory and enforce the
 * same unique indexes and the same freeze production does. The integration suites then prove the
 * same behaviour survives real SQL, real constraints and real row-level security.
 */

describe('templates', () => {
  it('refuses a body whose placeholder was never declared', async () => {
    const harness = harnessFor();
    const defined = await harness.as(ADMINISTRATOR, () =>
      send<{ letterTemplateId: string }>(harness, {
        commandName: 'letters.define-template',
        code: 'experience-letter',
        name: { en: 'Experience letter', ar: 'شهادة خبرة' },
        category: 'employment',
        requiresApproval: false,
        employeeRequestable: true,
      }),
    );

    // Caught when the version is authored rather than when a letter is generated, so the typo is
    // refused for the person who wrote it instead of failing for the employee who asked.
    const refused = await harness.as(ADMINISTRATOR, () =>
      attempt(harness, {
        commandName: 'letters.draft-version',
        letterTemplateId: defined.letterTemplateId,
        body: { en: 'Hello {{person.nickname}}', ar: 'مرحبا {{person.nickname}}' },
        variables: ['person.fullName'],
        exposedFields: ['person'],
      }),
    );

    expect(refused.ok).toBe(false);
  });

  it('requires both languages', async () => {
    const harness = harnessFor();
    const defined = await harness.as(ADMINISTRATOR, () =>
      send<{ letterTemplateId: string }>(harness, {
        commandName: 'letters.define-template',
        code: 'bank-letter',
        name: { en: 'Bank letter', ar: 'خطاب بنكي' },
        category: 'banking',
        requiresApproval: false,
        employeeRequestable: true,
      }),
    );

    // A template authored only in English is a letter an Arabic speaker cannot be issued.
    const refused = await harness.as(ADMINISTRATOR, () =>
      attempt(harness, {
        commandName: 'letters.draft-version',
        letterTemplateId: defined.letterTemplateId,
        body: { en: 'Hello', ar: '  ' },
        variables: [],
        exposedFields: [],
      }),
    );

    expect(refused.ok).toBe(false);
  });

  it('freezes a version once it has issued a letter', async () => {
    const harness = harnessFor();
    const { letterTemplateId, letterTemplateVersionId } = await publishedTemplate(harness);
    const requested = await requestFor(harness, letterTemplateId);

    await harness.as(ADMINISTRATOR, () =>
      send(harness, { commandName: 'letters.issue', letterRequestId: requested.letterRequestId }),
    );

    const refused = await harness.as(ADMINISTRATOR, () =>
      attempt(harness, {
        commandName: 'letters.amend-version',
        letterTemplateVersionId,
        expectedVersion: 2,
        body: PLAIN_BODY,
        variables: ['person.fullName', 'employment.startDate'],
        exposedFields: ['person', 'employment'],
      }),
    );

    // Editing it would silently change what a historical letter claims to have been generated from.
    expect(refused.ok).toBe(false);

    const detail = await harness.as(ADMINISTRATOR, () =>
      ask<TemplateDetail>(harness, { queryName: 'letters.read-template', letterTemplateId }),
    );

    expect(detail.versions[0]?.editable).toBe(false);
    expect(detail.versions[0]?.firstIssuedAt).toBeInstanceOf(Date);
  });

  it('lets a published version that has issued nothing still be amended', async () => {
    const harness = harnessFor();
    const { letterTemplateId, letterTemplateVersionId } = await publishedTemplate(harness);

    await harness.as(ADMINISTRATOR, () =>
      send(harness, {
        commandName: 'letters.amend-version',
        letterTemplateVersionId,
        expectedVersion: 2,
        body: { en: 'Certifying {{person.fullName}}.', ar: 'نشهد {{person.fullName}}.' },
        variables: ['person.fullName'],
        exposedFields: ['person'],
      }),
    );

    const detail = await harness.as(ADMINISTRATOR, () =>
      ask<TemplateDetail>(harness, { queryName: 'letters.read-template', letterTemplateId }),
    );

    // The freeze is caused by issuance, not by publication.
    expect(detail.versions[0]?.variables).toEqual(['person.fullName']);
  });

  it('refuses generating from a retired version', async () => {
    const harness = harnessFor();
    const { letterTemplateId, letterTemplateVersionId } = await publishedTemplate(harness);

    await harness.as(ADMINISTRATOR, () =>
      send(harness, {
        commandName: 'letters.move-version',
        letterTemplateVersionId,
        status: 'retired',
        expectedVersion: 2,
      }),
    );

    const refused = await harness.as(REQUESTER, () =>
      attempt(harness, {
        commandName: 'letters.request',
        letterTemplateId,
        employmentId: '01900000-0000-7000-8000-000000000001',
        personId: '01900000-0000-7000-8000-000000000002',
        locale: 'en',
      }),
    );

    expect(refused.ok).toBe(false);
  });
});

describe('requesting', () => {
  it('lets the template decide whether approval is needed', async () => {
    const harness = harnessFor();
    const withApproval = await publishedTemplate(harness, {
      code: 'salary-certificate',
      requiresApproval: true,
    });
    const requested = await requestFor(harness, withApproval.letterTemplateId);

    // Not the caller's choice: a requester cannot skip a control by asking differently.
    expect(requested.status).toBe('pending_approval');
  });

  it('refuses a locale the product does not have', async () => {
    const harness = harnessFor();
    const { letterTemplateId } = await publishedTemplate(harness);
    const refused = await harness.as(REQUESTER, () =>
      attempt(harness, {
        commandName: 'letters.request',
        letterTemplateId,
        employmentId: '01900000-0000-7000-8000-000000000001',
        personId: '01900000-0000-7000-8000-000000000002',
        locale: 'fr',
      }),
    );

    expect(refused.ok).toBe(false);
  });
});

describe('approval', () => {
  it('refuses the requester approving their own letter', async () => {
    const harness = harnessFor();
    const { letterTemplateId } = await publishedTemplate(harness, {
      code: 'salary-certificate',
      requiresApproval: true,
    });
    const requested = await requestFor(harness, letterTemplateId);

    const refused = await harness.as(REQUESTER, () =>
      attempt(harness, {
        commandName: 'letters.decide',
        letterRequestId: requested.letterRequestId,
        decision: 'approved',
      }),
    );

    expect(refused.ok).toBe(false);
  });

  it('records the authenticated approver, never one the command supplied', async () => {
    const harness = harnessFor();
    const { letterTemplateId } = await publishedTemplate(harness, {
      code: 'salary-certificate',
      requiresApproval: true,
    });
    const requested = await requestFor(harness, letterTemplateId);

    await harness.as(APPROVER, () =>
      send(harness, {
        commandName: 'letters.decide',
        letterRequestId: requested.letterRequestId,
        decision: 'approved',
        decidedBy: 'user:somebody-else',
      }),
    );

    const detail = await harness.as(ADMINISTRATOR, () =>
      ask<RequestDetail>(harness, {
        queryName: 'letters.read-request',
        letterRequestId: requested.letterRequestId,
      }),
    );

    expect(detail.decisions[0]?.decidedBy).toBe(APPROVER);
    expect(detail.request.status).toBe('approved');
  });

  it('re-derives the request from the whole chain when a rejection is reversed', async () => {
    const harness = harnessFor();
    const { letterTemplateId } = await publishedTemplate(harness, {
      code: 'salary-certificate',
      requiresApproval: true,
    });
    const requested = await requestFor(harness, letterTemplateId);
    const decide = (command: Record<string, unknown>): Promise<unknown> =>
      harness.as(APPROVER, () =>
        send(harness, {
          commandName: 'letters.decide',
          letterRequestId: requested.letterRequestId,
          ...command,
        }),
      );

    await decide({ decision: 'rejected', comment: 'Wrong addressee' });

    const rejected = await harness.as(ADMINISTRATOR, () =>
      ask<RequestDetail>(harness, {
        queryName: 'letters.read-request',
        letterRequestId: requested.letterRequestId,
      }),
    );

    expect(rejected.request.status).toBe('rejected');

    // A reversal does not erase what it reverses: both rows stay, and the chain reads as history.
    await decide({
      decision: 'reversed',
      reversesId: rejected.decisions[0]?.approvalDecisionId,
    });

    const reversed = await harness.as(ADMINISTRATOR, () =>
      ask<RequestDetail>(harness, {
        queryName: 'letters.read-request',
        letterRequestId: requested.letterRequestId,
      }),
    );

    expect(reversed.decisions).toHaveLength(2);
    expect(reversed.request.approvalState).toBe('pending');
  });

  it('refuses issuing a letter whose approval has not been given', async () => {
    const harness = harnessFor();
    const { letterTemplateId } = await publishedTemplate(harness, {
      code: 'salary-certificate',
      requiresApproval: true,
    });
    const requested = await requestFor(harness, letterTemplateId);

    // `pending_approval` does not reach `generating`. The transition table is the enforcement.
    const refused = await harness.as(ADMINISTRATOR, () =>
      attempt(harness, {
        commandName: 'letters.issue',
        letterRequestId: requested.letterRequestId,
      }),
    );

    expect(refused.ok).toBe(false);
  });

  it('issues once the chain stands as approved', async () => {
    const harness = harnessFor();
    const { letterTemplateId } = await publishedTemplate(harness, {
      code: 'salary-certificate',
      requiresApproval: true,
    });
    const requested = await requestFor(harness, letterTemplateId);

    await harness.as(APPROVER, () =>
      send(harness, {
        commandName: 'letters.decide',
        letterRequestId: requested.letterRequestId,
        decision: 'approved',
      }),
    );

    const issued = await harness.as(ADMINISTRATOR, () =>
      send<LetterIssued>(harness, {
        commandName: 'letters.issue',
        letterRequestId: requested.letterRequestId,
      }),
    );

    expect(issued.referenceNumber).toBe('LTR-000001');
  });
});
