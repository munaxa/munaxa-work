import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { attendanceTranslator } from './locale';
import {
  AttendanceOverview,
  DaysSection,
  ExceptionsSection,
  ReconciliationSection,
  RegisterBoundaries,
  dayHref,
} from './register';
import { ImportsSection, RosterSection, SchedulesSection, ShiftsSection } from './configuration';
import { CorrectionsSection } from './punches';
import { registerAnsweredNothing } from './api';
import {
  EMPLOYMENT_A,
  EMPLOYMENT_B,
  EMPLOYMENT_C,
  ON_DATE,
  aFullRegister,
  aRefusedRegister,
  anEmptyRegister,
} from './attendance.fixture';

/**
 * The attendance register, asserted against the markup rather than a description of it.
 *
 * Each assertion is anchored to a finding the third slice investigation stated about the screen
 * this replaced, so none of them can come back quietly. The two that matter most are that every
 * flagged day opens, and that the domain's verdict is rendered rather than rebuilt.
 */

const en = attendanceTranslator('en');
const ar = attendanceTranslator('ar');

const html = (node: ReactNode): string => renderToStaticMarkup(node);

/** An `href` as it lands in an attribute: only `&` is escaped there, not the quotes around it. */
const attribute = (href: string): string => `href="${href.replaceAll('&', '&amp;')}"`;

/** `renderToStaticMarkup` escapes apostrophes, so a sentence containing one is looked up escaped. */
const escaped = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#x27;');

const register = (
  t: typeof en,
  language: 'en' | 'ar',
  data: ReturnType<typeof aFullRegister>,
): string =>
  [
    html(<AttendanceOverview t={t} dashboard={data.dashboard} />),
    html(<ExceptionsSection t={t} language={language} exceptions={data.exceptions} />),
    html(<DaysSection t={t} language={language} days={data.days} />),
    html(<ReconciliationSection t={t} language={language} reconciliation={data.reconciliation} />),
    html(<CorrectionsSection t={t} language={language} corrections={data.corrections} />),
    html(<RosterSection t={t} language={language} roster={data.roster} shifts={data.shifts} />),
    html(<ShiftsSection t={t} language={language} shifts={data.shifts} />),
    html(<SchedulesSection t={t} language={language} schedules={data.schedules} />),
    html(<ImportsSection t={t} language={language} imports={data.imports} />),
    html(<RegisterBoundaries t={t} />),
  ].join('\n');

