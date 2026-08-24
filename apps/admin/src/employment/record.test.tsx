import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { translator as shellTranslator } from '../shell/locale';

import { recordTranslator } from './record-locale';
import { ContractsSection, IdentitySection, PlacementSection } from './record-identity';
import { EmploymentSummary } from './record-summary';
import {
  AttendanceSection,
  DocumentsSection,
  LeaveSection,
  LearningSection,
  LettersSection,
} from './record-operations';
import {
  AssetsSection,
  BoundariesNote,
  CareerSection,
  RelationsSection,
} from './record-governance';
import { aFullRecord, aWithheldRecord, anEmptyRecord } from './record.fixture';

/**
 * What the employee record actually renders, asserted against the markup rather than a description
 * of it.
 *
 * The record is the first screen in this product that composes more than one module, so the
 * assertions that matter are about the *seams*: that a withheld section is distinguishable from an
 * empty one, that a value from one module never appears under another's heading, that no name is
 * invented for an identifier this screen did not ask for, and that both languages reach every
 * section.
 *
 * `renderToStaticMarkup` runs the real components with the real catalogues and produces the real
 * HTML — no DOM, no test renderer, no new dependency, and nothing mocked at all.
 */

const en = recordTranslator('en');
const ar = recordTranslator('ar');
const admin = shellTranslator('en');

const html = (node: ReactNode): string => renderToStaticMarkup(node);

const escaped = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#x27;');

const everySection = (
  t: typeof en,
  language: 'en' | 'ar',
  record: ReturnType<typeof aFullRecord>,
): string =>
  [
    html(<EmploymentSummary t={t} language={language} record={record} />),
    html(<IdentitySection t={t} language={language} record={record} />),
    html(<PlacementSection t={t} language={language} record={record} />),
    html(<ContractsSection t={t} record={record} />),
    html(<DocumentsSection t={t} language={language} record={record} />),
    html(<LettersSection t={t} record={record} />),
    html(<LeaveSection t={t} language={language} record={record} />),
    html(<AttendanceSection t={t} record={record} />),
    html(<CareerSection t={t} record={record} />),
    html(<LearningSection t={t} record={record} />),
    html(<RelationsSection t={t} record={record} />),
    html(<AssetsSection t={t} record={record} />),
    html(<BoundariesNote t={t} />),
  ].join('\n');

