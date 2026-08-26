import type { ReactNode } from 'react';
import type {
  AssessmentView,
  PeerAggregateView,
  ReviewSnapshotView,
  ReviewerAssignmentView,
} from '@work/performance/contracts';

import { count, instant, reference } from './exact';
import {
  Cell,
  Clear,
  Fact,
  Facts,
  Figure,
  Identifier,
  Isolated,
  Note,
  Opens,
  PerformanceSection,
  Reference,
  Row,
  Rows,
  Sentence,
  Term,
  When,
  Wrote,
} from './frame';
import type { Language, Translate } from './locale';
import { scoreText, weightText } from './scoring';
import { ASSESSMENT_TONE, ASSIGNMENT_TONE } from './tones';

/**
 * The panel, the assessments and the completion snapshot of one review.
 *
 * **Which assessment counts is stated beside each one.** A manager assessment is the approved
 * scoring path; a self assessment and a peer assessment are recorded, readable, and contribute
 * nothing. No weight is shown against a self or peer assessment, because inventing one would be
 * inventing a policy the domain does not have.
 *
 * **Nothing here says "anonymous", and nothing here can.** Every response is an attributed row.
 * Reviewer identity is *confidential* — shown to those the API permits — and the screen uses that
 * word. Below the configured minimum the peer aggregate is withheld: that withholds a number, and
 * the field is called `available` rather than `anonymous` for exactly that reason.
 *
 * **The snapshot is what a completed rating can still be explained from, years later.** It is
 * published as opaque structured values rather than as live references, so a consumer re-reading
 * the current rating scale cannot make a finished review appear to change.
 */

export interface AssessmentProps {
  readonly t: Translate;
  readonly language: Language;
}

/**
 * The multi-rater aggregate, or the honest statement that it is being withheld.
 *
 * Below the configured minimum no score is carried at all. That withholds a number; it does not
 * make the responses anonymous, and the note beneath says which of the two happened.
 */
const Aggregate = ({
  t,
  aggregate,
}: {
  readonly t: Translate;
  readonly aggregate: PeerAggregateView;
}): ReactNode => (
  <>
    <Facts>
      <Fact
        label={t('performance.label.responses')}
        value={<Figure>{count(aggregate.responseCount)}</Figure>}
      />
      <Fact
        label={t('performance.label.minimumResponses')}
        value={<Figure>{count(aggregate.minimumResponses)}</Figure>}
      />
      {/* Present only when the minimum was met. A withheld aggregate shows no number at all. */}
      <Fact
        label={t('performance.label.score')}
        value={<Figure>{aggregate.available ? scoreText(aggregate.averageScore) : '—'}</Figure>}
      />
    </Facts>
    {/*
      Only the state-specific sentence. "Reviewer identity is confidential, not anonymous" is a
      boundary of the whole screen and is said once, in the footer — saying it twice on one page
      is the duplication the coherence review found on the screens this replaced.
    */}
    {aggregate.available ? undefined : (
      <Note t={t} message="performance.notice.aggregateWithheld" />
    )}
  </>
);

/** The reviewer panel: who was asked, in what role, and whether they answered. */
export const PanelSection = ({
  t,
  language,
  reviewers,
  aggregate,
}: AssessmentProps & {
  readonly reviewers: readonly ReviewerAssignmentView[];
  readonly aggregate: PeerAggregateView;
}): ReactNode => {
  const title = t('performance.label.panel');

  if (reviewers.length === 0)
    return <Clear t={t} title={title} message="performance.notice.noPanel" />;

  return (
    <PerformanceSection title={title}>
      <Rows
        headings={[
          t('performance.label.reviewer'),
          t('performance.label.role'),
          t('performance.label.response'),
          t('performance.label.requestedAt'),
          t('performance.label.respondedAt'),
        ]}
      >
        {reviewers.map((reviewer) => (
          <Row key={reviewer.reviewerAssignmentId}>
            {/* An identifier, and only to a caller the API let read this. Never "Anonymous". */}
            <Identifier value={reference(reviewer.reviewerEmploymentId)} />
            <Cell>{t(`performance.vocabulary.reviewerRole.${reviewer.role}`)}</Cell>
            <Cell>
              <Term
                t={t}
                group="assignmentStatus"
                value={reviewer.status}
                tone={ASSIGNMENT_TONE[reviewer.status]}
              />
            </Cell>
            <When>
              <Isolated>{instant(reviewer.requestedAt, language)}</Isolated>
            </When>
            <When>
              <Isolated>{instant(reviewer.respondedAt, language)}</Isolated>
            </When>
          </Row>
        ))}
      </Rows>

      <Aggregate t={t} aggregate={aggregate} />
    </PerformanceSection>
  );
};

/** Which assessment counts, said once per assessment rather than left to the reader to infer. */
const countsNote = (kind: string): string =>
  kind === 'manager'
    ? 'performance.notice.managerCounted'
    : kind === 'self'
      ? 'performance.notice.selfNotCounted'
      : 'performance.notice.peerNotCounted';

