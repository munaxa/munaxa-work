import { describe, expect, it } from 'vitest';

import { Person } from './person.js';
import { PersonIdentifier, normalizeIdentifier } from './person-identifier.js';
import { PersonName } from './person-name.js';
import { PersonHistory } from './person-history.js';
import { PersonCapability } from './person-capability.js';

const ORIGIN = {
  tenantId: '01920000-0000-7000-8000-0000000000aa',
  correlationId: '01920000-0000-7000-8000-0000000000bb',
  actor: 'user:tester',
};
const NOW = new Date('2026-08-06T09:00:00Z');
const TENANT = ORIGIN.tenantId;

const digest = { digest: (type: string, value: string) => `${type}:${value}` };

const failedWith = (result: { ok: boolean }, reason: string): void => {
  expect(result.ok).toBe(false);
  expect((result as unknown as { error: { reason: string } }).error.reason).toBe(reason);
};

describe('a person', () => {
  const create = (over: Record<string, unknown> = {}) =>
    Person.create({ tenantId: TENANT, personNumber: 'P-0001', ...over }, ORIGIN, NOW);

  it('starts as a draft, because a register acquires people before anybody has checked them', () => {
    const person = create();

    expect(person.ok).toBe(true);
    expect(person.ok && person.value.currentStatus).toBe('draft');
  });

  it('names itself in the event and says nothing about the human being', () => {
    const person = create({ dateOfBirth: '1990-03-14' });
    const raised = person.ok ? person.value.pullEvents() : [];

    expect(raised).toHaveLength(1);
    expect(JSON.stringify(raised[0]?.payload)).not.toContain('1990');
  });

  it('refuses a date of birth in the future', () => {
    failedWith(create({ dateOfBirth: '2030-01-01' }), 'date_of_birth_in_the_future');
  });

  it('refuses a date of birth nobody alive could have, which is how 2960 for 1960 is caught', () => {
    failedWith(create({ dateOfBirth: '1860-01-01' }), 'date_of_birth_implausible');
  });

  it('refuses a date that is not a date', () => {
    failedWith(create({ dateOfBirth: '14/03/1990' }), 'date_malformed');
  });

  it('refuses a person number that would not survive a payroll file', () => {
    failedWith(create({ personNumber: 'رقم ١' }), 'code_malformed');
  });

  it('keeps a correction out of the event payload, naming the fields rather than the values', () => {
    const person = create();

    if (!person.ok) throw new Error('unreachable');
    person.value.pullEvents();

    const amended = person.value.amendDetails({ dateOfBirth: '1988-01-02' }, ORIGIN, NOW);
    const raised = person.value.pullEvents();

    expect(amended.ok).toBe(true);
    expect(raised[0]?.payload).toEqual({ personId: person.value.id, fields: ['dateOfBirth'] });
  });

  it('archives rather than deletes, so everything that ever pointed here still resolves', () => {
    const person = create();

    if (!person.ok) throw new Error('unreachable');
    expect(person.value.changeStatus('active', ORIGIN, NOW).ok).toBe(true);
    expect(person.value.changeStatus('archived', ORIGIN, NOW).ok).toBe(true);
    expect(person.value.currentStatus).toBe('archived');
  });

  it('refuses a status change to a status it already has', () => {
    const person = create();

    if (!person.ok) throw new Error('unreachable');
    failedWith(person.value.changeStatus('draft', ORIGIN, NOW), 'person_already_in_status');
  });

  it('refuses merge as an ordinary status change, because a merge needs a survivor', () => {
    const person = create();

    if (!person.ok) throw new Error('unreachable');
    failedWith(person.value.changeStatus('merged', ORIGIN, NOW), 'merge_is_not_a_status_change');
  });

  it('refuses every amendment once merged, so a change cannot land on a record nothing reads', () => {
    const person = create();

    if (!person.ok) throw new Error('unreachable');
    expect(person.value.mergeInto('01920000-0000-7000-8000-0000000000cc', ORIGIN, NOW).ok).toBe(
      true,
    );
    failedWith(person.value.amendDetails({ placeOfBirth: 'Riyadh' }, ORIGIN, NOW), 'person_merged');
    failedWith(person.value.reviseMetadata({}, ORIGIN, NOW), 'person_merged');
  });

  it('refuses to merge into itself', () => {
    const person = create();

    if (!person.ok) throw new Error('unreachable');
    failedWith(
      person.value.mergeInto(person.value.id, ORIGIN, NOW),
      'person_cannot_merge_into_itself',
    );
  });

  it('has no field for a department, a position, a manager or a salary (AD-003, AD-004)', () => {
    const person = create();

    if (!person.ok) throw new Error('unreachable');

    const columns = Object.keys(person.value.snapshot());

    for (const forbidden of [
      'department',
      'unitId',
      'positionId',
      'managerId',
      'costCenter',
      'salary',
      'employmentId',
      'shift',
      'supervisor',
    ]) {
      expect(columns).not.toContain(forbidden);
    }
  });
});

describe('a name', () => {
  const record = (over: Record<string, unknown> = {}) =>
    PersonName.record(
      {
        tenantId: TENANT,
        personId: '01920000-0000-7000-8000-0000000000dd',
        legalName: { en: 'Sara Al-Amri', ar: 'سارة العامري' },
        effectiveFrom: NOW,
        ...over,
      },
      ORIGIN,
      NOW,
    );

  it('requires both first-class languages, because half a name is an unusable contract', () => {
    failedWith(record({ legalName: { en: 'Sara Al-Amri' } }), 'name_requires_both_languages');
  });

  it('refuses a preferred name in one language only', () => {
    failedWith(record({ preferredName: { ar: 'سارة' } }), 'name_requires_both_languages');
  });

  it('carries neither the old name nor the new one in the event it raises', () => {
    const name = record();
    const raised = name.ok ? name.value.pullEvents() : [];

    expect(JSON.stringify(raised[0]?.payload)).not.toContain('Sara');
    expect(JSON.stringify(raised[0]?.payload)).not.toContain('سارة');
  });
});

