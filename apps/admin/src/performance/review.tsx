import type { ReactNode } from 'react';
import type {
  CalibrationDecisionView,
  ComponentScoreView,
  CycleView,
  ReviewDetailView,
  ReviewView,
} from '@work/performance/contracts';
import type { EmploymentView } from '@work/employment/contracts';

import { count, day, instant, reference } from './exact';
import {
  Cell,
  Clear,
  Fact,
  Facts,
  Figure,
  Isolated,
  Note,
  PerformanceSection,
  Reference,
  Row,
  Rows,
  Sentence,
  Term,
  When,
  Wrote,
} from './frame';
import { nameIn, personIn, type Language, type Translate } from './locale';
import { scoreText, weightText } from './scoring';
import { REVIEW_TONE } from './tones';

/**
 * One review: who it is about, where it has got to, what it scored and how.
 *
 * This is the page the screen it replaced did not have. That screen rendered a review's rating, its
 * working, its assessments and its panel across four sections built from `reviews.items[0]` — the
 * first row of the first page of the running cycle — with nothing anywhere saying whose review it
 * was. Four sections described a person nobody had chosen to look at.
 *
 * **The subject is named where Employment permits it, and is an identifier where it does not.**
 * Two bounded reads, one for the subject and one for the manager, made on this page only.
 * `personName` is present only when the caller may read the person, which Employment decides.
 *
 * **The calculated score and the final score are separate fields, both shown as published.** A
 * review with no final score shows no final score. The screen this replaced substituted the
 * calculated one under a heading that said final, which told a reader a rating had been settled
 * when it had not.
 *
 * **Calibration sits beside the engine's number, never over it.** A trigger refuses an update that
 * would change the original, so both are displayed and the screen says whether a human actually
 * moved it — a panel that examined a rating and confirmed it is not an override.
 */

export interface ReviewProps {
  readonly t: Translate;
  readonly language: Language;
}

/** The employment a row is about, named if Employment answered and an identifier if it did not. */
const Subject = ({
  employment,
  employmentId,
  language,
}: {
  readonly employment: EmploymentView | undefined;
  readonly employmentId: string | undefined;
  readonly language: Language;
}): ReactNode => {
  const name = personIn(employment?.personName, language);

  return name === undefined ? (
    <Reference value={reference(employmentId)} />
  ) : (
    <span className="flex flex-col gap-0.5">
      <Wrote>{name}</Wrote>
      <Reference value={reference(employmentId)} />
    </span>
  );
};

/** Who the review is about, which cycle it belongs to, and what state the domain says it is in. */
export const ReviewHeader = ({
  t,
  language,
  review,
  cycle,
  subject,
  manager,
}: ReviewProps & {
  readonly review: ReviewView;
  readonly cycle: CycleView | undefined;
  readonly subject: EmploymentView | undefined;
  readonly manager: EmploymentView | undefined;
}): ReactNode => (
  <Facts>
    <Fact
      label={t('performance.label.employment')}
      value={
        <Subject employment={subject} employmentId={review.employmentId} language={language} />
      }
    />
    <Fact
      label={t('performance.label.manager')}
      value={
        <Subject
          employment={manager}
          employmentId={review.managerEmploymentId}
          language={language}
        />
      }
    />
    <Fact
      label={t('performance.label.status')}
      value={
        <Term t={t} group="reviewStatus" value={review.status} tone={REVIEW_TONE[review.status]} />
      }
    />
    <Fact
      label={t('performance.label.cycle')}
      value={
        cycle === undefined ? (
          <Reference value={reference(review.cycleId)} />
        ) : (
          <span className="flex flex-col gap-0.5">
            <Wrote>{nameIn(cycle.name, language)}</Wrote>
            <Isolated>{`${cycle.code} · ${day(cycle.periodStart)} – ${day(cycle.periodEnd)}`}</Isolated>
          </span>
        )
      }
    />
    <Fact
      label={t('performance.label.scoredAt')}
      value={<Isolated>{instant(review.scoredAt, language)}</Isolated>}
    />
    <Fact
      label={t('performance.label.completedAt')}
      value={<Isolated>{instant(review.completedAt, language)}</Isolated>}
    />
  </Facts>
);

/**
 * The rating: the engine's number, the final number, and — where a panel sat — both of theirs.
 *
 * Every value is published. `calibrated` is the review's own boolean; whether a human *moved* the
 * number is read from the decision's own two fields, which is a comparison of two published values
 * rather than a derivation of a new one.
 */
