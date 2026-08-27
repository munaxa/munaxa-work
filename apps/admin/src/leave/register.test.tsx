import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { leaveTranslator } from './locale';
import { namesOf } from './frame';
import {
  BalancesSection,
  LeaveOverview,
  ReconciliationSection,
  RegisterBoundaries,
  RequestsSection,
  standingHref,
} from './register';
import { AccrualRunsSection, PoliciesSection, TypesSection } from './configuration';
import { registerAnsweredNothing } from './api';
import {
  ANNUAL,
  EMPLOYMENT_A,
  EMPLOYMENT_B,
  EMPLOYMENT_C,
  REQUEST_A,
  REQUEST_B,
  TYPES,
  aBalanceWithheldRegister,
  aFullRegister,
  aRefusedRegister,
  anEmptyRegister,
} from './leave.fixture';

/**
 * The leave register, asserted against the markup rather than a description of it.
 *
 * Each assertion is anchored to a finding the second slice investigation stated about the screen
 * this replaced, so none of them can come back quietly.
 */

const en = leaveTranslator('en');
const ar = leaveTranslator('ar');

const html = (node: ReactNode): string => renderToStaticMarkup(node);

/** The leave-type names the pages build once from the read they already made. */
const names = namesOf(TYPES, 'en');

/** `renderToStaticMarkup` escapes apostrophes, so a sentence containing one is looked up escaped. */
/** An `href` as it lands in an attribute: only `&` is escaped there, not the quotes around it. */
const attribute = (href: string): string => `href="${href.replaceAll('&', '&amp;')}"`;

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
    html(<LeaveOverview t={t} dashboard={data.dashboard} />),
    html(<RequestsSection t={t} language={language} requests={data.requests} />),
    html(<BalancesSection t={t} language={language} balances={data.balances} names={names} />),
    html(<ReconciliationSection t={t} language={language} reconciliation={data.reconciliation} />),
    html(<TypesSection t={t} language={language} types={data.types} />),
    html(<PoliciesSection t={t} language={language} policies={data.policies} />),
    html(<AccrualRunsSection t={t} language={language} runs={data.accrualRuns} />),
  ].join('\n');

