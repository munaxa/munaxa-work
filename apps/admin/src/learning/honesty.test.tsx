import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { translator } from './locale';
import { CategoriesSection } from './catalogue';
import { ReconciliationSection } from './compliance';
import { AssignmentsSection, EnrolmentsSection, ResultsSection } from './records';
import { CertificationsSection } from './attainment';
import { UnavailableSection } from './overview';
import { aCertificate, aCourse, aResult, aRule, anAssignment, anEnrolment } from './views.fixture';

/**
 * What the screen refuses to claim, and the two kinds of value it must not convert.
 *
 * The other half of the render suite proves the workspaces appear. This half proves the harder
 * property: that nothing on the page overstates what this product does. A mark keeps the characters
 * an assessor typed, a civil date keeps the day the domain stored, a derived answer carries the day
 * it was derived for, and every capability that does not exist is named rather than left for
 * somebody to infer from an empty table.
 *
 * `renderToStaticMarkup` runs the real components with the real catalogues and produces the real
 * HTML — no DOM, no test renderer, no new dependency, and nothing mocked but the API response.
 */

const en = translator('en');
const ar = translator('ar');
const props = { t: en, language: 'en' } as const;
const arabic = { t: ar, language: 'ar' } as const;

const html = (node: ReactNode): string => renderToStaticMarkup(node);

/**
 * A catalogue string as React emits it.
 *
 * React escapes `'`, `"`, `&`, `<` and `>` in text nodes, so a sentence containing an apostrophe
 * appears in the markup escaped. Comparing against the raw string would fail on text that rendered
 * correctly, which is a test bug wearing the shape of a defect.
 */
const escaped = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#x27;');

describe('the exact mark, on the page', () => {
  /** The mandatory regression: the characters must survive all the way to the markup. */
  it('renders 18.50 as 18.50 and never as 18.5', () => {
    const markup = html(<ResultsSection {...props} results={[aResult()]} />);

    expect(markup).toContain('18.50');
    // Not a substring match: `18.50` contains `18.5`. The cell must hold the exact text.
    expect(markup).toContain('>18.50<');
    expect(markup).not.toContain('>18.5<');
  });

  /**
   * Where a mark is actually at risk in *this* module, which is not where it was in Performance.
   *
   * Learning's marks are bounded at twelve integer digits and four decimals, and every value in
   * that range survives a `Number` round trip — JavaScript prints the shortest string that parses
   * back to the same double, and sixteen significant digits still fit. So magnitude is not the
   * danger here. **Trailing zeros are**, at every width: `20.00` becomes `20`, `0.5000` becomes
   * `0.5`, and `999999999999.0000` — the widest mark the domain accepts — loses four characters and
   * a decimal point. Each of those is a different mark on a transcript, and each looks like tidying
   * up rather than like data loss.
   */
  it('keeps the trailing zeros a float round trip would silently drop', () => {
    for (const mark of ['20.00', '0.5000', '18.5000', '999999999999.0000']) {
      const markup = html(<ResultsSection {...props} results={[aResult({ rawMark: mark })]} />);

      expect([mark, markup.includes(`>${mark}<`)]).toEqual([mark, true]);
      // And the shortened value a parse would have produced is a different string entirely.
      expect([mark, String(Number(mark))]).not.toEqual([mark, mark]);
    }
  });

  it('shows the scale beside the mark, because a mark alone means nothing', () => {
    const markup = html(<ResultsSection {...props} results={[aResult()]} />);

    expect(markup).toContain('out of 20');
  });
});

describe('civil dates, on the page', () => {
  it('renders every date exactly as the domain stored it, in both languages', () => {
    for (const rendered of [
      html(
        <AssignmentsSection
          {...props}
          assignments={[anAssignment()]}
          total={1}
          asOf="2026-08-12"
        />,
      ),
      html(
        <AssignmentsSection
          {...arabic}
          assignments={[anAssignment()]}
          total={1}
          asOf="2026-08-12"
        />,
      ),
    ]) {
      // The due day, the occurrence day and the day the derived answer was computed against.
      expect(rendered).toContain('2026-09-30');
      expect(rendered).toContain('2024-01-01');
      expect(rendered).toContain('2026-08-12');
      // A `Date` on this path would render the day before west of UTC, or Arabic-Indic digits.
      expect(rendered).not.toContain('2026-09-29');
      expect(rendered).not.toContain('٢٠٢٦');
    }
  });

  it('renders a certificate’s last valid day rather than an instant', () => {
    const markup = html(
      <CertificationsSection
        {...props}
        certifications={[aCertificate()]}
        total={1}
        asOf="2026-08-12"
      />,
    );

    expect(markup).toContain('2027-08-12');
    expect(markup).not.toContain('T00:00');
  });
});

