import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { attendanceTranslator } from './locale';
import { DayBoundaries, DayFigures, DayIdentity, DayProvenance, ExceptionsSection } from './day';
import { CorrectionsSection, EventsSection, replacedIn } from './punches';
import {
  EVENT_ORIGINAL,
  EVENT_REPLACEMENT,
  aDayDetail,
  anAttendanceDay,
  anException,
  events,
} from './attendance.fixture';

/**
 * One attendance day, asserted against the markup.
 *
 * The assertions that matter most are the two the brief singles out: a superseded punch stays
 * visible and marked, and every verdict on the page is the module's own rather than something this
 * screen worked out.
 */

const en = attendanceTranslator('en');
const ar = attendanceTranslator('ar');

const html = (node: ReactNode): string => renderToStaticMarkup(node);

const escaped = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#x27;');

const page = (t: typeof en, language: 'en' | 'ar'): string => {
  const detail = aDayDetail();

  return [
    html(
      <DayIdentity
        t={t}
        language={language}
        attendanceDay={detail.snapshot.day}
        employment={detail.employment}
      />,
    ),
    html(<DayFigures t={t} language={language} attendanceDay={detail.snapshot.day} />),
    html(<ExceptionsSection t={t} exceptions={detail.snapshot.exceptions} />),
    html(<EventsSection t={t} language={language} events={detail.snapshot.events} />),
    html(<CorrectionsSection t={t} language={language} corrections={detail.corrections} />),
    html(<DayProvenance t={t} language={language} attendanceDay={detail.snapshot.day} />),
    html(<DayBoundaries t={t} />),
  ].join('\n');
};