describe('the leave register', () => {
  /** The finding: nothing on the leave screen opened, so a request could be listed and never read. */
  it('opens every request, not just the first', () => {
    const markup = html(
      <RequestsSection t={en} language="en" requests={aFullRegister().requests} />,
    );

    expect(markup).toContain(`href="/leave/requests/${REQUEST_A}?lang=en"`);
    expect(markup).toContain(`href="/leave/requests/${REQUEST_B}?lang=en"`);
  });

  /** Every balance opens the standing that produced it, with its own leave type already chosen. */
  it('opens every balance at its own leave type', () => {
    const markup = html(
      <BalancesSection t={en} language="en" balances={aFullRegister().balances} names={names} />,
    );

    expect(markup).toContain(attribute(standingHref(EMPLOYMENT_A, 'en', ANNUAL)));
    expect(markup).toContain(
      attribute(`/leave/balances/${EMPLOYMENT_C}?lang=en&leaveTypeId=${ANNUAL}`),
    );
  });

  /** The finding: five rows of two hundred and sixty-eight, with nothing saying so. */
  it('reports the server total beside the rows on the page, never the row count', () => {
    const markup = register(en, 'en', aFullRegister());

    expect(markup).toContain('3 / 268');
    expect(markup).toContain('3 / 823');
  });

  it('says the refusal once when nothing answered, and not once per section', () => {
    expect(registerAnsweredNothing(aRefusedRegister())).toBe(true);
    expect(registerAnsweredNothing(anEmptyRegister())).toBe(false);
    expect(registerAnsweredNothing(aBalanceWithheldRegister())).toBe(false);
  });

  it('says a refused section was withheld, and an empty one that there is nothing', () => {
    const withheld = register(en, 'en', aRefusedRegister());
    const nothing = register(en, 'en', anEmptyRegister());

    expect(withheld).toContain(escaped(en('admin.notice.sectionWithheld')));
    expect(withheld).not.toContain(escaped(en('leave.label.noRequests')));
    expect(nothing).toContain(escaped(en('leave.label.noRequests')));
    expect(nothing).toContain(escaped(en('leave.label.noBalances')));
    expect(nothing).not.toContain(escaped(en('admin.notice.sectionWithheld')));
  });

  /**
   * The two permissions, kept apart on one page.
   *
   * A caller holding `leave.read` and not `leave.balance.read` must see the requests and be told the
   * balances were withheld — never that no balance has been calculated.
   */
  it('names the balance permission when only the balance reads were refused', () => {
    const markup = register(en, 'en', aBalanceWithheldRegister());

    expect(markup).toContain(escaped(en('leave.notice.balanceIsOwnPermission')));
    expect(markup).not.toContain(escaped(en('leave.label.noBalances')));
    expect(markup).toContain(`href="/leave/requests/${REQUEST_A}?lang=en"`);
  });

  /** An empty register is not eight repetitions of the same sentence. */
  it('gives each empty section its own sentence', () => {
    const markup = register(en, 'en', anEmptyRegister());
    const sentences = [
      en('leave.label.noRequests'),
      en('leave.label.noBalances'),
      en('leave.label.noneAwaiting'),
      en('leave.label.noTypes'),
      en('leave.label.noPolicies'),
      en('leave.label.noAccrualRuns'),
    ];

    expect(new Set(sentences).size).toBe(sentences.length);
    for (const sentence of sentences) expect(markup).toContain(escaped(sentence));
  });

  /** The finding: raw enumeration values leaked into the page in both languages. */
  it('translates every status vocabulary rather than showing the stored value', () => {
    const markup = register(en, 'en', aFullRegister());

    expect(markup).toContain(en('leave.state.pending_approval'));
    expect(markup).toContain(en('leave.basis.working_days'));
    expect(markup).toContain(en('leave.accrual.monthly'));
    expect(markup).toContain(en('leave.carryOver.capped_minutes'));
    expect(markup).toContain(en('leave.unit.days'));
    expect(markup).not.toContain('pending_approval');
    expect(markup).not.toContain('working_days');
    expect(markup).not.toContain('capped_minutes');
  });

  /** The Attendance defect, which must not be copied: a raw catalogue key on the page. */
  it('leaks no catalogue key, in English as well as in Arabic', () => {
    for (const [t, language] of [
      [en, 'en'],
      [ar, 'ar'],
    ] as const) {
      const markup = register(t, language, aFullRegister());

      expect(markup).not.toMatch(/leave\.(label|notice|state|kind|basis|accrual)\./);
      expect(markup).not.toMatch(/admin\.(label|notice)\./);
    }
  });

  /**
   * The finding: `01900000…` twelve times over, and in Arabic with the ellipsis leading.
   *
   * An employment is rendered whole and inside a `<bdi>`, so three employments that share a UUIDv7
   * timestamp prefix stay three.
   */
  it('renders an employment in full, isolated, and never truncated', () => {
    const markup = html(
      <RequestsSection t={ar} language="ar" requests={aFullRegister().requests} />,
    );

    expect(markup).toContain(`<bdi>${EMPLOYMENT_A}</bdi>`);
    expect(markup).toContain(`<bdi>${EMPLOYMENT_B}</bdi>`);
    expect(markup).toContain(`<bdi>${EMPLOYMENT_C}</bdi>`);
    expect(markup).not.toContain('01900000…');
  });

  /** A ratio split across two isolated runs renders reversed inside an Arabic paragraph. */
  it('isolates a shown-of-total ratio as one run, not two', () => {
    const markup = html(
      <RequestsSection t={ar} language="ar" requests={aFullRegister().requests} />,
    );

    expect(markup).toContain('<bdi>3 / 268</bdi>');
  });

  it('offers no control, and says the recalculation is an API call', () => {
    const markup = register(en, 'en', aFullRegister());

    expect(markup).not.toContain('<button');
    expect(markup).not.toContain('<form');
    expect(markup).not.toContain('<input');
    expect(markup).toContain(escaped(en('leave.notice.recalculationIsApi')));
  });

  it('states its boundaries once, at the foot of the page', () => {
    const markup = html(<RegisterBoundaries t={en} />);

    expect(markup).toContain(escaped(en('leave.label.noMoney')));
    expect(markup).toContain(escaped(en('admin.notice.readOnly')));
  });
});