describe('what the screen refuses to claim', () => {
  it('says beside every assessment result that nothing is scored in aggregate', () => {
    const markup = html(<ResultsSection {...props} results={[aResult()]} />);

    expect(markup).toContain(escaped(en('learning.notice.noAggregateScore')));
    // And no column implies one. A recorded outcome is not a performance score (AD-002).
    for (const forbidden of ['Overall score', 'Average', 'Total score', 'Rating']) {
      expect([forbidden, markup.includes(forbidden)]).toEqual([forbidden, false]);
    }
  });

  it('says requirement generation is something somebody runs, not something scheduled', () => {
    const markup = html(
      <ReconciliationSection
        {...props}
        rules={[aRule()]}
        assignments={[anAssignment()]}
        asOf="2026-08-12"
      />,
    );

    expect(markup).toContain(escaped(en('learning.notice.notScheduled')));
    for (const forbidden of ['Next run', 'Scheduled', 'Last run']) {
      expect([forbidden, markup.includes(forbidden)]).toEqual([forbidden, false]);
    }
  });

  it('shows an evidence document as a reference with no link, filename or size', () => {
    const markup = html(
      <CertificationsSection
        {...props}
        certifications={[aCertificate()]}
        total={1}
        asOf="2026-08-12"
      />,
    );

    expect(markup).toContain('01930000');
    // No anchor, no download, no signed URL. The whole integration is "this reference exists".
    expect(markup).not.toContain('<a ');
    for (const forbidden of ['download', 'href=', 'storageReference', 'contentType']) {
      expect([forbidden, markup.includes(forbidden)]).toEqual([forbidden, false]);
    }
  });

  it('attributes every assessment result and makes no anonymity claim', () => {
    const english = html(<ResultsSection {...props} results={[aResult()]} />);
    const عربي = html(<ResultsSection {...arabic} results={[aResult()]} />);

    // Learning does not own Performance's 360 confidentiality, and it does not borrow the word.
    // Hiding an assessor's name while calling it anonymous would be a promise the data cannot keep.
    expect(english.toLowerCase()).not.toContain('anonymous');
    expect(عربي).not.toContain('مجهول');
    // The assessor is on the row, not a placeholder.
    expect(english).toContain(en('learning.label.assessedBy'));
    expect(english).toContain('user:lea');
  });

  it('lists every capability this product does not have', () => {
    const markup = html(<UnavailableSection {...props} />);

    for (const key of [
      'learning.notice.notScheduled',
      'learning.notice.noAggregateScore',
      'learning.notice.selfServiceUnavailable',
      'learning.notice.readTeamUnavailable',
      'learning.notice.noNotificationDelivery',
      'learning.notice.noDocumentBytes',
      'learning.notice.noCategoryListing',
      'learning.notice.noSupersessionLink',
    ]) {
      expect(markup).toContain(escaped(en(key)));
    }
  });

  it('offers no action a completed record cannot take, and says why', () => {
    const markup = html(<EnrolmentsSection {...props} enrolments={[anEnrolment()]} total={1} />);

    expect(markup).toContain(escaped(en('learning.withheld.enrolmentCompleted')));
    expect(markup).toContain(escaped(en('learning.notice.actionsAreUsability')));
    // A completed enrolment offers issuance and nothing that would edit what happened. Asserted
    // against the actions block itself: "Complete" is a substring of the status word "Completed",
    // and a whole-markup search would pass on the status cell rather than on the action list.
    const actions = markup.split('>Actions this state allows<')[1] ?? '';

    expect(actions).toContain(`<span>${en('learning.action.issue')}</span>`);
    expect(actions).not.toContain(en('learning.action.complete'));
    expect(actions).not.toContain(en('learning.action.recordResult'));
  });

  it('says a category listing is not a listing of every category', () => {
    const markup = html(<CategoriesSection {...props} courses={[aCourse({ categoryId: 'x1' })]} />);

    expect(markup).toContain(escaped(en('learning.notice.noCategoryListing')));
  });
});

describe('derived answers carry the day they were derived for', () => {
  it('captions the certification queue with the day validity was computed against', () => {
    const markup = html(
      <CertificationsSection
        {...props}
        certifications={[aCertificate({ validity: 'expiring_soon' })]}
        total={1}
        asOf="2026-08-12"
      />,
    );

    expect(markup).toContain(`${en('learning.label.asOf')}: 2026-08-12`);
    expect(markup).toContain(en('learning.vocabulary.validity.expiring_soon'));
    expect(markup).toContain(escaped(en('learning.notice.derivedExpiry')));
  });

  it('renders no_expiry as a state rather than a blank cell', () => {
    // Built by omission: a certificate that never lapses has no `validUntil` key at all, which is
    // a different shape from one carrying `undefined` under `exactOptionalPropertyTypes`.
    const { validUntil: _never, ...perpetual } = aCertificate({ validity: 'no_expiry' });
    const markup = html(
      <CertificationsSection {...props} certifications={[perpetual]} total={1} asOf="2026-08-12" />,
    );

    expect(markup).toContain(en('learning.vocabulary.validity.no_expiry'));
  });
});
