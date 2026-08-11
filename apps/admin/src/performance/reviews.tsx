import type { ReactNode } from 'react';
import type { AssessmentView, ReviewDetailView, ReviewView } from '@work/performance/contracts';

import { reviewActionsFor, reviewWithheldBecause } from './lifecycle';
import { ratingFor, scoreText, weightText } from './scoring';
import {
  Actions,
  Empty,
  Figure,
  Section,
  Status,
  Table,
  instant,
  short,
  type SectionProps,
} from './sections';

/**
 * The review workspace: the queue, one review's working, its panel and its rating.
 *
 * **Which assessment counts is stated on the screen, next to each one.** A manager assessment is the
 * approved scoring path; a self assessment and a peer assessment are recorded, readable, and
 * contribute nothing. No column here is headed "contribution" for a self or peer row, no weight is
 * shown against one, and the note under each says so in words. Inventing a weight would be inventing
 * a policy the domain does not have.
 *
 * **The calculated score and the calibrated score are separate fields, both shown.** Calibration
 * records a new rating beside the engine's and never over it — a trigger refuses an update that
 * would change the original — so a screen with a single "score" field would misrepresent what the
 * panel did.
 *
 * **An excluded component says why.** A component nobody assessed leaves the denominator with its
 * reason recorded, rather than being scored zero, and the working shows both the exclusion and the
 * reason. Rating somebody down for work nobody assessed is the outcome that rule exists to prevent.
 */

export const ReviewQueueSection = ({
  t,
  language,
  reviews,
  total,
}: SectionProps & {
  readonly reviews: readonly ReviewView[];
  readonly total: number;
}): ReactNode => (
  <Section
    t={t}
    title="reviews"
    total={total}
    shown={reviews.length}
    note="performance.notice.readTeamUnavailable"
  >
    {reviews.length === 0 ? (
      <Empty t={t} />
    ) : (
      <>
        <Table
          t={t}
          headers={[
            'employment',
            'manager',
            'status',
            'calculatedScore',
            'finalScore',
            'completedAt',
          ]}
        >
          {reviews.map((review) => (
            <tr key={review.reviewId}>
              <td>{short(review.employmentId)}</td>
              <td>{short(review.managerEmploymentId)}</td>
              <td>
                <Status t={t} group="reviewStatus" status={review.status} />
              </td>
              <td>{scoreText(review.calculatedScore)}</td>
              <td>{scoreText(review.finalScore ?? review.calculatedScore)}</td>
              <td>{instant(review.completedAt, language)}</td>
            </tr>
          ))}
        </Table>

        <Actions
          t={t}
          actions={reviewActionsFor(reviews[0])}
          withheld={reviewWithheldBecause(reviews[0])}
        />
      </>
    )}
  </Section>
);

/** The rating, and where each number came from. */
export const RatingSection = ({
  t,
  language,
  detail,
}: SectionProps & { readonly detail: ReviewDetailView | undefined }): ReactNode => {
  if (detail === undefined) {
    return (
      <Section t={t} title="rating">
        <Empty t={t} />
      </Section>
    );
  }

  const rating = ratingFor(detail.review, detail.calibration);

  return (
    <Section t={t} title="rating" note="performance.notice.calibrationKept">
      <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
        <Figure t={t} label="calculatedScore" value={rating.calculated} />
        <Figure t={t} label="finalScore" value={rating.final} />
        <Figure
          t={t}
          label="status"
          value={t(`performance.vocabulary.reviewStatus.${detail.review.status}`)}
        />
      </dl>

      {/* Both numbers, and who moved it. Shown only where a decision exists — a review nobody
          calibrated must not display an empty "original" that implies one did. */}
      {rating.original === undefined ? undefined : (
        <Table
          t={t}
          headers={['originalScore', 'calibratedScore', 'reason', 'decidedBy', 'decidedAt']}
        >
          <tr>
            <td>{rating.original}</td>
            <td>{rating.moderated ? rating.final : rating.original}</td>
            <td>{rating.reason ?? '—'}</td>
            <td>{short(rating.decidedBy)}</td>
            <td>{instant(rating.decidedAt, language)}</td>
          </tr>
        </Table>
      )}
    </Section>
  );
};

/**
 * The working: what each component was worth, what it scored, and what left the denominator.
 *
 * `denominatorBasisPoints` is shown beside the weight because they differ exactly when something was
 * excluded, and the difference is the arithmetic an administrator is being asked to trust.
 */
export const WorkingSection = ({
  t,
  detail,
}: SectionProps & { readonly detail: ReviewDetailView | undefined }): ReactNode => (
  <Section t={t} title="components">
    {detail === undefined || detail.componentScores.length === 0 ? (
      <Empty t={t} />
    ) : (
      <Table
        t={t}
        headers={['component', 'weight', 'score', 'contribution', 'excluded', 'exclusionReason']}
      >
        {detail.componentScores.map((component) => (
          <tr key={component.component}>
            <td>{t(`performance.vocabulary.scoreComponent.${component.component}`)}</td>
            <td>{weightText(component.weightBasisPoints)}</td>
            <td>{scoreText(component.score)}</td>
            <td>{scoreText(component.contributedScore)}</td>
            <td>{component.included ? '—' : t('performance.label.excluded')}</td>
            {/* Never inferred from a missing score. The engine recorded which of the four it was. */}
            <td>
              {component.exclusionReason === undefined
                ? '—'
                : t(`performance.vocabulary.exclusionReason.${component.exclusionReason}`)}
            </td>
          </tr>
        ))}
      </Table>
    )}
  </Section>
);

/** Which assessment counts, said once per row rather than left to the reader to infer. */
const countsNote = (kind: string): string =>
  kind === 'manager'
    ? 'performance.notice.managerCounted'
    : kind === 'self'
      ? 'performance.notice.selfNotCounted'
      : 'performance.notice.peerNotCounted';

export const AssessmentsSection = ({
  t,
  language,
  assessments,
}: SectionProps & { readonly assessments: readonly AssessmentView[] }): ReactNode => (
  <Section t={t} title="assessments">
    {assessments.length === 0 ? (
      <Empty t={t} />
    ) : (
      assessments.map((assessment) => (
        <div key={assessment.assessmentId} className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">
            {`${t(`performance.vocabulary.reviewerRole.${assessment.assessmentKind}`)} · ${short(assessment.assessorEmploymentId)}`}
          </h3>
          <p className="text-xs opacity-70">{t(countsNote(assessment.assessmentKind))}</p>

          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Figure t={t} label="score" value={scoreText(assessment.overallScore)} />
            <Figure
              t={t}
              label="status"
              value={t(`performance.vocabulary.assessmentStatus.${assessment.status}`)}
            />
            <Figure t={t} label="submittedAt" value={instant(assessment.submittedAt, language)} />
          </dl>

          <Table t={t} headers={['component', 'score', 'excluded', 'exclusionReason', 'comment']}>
            {assessment.items.map((item) => (
              <tr key={item.assessmentItemId}>
                <td>{short(item.goalId ?? item.competencyId)}</td>
                <td>{scoreText(item.score)}</td>
                <td>{item.excluded ? t('performance.label.excluded') : '—'}</td>
                <td>
                  {item.exclusionReason === undefined
                    ? '—'
                    : t(`performance.vocabulary.exclusionReason.${item.exclusionReason}`)}
                </td>
                <td>{item.comment ?? '—'}</td>
              </tr>
            ))}
          </Table>
        </div>
      ))
    )}
  </Section>
);
