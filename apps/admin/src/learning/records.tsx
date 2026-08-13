import type { ReactNode } from 'react';
import type { AssessmentResultView, AssignmentView, EnrolmentView } from '@work/learning/contracts';

import { civil, count, exactMark } from './exact';
import {
  assignmentActionsFor,
  assignmentWithheldBecause,
  enrolmentActionsFor,
  enrolmentWithheldBecause,
} from './lifecycle';
import {
  Actions,
  Empty,
  Section,
  Status,
  Table,
  short,
  type SectionProps,
  type Translate,
} from './sections';

/**
 * What people were asked to do, what they sat, and what an assessor wrote down.
 *
 * **No employment identifier is sent to reach any of this.** The searches accept one as a filter and
 * this screen supplies none: a caller holding only `assignment.read-team` reads nothing whatever
 * they name, because this product cannot resolve a signed-in person to their employment (ADR-0032).
 * A "my team" picker here would be an administrator's filter wearing an employee's identity, and an
 * employment identifier typed into a URL would be an IDOR by another name.
 *
 * **Overdue is the API's answer, computed against a stated day.** No column holds it and nothing
 * here recomputes it — the day is displayed beside the queue so a screen never says "overdue"
 * without saying overdue as of when.
 *
 * **There is no satisfy action and no satisfy column.** An assignment is satisfied by a completion
 * or by a certificate issued against it, in the same transaction as the act that earned it.
 *
 * **Nothing on this screen totals an assessment.** The results table shows what each assessor
 * recorded — an outcome, and the mark they wrote, exactly as they wrote it. There is no average, no
 * percentage, no pass/fail verdict over the set and no column that could be mistaken for one,
 * because the specification defines no formula: aggregate assessment scoring is `NOT VERIFIED`, and
 * the note under the table says so in both languages.
 *
 * **A recorded assessment is not a performance score.** Somebody passing a practical check is a
 * fact about a course they sat; what a manager thought of their work is Performance's record and a
 * different question (AD-002). No column here is headed "score", "rating" or "performance".
 */

/**
 * One requirement somebody carries, as a row.
 *
 * Its own component because three of these cells are the module's most easily-broken claims: two
 * civil dates that must not meet a `Date`, and an `overdue` answer the API derived against a stated
 * day rather than a column anybody could read here.
 */
const AssignmentRow = ({
  t,
  assignment,
}: {
  readonly t: Translate;
  readonly assignment: AssignmentView;
}): ReactNode => (
  <tr>
    <td>{short(assignment.employmentId)}</td>
    <td>{short(assignment.courseId)}</td>
    <td>
      <Status t={t} group="assignmentSource" status={assignment.source} />
    </td>
    <td>{civil(assignment.occurrenceKey)}</td>
    {/* Civil dates, exactly as stored: a due day is the same day in every time zone. */}
    <td>{civil(assignment.dueOn)}</td>
    <td>
      <Status t={t} group="answer" status={assignment.overdue ? 'yes' : 'no'} />
    </td>
    <td>
      <Status t={t} group="assignmentStatus" status={assignment.status} />
    </td>
    <td>{count(assignment.version)}</td>
  </tr>
);

export const AssignmentsSection = ({
  t,
  assignments,
  total,
  asOf,
}: SectionProps & {
  readonly assignments: readonly AssignmentView[];
  readonly total: number;
  readonly asOf: string | undefined;
}): ReactNode => (
  <Section
    t={t}
    title="assignments"
    total={total}
    shown={assignments.length}
    note="learning.notice.derivedOverdue"
  >
    <p className="text-xs opacity-70">{`${t('learning.label.asOf')}: ${civil(asOf)}`}</p>

    {assignments.length === 0 ? (
      <Empty t={t} />
    ) : (
      <>
        <Table
          t={t}
          headers={[
            'employment',
            'course',
            'source',
            'occurrence',
            'dueOn',
            'overdue',
            'status',
            'version',
          ]}
        >
          {assignments.map((assignment) => (
            <AssignmentRow key={assignment.assignmentId} t={t} assignment={assignment} />
          ))}
        </Table>

        <Actions
          t={t}
          actions={assignmentActionsFor(assignments[0])}
          withheld={assignmentWithheldBecause(assignments[0])}
        />
      </>
    )}
  </Section>
);

