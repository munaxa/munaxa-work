import type { ReactNode } from 'react';
import type { AssessmentView, CourseVersionView, CourseView } from '@work/learning/contracts';

import { count } from './exact';
import { courseActionsFor, courseWithheldBecause } from './lifecycle';
import {
  Actions,
  Empty,
  Section,
  Status,
  Table,
  named,
  short,
  yesNo,
  type SectionProps,
} from './sections';

/**
 * The course catalogue: what a tenant offers, and what each course currently teaches.
 *
 * **A version is never edited, and the table shows why.** Every version a course has had is listed,
 * because a completion in 2023 describes the version somebody actually sat: rewriting that content
 * in place would change the meaning of a certificate already in somebody's file (AD-004). The
 * current version is marked rather than being the only one shown.
 *
 * **`requiresAssessment` is the tenant's configuration and this screen invents nothing behind it.**
 * It says an assessment outcome is needed before completion. It does not say what passing means —
 * no threshold, no weighting, no rounding — because the specification defines none, and a column
 * headed "pass mark" would be this screen inventing a rule that decides who passes safety training.
 *
 * **Categories are shown as they appear on courses, and there is no category listing.** The API
 * exposes a create route and a `categoryId` on each course; there is no query that enumerates them.
 * So this section lists the categories in use on the page it fetched and says exactly that, rather
 * than implying it has the tenant's whole taxonomy. Nothing in this product branches on a category
 * (AD-003), which is why the missing contract has never mattered.
 */

export const CoursesSection = ({
  t,
  language,
  courses,
  total,
}: SectionProps & {
  readonly courses: readonly CourseView[];
  readonly total: number;
}): ReactNode => (
  <Section t={t} title="catalogue" total={total} shown={courses.length}>
    {courses.length === 0 ? (
      <Empty t={t} />
    ) : (
      <>
        <Table
          t={t}
          headers={['code', 'title', 'delivery', 'status', 'versions', 'category', 'version']}
        >
          {courses.map((course) => (
            <tr key={course.courseId}>
              <td>{course.code}</td>
              <td>{named(course.name, language)}</td>
              <td>
                <Status t={t} group="courseDelivery" status={course.delivery} />
              </td>
              <td>
                <Status t={t} group="courseStatus" status={course.status} />
              </td>
              <td>{count(course.versionCount)}</td>
              <td>{short(course.categoryId)}</td>
              <td>{count(course.version)}</td>
            </tr>
          ))}
        </Table>

        <Actions
          t={t}
          actions={courseActionsFor(courses[0])}
          withheld={courseWithheldBecause(courses[0])}
        />
      </>
    )}
  </Section>
);

/**
 * The categories in use on the courses this page fetched.
 *
 * **Not the tenant's taxonomy**, and the note says so. There is no listing contract for categories;
 * inventing one here would mean either a query this module does not have or a request per course,
 * and both are worse than an honest partial answer.
 */
export const CategoriesSection = ({
  t,
  courses,
}: SectionProps & { readonly courses: readonly CourseView[] }): ReactNode => {
  const inUse = [
    ...new Set(courses.map((course) => course.categoryId).filter((id) => id !== undefined)),
  ];

  return (
    <Section t={t} title="categories" note="learning.notice.noCategoryListing">
      {inUse.length === 0 ? (
        <Empty t={t} />
      ) : (
        <Table t={t} headers={['category', 'courses']}>
          {inUse.map((categoryId) => (
            <tr key={categoryId}>
              <td>{short(categoryId)}</td>
              <td>{count(courses.filter((course) => course.categoryId === categoryId).length)}</td>
            </tr>
          ))}
        </Table>
      )}
    </Section>
  );
};

/**
 * Every version one course has had, newest state marked.
 *
 * One course's versions, for the first course in the listing — never one request per course. The
 * `contentReference` is deliberately absent from this table: it is an opaque key nothing in this
 * product resolves, uploads or downloads, and a column headed "content" would imply a link.
 */
export const VersionsSection = ({
  t,
  language,
  course,
  versions,
}: SectionProps & {
  readonly course: CourseView | undefined;
  readonly versions: readonly CourseVersionView[];
}): ReactNode => (
  <Section t={t} title="versions" note="learning.notice.versionsAreImmutable">
    {versions.length === 0 ? (
      <Empty t={t} />
    ) : (
      <Table
        t={t}
        headers={[
          'versionNumber',
          'title',
          'duration',
          'requiresAssessment',
          'validMonths',
          'current',
        ]}
      >
        {versions.map((version) => (
          <tr key={version.courseVersionId}>
            <td>{count(version.versionNumber)}</td>
            <td>{named(version.title, language)}</td>
            <td>{count(version.durationMinutes)}</td>
            <td>{yesNo(version.requiresAssessment, t)}</td>
            <td>{count(version.certificationValidMonths)}</td>
            <td>{yesNo(course?.currentVersionId === version.courseVersionId, t)}</td>
          </tr>
        ))}
      </Table>
    )}
  </Section>
);

/**
 * What a course version asks somebody to demonstrate.
 *
 * A kind, a title and whether an outcome is required before completion. **There is no pass mark, no
 * weight and no attempt limit in this table**, because there is none in the domain: aggregate
 * assessment scoring is `NOT VERIFIED`, and the note under the results table in `records.tsx` says
 * so beside the outcomes themselves.
 */
export const AssessmentsSection = ({
  t,
  language,
  assessments,
}: SectionProps & { readonly assessments: readonly AssessmentView[] }): ReactNode => (
  <Section t={t} title="assessments" note="learning.notice.noAggregateScore">
    {assessments.length === 0 ? (
      <Empty t={t} />
    ) : (
      <Table t={t} headers={['title', 'kind', 'required']}>
        {assessments.map((assessment) => (
          <tr key={assessment.assessmentId}>
            <td>{named(assessment.title, language)}</td>
            <td>
              <Status t={t} group="assessmentKind" status={assessment.kind} />
            </td>
            <td>{yesNo(assessment.required, t)}</td>
          </tr>
        ))}
      </Table>
    )}
  </Section>
);