describe('an identifier', () => {
  const record = (over: Record<string, unknown> = {}) =>
    PersonIdentifier.record(
      {
        tenantId: TENANT,
        personId: '01920000-0000-7000-8000-0000000000dd',
        identifierType: 'national-id',
        value: '1234567890',
        ...over,
      },
      digest,
      ORIGIN,
      NOW,
    );

  it('compares one document typed three ways as one document', () => {
    expect(normalizeIdentifier('1234-5678-90')).toBe('1234567890');
    expect(normalizeIdentifier('1234 5678 90')).toBe('1234567890');
    expect(normalizeIdentifier('a1b2/c3')).toBe('A1B2C3');
  });

  it('never puts the number in the event it raises', () => {
    const identifier = record();
    const raised = identifier.ok ? identifier.value.pullEvents() : [];

    expect(JSON.stringify(raised[0]?.payload)).not.toContain('1234567890');
    expect(raised[0]?.payload).toMatchObject({ identifierType: 'national-id' });
  });

  it('refuses an expiry before the issue date', () => {
    failedWith(
      record({ issuedOn: '2024-01-01', expiresOn: '2023-01-01' }),
      'identifier_expires_before_issue',
    );
  });

  it('refuses an issuing country that is not a country code', () => {
    failedWith(record({ issuingCountry: 'SAU' }), 'country_code_malformed');
  });

  it('keeps its match key after withdrawal, so a replaced passport still answers who held it', () => {
    const identifier = record();

    if (!identifier.ok) throw new Error('unreachable');

    const key = identifier.value.matchKey;

    expect(identifier.value.withdraw(ORIGIN, NOW).ok).toBe(true);
    expect(identifier.value.matchKey).toBe(key);
    expect(identifier.value.snapshot().value).toBe('1234567890');
  });

  it('refuses a second withdrawal rather than silently succeeding', () => {
    const identifier = record();

    if (!identifier.ok) throw new Error('unreachable');
    identifier.value.withdraw(ORIGIN, NOW);
    failedWith(identifier.value.withdraw(ORIGIN, NOW), 'identifier_withdrawn');
  });

  it('has no way to change the value, because a new number is a new document (AD-009)', () => {
    const identifier = record();

    if (!identifier.ok) throw new Error('unreachable');

    // `amend` takes dates and the primary flag. There is no parameter for the value at all, so
    // the only way to correct one is to withdraw the document and record the replacement.
    const amended = identifier.value.amend({ expiresOn: '2031-01-01' }, ORIGIN, NOW);

    expect(amended.ok).toBe(true);
    expect(identifier.value.snapshot().value).toBe('1234567890');
    expect(identifier.value.snapshot().expiresOn).toBe('2031-01-01');
  });
});

describe('history and capability', () => {
  const person = '01920000-0000-7000-8000-0000000000dd';

  it('refuses an expiry on a degree, because only a certification lapses', () => {
    failedWith(
      PersonHistory.record(
        {
          tenantId: TENANT,
          personId: person,
          kind: 'education',
          organizationName: { en: 'KFUPM', ar: 'جامعة الملك فهد' },
          title: { en: 'BSc', ar: 'بكالوريوس' },
          fromDate: '2010-09-01',
          expiresOn: '2030-01-01',
        },
        ORIGIN,
        NOW,
      ),
      'only_a_certification_expires',
    );
  });

  it('refuses a field of study on a previous employer', () => {
    failedWith(
      PersonHistory.record(
        {
          tenantId: TENANT,
          personId: person,
          kind: 'experience',
          organizationName: { en: 'Acme', ar: 'أكمي' },
          title: { en: 'Analyst', ar: 'محلل' },
          fieldOfStudy: { en: 'Physics', ar: 'فيزياء' },
          fromDate: '2015-01-01',
        },
        ORIGIN,
        NOW,
      ),
      'field_of_study_only_on_education',
    );
  });

  it('refuses a period that ends before it begins', () => {
    failedWith(
      PersonHistory.record(
        {
          tenantId: TENANT,
          personId: person,
          kind: 'experience',
          organizationName: { en: 'Acme', ar: 'أكمي' },
          title: { en: 'Analyst', ar: 'محلل' },
          fromDate: '2015-01-01',
          toDate: '2014-01-01',
        },
        ORIGIN,
        NOW,
      ),
      'period_ends_before_it_begins',
    );
  });

  it('needs no name for a language, because the tag renders from the reader’s own locale', () => {
    const language = PersonCapability.record(
      {
        tenantId: TENANT,
        personId: person,
        kind: 'language',
        capabilityCode: 'ar',
        level: 'native',
      },
      ORIGIN,
      NOW,
    );

    expect(language.ok).toBe(true);
  });

  it('requires a name for a skill, in both languages', () => {
    failedWith(
      PersonCapability.record(
        {
          tenantId: TENANT,
          personId: person,
          kind: 'skill',
          capabilityCode: 'welding',
          level: 'expert',
        },
        ORIGIN,
        NOW,
      ),
      'skill_requires_a_name',
    );
  });

  it('refuses a level from the other scale, so a language is never “expert”', () => {
    failedWith(
      PersonCapability.record(
        {
          tenantId: TENANT,
          personId: person,
          kind: 'language',
          capabilityCode: 'en',
          level: 'expert',
        },
        ORIGIN,
        NOW,
      ),
      'capability_level_unknown',
    );
  });
});