describe('the employee record', () => {
  it('renders one value from each of the eleven modules it composes', () => {
    const markup = everySection(en, 'en', aFullRecord());

    // People — the legal name, in the reader's language.
    expect(markup).toContain('Layla Haddad');
    // Employment — the number, the type and the placement's effective date.
    expect(markup).toContain('EMP-000417');
    expect(markup).toContain('FULL_TIME');
    expect(markup).toContain('2021-03-01');
    // Documents — the title the tenant gave it.
    expect(markup).toContain('Signed contract');
    // Letters — the reference the sequence minted.
    expect(markup).toContain('LTR-2026-000091');
    // Leave — the available balance, in the minutes the module publishes.
    expect(markup).toContain('7200');
    // Attendance — the day and what was worked on it.
    expect(markup).toContain('2026-08-20');
    expect(markup).toContain('465');
    // Learning — the counts the module derives.
    expect(markup).toContain('11');
    // Relations — the category and the derived occurrence ordinal.
    expect(markup).toContain('LATENESS');
    // Assets — the asset tag a human recognises, and the days it has been out.
    expect(markup).toContain('LT-00841');
    expect(markup).toContain('194');
    // Career — the date the summary was resolved at.
    expect(markup).toContain('2026-08-24');
  });

  /**
   * The assertion the whole design turns on.
   *
   * An empty disciplinary section reads as "this person has a clean record". If a refusal rendered
   * as an empty section, the screen would make that statement on somebody the caller was not
   * allowed to look at — so the two must never produce the same markup.
   */
  it('distinguishes a withheld section from an empty one', () => {
    const withheld = everySection(en, 'en', aWithheldRecord());
    const empty = everySection(en, 'en', anEmptyRecord());

    expect(withheld).toContain(escaped(admin('admin.notice.sectionWithheld')));
    expect(empty).toContain(escaped(admin('admin.label.empty')));
    expect(empty).not.toContain(escaped(admin('admin.notice.sectionWithheld')));
    expect(withheld).not.toBe(empty);
  });

  it('says a refusal is a refusal in every section that can be refused', () => {
    const record = aWithheldRecord();
    const refusable = [
      html(<IdentitySection t={en} language="en" record={record} />),
      html(<PlacementSection t={en} language="en" record={record} />),
      html(<ContractsSection t={en} record={record} />),
      html(<DocumentsSection t={en} language="en" record={record} />),
      html(<LettersSection t={en} record={record} />),
      html(<LeaveSection t={en} language="en" record={record} />),
      html(<AttendanceSection t={en} record={record} />),
      html(<CareerSection t={en} record={record} />),
      html(<LearningSection t={en} record={record} />),
      html(<RelationsSection t={en} record={record} />),
      html(<AssetsSection t={en} record={record} />),
    ];

    for (const markup of refusable) {
      expect(markup).toContain(escaped(admin('admin.notice.sectionWithheld')));
    }
  });

  /**
   * A refused disciplinary section must not carry the words a populated one carries: not the
   * category, not the severity, not the ordinal. Asserting the notice alone would pass on a screen
   * that showed both.
   */
  it('renders no violation content at all when relations was refused', () => {
    const markup = html(<RelationsSection t={en} record={aWithheldRecord()} />);

    for (const leak of ['LATENESS', 'minor', 'Arrived after']) {
      expect([leak, markup.includes(leak)]).toEqual([leak, false]);
    }
  });

  it('shows an identifier where a name belongs to a module it did not ask, and says why', () => {
    const markup = html(<PlacementSection t={en} language="en" record={aFullRecord()} />);

    // A shortened identifier for the unit, the position and the manager — never a name.
    expect(markup).toContain('01900000…');
    expect(markup).toContain(escaped(admin('admin.notice.identifiersNotNames')));
  });

  it('renders every section in Arabic', () => {
    const markup = everySection(ar, 'ar', aFullRecord());

    for (const key of [
      'admin.record.identity',
      'admin.record.employment',
      'admin.record.placement',
      'admin.record.contracts',
      'admin.record.documents',
      'admin.record.letters',
      'admin.record.leave',
      'admin.record.attendance',
      'admin.record.career',
      'admin.record.learning',
      'admin.record.relations',
      'admin.record.assets',
      'admin.record.boundaries',
    ]) {
      expect([key, markup.includes(escaped(ar(key)))]).toEqual([key, true]);
    }
    // The Arabic legal name, not the English one falling through.
    expect(markup).toContain('ليلى حداد');
  });

  it('offers no control anywhere: this portal reads and writes nothing', () => {
    const markup = everySection(en, 'en', aFullRecord()).toLowerCase();

    for (const control of [
      '<form',
      '<button',
      '<input',
      '<select',
      '<textarea',
      '<dialog',
      'onclick',
      'onsubmit',
      'use client',
    ]) {
      expect([control, markup.includes(control)]).toEqual([control, false]);
    }
  });

  /**
   * The boundaries this record states rather than leaves as an absence.
   *
   * Each is a fact about this repository: Performance publishes no per-employment read, no salary
   * is on the record, no document content is stored, offboarding is unbuilt and self-service is
   * unbuilt. A reader must not have to guess which of "missing" and "withheld" they are looking at.
   */
  it('names what the record does not show', () => {
    const markup = html(<BoundariesNote t={en} />);

    for (const key of [
      'admin.notice.eachSectionIsItsOwnPermission',
      'admin.notice.noPerformanceRead',
      'admin.notice.noCompensationOnRecord',
      'admin.notice.noDocumentContent',
      'admin.notice.noOffboarding',
      'admin.notice.noSelfService',
      'admin.notice.readOnly',
    ]) {
      expect([key, markup.includes(escaped(admin(key)))]).toEqual([key, true]);
    }
  });

  /**
   * Every quantity a module publishes in minutes carries the word for one.
   *
   * A bare `9600` in a leave balance is the defect class the audit named in the benchmark product —
   * a raw figure with no unit — and the caption that used to sit under the table rendered the
   * formatter's own placeholder, `{minutes} min`, as literal text.
   */
  it('renders every minute quantity with its unit, and no placeholder', () => {
    const markup = everySection(en, 'en', aFullRecord());

    expect(markup).toContain('9600 min');
    expect(markup).toContain('7200 min');
    expect(markup).toContain('480 min');
    expect(markup).not.toContain('{minutes}');
  });

  it('renders the Arabic unit in Arabic, not the English one', () => {
    const markup = everySection(ar, 'ar', aFullRecord());

    expect(markup).toContain(`9600 ${ar('leave.label.minutes').replace('{minutes} ', '')}`);
    expect(markup).not.toContain('{minutes}');
  });

  /**
   * A violation's state is one of Relations' own closed vocabularies and the module ships it in
   * both languages; its severity is a word the tenant chose and is rendered as stored.
   */
  it('translates the violation state and leaves the tenant severity alone', () => {
    const english = html(<RelationsSection t={en} record={aFullRecord()} />);
    const arabic = html(<RelationsSection t={ar} record={aFullRecord()} />);

    expect(english).toContain(en('relations.state.reported'));
    expect(arabic).toContain(ar('relations.state.reported'));
    expect(arabic).not.toContain('>reported<');
    // The severity is the tenant's word in both languages.
    expect(english).toContain('minor');
    expect(arabic).toContain('minor');
  });

  /** A balance without its leave type is two identical rows with different numbers. */
  it('names the leave type on every balance', () => {
    const markup = html(<LeaveSection t={en} language="en" record={aFullRecord()} />);

    expect(markup).toContain('Annual leave');
  });

  it('names the manager where a bounded read answered, and never invents the rest', () => {
    const markup = everySection(en, 'en', aFullRecord());

    expect(markup).toContain('Omar Nasser');
    // The unit and the position stay identifiers: Organization publishes no lookup by identifier.
    expect(markup).toContain('01900000…');
  });

  /**
   * A value that must keep its own direction inside Arabic text is isolated.
   *
   * Without `<bdi>` an employment number or a date inside an Arabic sentence is reordered by the
   * bidirectional algorithm, which is how `EMP-000417` renders as `417-EMP-000` on the page.
   */
  it('isolates every Latin run it puts inside Arabic text', () => {
    const markup = html(<EmploymentSummary t={ar} language="ar" record={aFullRecord()} />);

    expect(markup).toContain('<bdi>EMP-000417</bdi>');
    expect(markup).toContain('<bdi>2021-03-01</bdi>');
  });

  it('says that sensitive fields were withheld rather than rendering them blank', () => {
    const markup = html(<IdentitySection t={en} language="en" record={aFullRecord()} />);

    expect(markup).toContain(escaped(en('people.hint.sensitiveWithheld')));
  });

  /**
   * No compensation, no payslip, no performance rating anywhere on the record.
   *
   * Two of the three are deliberate boundaries rather than gaps, and a later change that quietly
   * added one would move a salary onto the screen everybody opens. This fails if it does.
   */
  it('carries no salary, no payslip and no rating', () => {
    const markup = everySection(en, 'en', aFullRecord()).toLowerCase();

    for (const absent of ['payslip', 'gross', 'net pay', 'rating', 'nine-box']) {
      expect([absent, markup.includes(absent)]).toEqual([absent, false]);
    }
  });
});
