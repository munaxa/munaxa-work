import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { hiringTranslator, orderedStatuses } from './locale';
import {
  HiringOverview,
  NothingReadable,
  RequisitionsSection,
  VacanciesSection,
  WorkspaceBoundaries,
  answeredNothing,
} from './workspace';
import { ApplicationsSection, CandidatesSection, PipelineSection } from './pipeline';
import { aFullWorkspace, aPipeline, aRefusedWorkspace, anEmptyWorkspace } from './hiring.fixture';

/**
 * The hiring workspace, asserted against the markup rather than a description of it.
 *
 * Each assertion is anchored to a finding the slice investigation stated, so none can come back
 * quietly. The three that matter most are the three-state distinction, the server's own totals, and
 * the absence of any candidate name in a list that would otherwise resolve one per row.
 */

const en = hiringTranslator('en');
const ar = hiringTranslator('ar');

const html = (node: ReactNode): string => renderToStaticMarkup(node);

const workspace = (
  t: typeof en,
  language: 'en' | 'ar',
  hiring: ReturnType<typeof aFullWorkspace>,
): string =>
  [
    html(<HiringOverview t={t} hiring={hiring} />),
    html(<RequisitionsSection t={t} language={language} requisitions={hiring.requisitions} />),
    html(<VacanciesSection t={t} language={language} vacancies={hiring.vacancies} />),
    html(<PipelineSection t={t} language={language} pipelines={hiring.pipelines} />),
    html(<ApplicationsSection t={t} language={language} applications={hiring.applications} />),
    html(<CandidatesSection t={t} language={language} candidates={hiring.candidates} />),
    html(<WorkspaceBoundaries t={t} />),
  ].join('\n');

describe('the hiring workspace', () => {
  /** The assertion the whole screen turns on. */
  /**
   * The one sentence that replaces the whole screen when nothing answered.
   *
   * Four tiles and five headings each carrying the same apology reads as a broken screen rather
   * than a locked one — the finding the Employee Record's verification settled.
   */
  it('says the refusal once when nothing answered, and not once per section', () => {
    expect(answeredNothing(aRefusedWorkspace())).toBe(true);
    expect(answeredNothing(anEmptyWorkspace())).toBe(false);

    const markup = html(<NothingReadable t={en} />);

    expect(markup).toContain(en('recruitment.label.nothingReadable'));
    expect(markup).toContain(en('admin.notice.notSignedIn'));
    expect(markup.split(en('admin.notice.notSignedIn'))).toHaveLength(2);
  });

  /** A section refused on its own — its neighbours answered — still says so in its own place. */
  it('says a refused section was withheld, and an empty one that there is nothing', () => {
    const withheld = workspace(en, 'en', aRefusedWorkspace());
    const nothing = workspace(en, 'en', anEmptyWorkspace());

    expect(withheld).toContain(en('admin.notice.sectionWithheld'));
    expect(withheld).not.toContain(en('recruitment.label.noRequisitions'));

    expect(nothing).toContain(en('recruitment.label.noRequisitions'));
    expect(nothing).toContain(en('recruitment.label.noApplications'));
    expect(nothing).not.toContain(en('admin.notice.sectionWithheld'));
  });

  it('carries no apology on a tile: a refused total is a dash and nothing else', () => {
    const markup = html(<HiringOverview t={en} hiring={aRefusedWorkspace()} />);

    expect(markup).not.toContain(en('admin.notice.sectionWithheld'));
    expect(markup).toContain('—');
  });

  it('shows the server total beside the page length, never instead of it', () => {
    const markup = workspace(en, 'en', aFullWorkspace());

    expect(markup).toContain('412');
    expect(markup).toContain('176');
    expect(markup).toContain('26');
  });

  /**
   * The N+1 the investigation named.
   *
   * `ApplicationView` carries no candidate name, and resolving one per row is an unbounded read on
   * a page of four hundred applicants. The list says so instead.
   */
  it('shows no candidate name in the applications list, and says where the name is', () => {
    const markup = html(
      <ApplicationsSection t={en} language="en" applications={aFullWorkspace().applications} />,
    );

    expect(markup).not.toContain('Layla Haddad');
    expect(markup).toContain(en('recruitment.label.namesOnTheRecord'));
  });

  it('renders a hire state on an application row, including one that stopped', () => {
    const markup = workspace(en, 'en', aFullWorkspace());

    expect(markup).toContain(en('recruitment.label.hireState'));
  });

  it('names every status in words, never by colour alone', () => {
    const markup = workspace(en, 'en', aFullWorkspace());

    expect(markup).toContain(en('recruitment.status.requisition.open'));
    expect(markup).toContain(en('recruitment.status.vacancy.published'));
    expect(markup).toContain(en('recruitment.status.candidate.active'));
    expect(markup).toContain(en('recruitment.status.application.interviewing'));
  });

  it('isolates every identifier and code so Arabic does not reorder it', () => {
    const markup = workspace(ar, 'ar', aFullWorkspace());

    expect(markup).toContain('<bdi>REQ-000417</bdi>');
    expect(markup).toContain('<bdi>APP-009913</bdi>');
    expect(markup).toContain('<bdi>referral</bdi>');
  });

  it('renders the Arabic catalogue rather than falling back to English', () => {
    const markup = workspace(ar, 'ar', aFullWorkspace());

    expect(markup).toContain(ar('recruitment.label.requisitions'));
    expect(markup).toContain('ممرض أول');
    expect(markup).not.toContain('recruitment.label.');
  });

  it('opens a requisition and an application, and carries the language with it', () => {
    const markup = workspace(en, 'ar', aFullWorkspace());

    expect(markup).toContain(
      'href="/recruitment/requisitions/01900000-0000-7000-8000-0000000000r1?lang=ar"',
    );
    expect(markup).toContain(
      'href="/recruitment/applications/01900000-0000-7000-8000-0000000000a1?lang=ar"',
    );
  });

  it('offers no control: no form, button or input anywhere', () => {
    const markup = workspace(en, 'en', aFullWorkspace());

    expect(markup).not.toMatch(/<form|<button|<input|<select|<textarea/);
  });

  /**
   * A column of identifiers nobody can read is width the headcount figures need.
   *
   * The position a requisition names has no reachable read by identifier, so it stays an identifier
   * — but a list of them, all alike, belongs on the requisition record where there is one of it.
   * The employee directory made the same call.
   */
  it('keeps the position off the list and shortens no identifier anywhere', () => {
    const markup = workspace(en, 'en', aFullWorkspace());

    expect(markup).not.toContain('01900000-0000-7000-8000-0000000000p1');
    expect(markup).not.toContain('01900000…');
  });

  /** The page count and the total are one run, so Arabic cannot render `5 / 26` as `26 / 5`. */
  it('keeps the page count and the total in one isolated run', () => {
    expect(workspace(ar, 'ar', aFullWorkspace())).toContain('<bdi>1 / 26</bdi>');
  });
});

