import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { directionOf, translator } from './locale';
import { CoursesSection, VersionsSection } from './catalogue';
import { RulesSection } from './compliance';
import { AssignmentsSection, EnrolmentsSection, ResultsSection } from './records';
import { CertificationsSection, HistorySection, InstructorsSection } from './attainment';
import { OverviewSection, UnavailableSection } from './overview';
import {
  aCertificate,
  aHistory,
  aResult,
  aRule,
  aVersion,
  anAssignment,
  anEnrolment,
  anInstructor,
  aCourse,
} from './views.fixture';

/**
 * What the screen actually renders, asserted against the markup rather than against a description
 * of it.
 *
 * Every major workspace, its totals, its empty state and its Arabic. These are the assertions
 * nobody else in this repository can make: the API suites prove the server sends a page and a
 * total, and only this proves a browser puts both on the page and does not print one in place of
 * the other.
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

describe('totals and paging', () => {
  it('shows the server’s total separately from the number of rows on the page', () => {
    const markup = html(
      <AssignmentsSection
        {...props}
        assignments={[anAssignment(), anAssignment({ assignmentId: 'b' })]}
        total={4000}
        asOf="2026-08-12"
      />,
    );

    // Two rows of four thousand. A screen that printed only `2` would tell an administrator that
    // two people are out of compliance in an organization where four thousand are.
    expect(markup).toContain('2 / 4000');
    expect(markup).toContain(en('learning.label.page'));
  });

  it('states that a page-scoped count is page-scoped', () => {
    const markup = html(
      <RulesSection {...props} rules={[aRule()]} assignments={[anAssignment()]} total={1} />,
    );

    expect(markup).toContain(escaped(en('learning.notice.countsAreOfThisPage')));
    // And the count itself is of the fetched page: one assignment names this rule.
    expect(markup).toContain(en('learning.label.generated'));
  });
});

describe('empty and unavailable states', () => {
  it('renders an empty state rather than a blank card', () => {
    const markup = html(<CoursesSection {...props} courses={[]} total={0} />);

    expect(markup).toContain(en('learning.notice.empty'));
  });

  it('distinguishes an unreachable API from a tenant with no data', () => {
    const overview = (unavailable: boolean): string =>
      html(
        <OverviewSection
          {...props}
          courses={[]}
          coursesTotal={0}
          assignments={[]}
          assignmentsTotal={0}
          certifications={[]}
          certificationsTotal={0}
          enrolmentsTotal={0}
          rulesTotal={0}
          asOf={undefined}
          unavailable={unavailable}
        />,
      );

    // "Not signed in" and "nothing configured yet" are different answers, and a screen that showed
    // the same thing for both would send an administrator looking for data that was never withheld.
    expect(overview(true)).toContain(escaped(en('learning.notice.unauthenticated')));
    expect(overview(false)).not.toContain(escaped(en('learning.notice.unauthenticated')));
  });

  it('renders a history with no record as an empty state rather than zeros', () => {
    const markup = html(<HistorySection {...props} history={undefined} />);

    expect(markup).toContain(en('learning.notice.empty'));
  });
});

describe('the workspaces render', () => {
  it('renders every major workspace with its heading and its rows', () => {
    const rendered = [
      html(<CoursesSection {...props} courses={[aCourse()]} total={1} />),
      html(<VersionsSection {...props} course={aCourse()} versions={[aVersion()]} />),
      html(<RulesSection {...props} rules={[aRule()]} assignments={[anAssignment()]} total={1} />),
      html(
        <AssignmentsSection
          {...props}
          assignments={[anAssignment()]}
          total={1}
          asOf="2026-08-12"
        />,
      ),
      html(<EnrolmentsSection {...props} enrolments={[anEnrolment()]} total={1} />),
      html(<ResultsSection {...props} results={[aResult()]} />),
      html(
        <CertificationsSection
          {...props}
          certifications={[aCertificate()]}
          total={1}
          asOf="2026-08-12"
        />,
      ),
      html(<InstructorsSection {...props} instructors={[anInstructor()]} total={1} />),
      html(<HistorySection {...props} history={aHistory()} />),
    ];

    for (const markup of rendered) {
      // A real table with real scoped headers, scrolling inside its own container.
      expect(markup).toContain('scope="col"');
      expect(markup).toContain('overflow-x-auto');
      // A missing catalogue key renders as the key itself, which would be unmistakable here.
      expect(markup).not.toContain('learning.label.');
    }
  });

  it('marks which version is the current one rather than showing only that one', () => {
    const markup = html(
      <VersionsSection
        {...props}
        course={aCourse()}
        versions={[aVersion(), aVersion({ courseVersionId: 'other', versionNumber: 2 })]}
      />,
    );

    // Both versions are listed: a completion in 2023 describes the version somebody actually sat.
    expect(markup).toContain('Fire safety v1');
    expect(markup).toContain(escaped(en('learning.notice.versionsAreImmutable')));
    expect(markup).toContain(en('learning.vocabulary.answer.yes'));
    expect(markup).toContain(en('learning.vocabulary.answer.no'));
  });
});

describe('Arabic and direction', () => {
  it('renders Arabic labels and vocabulary rather than falling back to English keys', () => {
    const markup = html(<CoursesSection {...arabic} courses={[aCourse()]} total={1} />);

    expect(markup).toContain(ar('learning.label.catalogue'));
    expect(markup).toContain(ar('learning.vocabulary.courseStatus.published'));
    expect(markup).toContain(ar('learning.vocabulary.courseDelivery.classroom'));
    // The bilingual course name, in the reader's language.
    expect(markup).toContain('السلامة من الحرائق');
    expect(markup).not.toContain('learning.label.');
    expect(markup).not.toContain('learning.vocabulary.');
  });

  it('renders the Arabic notices, including the ones that state what is not verified', () => {
    const markup = html(<UnavailableSection {...arabic} />);

    for (const key of [
      'learning.notice.notScheduled',
      'learning.notice.noAggregateScore',
      'learning.notice.readTeamUnavailable',
      'learning.notice.noNotificationDelivery',
    ]) {
      expect(markup).toContain(escaped(ar(key)));
    }
    expect(markup).not.toContain('learning.notice.');
  });

  it('ties direction to language rather than leaving it a separate control', () => {
    expect(directionOf('ar')).toBe('rtl');
    expect(directionOf('en')).toBe('ltr');
  });

  it('renders an Arabic instructor’s name without losing the external-record notice', () => {
    const markup = html(
      <InstructorsSection {...arabic} instructors={[anInstructor()]} total={1} />,
    );

    expect(markup).toContain('أكاديمية الدفاع المدني');
    expect(markup).toContain(escaped(ar('learning.notice.externalInstructor')));
  });
});
