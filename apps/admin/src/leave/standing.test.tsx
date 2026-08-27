import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { leaveTranslator } from './locale';
import { namesOf } from './frame';
import {
  BalancesSection,
  ProjectionSection,
  StandingBoundaries,
  StandingIdentity,
  TypeChooser,
  narrowedHref,
} from './standing';
import { AdjustmentsSection, EntitlementsSection, LedgerSection } from './movements';
import { RequestsSection } from './register';
import { standingAnsweredNothing } from './api';
import { ANNUAL, EMPLOYMENT_A, SICK, TYPES } from './leave.fixture';
import { aFullStanding, aRefusedStanding, anEmptyStanding } from './detail.fixture';

/**
 * One employment's leave standing.
 *
 * This is the file that guards the point of the slice: the ledger's before-and-after figures are
 * the server's, the projection is never calculated for a leave type nobody chose, and a balance
 * whose inputs moved says so.
 */

const en = leaveTranslator('en');
const ar = leaveTranslator('ar');

const html = (node: ReactNode): string => renderToStaticMarkup(node);

/** The leave-type names the pages build once from the read they already made. */
const names = namesOf(TYPES, 'en');

const attribute = (href: string): string => `href="${href.replaceAll('&', '&amp;')}"`;

const escaped = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#x27;');

/** A duration as the page renders it: isolated, and pinned left-to-right so a sign leads. */
const minutesOf = (t: typeof en, value: number): string =>
  `<bdi dir="ltr">${t('leave.label.minutes').replace('{minutes}', String(value))}</bdi>`;

const page = (
  t: typeof en,
  language: 'en' | 'ar',
  data: ReturnType<typeof aFullStanding>,
): string =>
  [
    html(
      <StandingIdentity t={t} language={language} standing={data} employmentId={EMPLOYMENT_A} />,
    ),
    html(
      <TypeChooser
        t={t}
        language={language}
        types={data.types}
        employmentId={EMPLOYMENT_A}
        selected={ANNUAL}
      />,
    ),
    html(<BalancesSection t={t} language={language} balances={data.balances} names={names} />),
    html(<ProjectionSection t={t} projection={data.projection} />),
    html(<LedgerSection t={t} language={language} ledger={data.ledger} />),
    html(<EntitlementsSection t={t} entitlements={data.entitlements} names={names} />),
    html(
      <AdjustmentsSection t={t} language={language} adjustments={data.adjustments} names={names} />,
    ),
    html(<RequestsSection t={t} language={language} requests={data.requests} />),
    html(<StandingBoundaries t={t} />),
  ].join('\n');