describe('one attendance day', () => {
  /**
   * The brief's requirement, and the module's own reason for returning them.
   *
   * A punch replaced by a correction stays in the list and is marked as replaced, with the
   * identifier of the punch that replaced it; the replacement is marked with what it supersedes.
   * Neither is filtered out, and nothing here decides which of the two is correct.
   */
  it('keeps a superseded punch visible and marks it from both ends', () => {
    const markup = html(<EventsSection t={en} language="en" events={events} />);

    expect(markup).toContain(EVENT_ORIGINAL);
    expect(markup).toContain(EVENT_REPLACEMENT);
    expect(markup).toContain(en('attendance.label.replaced'));
    expect(markup).toContain(en('attendance.label.supersedes'));
    expect(markup).toContain(en('attendance.label.current'));
    expect(escaped(en('attendance.notice.eventsIncludeSuperseded'))).toBeTruthy();
    expect(markup).toContain(escaped(en('attendance.notice.eventsIncludeSuperseded')));
  });

  /**
   * The relation is the server's, read in the direction it was not published in.
   *
   * The contract states it from one end only — a superseding event carries `supersedesEventId` —
   * and the module returns every event on the day, so the reverse index is complete by
   * construction. It is not a rule about which punch wins.
   */
  it('reads the supersession relation from the snapshot, not from a rule of its own', () => {
    const replaced = replacedIn(events);

    expect(replaced.get(EVENT_ORIGINAL)).toBe(EVENT_REPLACEMENT);
    expect(replaced.get(EVENT_REPLACEMENT)).toBeUndefined();
    expect(replacedIn([])).toEqual(new Map());
  });

  /** Every punch keeps its own three timestamps and its own skew. None is derived. */
  it('renders the punch evidence the module published', () => {
    const markup = html(<EventsSection t={en} language="en" events={events} />);

    expect(markup).toContain(en('attendance.event.clock_in'));
    expect(markup).toContain(en('attendance.event.clock_out'));
    expect(markup).toContain(en('attendance.source.device'));
    expect(markup).toContain(en('attendance.source.correction'));
    expect(markup).toContain(en('attendance.source.mobile'));
    expect(markup).toContain('TERM-04');
    expect(markup).toContain(en('attendance.label.capturedOffline'));
    expect(markup).toContain('47 s');
  });

  /**
   * Expected and worked are two published figures side by side, never a comparison.
   *
   * The fixture's day expects 480 minutes and records 466. A screen that printed "14 minutes short"
   * would be deciding something the module deliberately expresses as an exception instead.
   */
  it('shows expected beside worked without comparing them', () => {
    const markup = html(<DayFigures t={en} language="en" attendanceDay={anAttendanceDay()} />);

    expect(markup).toContain('480 min');
    expect(markup).toContain('466 min');
    expect(markup).not.toContain('14 min');
    expect(markup).toContain(escaped(en('attendance.notice.minutesAsPublished')));
  });

  /** The verdict is the module's sentence, its severity and its minutes. */
  it("renders the module's verdict rather than one of its own", () => {
    const markup = html(
      <ExceptionsSection
        t={en}
        exceptions={[
          anException(),
          anException({ exceptionId: 'x2', kind: 'undertime', severity: 'blocking', minutes: 14 }),
        ]}
      />,
    );

    expect(markup).toContain(en('attendance.exception.late_arrival'));
    expect(markup).toContain(en('attendance.exception.undertime'));
    expect(markup).toContain(en('attendance.severity.blocking'));
    expect(markup).toContain('17 min');
    expect(markup).toContain(escaped(en('attendance.notice.verdictsAreTheDomains')));
  });

  /** An exception with no minutes shows the absence, never a zero. */
  it('renders an absent minutes figure as absent', () => {
    const bare = { ...anException() };
    delete (bare as { minutes?: number }).minutes;

    expect(html(<ExceptionsSection t={en} exceptions={[bare]} />)).toContain('—');
  });

  /** All three leave states, and the one that must never be read as "no leave". */
  it('renders each leave state distinctly on the day', () => {
    for (const state of ['none', 'applied', 'unknown'] as const) {
      const markup = html(
        <DayIdentity
          t={en}
          language="en"
          attendanceDay={anAttendanceDay({ leaveState: state })}
          employment={aDayDetail().employment}
        />,
      );

      expect(markup).toContain(en(`attendance.leave.${state}`));
    }
  });

  it('says a person was not resolved rather than inventing a name', () => {
    const markup = html(
      <DayIdentity t={en} language="en" attendanceDay={anAttendanceDay()} employment={undefined} />,
    );

    expect(markup).toContain(escaped(en('admin.label.notResolved')));
  });

  it('says the corrections were withheld when refused, not that there are none', () => {
    const markup = html(<CorrectionsSection t={en} language="en" corrections={undefined} />);

    expect(markup).toContain(escaped(en('admin.notice.sectionWithheld')));
    expect(markup).not.toContain(escaped(en('attendance.label.noCorrections')));
  });

  /** A correction's justification is a person's own words, isolated so its language decides. */
  it("isolates a requester's own words inside an Arabic table", () => {
    const markup = html(
      <CorrectionsSection t={ar} language="ar" corrections={aDayDetail().corrections} />,
    );

    expect(markup).toContain(
      '<bdi>The gate terminal queued for fifteen minutes; the guard log confirms it.</bdi>',
    );
  });

  it('leaks no catalogue key, in English as well as in Arabic', () => {
    for (const [t, language] of [
      [en, 'en'],
      [ar, 'ar'],
    ] as const) {
      const markup = page(t, language);

      expect(markup).not.toMatch(
        /attendance\.(label|notice|exception|day|severity|leave|event|source|correction)\./,
      );
      expect(markup).not.toMatch(/admin\.(label|notice)\./);
    }
  });

  /** Every duration is isolated and pinned left-to-right, so a signed figure keeps its sign. */
  it('pins durations left to right inside Arabic text', () => {
    const markup = html(<DayFigures t={ar} language="ar" attendanceDay={anAttendanceDay()} />);

    expect(markup).toContain('<bdi dir="ltr">480 ');
    expect(markup).not.toContain('<bdi>480 ');
  });

  it('offers no control', () => {
    const markup = page(en, 'en');

    expect(markup).not.toContain('<button');
    expect(markup).not.toContain('<form');
    expect(markup).not.toContain('<input');
    expect(markup).not.toContain('<select');
  });

  /** What makes a disputed day explainable, shown rather than hidden. */
  it('shows how the figure was reached', () => {
    const markup = html(<DayProvenance t={en} language="en" attendanceDay={anAttendanceDay()} />);

    expect(markup).toContain('sha256:9f2c');
    expect(markup).toContain(en('attendance.label.calculationVersion'));
  });
});
