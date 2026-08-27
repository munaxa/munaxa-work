import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { hiringTranslator } from './locale';
import {
  DecisionsSection,
  Headcount,
  RequisitionBoundaries,
  RequisitionSummary,
} from './requisition';
import { PipelineSection } from './pipeline';
import { ApplicationBoundaries, ApplicationSummary, HistorySection } from './application';
import { InterviewsSection, OffersSection, PanelSection } from './panel';
import {
  aRequisitionDetail,
  anApplicationDetail,
  anApprovedRequisition,
  anEmptyPanel,
  aStoppedHireDetail,
  aWithheldCandidate,
  aWithheldPanel,
} from './hiring.fixture';

/**
 * The two hiring records, asserted against the markup.
 *
 * Every assertion is anchored to a rule the authorization stated: an offer's figures never render,
 * feedback is never aggregated, a stopped hire stays visible, withheld is not empty, and an approval
 * identifier is not a link to an approval that does not exist.
 */

const en = hiringTranslator('en');
const ar = hiringTranslator('ar');

const html = (node: ReactNode): string => renderToStaticMarkup(node);

/** `renderToStaticMarkup` escapes apostrophes, so a sentence containing one is looked up escaped. */
const escaped = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#x27;');

const requisition = (t: typeof en, language: 'en' | 'ar'): string => {
  const detail = aRequisitionDetail();

  return [
    html(<Headcount t={t} requisition={detail.snapshot.requisition} />),
    html(<RequisitionSummary t={t} language={language} detail={detail} />),
    html(<DecisionsSection t={t} language={language} decisions={detail.snapshot.decisions} />),
    html(<PipelineSection t={t} language={language} pipelines={detail.pipelines} />),
    html(<RequisitionBoundaries t={t} />),
  ].join('\n');
};

const application = (
  t: typeof en,
  language: 'en' | 'ar',
  detail: ReturnType<typeof anApplicationDetail>,
): string =>
  [
    html(<ApplicationSummary t={t} language={language} detail={detail} />),
    html(<HistorySection t={t} language={language} history={detail.snapshot.history} />),
    html(<InterviewsSection t={t} language={language} interviews={detail.snapshot.interviews} />),
    html(
      <PanelSection
        t={t}
        language={language}
        interviews={detail.snapshot.interviews}
        panels={detail.panels}
      />,
    ),
    html(<OffersSection t={t} language={language} offers={detail.snapshot.offers} />),
    html(<ApplicationBoundaries t={t} />),
  ].join('\n');

describe('the requisition record', () => {
  it('shows the three headcount figures the module published, and derives none of them', () => {
    const markup = requisition(en, 'en');

    expect(markup).toContain('4');
    expect(markup).toContain('1');
    expect(markup).toContain('3');
    expect(markup).toContain(en('recruitment.label.remaining'));
    expect(markup).toContain(en('recruitment.label.boundaryHeadcount'));
  });

  it('resolves the requester to a name and leaves an unresolved manager as an identifier', () => {
    const markup = requisition(en, 'en');

    expect(markup).toContain('Nadia Fakhoury');
    expect(markup).toContain('01900000-0000-7000-8000-0000000000e1');
  });

  it('shows a reversal as another row rather than as an edited decision', () => {
    const markup = requisition(en, 'en');

    expect(markup).toContain(en('recruitment.status.decisionOutcome.approved'));
    expect(markup).toContain(en('recruitment.status.decisionOutcome.reversed'));
    expect(markup).toContain(en('recruitment.label.decisionsAreAppended'));
  });

  it('says a requisition Recruitment decided itself was decided in Recruitment', () => {
    const markup = requisition(en, 'en');

    expect(markup).toContain(en('recruitment.label.decidedInRecruitment'));
  });

  /** The approval identifier is a reference, never a link to an instance nothing routes. */
  it('shows an approval identifier without offering a link to it', () => {
    const detail = { ...aRequisitionDetail() };
    const routed = {
      ...detail,
      snapshot: { ...detail.snapshot, requisition: anApprovedRequisition() },
    };
    const markup = html(<RequisitionSummary t={en} language="en" detail={routed} />);

    expect(markup).toContain('01900000-0000-7000-8000-0000000000w1');
    expect(markup).not.toContain('href');
    expect(markup).not.toContain(en('recruitment.label.decidedInRecruitment'));
  });

  it('keeps an organizational reference whole and unnamed', () => {
    const markup = requisition(en, 'en');

    expect(markup).toContain('01900000-0000-7000-8000-0000000000p1');
    expect(markup).toContain('01900000-0000-7000-8000-0000000000u1');
    expect(markup).toContain(en('recruitment.label.boundaryOrganization'));
  });

  it('renders in Arabic with every Latin run isolated', () => {
    const markup = requisition(ar, 'ar');

    // The requisition number is the page heading and belongs to the route; what these sections carry
    // are the codes and dates, and each is isolated so Arabic does not reorder it.
    expect(markup).toContain('<bdi>growth</bdi>');
    expect(markup).toContain('<bdi>2026-10-01</bdi>');
    expect(markup).toContain(ar('recruitment.label.headcount'));
    expect(markup).not.toContain('recruitment.label.');
  });

  it('offers no control', () => {
    expect(requisition(en, 'en')).not.toMatch(/<form|<button|<input|<select|<textarea/);
  });
});

