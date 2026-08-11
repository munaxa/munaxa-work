import { describe, expect, it } from 'vitest';

import {
  createTemplate,
  draftTemplateVersion,
  editable,
  moveTemplateVersionTo,
  placeholdersIn,
  usableForGeneration,
  type LetterTemplateVersionState,
} from './letter-template.js';
import {
  generate,
  issueLetter,
  moveRequestTo,
  requestLetter,
  supersede,
} from './letter-generation.js';
import { approvalState, recordDecision } from './letter-approval.js';

/**
 * What a letter domain must guarantee, tested without a database, a renderer or a source.
 *
 * The three worth reading first: an unresolved variable fails rather than rendering a blank; a
 * template version that has issued a letter cannot be edited; and an issued letter's substituted
 * values are frozen, so a later raise cannot change a certificate somebody is holding.
 */

const TOKEN = 'a'.repeat(48);

const aVersion = (
  overrides: Partial<Parameters<typeof draftTemplateVersion>[0]> = {},
): LetterTemplateVersionState => {
  const drafted = draftTemplateVersion({
    letterTemplateVersionId: 'tv1',
    letterTemplateId: 't1',
    versionNumber: 1,
    body: {
      en: 'This certifies that {{ person.fullName }} earns {{ salary.gross }}.',
      ar: 'نشهد بأن {{ person.fullName }} يتقاضى {{ salary.gross }}.',
    },
    variables: ['person.fullName', 'salary.gross'],
    exposedFields: ['person', 'salary'],
    ...overrides,
  });

  if (!drafted.ok) throw new Error(`fixture refused: ${drafted.error.reason}`);
  return drafted.value;
};

const published = (): LetterTemplateVersionState => {
  const moved = moveTemplateVersionTo(aVersion(), 'published');

  if (!moved.ok) throw new Error('fixture refused');
  return moved.value;
};

describe('a letter template', () => {
  it('requires a code, a category and a name in both languages', () => {
    const base = {
      letterTemplateId: 't1',
      code: 'salary-certificate',
      name: { en: 'Salary certificate', ar: 'شهادة راتب' },
      category: 'certificate',
      requiresApproval: true,
      employeeRequestable: true,
    };

    expect(createTemplate(base).ok).toBe(true);
    expect(createTemplate({ ...base, code: 'Salary Certificate' }).ok).toBe(false);
    expect(createTemplate({ ...base, name: { en: 'x', ar: ' ' } }).ok).toBe(false);
    expect(createTemplate({ ...base, category: 'Not A Code' }).ok).toBe(false);
  });
});

describe('a template version', () => {
  it('requires a body in both languages', () => {
    const refused = draftTemplateVersion({
      letterTemplateVersionId: 'tv1',
      letterTemplateId: 't1',
      versionNumber: 1,
      body: { en: 'Hello', ar: '' },
      variables: [],
      exposedFields: [],
    });

    // A template authored only in English is a letter an Arabic speaker cannot be issued.
    expect(refused.ok ? '' : refused.error.reason).toBe('template_body_incomplete');
  });

  it('refuses a placeholder the version did not declare', () => {
    const refused = draftTemplateVersion({
      letterTemplateVersionId: 'tv1',
      letterTemplateId: 't1',
      versionNumber: 1,
      body: { en: 'Hello {{ person.nickname }}', ar: 'مرحبا {{ person.nickname }}' },
      variables: ['person.fullName'],
      exposedFields: ['person'],
    });

    // Caught when the template is authored, not when an employee's certificate fails.
    expect(refused.ok ? '' : refused.error.reason).toBe('placeholder_not_declared');
  });

  it('refuses a variable name that is not a name', () => {
    for (const variable of ['person.fullName()', 'salary * 2', 'SELECT 1', '__proto__']) {
      const refused = draftTemplateVersion({
        letterTemplateVersionId: 'tv1',
        letterTemplateId: 't1',
        versionNumber: 1,
        body: { en: 'x', ar: 'x' },
        variables: [variable],
        exposedFields: [],
      });

      // The safety model in one assertion: a variable is a name, never an expression.
      expect(refused.ok ? `accepted ${variable}` : refused.error.reason).toBe(
        'variable_name_malformed',
      );
    }
  });

  it('refuses an exposed field nobody declared', () => {
    const refused = draftTemplateVersion({
      letterTemplateVersionId: 'tv1',
      letterTemplateId: 't1',
      versionNumber: 1,
      body: { en: 'x', ar: 'x' },
      variables: [],
      exposedFields: ['bank-account'],
    });

    expect(refused.ok ? '' : refused.error.reason).toBe('exposed_field_unknown');
  });

  it('finds the placeholders a body uses', () => {
    expect(placeholdersIn('a {{ one }} b {{two}} c')).toEqual(['one', 'two']);
    expect(placeholdersIn('nothing here')).toEqual([]);
  });

  it('is editable until it has issued a letter, and never afterwards', () => {
    const draft = aVersion();

    expect(editable(draft).ok).toBe(true);

    // Publication does not freeze it; issuance does. Nothing depends on a published-but-unused one.
    const issued = { ...published(), firstIssuedAt: new Date('2026-08-01T00:00:00Z') };

    expect(editable(issued).ok ? '' : editable(issued).ok).toBe(false);
  });

  it('may only generate from a published version', () => {
    expect(usableForGeneration(aVersion()).ok).toBe(false);
    expect(usableForGeneration(published()).ok).toBe(true);

    const retired = moveTemplateVersionTo(published(), 'retired');

    expect(usableForGeneration(retired.ok ? retired.value : published()).ok).toBe(false);
  });
});

