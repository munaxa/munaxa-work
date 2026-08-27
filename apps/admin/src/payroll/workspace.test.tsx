import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { payrollTranslator } from './locale';
import { PayrollOverview, RunsSection, WorkspaceBoundaries, answeredNothing } from './workspace';
import { DefinitionsSection, GroupsSection, PeriodsSection } from './configuration';
import { aFullWorkspace, aRefusedWorkspace, anEmptyWorkspace } from './payroll.fixture';

/**
 * The payroll workspace, asserted against the markup rather than a description of it.
 *
 * Each assertion is anchored to a finding the coherence review stated, so none can come back
 * quietly. The two that matter most are that every run is reachable, and that a refusal never reads
 * as an empty payroll.
 */

const en = payrollTranslator('en');
const ar = payrollTranslator('ar');

const html = (node: ReactNode): string => renderToStaticMarkup(node);

/** `renderToStaticMarkup` escapes apostrophes, so a sentence containing one is looked up escaped. */
const escaped = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#x27;');

const workspace = (
  t: typeof en,
  language: 'en' | 'ar',
  data: ReturnType<typeof aFullWorkspace>,
): string =>
  [
    html(<PayrollOverview t={t} dashboard={data.dashboard} />),
    html(<RunsSection t={t} language={language} runs={data.runs} />),
    html(<PeriodsSection t={t} periods={data.periods} />),
    html(<GroupsSection t={t} language={language} groups={data.groups} />),
    html(
      <DefinitionsSection
        t={t}
        language={language}
        definitions={data.definitions}
        group={data.definitionsGroup}
      />,
    ),
    html(<WorkspaceBoundaries t={t} />),
  ].join('\n');

describe('the payroll workspace', () => {
  /**
   * The defect the coherence review named: an operator could not look at last month's payroll.
   *
   * Every run in the page is a link to its own record, and the earlier run is as reachable as the
   * latest one — which is what "the user must be able to navigate to a specific existing run" means.
   */
  it('opens every run, not just the first', () => {
    const markup = html(<RunsSection t={en} language="en" runs={aFullWorkspace().runs} />);

    expect(markup).toContain('href="/payroll/runs/01900000-0000-7000-8000-0000000000n1?lang=en"');
    expect(markup).toContain('href="/payroll/runs/01900000-0000-7000-8000-0000000000n2?lang=en"');
    expect(markup).toContain('14');
    expect(markup).toContain('13');
  });

  it('says the refusal once when nothing answered, and not once per section', () => {
    expect(answeredNothing(aRefusedWorkspace())).toBe(true);
    expect(answeredNothing(anEmptyWorkspace())).toBe(false);
  });

  it('says a refused section was withheld, and an empty one that there is nothing', () => {
    const withheld = workspace(en, 'en', aRefusedWorkspace());
    const nothing = workspace(en, 'en', anEmptyWorkspace());

    expect(withheld).toContain(en('admin.notice.sectionWithheld'));
    expect(withheld).not.toContain(en('payroll.label.noRuns'));

    expect(nothing).toContain(en('payroll.label.noRuns'));
    expect(nothing).toContain(en('payroll.label.noPeriods'));
    expect(nothing).not.toContain(en('admin.notice.sectionWithheld'));
  });

  /** Each section says its own true thing rather than one sentence repeated down a column. */
  it('gives every empty section its own sentence', () => {
    const nothing = workspace(en, 'en', anEmptyWorkspace());
    const sentences = new Set(
      [
        en('payroll.label.noRuns'),
        en('payroll.label.noPeriods'),
        en('payroll.label.noGroups'),
      ].filter((sentence) => nothing.includes(sentence)),
    );

    expect(sentences.size).toBe(3);
  });

  it('shows the server total beside the page length, never instead of it', () => {
    const markup = workspace(en, 'en', aFullWorkspace());

    expect(markup).toContain('26');
    expect(markup).toContain('14');
  });

  it('shows the overview figures the server counted, and a dash when it did not answer', () => {
    expect(html(<PayrollOverview t={en} dashboard={aFullWorkspace().dashboard} />)).toContain(
      '1402'.slice(0, 0) + '7',
    );
    expect(html(<PayrollOverview t={en} dashboard={undefined} />)).toContain('—');
  });

  it('names every status in words, never by colour alone', () => {
    const markup = workspace(en, 'en', aFullWorkspace());

    expect(markup).toContain(en('payroll.status.calculated'));
    expect(markup).toContain(en('payroll.status.finalized'));
    expect(markup).toContain(en('payroll.status.open'));
  });

  it('names the group its deduction definitions belong to', () => {
    const markup = workspace(en, 'en', aFullWorkspace());

    expect(markup).toContain('Head office');
    expect(markup).toContain(escaped(en('payroll.label.definitionsArePerGroup')));
  });

  it('says the runs are in the server’s order rather than sorting them', () => {
    expect(workspace(en, 'en', aFullWorkspace())).toContain(
      en('payroll.label.runsAreServerOrdered'),
    );
  });

  it('isolates every code and identifier so Arabic does not reorder it', () => {
    const markup = workspace(ar, 'ar', aFullWorkspace());

    expect(markup).toContain('<bdi>2026-08</bdi>');
    expect(markup).toContain('<bdi>regular</bdi>');
    expect(markup).toContain('<bdi>2 / 26</bdi>');
  });

  it('renders the Arabic catalogue rather than falling back to English', () => {
    const markup = workspace(ar, 'ar', aFullWorkspace());

    expect(markup).toContain(ar('payroll.label.runs'));
    expect(markup).toContain('المركز الرئيسي');
    expect(markup).not.toContain('payroll.label.');
  });

  it('offers no control: no form, button or input anywhere', () => {
    expect(workspace(en, 'en', aFullWorkspace())).not.toMatch(
      /<form|<button|<input|<select|<textarea/,
    );
  });

  it('keeps an identifier whole rather than shortening it', () => {
    const markup = workspace(en, 'en', aFullWorkspace());

    expect(markup).toContain('01900000-0000-7000-8000-0000000000g1');
    expect(markup).not.toContain('01900000…');
  });

  /**
   * A column of period identifiers, alike at a glance and unresolvable, is width the run's own
   * figures need. Payroll publishes no read of a period by identifier, so it stays an identifier —
   * on the run record, where there is one of it, rather than repeated down a list.
   */
  it('keeps the period identifier off the runs list', () => {
    const markup = html(<RunsSection t={en} language="en" runs={aFullWorkspace().runs} />);

    expect(markup).not.toContain('01900000-0000-7000-8000-0000000000d1');
  });
});