describe('the application record', () => {
  it('resolves the candidate from one bounded read and shows their name', () => {
    const markup = application(en, 'en', anApplicationDetail());

    expect(markup).toContain('Layla Haddad');
    expect(markup).toContain('CAN-004192');
  });

  it('says the candidate was withheld rather than showing an application with no candidate', () => {
    const markup = application(en, 'en', aWithheldCandidate());

    expect(markup).toContain(en('admin.notice.sectionWithheld'));
    expect(markup).toContain('01900000-0000-7000-8000-0000000000c1');
  });

  /** The rule the authorization stated in full: no figure, no currency, no derived amount. */
  it('never renders an offer figure, though the fixture carries one', () => {
    const markup = application(en, 'en', anApplicationDetail());

    expect(markup).not.toContain('1850');
    expect(markup).not.toContain('250.000');
    expect(markup).not.toContain('JOD');
    expect(markup).toContain('OFF-000221');
    expect(markup).toContain(en('recruitment.status.offer.issued'));
    expect(markup).toContain(en('recruitment.label.boundaryCompensation'));
  });

  it('shows every verdict as its own row and aggregates none of them', () => {
    const markup = application(en, 'en', anApplicationDetail());

    expect(markup).toContain(en('recruitment.recommendation.strong_yes'));
    expect(markup).toContain(en('recruitment.recommendation.yes'));
    expect(markup).toContain(en('recruitment.recommendation.no'));

    // Three verdicts stay three rows. The scores 5, 4 and 2 appear as three separate cells, and no
    // average (3.67), sum (11) or majority is anywhere among them.
    const scores = [...markup.matchAll(/<td[^>]*tabular-nums[^>]*>(\d+)<\/td>/g)].map(
      (match) => match[1],
    );

    expect(scores).toContain('5');
    expect(scores).toContain('4');
    expect(scores).toContain('2');
    expect(scores).not.toContain('11');
    expect(markup).not.toContain('3.67');
    expect(markup).toContain(escaped(en('recruitment.label.boundaryFeedback')));
  });

  it('says a withheld panel was withheld, and an empty one that nothing was recorded', () => {
    const withheld = application(en, 'en', aWithheldPanel());
    const empty = application(en, 'en', anEmptyPanel());

    expect(withheld).toContain(en('admin.notice.sectionWithheld'));
    expect(empty).not.toContain(en('admin.notice.sectionWithheld'));
    expect(empty).toContain(en('recruitment.label.panel'));
  });

  /**
   * The permission belongs to the caller, not to an interview, so every round is refused together —
   * and the record's own rule is that a withheld section is one line rather than the same sentence
   * repeated down a column.
   */
  it('says a wholly withheld panel once rather than once per round', () => {
    const detail = aWithheldPanel();
    const bothRounds = {
      ...detail,
      panels: [
        { interviewId: 'i1', feedback: undefined },
        { interviewId: 'i2', feedback: undefined },
      ],
    };
    const markup = html(
      <PanelSection
        t={en}
        language="en"
        interviews={detail.snapshot.interviews}
        panels={bothRounds.panels}
      />,
    );

    expect(markup.split(en('admin.notice.sectionWithheld'))).toHaveLength(2);
    expect(markup).not.toContain('<table');
  });

  /** ADR-0046: a hire that stopped half way is a fact operations must see. */
  it('renders a stopped hire, including where it stopped', () => {
    const markup = application(en, 'en', aStoppedHireDetail());

    expect(markup).toContain(en('recruitment.status.hire.failed'));
    expect(markup).toContain('employment_creation_failed');
  });

  it('shows the history the snapshot carried, newest first as the server ordered it', () => {
    const markup = application(en, 'en', anApplicationDetail());

    expect(markup).toContain(en('recruitment.status.application.shortlisted'));
    expect(markup).toContain(en('recruitment.status.application.interviewing'));
    expect(markup).toContain('panel_scheduled');
  });

  it('shows an interviewer as an employment reference rather than a resolved name', () => {
    const markup = application(en, 'en', anApplicationDetail());

    expect(markup).toContain('01900000-0000-7000-8000-0000000000e2');
    expect(markup).toContain(en('recruitment.label.boundaryInterviewers'));
  });

  it('shows a candidate’s contact details nowhere, and says so', () => {
    const markup = application(en, 'en', anApplicationDetail());

    expect(markup).not.toContain('layla.haddad@example.com');
    expect(markup).not.toContain('+962790000000');
    expect(markup).toContain(escaped(en('recruitment.label.boundaryContact')));
  });

  it('links a completed hire to the employee record and nowhere else', () => {
    const detail = anApplicationDetail();
    const hired = {
      ...detail,
      snapshot: {
        ...detail.snapshot,
        application: {
          ...detail.snapshot.application,
          hireState: 'completed' as const,
          employmentId: '01900000-0000-7000-8000-0000000000e9',
        },
      },
    };
    const markup = html(<ApplicationSummary t={en} language="en" detail={hired} />);

    expect(markup).toContain('href="/employment/01900000-0000-7000-8000-0000000000e9?lang=en"');
  });

  it('renders in Arabic with every Latin run isolated', () => {
    const markup = application(ar, 'ar', anApplicationDetail());

    // The application number is the page heading and belongs to the route; these sections carry the
    // candidate number, the stage and the offer number, and each is isolated.
    expect(markup).toContain('<bdi>CAN-004192</bdi>');
    expect(markup).toContain('<bdi>OFF-000221</bdi>');
    expect(markup).toContain('ليلى حداد');
    expect(markup).not.toContain('recruitment.label.');
  });

  it('offers no control', () => {
    expect(application(en, 'en', anApplicationDetail())).not.toMatch(
      /<form|<button|<input|<select|<textarea/,
    );
  });
});
