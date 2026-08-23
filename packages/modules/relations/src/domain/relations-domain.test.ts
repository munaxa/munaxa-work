import { describe, expect, it } from 'vitest';

import { recordAccess } from './access-event.js';
import { ACCESS_ACTIONS, COUNTRY_PACK_SOURCES, VIOLATION_STATES } from './relations-vocabulary.js';
import {
  acceptsNewViolations,
  createViolationCategory,
  type ViolationCategoryState,
} from './violation-category.js';
import { DESCRIPTION_LIMIT, recordViolation } from './violation.js';

/**
 * The rules, with no database and no dispatcher in the way.
 *
 * The domain is where a violation becomes a violation, so this suite asks the questions a labour
 * tribunal would: could this record have said something it should not, and could it have been
 * written by somebody who should not have written it.
 */

const CATEGORY: Parameters<typeof createViolationCategory>[0] = {
  violationCategoryId: 'category-1',
  code: 'unauthorized-absence',
  name: { en: 'Unauthorized absence', ar: 'غياب غير مصرح به' },
  severity: 'major',
  sequence: 10,
  repeatWindowDays: 180,
  source: 'tenant',
};

const categoryOf = (
  overrides: Partial<Parameters<typeof createViolationCategory>[0]> = {},
): ViolationCategoryState => {
  const created = createViolationCategory({ ...CATEGORY, ...overrides });

  if (!created.ok) throw new Error(`unexpected refusal: ${created.error.reason}`);
  return created.value;
};

describe('the violation catalogue', () => {
  it('accepts an entry a tenant defined, and starts it in use at version one', () => {
    const created = categoryOf();

    expect([
      created.code,
      created.severity,
      created.sequence,
      created.active,
      created.version,
    ]).toStrictEqual(['unauthorized-absence', 'major', 10, true, 1]);
    expect(created.source).toBe('tenant');
    expect(created.countryPackId).toBeUndefined();
  });

  /**
   * Severity is a tenant's word, and this is the assertion that keeps it one.
   *
   * If a closed list ever appears, this test fails — which is the point. AD-002 says nothing is
   * hardcoded, and a fixed severity list would be this product deciding what counts as serious for
   * every customer in every jurisdiction.
   */
  it.each(['minor', 'major', 'gross-misconduct', 'مخالفة جسيمة', 'tier-4'])(
    'takes %s as a severity without interpreting it',
    (severity) => {
      expect(categoryOf({ severity }).severity).toBe(severity);
    },
  );

  it.each([
    ['code_malformed', { code: 'Unauthorized Absence' }, 'category_code_malformed'],
    ['english missing', { name: { en: ' ', ar: 'غياب' } }, 'category_name_incomplete'],
    ['arabic missing', { name: { en: 'Absence', ar: '  ' } }, 'category_name_incomplete'],
    ['severity blank', { severity: '   ' }, 'category_severity_missing'],
    ['sequence negative', { sequence: -1 }, 'category_sequence_invalid'],
    ['sequence fractional', { sequence: 1.5 }, 'category_sequence_invalid'],
    ['window negative', { repeatWindowDays: -1 }, 'category_repeat_window_invalid'],
    ['source unknown', { source: 'ministry' }, 'category_source_unknown'],
  ])('refuses %s by name', (_case, overrides, reason) => {
    const created = createViolationCategory({ ...CATEGORY, ...overrides });

    expect(created.ok).toBe(false);
    expect(created.ok ? '' : created.error.reason).toBe(reason);
  });

  /**
   * The country-pack boundary, kept honest in both directions.
   *
   * A `country_pack` entry that named no pack would claim statutory provenance nothing could trace —
   * worse than claiming none, because it would look like a rule somebody may not lawfully change.
   * And a `tenant` entry naming one would be a tenant asserting statutory backing it does not have.
   */
  it('refuses a country-pack entry that names no pack', () => {
    const created = createViolationCategory({ ...CATEGORY, source: 'country_pack' });

    expect(created.ok ? '' : created.error.reason).toBe('category_pack_source_needs_pack');
  });

  it('refuses a tenant entry that names a pack', () => {
    const created = createViolationCategory({ ...CATEGORY, countryPackId: 'jo-labour' });

    expect(created.ok ? '' : created.error.reason).toBe('category_tenant_source_has_pack');
  });

  it('accepts a country-pack entry that names one, and carries the provenance through', () => {
    const created = categoryOf({
      source: 'country_pack',
      countryPackId: 'pack-under-test',
      countryPackVersion: 3,
    });

    expect([created.source, created.countryPackId, created.countryPackVersion]).toStrictEqual([
      'country_pack',
      'pack-under-test',
      3,
    ]);
  });

  it('refuses a pack version below one', () => {
    const created = createViolationCategory({
      ...CATEGORY,
      source: 'country_pack',
      countryPackId: 'pack-under-test',
      countryPackVersion: 0,
    });

    expect(created.ok ? '' : created.error.reason).toBe('category_pack_version_invalid');
  });

  /** A deactivated entry accepts nothing new. Old records keep pointing at it — see the use case. */
  it('stops accepting new violations once deactivated', () => {
    expect(acceptsNewViolations(categoryOf())).toBe(true);
    expect(acceptsNewViolations(categoryOf({ active: false }))).toBe(false);
  });
});