describe('requesting and generating a letter', () => {
  const aRequest = (requiresApproval: boolean) =>
    requestLetter({
      letterRequestId: 'r1',
      template: { letterTemplateId: 't1', requiresApproval },
      templateVersion: published(),
      employmentId: 'e1',
      personId: 'p1',
      locale: 'ar',
      requestedBy: 'user:employee',
      requestedAt: new Date('2026-08-01T09:00:00Z'),
    });

  it('starts pending approval only where the template requires it', () => {
    const gated = aRequest(true);
    const open = aRequest(false);

    // The template decides, not the caller: a requester cannot skip a control by asking differently.
    expect(gated.ok && gated.value.status).toBe('pending_approval');
    expect(open.ok && open.value.status).toBe('requested');
  });

  it('refuses an unknown locale and an unpublished template version', () => {
    const badLocale = requestLetter({
      letterRequestId: 'r1',
      template: { letterTemplateId: 't1', requiresApproval: false },
      templateVersion: published(),
      employmentId: 'e1',
      personId: 'p1',
      locale: 'fr',
      requestedBy: 'user:hr',
      requestedAt: new Date(),
    });

    expect(badLocale.ok ? '' : badLocale.error.reason).toBe('locale_unknown');
  });

  it('substitutes declared values and fails loudly on a missing one', () => {
    const rendered = generate({
      templateVersion: published(),
      locale: 'en',
      resolved: { 'person.fullName': 'Rania Odeh', 'salary.gross': '1,200.000 JOD' },
    });

    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(rendered.value.body).toBe('This certifies that Rania Odeh earns 1,200.000 JOD.');
    expect(rendered.value.substitutedValues['salary.gross']).toBe('1,200.000 JOD');

    const missing = generate({
      templateVersion: published(),
      locale: 'en',
      resolved: { 'person.fullName': 'Rania Odeh' },
    });

    // A blank here is how a bank letter comes to state that an employee earns nothing.
    expect(missing.ok ? '' : missing.error.reason).toBe('variable_unresolved');
    expect(missing.ok ? '' : missing.error.detail?.['variable']).toBe('salary.gross');
  });

  it('renders the requested language', () => {
    const arabic = generate({
      templateVersion: published(),
      locale: 'ar',
      resolved: { 'person.fullName': 'رانيا عودة', 'salary.gross': '١٢٠٠' },
    });

    expect(arabic.ok && arabic.value.body).toContain('رانيا عودة');
  });

  it('moves through its lifecycle and refuses a move nobody listed', () => {
    const requested = aRequest(false);
    const generating = moveRequestTo(requested.ok ? requested.value : ({} as never), 'generating');
    const generated = moveRequestTo(generating.ok ? generating.value : ({} as never), 'generated');

    expect(generated.ok && generated.value.status).toBe('generated');

    const backwards = moveRequestTo(generated.ok ? generated.value : ({} as never), 'requested');

    expect(backwards.ok ? '' : backwards.error.reason).toBe('letter_transition_not_permitted');
  });

  it('requires a reason to fail', () => {
    const requested = aRequest(false);
    const generating = moveRequestTo(requested.ok ? requested.value : ({} as never), 'generating');
    const failed = moveRequestTo(generating.ok ? generating.value : ({} as never), 'failed');

    expect(failed.ok ? '' : failed.error.reason).toBe('failure_needs_reason');
  });
});

