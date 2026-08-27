import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { leaveTranslator } from './locale';
import {
  DaysSection,
  RequestBoundaries,
  RequestNarrative,
  RequestSummary,
  typeOf,
} from './request';
import { ApprovalSection } from './approval';
import { ANNUAL, EMPLOYMENT_A } from './leave.fixture';
import { aRequestDetail, anUnapprovedChain } from './detail.fixture';

/**
 * One leave request, asserted against the markup.
 *
 * The assertions that matter most are the two the module's own contract insists on: a policy
 * requiring no approval names nobody, and the dates a request covers are the domain's day rows
 * rather than a range this screen expanded.
 */

const en = leaveTranslator('en');
const ar = leaveTranslator('ar');

const html = (node: ReactNode): string => renderToStaticMarkup(node);

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

const page = (t: typeof en, language: 'en' | 'ar'): string => {
  const detail = aRequestDetail();

  return [
    html(<RequestSummary t={t} language={language} detail={detail} />),
    html(<DaysSection t={t} request={detail.request} />),
    html(<ApprovalSection t={t} language={language} approvals={detail.approvals} />),
    html(<RequestNarrative t={t} language={language} request={detail.request} />),
    html(<RequestBoundaries t={t} />),
  ].join('\n');
};

describe('one leave request', () => {
  /** The dates are the domain's day rows, each with its own portion and its own two figures. */
  it('renders the dates the domain decided, not a range this screen expanded', () => {
    const markup = html(<DaysSection t={en} request={aRequestDetail().request} />);

    expect(markup).toContain('<bdi>2026-09-01</bdi>');
    expect(markup).toContain('<bdi>2026-09-02</bdi>');
    expect(markup).toContain('<bdi>2026-09-03</bdi>');
    expect(markup).toContain(en('leave.portion.full_day'));
    expect(markup).toContain(en('leave.label.expected'));
  });

  /**
   * Every duration is the published figure.
   *
   * The request's own total is `1440`, and the three day rows are `480` each. A screen that summed
   * the day rows would show `1440` too — and would go on doing so until a half-day or an amendment
   * made the two disagree. The assertion is that the total comes from the request.
   */
  it('renders the published total and never a sum of the day rows', () => {
    const detail = aRequestDetail();
    const markup = html(<RequestSummary t={en} language="en" detail={detail} />);

    expect(detail.request.totalMinutes).toBe(1440);
    expect(markup).toContain(minutesOf(en, 1440));
    expect(markup).toContain(minutesOf(en, 7200));
  });

  /** The contract's own instruction: no approver is named where nobody decided. */
  it('says no approval was required rather than naming a system approver', () => {
    const markup = html(<ApprovalSection t={en} language="en" approvals={anUnapprovedChain()} />);

    expect(markup).toContain(escaped(en('leave.notice.noApprovalRequired')));
    expect(markup).not.toContain('system:auto-approval');
    expect(markup).not.toContain(en('leave.label.approver'));
  });

  it('says the chain was withheld when it was refused, not that nobody decided', () => {
    const markup = html(<ApprovalSection t={en} language="en" approvals={undefined} />);

    expect(markup).toContain(escaped(en('admin.notice.sectionWithheld')));
    expect(markup).not.toContain(escaped(en('leave.notice.noApprovalRequired')));
    expect(markup).not.toContain(escaped(en('leave.notice.nothingDecidedYet')));
  });

  /** A chain that requires a decision and has none is not the same as one that required none. */
  it('says nobody has answered yet when a decision is still owed', () => {
    const markup = html(
      <ApprovalSection
        t={en}
        language="en"
        approvals={{ ...anUnapprovedChain(), approvalRequired: true, approvalsRequired: 2 }}
      />,
    );

    expect(markup).toContain(escaped(en('leave.notice.nothingDecidedYet')));
    expect(markup).not.toContain(escaped(en('leave.notice.noApprovalRequired')));
  });

  /**
   * The approval reference goes nowhere, and the screen says why.
   *
   * Leave records its own decisions and does not consume the approval port, so linking this to
   * `/approvals/[instanceId]` would invent a relationship the contracts do not establish.
   */
  it('shows the approval reference as an identifier and never links it to the approvals surface', () => {
    const markup = html(
      <ApprovalSection
        t={en}
        language="en"
        approvals={{ ...aRequestDetail().approvals!, approvalId: 'ap-1' }}
      />,
    );

    expect(markup).toContain('ap-1');
    expect(markup).not.toContain('/approvals/');
    expect(markup).toContain(escaped(en('leave.notice.approvalNotWorkflow')));
  });

  /** The requester's employment opens their standing — the workflow closing on an answer. */
  it('links the requester to the balance that explains their leave', () => {
    const markup = html(<RequestSummary t={en} language="en" detail={aRequestDetail()} />);

    expect(markup).toContain(
      attribute(`/leave/balances/${EMPLOYMENT_A}?lang=en&leaveTypeId=${ANNUAL}`),
    );
  });

  /** A name is Employment's to give, and is absent when the caller may not read the person. */
  it('says a person was not resolved rather than inventing a name', () => {
    const detail = aRequestDetail({ employment: undefined });
    const markup = html(<RequestSummary t={en} language="en" detail={detail} />);

    expect(markup).toContain(escaped(en('admin.label.notResolved')));
  });

  it('names the leave type from the configured list, and falls back to its identifier', () => {
    const detail = aRequestDetail();

    expect(typeOf(detail.types, ANNUAL)?.code).toBe('ANNUAL');
    expect(typeOf(undefined, ANNUAL)).toBeUndefined();
    expect(html(<RequestSummary t={en} language="en" detail={detail} />)).toContain('Annual leave');
    expect(
      html(<RequestSummary t={en} language="en" detail={aRequestDetail({ types: undefined })} />),
    ).toContain(ANNUAL);
  });

  it('leaks no catalogue key, in English as well as in Arabic', () => {
    for (const [t, language] of [
      [en, 'en'],
      [ar, 'ar'],
    ] as const) {
      const markup = page(t, language);

      expect(markup).not.toMatch(/leave\.(label|notice|state|kind|portion|decision)\./);
      expect(markup).not.toMatch(/admin\.(label|notice)\./);
    }
  });

  it('isolates every identifier, date and duration inside Arabic text', () => {
    const markup = page(ar, 'ar');

    expect(markup).toContain(`<bdi>2026-09-01</bdi>`);
    expect(markup).toContain(minutesOf(ar, 1440));
    expect(markup).toContain('<bdi>1 / 1</bdi>');
  });

  it('offers no control', () => {
    const markup = page(en, 'en');

    expect(markup).not.toContain('<button');
    expect(markup).not.toContain('<form');
    expect(markup).not.toContain('<input');
    expect(markup).not.toContain('<select');
  });

  /** The requester's own words are text somebody wrote, not a field. */
  it('shows the justification under its own heading, and omits the section when there is none', () => {
    const detail = aRequestDetail();
    const markup = html(<RequestNarrative t={en} language="en" request={detail.request} />);

    expect(markup).toContain('Family visit already booked.');

    const bare = { ...detail.request };
    delete (bare as { justification?: string }).justification;
    delete (bare as { reasonCode?: string }).reasonCode;

    expect(html(<RequestNarrative t={en} language="en" request={bare} />)).toBe('');
  });
});