describe('the pipeline', () => {
  it('shows the server count for every stage it reported, and the server total', () => {
    const markup = html(
      <PipelineSection t={en} language="en" pipelines={aFullWorkspace().pipelines} />,
    );

    expect(markup).toContain('176');
    expect(markup).toContain('118');
    expect(markup).toContain('40');
    expect(markup).toContain(en('recruitment.status.application.shortlisted'));
  });

  /** The stages must read in the module's order, not the order the counts happen to sort in. */
  it('orders the stages as Recruitment declares them, never by how many are in each', () => {
    expect(orderedStatuses(aPipeline().countsByStatus)).toEqual([
      'received',
      'screening',
      'shortlisted',
      'interviewing',
      'offered',
    ]);
  });

  it('keeps a status the catalogue has not heard of rather than dropping its count', () => {
    expect(orderedStatuses({ interviewing: 2, invented_stage: 7 })).toEqual([
      'interviewing',
      'invented_stage',
    ]);
  });

  it('shows no stage the server did not report, and turns no absence into a nought', () => {
    const markup = html(
      <PipelineSection t={en} language="en" pipelines={aFullWorkspace().pipelines} />,
    );

    expect(markup).not.toContain(en('recruitment.status.application.withdrawn'));
    expect(markup).not.toContain(`${en('recruitment.status.application.hired')} <bdi>0</bdi>`);
  });

  it('says a refused pipeline was withheld rather than showing it as empty', () => {
    const markup = html(
      <PipelineSection
        t={en}
        language="en"
        pipelines={[
          { vacancy: aFullWorkspace().vacancies?.items[0] as never, pipeline: undefined },
        ]}
      />,
    );

    expect(markup).toContain(en('admin.notice.sectionWithheld'));
    expect(markup).not.toContain(en('recruitment.label.noApplications'));
  });

  it('computes nothing: no percentage sign and no conversion rate anywhere', () => {
    const markup = html(
      <PipelineSection t={en} language="en" pipelines={aFullWorkspace().pipelines} />,
    );

    expect(markup).not.toContain('%');
  });
});