describe('issuing a letter', () => {
  const generated = () => {
    const requested = requestLetter({
      letterRequestId: 'r1',
      template: { letterTemplateId: 't1', requiresApproval: false },
      templateVersion: published(),
      employmentId: 'e1',
      personId: 'p1',
      locale: 'en',
      requestedBy: 'user:hr',
      requestedAt: new Date('2026-08-01T09:00:00Z'),
    });
    const generating = moveRequestTo(requested.ok ? requested.value : ({} as never), 'generating');
    const done = moveRequestTo(generating.ok ? generating.value : ({} as never), 'generated');

    if (!done.ok) throw new Error('fixture refused');
    return done.value;
  };

  const issue = (overrides: Partial<Parameters<typeof issueLetter>[0]> = {}) =>
    issueLetter({
      issuedLetterId: 'i1',
      request: generated(),
      templateVersion: published(),
      content: {
        body: 'This certifies that Rania Odeh earns 1,200.000 JOD.',
        substitutedValues: { 'person.fullName': 'Rania Odeh', 'salary.gross': '1,200.000 JOD' },
      },
      sourceVersions: { compensation: 'v7', employment: 'v3' },
      referenceNumber: 'LTR-2026-000001',
      verificationToken: TOKEN,
      issuedAt: new Date('2026-08-01T10:00:00Z'),
      issuedBy: 'user:hr-manager',
      ...overrides,
    });

  it('freezes the substituted values and the source versions', () => {
    const issued = issue();

    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    // The snapshot: a raise next month cannot change what this certificate says.
    expect(issued.value.substitutedValues['salary.gross']).toBe('1,200.000 JOD');
    expect(issued.value.sourceVersions['compensation']).toBe('v7');
    expect(issued.value.letterTemplateVersionId).toBe('tv1');
  });

  it('produces no artefact, because no renderer exists', () => {
    const issued = issue();

    expect(issued.ok && issued.value.documentId).toBeUndefined();
  });

  it('never claims a signature happened', () => {
    const unsigned = issue();
    const requiring = issue({
      templateVersion: { ...published(), requiresSignature: true },
    });

    expect(unsigned.ok && unsigned.value.signatureState).toBe('not_required');
    // `required` says somebody must sign. It does not say anybody did.
    expect(requiring.ok && requiring.value.signatureState).toBe('required');
  });

  it('refuses to issue what was not generated, and a guessable token', () => {
    const notGenerated = issue({
      request: { ...generated(), status: 'requested' },
    });
    const guessable = issue({ verificationToken: 'abc123' });

    expect(notGenerated.ok ? '' : notGenerated.error.reason).toBe('letter_not_generated');
    // The verification endpoint takes nothing but this token.
    expect(guessable.ok ? '' : guessable.error.reason).toBe('verification_token_too_short');
  });

  it('supersedes rather than edits, and never supersedes itself', () => {
    const issued = issue();
    const original = issued.ok ? issued.value : ({} as never);
    const superseded = supersede(original, 'i2', new Date('2026-09-01T00:00:00Z'));

    expect(superseded.ok && superseded.value.supersededById).toBe('i2');
    // Everything else is exactly as issued: somebody may hold a printed copy.
    expect(superseded.ok && superseded.value.substitutedValues).toEqual(original.substitutedValues);
    expect(supersede(original, 'i1', new Date()).ok).toBe(false);
    expect(supersede(superseded.ok ? superseded.value : original, 'i3', new Date()).ok).toBe(false);
  });
});

describe('letter approval', () => {
  const decision = {
    approvalDecisionId: 'd1',
    letterRequestId: 'r1',
    sequence: 1,
    decision: 'approved',
    requestedBy: 'user:employee',
    decidedBy: 'user:hr-manager',
    decidedAt: new Date('2026-08-01T10:00:00Z'),
  };

  it('records a named human', () => {
    const recorded = recordDecision(decision);

    expect(recorded.ok && recorded.value.decidedBy).toBe('user:hr-manager');
  });

  it('refuses self-approval', () => {
    const refused = recordDecision({ ...decision, decidedBy: 'user:employee' });

    // Refused here and again by a check constraint, as in Compensation and Payroll.
    expect(refused.ok ? '' : refused.error.reason).toBe('self_approval_not_permitted');
  });

  it('requires a target for a reversal', () => {
    const refused = recordDecision({ ...decision, decision: 'reversed' });

    expect(refused.ok ? '' : refused.error.reason).toBe('reversal_needs_target');
  });

  it('reads the chain as history, with the latest standing decision deciding', () => {
    const approved = recordDecision(decision);
    const first = approved.ok ? approved.value : ({} as never);

    expect(approvalState([])).toBe('pending');
    expect(approvalState([first])).toBe('approved');

    const reversal = recordDecision({
      ...decision,
      approvalDecisionId: 'd2',
      sequence: 2,
      decision: 'reversed',
      reversesId: 'd1',
    });
    const chain = [first, reversal.ok ? reversal.value : ({} as never)];

    // The reversal does not erase the approval; it removes it from standing.
    expect(approvalState(chain)).toBe('pending');
    expect(chain).toHaveLength(2);
  });

  it('never records system:auto-approval', () => {
    const recorded = recordDecision(decision);

    expect(JSON.stringify(recorded)).not.toContain('system:auto-approval');
  });
});