/**
 * Who is on what, and how it ended.
 *
 * The **pinned course version** is a column of its own. It is what makes a completion still
 * describable after a course is revised: the version somebody sat is the version their certificate
 * means, and a screen showing only the course would lose that (AD-004).
 */
export const EnrolmentsSection = ({
  t,
  enrolments,
  total,
}: SectionProps & {
  readonly enrolments: readonly EnrolmentView[];
  readonly total: number;
}): ReactNode => (
  <Section t={t} title="enrolments" total={total} shown={enrolments.length}>
    {enrolments.length === 0 ? (
      <Empty t={t} />
    ) : (
      <>
        <Table
          t={t}
          headers={[
            'employment',
            'course',
            'pinnedVersion',
            'assignment',
            'status',
            'completedOn',
            'completedBy',
            'version',
          ]}
        >
          {enrolments.map((enrolment) => (
            <tr key={enrolment.enrolmentId}>
              <td>{short(enrolment.employmentId)}</td>
              <td>{short(enrolment.courseId)}</td>
              <td>{short(enrolment.courseVersionId)}</td>
              <td>{short(enrolment.assignmentId)}</td>
              <td>
                <Status t={t} group="enrolmentStatus" status={enrolment.status} />
              </td>
              <td>{civil(enrolment.completedOn)}</td>
              <td>{short(enrolment.completedBy)}</td>
              <td>{count(enrolment.version)}</td>
            </tr>
          ))}
        </Table>

        <Actions
          t={t}
          actions={enrolmentActionsFor(enrolments[0])}
          withheld={enrolmentWithheldBecause(enrolments[0])}
        />
      </>
    )}
  </Section>
);

/**
 * The outcomes recorded against one enrolment, exactly as the assessors recorded them.
 *
 * **The mark is the assessor's own text and it is rendered untouched.** `18.50` is what somebody
 * wrote and `18.50` is what appears; `Number('18.50')` renders `18.5`, which is a different mark in
 * a transcript. `exactMark` is a named identity function so a later reader reaching for a format
 * meets the reason first.
 *
 * The scale sits beside the mark because a mark alone means nothing: `18.50` out of 20 and `18.50`
 * out of 100 are different results, and the tenant recorded which.
 *
 * **The assessor is named, and this screen makes no anonymity claim.** Learning does not own
 * Performance's 360 confidentiality: an outcome carries who recorded it, and hiding that name while
 * calling it anonymous would be a promise the data does not keep.
 */
export const ResultsSection = ({
  t,
  results,
}: SectionProps & { readonly results: readonly AssessmentResultView[] }): ReactNode => (
  <Section t={t} title="results" note="learning.notice.noAggregateScore">
    {results.length === 0 ? (
      <Empty t={t} />
    ) : (
      <Table t={t} headers={['assessment', 'outcome', 'mark', 'scale', 'assessedOn', 'assessedBy']}>
        {results.map((result) => (
          <tr key={result.resultId}>
            <td>{short(result.assessmentId)}</td>
            <td>
              <Status t={t} group="assessmentOutcome" status={result.outcome} />
            </td>
            {/* Exactly as written. Never parsed — see `exact.ts`. */}
            <td>{exactMark(result.rawMark)}</td>
            <td>{result.rawMarkScale ?? '—'}</td>
            <td>{civil(result.assessedOn)}</td>
            <td>{short(result.assessedBy)}</td>
          </tr>
        ))}
      </Table>
    )}
  </Section>
);