describe('the attendance register', () => {
  /** The finding: nothing on the attendance screen opened, so a flagged day could never be read. */
  it('opens the day behind every exception and every row', () => {
    const data = aFullRegister();

    expect(html(<ExceptionsSection t={en} language="en" exceptions={data.exceptions} />)).toContain(
      attribute(dayHref(EMPLOYMENT_A, ON_DATE, 'en')),
    );
    expect(html(<DaysSection t={en} language="en" days={data.days} />)).toContain(
      attribute(dayHref(EMPLOYMENT_B, '2026-08-23', 'en')),
    );
    expect(
      html(<ReconciliationSection t={en} language="en" reconciliation={data.reconciliation} />),
    ).toContain(attribute(dayHref(EMPLOYMENT_C, '2026-08-22', 'en')));
  });

  /** The finding: six rows of nine thousand, with nothing saying so. */
  it('reports the server total beside the rows on the page, never the row count', () => {
    const markup = register(en, 'en', aFullRegister());

    expect(markup).toContain('3 / 9814');
    expect(markup).toContain('3 / 41');
  });

  /**
   * The domain's verdict, rendered as the sentence the module ships.
   *
   * "Arrived late." is not assembled here from a kind and a number: it is one catalogue value the
   * module owns, and the minutes and severity beside it are the module's too.
   */
  it("renders the module's own sentence, minutes and severity for an exception", () => {
    const markup = html(
      <ExceptionsSection t={en} language="en" exceptions={aFullRegister().exceptions} />,
    );

    expect(markup).toContain(en('attendance.exception.late_arrival'));
    expect(markup).toContain(en('attendance.exception.overtime_candidate'));
    expect(markup).toContain(en('attendance.exception.missing_clock_out'));
    expect(markup).toContain(en('attendance.severity.blocking'));
    expect(markup).toContain(en('attendance.severity.warning'));
    expect(markup).toContain('17 min');
    expect(markup).toContain('45 min');
  });

  /** All three leave states, kept apart. `unknown` is not `none`. */
  it('renders all three leave states distinctly', () => {
    const markup = html(<DaysSection t={en} language="en" days={aFullRegister().days} />);

    expect(markup).toContain(en('attendance.leave.none'));
    expect(markup).toContain(en('attendance.leave.applied'));
    expect(markup).toContain(en('attendance.leave.unknown'));
    expect(
      new Set([
        en('attendance.leave.none'),
        en('attendance.leave.applied'),
        en('attendance.leave.unknown'),
      ]).size,
    ).toBe(3);
    expect(markup).toContain(escaped(en('attendance.notice.leaveUnknownIsNotNone')));
  });

  it('says the refusal once when nothing answered, and not once per section', () => {
    expect(registerAnsweredNothing(aRefusedRegister())).toBe(true);
    expect(registerAnsweredNothing(anEmptyRegister())).toBe(false);
  });

  it('says a refused section was withheld, and an empty one that there is nothing', () => {
    const withheld = register(en, 'en', aRefusedRegister());
    const nothing = register(en, 'en', anEmptyRegister());

    expect(withheld).toContain(escaped(en('admin.notice.sectionWithheld')));
    expect(withheld).not.toContain(escaped(en('attendance.label.noDays')));
    expect(nothing).toContain(escaped(en('attendance.label.noDays')));
    expect(nothing).toContain(escaped(en('attendance.label.noExceptions')));
    expect(nothing).not.toContain(escaped(en('admin.notice.sectionWithheld')));
  });

  it('gives each empty section its own sentence', () => {
    const markup = register(en, 'en', anEmptyRegister());
    const sentences = [
      en('attendance.label.noExceptions'),
      en('attendance.label.noDays'),
      en('attendance.label.noneAwaiting'),
      en('attendance.label.noCorrections'),
      en('attendance.label.noRoster'),
      en('attendance.label.noShifts'),
      en('attendance.label.noSchedules'),
      en('attendance.label.noImports'),
    ];

    expect(new Set(sentences).size).toBe(sentences.length);
    for (const sentence of sentences) expect(markup).toContain(escaped(sentence));
  });

  /** The finding: raw enumeration values leaked into the page in both languages. */
  it('translates every status vocabulary rather than showing the stored value', () => {
    const markup = register(en, 'en', aFullRegister());

    expect(markup).toContain(en('attendance.day.calculated'));
    expect(markup).toContain(en('attendance.dayKind.working'));
    expect(markup).toContain(en('attendance.shift.night'));
    expect(markup).toContain(en('attendance.roster.rest'));
    expect(markup).toContain(en('attendance.definition.published'));
    expect(markup).not.toContain('missing_clock_out');
    expect(markup).not.toContain('overtime_candidate');
    expect(markup).not.toContain('under_review');
  });

  /**
   * The shipped defect this slice fixed: five raw catalogue keys reaching customers.
   *
   * Asserted in **both** languages, because a key missing from Arabic alone is the one a reviewer
   * reading English never sees — and the defect that shipped was visible in both.
   */
  it('leaks no catalogue key, in English as well as in Arabic', () => {
    for (const [t, language] of [
      [en, 'en'],
      [ar, 'ar'],
    ] as const) {
      const markup = register(t, language, aFullRegister());

      expect(markup).not.toMatch(/attendance\.(label|notice|exception|day|severity|leave)\./);
      expect(markup).not.toMatch(/admin\.(label|notice)\./);
    }
  });

  /**
   * The finding: `01900000…` on six sections at once.
   *
   * Three employments sharing a UUIDv7 timestamp prefix stay three, because the identifier is
   * rendered whole and isolated.
   */
  it('renders an employment in full, isolated, and never truncated', () => {
    const markup = html(<DaysSection t={ar} language="ar" days={aFullRegister().days} />);

    expect(markup).toContain(`<bdi>${EMPLOYMENT_A}</bdi>`);
    expect(markup).toContain(`<bdi>${EMPLOYMENT_B}</bdi>`);
    expect(markup).toContain(`<bdi>${EMPLOYMENT_C}</bdi>`);
    expect(markup).not.toContain('01900000…');
  });

  it('isolates a shown-of-total ratio as one run, not two', () => {
    expect(html(<DaysSection t={ar} language="ar" days={aFullRegister().days} />)).toContain(
      '<bdi>3 / 9814</bdi>',
    );
  });

  it('offers no control, and says the recalculation is an API call', () => {
    const markup = register(en, 'en', aFullRegister());

    expect(markup).not.toContain('<button');
    expect(markup).not.toContain('<form');
    expect(markup).not.toContain('<input');
    expect(markup).not.toContain('<select');
    expect(markup).toContain(escaped(en('attendance.notice.recalculationIsApi')));
  });

  /**
   * ADR-0057: no device integration is shipped or verified, so no screen may claim one.
   *
   * The disclaimer in the boundaries names synchronization in order to deny it, so the assertion is
   * about the *claims* a screen could make — a device being offline, disconnected, unreachable, or
   * a sync having failed — none of which the domain publishes.
   */
  it('makes no claim about a device or a synchronization', () => {
    const markup = register(en, 'en', aFullRegister());

    expect(markup).toContain(escaped(en('attendance.notice.noDeviceStatus')));
    for (const claim of [
      'Sync failed',
      'Device offline',
      'Disconnected',
      'Unreachable',
      'Last seen',
      'ZK',
    ]) {
      expect(markup).not.toContain(claim);
    }
  });

  /**
   * Every read the register makes is a read it shows.
   *
   * The corrections read was issued and rendered nowhere — a request spent on nothing, which is the
   * sibling of a control that does nothing. The same section serves both screens and says which it
   * is on: the register spans employments and shows the column, a day is one employment's and says
   * so, because `correctionFilters` publishes no date filter for a day to narrow by.
   */
  it('renders the corrections it asks for, across employments', () => {
    const markup = html(
      <CorrectionsSection t={en} language="en" corrections={aFullRegister().corrections} />,
    );

    expect(markup).toContain(`<bdi>${EMPLOYMENT_A}</bdi>`);
    expect(markup).toContain(en('attendance.correction.amend_event'));
    expect(markup).toContain(en('attendance.correctionState.requested'));
    expect(markup).not.toContain(escaped(en('attendance.notice.correctionScope')));
  });

  it("says a day corrections list is the employment's, not the day's", () => {
    const markup = html(
      <CorrectionsSection
        t={en}
        language="en"
        corrections={aFullRegister().corrections}
        scopedToEmployment
      />,
    );

    expect(markup).toContain(escaped(en('attendance.notice.correctionScope')));
  });

  /**
   * A third permission, and therefore a third refusal.
   *
   * `attendance.import` gates the batches because their counts say how much of a customer's data
   * landed. A caller holding `attendance.read` and not that one must be told the section was
   * withheld — never that nothing was imported. And a batch record is a record of a *submission*,
   * not of a device: nothing here claims a reader is connected, silent or healthy.
   */
  it('names the import permission when only the batches were refused, and claims no device state', () => {
    expect(html(<ImportsSection t={en} language="en" imports={undefined} />)).toContain(
      escaped(en('attendance.notice.importsAreOwnPermission')),
    );
    expect(html(<ImportsSection t={en} language="en" imports={undefined} />)).not.toContain(
      escaped(en('attendance.label.noImports')),
    );

    const populated = html(
      <ImportsSection t={en} language="en" imports={aFullRegister().imports} />,
    );

    expect(populated).toContain('4120');
    expect(populated).toContain('4108');
    expect(populated).toContain(en('attendance.source.device'));
    expect(populated).toContain(escaped(en('attendance.notice.noDeviceStatus')));
  });

  it('states its boundaries once, at the foot of the page', () => {
    const markup = html(<RegisterBoundaries t={en} />);

    expect(markup).toContain(escaped(en('attendance.label.boundary.money')));
    expect(markup).toContain(escaped(en('admin.notice.readOnly')));
  });
});
