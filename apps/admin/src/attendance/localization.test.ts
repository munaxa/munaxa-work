import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { attendanceTranslator } from './locale';

/**
 * The regression test for a defect that shipped to customers.
 *
 * Five raw catalogue keys reached the attendance screen in **English and Arabic**, past a green
 * gate, because the catalogue stored them flat and containing dots — the literal string
 * `"boundary.employment"` nested under `attendance.label`. `check-localization.mjs` flattens a
 * catalogue by *joining* nested names with a dot, so it saw the key as present; every runtime
 * translator in this repository *splits* the requested key on a dot and walks segment by segment,
 * so it found no nested `boundary` object and returned the key.
 *
 * Three assertions, each closing a different half of it:
 *
 * 1. **The shape.** No key name anywhere in either catalogue contains a dot. This is the property
 *    the hardened gate now enforces repository-wide; asserting it here as well means a reviewer
 *    reading this module sees the rule that governs it.
 * 2. **The resolution.** Each of the five keys resolves to a real sentence, in both languages.
 * 3. **The catalogue's own completeness.** Every value in every vocabulary Attendance publishes has
 *    a translation, so a screen rendering a status can never fall back to the stored code.
 */

const CATALOGUES = {
  en: JSON.parse(
    readFileSync(
      new URL('../../../../packages/modules/attendance/locales/en.json', import.meta.url),
      'utf8',
    ),
  ) as Record<string, unknown>,
  ar: JSON.parse(
    readFileSync(
      new URL('../../../../packages/modules/attendance/locales/ar.json', import.meta.url),
      'utf8',
    ),
  ) as Record<string, unknown>,
};

const dottedKeys = (value: unknown, prefix = ''): readonly string[] =>
  typeof value === 'object' && value !== null
    ? Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) => [
        ...(key.includes('.') ? [prefix === '' ? key : `${prefix}.${key}`] : []),
        ...dottedKeys(nested, prefix === '' ? key : `${prefix}.${key}`),
      ])
    : [];

const BOUNDARY_KEYS = [
  'attendance.label.boundary.employment',
  'attendance.label.boundary.leave',
  'attendance.label.boundary.location',
  'attendance.label.boundary.money',
  'attendance.label.boundary.notifications',
] as const;

/** Every vocabulary the module publishes, against the catalogue group that must translate it. */
const VOCABULARIES: readonly (readonly [string, readonly string[]])[] = [
  ['day', ['pending', 'calculated', 'under_review', 'approved', 'locked']],
  ['dayKind', ['working', 'rest', 'holiday', 'unscheduled']],
  ['leave', ['none', 'applied', 'unknown']],
  ['event', ['clock_in', 'clock_out', 'break_start', 'break_end']],
  ['source', ['web', 'mobile', 'device', 'manual', 'import', 'api', 'correction']],
  ['severity', ['information', 'warning', 'blocking']],
  ['exceptionState', ['open', 'resolved', 'waived', 'superseded']],
  ['shift', ['fixed', 'flexible', 'split', 'night', 'open']],
  ['roster', ['shift', 'rest', 'holiday', 'off_site']],
  ['definition', ['draft', 'published', 'superseded']],
  [
    'correction',
    [
      'add_event',
      'amend_event',
      'remove_event',
      'manual_day',
      'overtime',
      'shift_swap',
      'off_site',
    ],
  ],
  ['correctionState', ['requested', 'approved', 'rejected', 'applied', 'withdrawn']],
  [
    'exception',
    [
      'missing_clock_in',
      'missing_clock_out',
      'late_arrival',
      'early_departure',
      'absence_pending_explanation',
      'absent_unexplained',
      'unscheduled_attendance',
      'rest_day_work',
      'holiday_work',
      'duplicate_punch',
      'invalid_punch',
      'clock_skew',
      'overtime_candidate',
      'undertime',
      'late_event_after_approval',
    ],
  ],
];

describe('the attendance catalogue', () => {
  /** The shape that shipped the defect. A dot inside a key name is the defect itself. */
  it('contains no key whose own name has a dot, in either language', () => {
    expect(dottedKeys(CATALOGUES.en)).toEqual([]);
    expect(dottedKeys(CATALOGUES.ar)).toEqual([]);
  });

  /** The five keys a customer actually saw, resolving to sentences rather than to themselves. */
  it('resolves every boundary key to a sentence, in English and in Arabic', () => {
    for (const language of ['en', 'ar'] as const) {
      const t = attendanceTranslator(language);

      for (const key of BOUNDARY_KEYS) {
        expect(t(key)).not.toBe(key);
        expect(t(key).length).toBeGreaterThan(20);
      }
    }
  });

  /** A status a screen can render must never fall back to the value the database stores. */
  it('translates every value of every vocabulary it publishes, in both languages', () => {
    for (const language of ['en', 'ar'] as const) {
      const t = attendanceTranslator(language);

      for (const [group, values] of VOCABULARIES) {
        for (const value of values) {
          const key = `attendance.${group}.${value}`;

          expect(t(key), `${language}: ${key}`).not.toBe(key);
        }
      }
    }
  });

  /** A missing key still returns itself — the property that made the defect visible at all. */
  it('returns the key itself when there is genuinely no translation', () => {
    expect(attendanceTranslator('en')('attendance.label.thereIsNoSuchKey')).toBe(
      'attendance.label.thereIsNoSuchKey',
    );
  });
});