describe('recording a violation', () => {
  const RECORDED_AT = new Date('2026-08-22T09:00:00Z');
  const request = (overrides: Record<string, unknown> = {}) => ({
    violationId: 'violation-1',
    employmentId: 'employment-1',
    category: categoryOf(),
    occurredOn: '2026-08-14',
    reportedBy: 'user:officer',
    description: 'Absent for two consecutive shifts without notice.',
    recordedAt: RECORDED_AT,
    today: '2026-08-22',
    ...overrides,
  });

  it('records it against the employment, in the reported state', () => {
    const recorded = recordViolation(request());

    expect(recorded.ok).toBe(true);
    expect(recorded.ok ? recorded.value.employmentId : '').toBe('employment-1');
    expect(recorded.ok ? recorded.value.state : '').toBe('reported');
    expect(recorded.ok ? recorded.value.version : 0).toBe(1);
  });

  /**
   * The AD-003 freeze, asserted rather than described.
   *
   * The record keeps what the catalogue *said*, not a live pointer to what it says now. A catalogue
   * entry renamed or re-graded two years later must not change what an old record meant.
   */
  it('freezes the category code and severity as they were at recording', () => {
    const recorded = recordViolation(
      request({ category: categoryOf({ code: 'late-arrival', severity: 'minor' }) }),
    );

    expect(recorded.ok ? recorded.value.categoryCode : '').toBe('late-arrival');
    expect(recorded.ok ? recorded.value.severity : '').toBe('minor');
  });

  it('refuses a category that is no longer in use', () => {
    const recorded = recordViolation(request({ category: categoryOf({ active: false }) }));

    expect(recorded.ok ? '' : recorded.error.reason).toBe('category_inactive');
  });

  it.each([
    ['a malformed date', '14/08/2026', 'occurred_on_malformed'],
    ['an instant', '2026-08-14T09:00:00Z', 'occurred_on_malformed'],
  ])('refuses %s for the day of conduct', (_case, occurredOn, reason) => {
    expect(
      recordViolation(request({ occurredOn })).ok
        ? ''
        : (recordViolation(request({ occurredOn })) as { error: { reason: string } }).error.reason,
    ).toBe(reason);
  });

  /** Conduct that has not happened yet cannot be reported. The boundary day itself is allowed. */
  it('refuses conduct dated after today, and accepts conduct dated today', () => {
    expect(recordViolation(request({ occurredOn: '2026-08-23' })).ok).toBe(false);
    expect(recordViolation(request({ occurredOn: '2026-08-22' })).ok).toBe(true);
  });

  it.each([
    ['an empty description', { description: '   ' }, 'description_missing'],
    ['an unattributed record', { reportedBy: '  ' }, 'reporter_unknown'],
  ])('refuses %s by name', (_case, overrides, reason) => {
    const recorded = recordViolation(request(overrides));

    expect(recorded.ok ? '' : recorded.error.reason).toBe(reason);
  });

  it('refuses a description beyond the limit and accepts one exactly at it', () => {
    expect(recordViolation(request({ description: 'x'.repeat(DESCRIPTION_LIMIT + 1) })).ok).toBe(
      false,
    );
    expect(recordViolation(request({ description: 'x'.repeat(DESCRIPTION_LIMIT) })).ok).toBe(true);
  });

  it('trims the description it stores', () => {
    const recorded = recordViolation(request({ description: '  absent  ' }));

    expect(recorded.ok ? recorded.value.description : '').toBe('absent');
  });
});

describe('the access trail', () => {
  const event = (overrides: Record<string, unknown> = {}) => ({
    accessEventId: 'access-1',
    violationId: 'violation-1',
    action: 'violation_read' as const,
    actor: 'user:officer',
    occurredAt: new Date('2026-08-22T09:00:00Z'),
    correlationId: 'correlation-1',
    ...overrides,
  });

  it('records who read which record', () => {
    expect(recordAccess(event()).ok).toBe(true);
  });

  it.each([
    ['no actor', { actor: '  ' }, 'access_actor_unknown'],
    ['no correlation', { correlationId: '' }, 'access_correlation_unknown'],
  ])('refuses an entry with %s', (_case, overrides, reason) => {
    const recorded = recordAccess(event(overrides));

    expect(recorded.ok ? '' : recorded.error.reason).toBe(reason);
  });
});

describe('the vocabularies', () => {
  /**
   * One state, and that is honest rather than unfinished.
   *
   * Every state after `reported` is reached by a capability Checkpoint 1 does not build. A
   * vocabulary listing states nothing can produce would be a promise the code cannot keep; this
   * widens by an approved change, as `workflow_history`'s event list did.
   */
  it('closes the violation states at the one Checkpoint 1 can produce', () => {
    expect(VIOLATION_STATES).toStrictEqual(['reported']);
  });

  it('names both authorities that may write a catalogue entry, and no third', () => {
    expect(COUNTRY_PACK_SOURCES).toStrictEqual(['tenant', 'country_pack']);
  });

  it('distinguishes a record opened from one that appeared in a list', () => {
    expect(ACCESS_ACTIONS).toStrictEqual([
      'violation_read',
      'violation_listed',
      'investigation_read',
      'investigation_listed',
      'case_history_read',
      'escalation_read',
    ]);
  });
});