export const RatingSection = ({
  t,
  language,
  review,
  calibration,
}: ReviewProps & {
  readonly review: ReviewView;
  readonly calibration: CalibrationDecisionView | undefined;
}): ReactNode => (
  <PerformanceSection title={t('performance.label.rating')}>
    <Facts>
      <Fact
        label={t('performance.label.calculatedScore')}
        value={<Figure>{scoreText(review.calculatedScore)}</Figure>}
      />
      <Fact
        label={t('performance.label.finalScore')}
        value={<Figure>{scoreText(review.finalScore)}</Figure>}
      />
      <Fact
        label={t('performance.label.ratingLevel')}
        value={<Reference value={reference(review.finalRatingLevelId)} />}
      />
    </Facts>

    {calibration === undefined ? (
      <Note t={t} message="performance.withheld.notCalibrated" />
    ) : (
      <>
        <Rows
          headings={[
            t('performance.label.originalScore'),
            t('performance.label.calibratedScore'),
            t('performance.label.reason'),
            t('performance.label.decidedBy'),
            t('performance.label.decidedAt'),
          ]}
          numeric={[0, 1]}
        >
          <Row>
            <Cell numeric>
              <Figure>{scoreText(calibration.originalScore)}</Figure>
            </Cell>
            <Cell numeric>
              <Figure>{scoreText(calibration.calibratedScore)}</Figure>
            </Cell>
            <Sentence>{calibration.reason}</Sentence>
            <Cell>
              <Reference value={reference(calibration.decidedBy)} />
            </Cell>
            <When>
              <Isolated>{instant(calibration.decidedAt, language)}</Isolated>
            </When>
          </Row>
        </Rows>
        <Note t={t} message="performance.notice.calibrationKept" />
      </>
    )}
  </PerformanceSection>
);

/** One component of the working, with the denominator it was scored against. */
const ComponentRow = ({
  t,
  component,
}: {
  readonly t: Translate;
  readonly component: ComponentScoreView;
}): ReactNode => (
  <Row>
    <Cell>{t(`performance.vocabulary.scoreComponent.${component.component}`)}</Cell>
    <Cell numeric>
      <Figure>{weightText(component.weightBasisPoints)}</Figure>
    </Cell>
    <Cell numeric>
      <Figure>{weightText(component.denominatorBasisPoints)}</Figure>
    </Cell>
    <Cell numeric>
      <Figure>{scoreText(component.score)}</Figure>
    </Cell>
    <Cell numeric>
      <Figure>{scoreText(component.contributedScore)}</Figure>
    </Cell>
    <Cell>
      {component.included ? (
        <Term t={t} group="inclusion" value="included" tone="success" />
      ) : (
        <Term t={t} group="inclusion" value="excluded" tone="muted" />
      )}
    </Cell>
    <Cell>
      {component.exclusionReason === undefined ? (
        <span>{'—'}</span>
      ) : (
        t(`performance.vocabulary.exclusionReason.${component.exclusionReason}`)
      )}
    </Cell>
    <Cell numeric>
      <Figure>{count(component.excludedItems.length)}</Figure>
    </Cell>
  </Row>
);

/**
 * The working: what each component was worth, what it scored, and what left the denominator.
 *
 * `denominatorBasisPoints` is shown beside the weight because they differ exactly when something
 * was excluded, and the difference is the arithmetic an administrator is being asked to trust. A
 * component nobody assessed leaves the denominator with its reason recorded rather than being
 * scored zero — rating somebody down for work nobody assessed is what that rule prevents.
 */
export const WorkingSection = ({
  t,
  detail,
}: {
  readonly t: Translate;
  readonly detail: ReviewDetailView;
}): ReactNode => {
  const title = t('performance.label.components');

  if (detail.componentScores.length === 0)
    return <Clear t={t} title={title} message="performance.notice.notScored" />;

  return (
    <PerformanceSection title={title}>
      <Rows
        headings={[
          t('performance.label.component'),
          t('performance.label.weight'),
          t('performance.label.denominator'),
          t('performance.label.score'),
          t('performance.label.contribution'),
          t('performance.label.inclusion'),
          t('performance.label.exclusionReason'),
          t('performance.label.excludedItems'),
        ]}
        numeric={[1, 2, 3, 4, 7]}
      >
        {detail.componentScores.map((component) => (
          <ComponentRow key={component.component} t={t} component={component} />
        ))}
      </Rows>
      <Note t={t} message="performance.notice.exactScore" />
    </PerformanceSection>
  );
};