describe("one employment's leave standing", () => {
  /**
   * The reason this slice exists.
   *
   * Every ledger row shows the balance before the movement, the movement, and the balance after it
   * — all three published by the server on the entry itself. The fixture's second entry moves a
   * balance from 2,400 to 12,000 by 9,600, and the third takes it back to 7,200. A screen that
   * carried a running total would produce those numbers too, and would produce different ones the
   * first time a page boundary or a reversal broke the sequence.
   */
  it('renders the server-published balance before and after every movement', () => {
    const markup = html(<LedgerSection t={en} language="en" ledger={aFullStanding().ledger} />);

    expect(markup).toContain(minutesOf(en, 0));
    expect(markup).toContain(minutesOf(en, 2400));
    expect(markup).toContain(minutesOf(en, 12000));
    expect(markup).toContain(minutesOf(en, 7200));
    expect(markup).toContain(minutesOf(en, -4800));
    expect(markup).toContain(en('leave.label.balanceBefore'));
    expect(markup).toContain(en('leave.label.balanceAfter'));
  });

  /** The ledger says what caused each movement, in Leave's own vocabulary. */
  it('names what moved the balance and what caused it', () => {
    const markup = html(<LedgerSection t={en} language="en" ledger={aFullStanding().ledger} />);

    expect(markup).toContain(en('leave.kind.carry_in'));
    expect(markup).toContain(en('leave.kind.accrual'));
    expect(markup).toContain(en('leave.kind.consumption'));
    expect(markup).toContain(en('leave.source.accrual_run'));
    expect(markup).toContain(en('leave.source.request'));
    expect(markup).not.toContain('carry_in');
    expect(markup).not.toContain('accrual_run');
  });

  /** No leave type is chosen on the reader's behalf — the `runs[0]` defect in another module. */
  it('asks for a leave type rather than projecting the first one', () => {
    const markup = html(<ProjectionSection t={en} projection={undefined} />);

    expect(markup).toContain(escaped(en('leave.notice.chooseLeaveType')));
    expect(markup).not.toContain(en('leave.label.projectedAvailable'));
  });

  /** And when one is chosen, the projection is marked as a projection. */
  it('marks a projection as a projection', () => {
    const markup = html(<ProjectionSection t={en} projection={aFullStanding().projection} />);

    expect(markup).toContain(escaped(en('leave.notice.projectionAssumes')));
    expect(markup).toContain(minutesOf(en, 3200));
    expect(markup).toContain(minutesOf(en, 10400));
  });

  it('tells a refused projection from a missing one', () => {
    expect(html(<ProjectionSection t={en} projection={{ kind: 'refused' }} />)).toContain(
      escaped(en('leave.notice.balanceIsOwnPermission')),
    );
    expect(html(<ProjectionSection t={en} projection={{ kind: 'missing' }} />)).toContain(
      escaped(en('leave.label.noBalances')),
    );
  });

  /** A figure that may be behind its own ledger says so, and is not shown as a calculation time. */
  it('says a balance is outstanding rather than showing a stale calculation time', () => {
    const markup = html(
      <BalancesSection
        t={en}
        language="en"
        balances={{
          items: [
            {
              ...aFullStanding().balances!.items[0]!,
              inputsChangedAt: new Date('2026-08-25T04:00:00.000Z'),
            },
          ],
          total: 1,
        }}
        names={names}
      />,
    );

    expect(markup).toContain(en('leave.label.stale'));
    expect(markup).toContain(escaped(en('leave.notice.staleBalance')));
  });

  /** A negative balance is shown as negative. Nothing clamps it. */
  it('renders a negative available balance without clamping it', () => {
    const balances = aFullStanding().balances!;
    const markup = html(
      <BalancesSection
        t={en}
        language="en"
        balances={{
          items: [{ ...balances.items[0]!, availableMinutes: -480 }],
          total: 1,
        }}
        names={names}
      />,
    );

    expect(markup).toContain(minutesOf(en, -480));
  });

  /** The two permissions are visibly separate on this page too. */
  it('names the balance permission for the reads it gates, and withholds the others plainly', () => {
    const markup = page(en, 'en', aRefusedStanding());

    expect(markup).toContain(escaped(en('leave.notice.balanceIsOwnPermission')));
    expect(markup).toContain(escaped(en('admin.notice.sectionWithheld')));
    expect(markup).not.toContain(escaped(en('leave.label.noLedger')));
    expect(markup).not.toContain(escaped(en('leave.label.noBalances')));
  });

  it('says the register answered nothing only when not one read answered', () => {
    expect(standingAnsweredNothing(aRefusedStanding())).toBe(true);
    expect(standingAnsweredNothing(anEmptyStanding())).toBe(false);
    expect(standingAnsweredNothing(aFullStanding())).toBe(false);
  });

  it('gives each empty section its own sentence', () => {
    const markup = page(en, 'en', anEmptyStanding());

    for (const key of [
      'leave.label.noBalances',
      'leave.label.noLedger',
      'leave.label.noEntitlements',
      'leave.label.noAdjustments',
      'leave.label.noRequests',
    ]) {
      expect(markup).toContain(escaped(en(key)));
    }
  });

  /** The chooser is links, because a control that needed JavaScript would do nothing here. */
  it('offers every leave type as a real address, and a way back to all of them', () => {
    const markup = html(
      <TypeChooser
        t={en}
        language="en"
        types={aFullStanding().types}
        employmentId={EMPLOYMENT_A}
        selected={ANNUAL}
      />,
    );

    expect(markup).toContain(attribute(narrowedHref(EMPLOYMENT_A, 'en', undefined)));
    expect(markup).toContain(attribute(narrowedHref(EMPLOYMENT_A, 'en', SICK)));
    expect(markup).not.toContain('<select');
    expect(markup).not.toContain('<button');
  });

  it('leaks no catalogue key, in English as well as in Arabic', () => {
    for (const [t, language] of [
      [en, 'en'],
      [ar, 'ar'],
    ] as const) {
      const markup = page(t, language, aFullStanding());

      expect(markup).not.toMatch(/leave\.(label|notice|state|kind|source|grant|accrual)\./);
      expect(markup).not.toMatch(/admin\.(label|notice)\./);
    }
  });

  it('isolates every identifier and figure inside Arabic text, and never truncates one', () => {
    const markup = page(ar, 'ar', aFullStanding());

    expect(markup).toContain(`<bdi>${ANNUAL}</bdi>`);
    expect(markup).toContain(minutesOf(ar, 7200));
    expect(markup).toContain('<bdi>3 / 1204</bdi>');
    expect(markup).not.toContain('01900000…');
  });

  /**
   * The bidi defect a `<bdi>` alone does not fix.
   *
   * A leading minus is a *neutral* character: inside a right-to-left paragraph it takes the
   * paragraph's direction and lands after the digits, so `-480 دقيقة` renders as `480- دقيقة` — a
   * deficit that reads as a credit. Pinning the isolate to `ltr` keeps the sign in front.
   */
  it('keeps the sign in front of a negative duration in Arabic', () => {
    const balances = aFullStanding().balances!;
    const markup = html(
      <BalancesSection
        t={ar}
        language="ar"
        balances={{ items: [{ ...balances.items[0]!, availableMinutes: -480 }], total: 1 }}
        names={names}
      />,
    );

    expect(markup).toContain('<bdi dir="ltr">-480 ');
    expect(markup).not.toContain('<bdi>-480 ');
  });

  /** A leave type is named from the read the page already made, and never looked up per row. */
  it('names a leave type from the read the page already made, keeping the identifier under it', () => {
    const markup = html(
      <BalancesSection t={en} language="en" balances={aFullStanding().balances} names={names} />,
    );

    expect(markup).toContain('Annual leave');
    expect(markup).toContain('Sick leave');
    expect(markup).toContain(`<bdi>${ANNUAL}</bdi>`);
  });

  /**
   * Free text is the one value on these screens whose direction is not the page's.
   *
   * An English note rendered bare inside an Arabic table has its trailing full stop moved to the
   * front, because punctuation is neutral and takes the paragraph's direction. Isolating the run
   * lets its own first strong character decide.
   */
  it("isolates a person's own words so an English note keeps its full stop", () => {
    const markup = html(
      <AdjustmentsSection
        t={ar}
        language="ar"
        adjustments={aFullStanding().adjustments}
        names={names}
      />,
    );

    expect(markup).toContain('<bdi>Two days granted for the relocation weekend.</bdi>');
  });

  it('offers no control anywhere on the page', () => {
    const markup = page(en, 'en', aFullStanding());

    expect(markup).not.toContain('<button');
    expect(markup).not.toContain('<form');
    expect(markup).not.toContain('<input');
    expect(markup).not.toContain('<select');
  });

  it('records that the as-of read cannot be typed from the published contracts', () => {
    expect(html(<StandingBoundaries t={en} />)).toContain(
      escaped(en('leave.notice.asOfNotPublished')),
    );
  });
});