/** One assessment's own lines: what was scored, what was excluded and what the assessor wrote. */
const AssessmentItems = ({
  t,
  assessment,
}: {
  readonly t: Translate;
  readonly assessment: AssessmentView;
}): ReactNode => (
  <Rows
    headings={[
      t('performance.label.item'),
      t('performance.label.reference'),
      t('performance.label.weight'),
      t('performance.label.score'),
      t('performance.label.exclusionReason'),
      t('performance.label.comment'),
    ]}
    numeric={[2, 3]}
  >
    {assessment.items.map((item) => (
      <Row key={item.assessmentItemId}>
        <Cell>{t(`performance.vocabulary.itemKind.${item.itemKind}`)}</Cell>
        {/*
          An assessed goal is a goal this product can now open, so the row opens it. A competency
          is not: Performance publishes no read for one competency, and a link to a route that does
          not exist is worse than an identifier.
        */}
        {item.goalId === undefined ? (
          <Identifier value={reference(item.competencyId)} />
        ) : (
          <Opens
            href={`/performance/goals/${item.goalId}`}
            label={t('performance.label.openGoal')}
            value={item.goalId}
          />
        )}
        <Cell numeric>
          <Figure>{weightText(item.weightBasisPoints)}</Figure>
        </Cell>
        <Cell numeric>
          <Figure>{scoreText(item.score)}</Figure>
        </Cell>
        <Cell>
          {item.exclusionReason === undefined
            ? '—'
            : t(`performance.vocabulary.exclusionReason.${item.exclusionReason}`)}
        </Cell>
        <Sentence>{item.comment}</Sentence>
      </Row>
    ))}
  </Rows>
);

/** One assessment: who wrote it, in what role, and whether it contributes to the rating. */
const Assessment = ({
  t,
  language,
  assessment,
}: AssessmentProps & { readonly assessment: AssessmentView }): ReactNode => (
  <div className="flex flex-col gap-3">
    <Facts>
      <Fact
        label={t('performance.label.assessmentKind')}
        value={t(`performance.vocabulary.reviewerRole.${assessment.assessmentKind}`)}
      />
      <Fact
        label={t('performance.label.assessor')}
        value={<Reference value={reference(assessment.assessorEmploymentId)} />}
      />
      <Fact
        label={t('performance.label.status')}
        value={
          <Term
            t={t}
            group="assessmentStatus"
            value={assessment.status}
            tone={ASSESSMENT_TONE[assessment.status]}
          />
        }
      />
      <Fact
        label={t('performance.label.score')}
        value={<Figure>{scoreText(assessment.overallScore)}</Figure>}
      />
      <Fact
        label={t('performance.label.submittedAt')}
        value={<Isolated>{instant(assessment.submittedAt, language)}</Isolated>}
      />
    </Facts>

    <Note t={t} message={countsNote(assessment.assessmentKind)} />

    {assessment.strengths === undefined ? undefined : (
      <p className="text-sm text-foreground">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          {`${t('performance.label.strengths')} · `}
        </span>
        <Wrote>{assessment.strengths}</Wrote>
      </p>
    )}
    {assessment.developmentAreas === undefined ? undefined : (
      <p className="text-sm text-foreground">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          {`${t('performance.label.developmentAreas')} · `}
        </span>
        <Wrote>{assessment.developmentAreas}</Wrote>
      </p>
    )}

    {assessment.items.length === 0 ? undefined : <AssessmentItems t={t} assessment={assessment} />}
  </div>
);

/** Every assessment recorded against the review. */
export const AssessmentsSection = ({
  t,
  language,
  assessments,
}: AssessmentProps & { readonly assessments: readonly AssessmentView[] }): ReactNode => {
  const title = t('performance.label.assessments');

  if (assessments.length === 0)
    return <Clear t={t} title={title} message="performance.notice.noAssessments" />;

  return (
    <PerformanceSection title={title}>
      <div className="flex flex-col gap-6">
        {assessments.map((assessment) => (
          <Assessment
            key={assessment.assessmentId}
            t={t}
            language={language}
            assessment={assessment}
          />
        ))}
      </div>
    </PerformanceSection>
  );
};

/**
 * The completion snapshot: what the rating can still be explained from.
 *
 * Only what a reader needs to see that a snapshot was taken and what it froze. The goals it lists
 * are the ones that were in the review at the moment it completed, with the scores they had then —
 * which is not necessarily what those goals say today, and that is the point.
 */
export const SnapshotSection = ({
  t,
  language,
  snapshot,
}: AssessmentProps & { readonly snapshot: ReviewSnapshotView | undefined }): ReactNode => {
  const title = t('performance.label.snapshot');

  if (snapshot === undefined)
    return <Clear t={t} title={title} message="performance.notice.noSnapshot" />;

  return (
    <PerformanceSection title={title}>
      <Facts>
        <Fact
          label={t('performance.label.takenAt')}
          value={<Isolated>{instant(snapshot.takenAt, language)}</Isolated>}
        />
        <Fact
          label={t('performance.label.takenBy')}
          value={<Reference value={reference(snapshot.takenBy)} />}
        />
        <Fact
          label={t('performance.label.calculatedScore')}
          value={<Figure>{scoreText(snapshot.calculation.calculatedScore)}</Figure>}
        />
        <Fact
          label={t('performance.label.finalScore')}
          value={<Figure>{scoreText(snapshot.calculation.finalScore)}</Figure>}
        />
        <Fact
          label={t('performance.label.goals')}
          value={<Figure>{count(snapshot.goals.length)}</Figure>}
        />
        <Fact
          label={t('performance.label.reviewer')}
          value={<Figure>{count(snapshot.reviewers.length)}</Figure>}
        />
      </Facts>
      <Note t={t} message="performance.notice.snapshotFrozen" />
    </PerformanceSection>
  );
};
