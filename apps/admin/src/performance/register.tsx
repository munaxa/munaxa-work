import type { ReactNode } from 'react';
import type { CycleView, GoalView, ReviewView } from '@work/performance/contracts';

import { count, day, instant, reference } from './exact';
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
  Refused,
  Row,
  Rows,
  Term,
  When,
  Wrote,
  shownOf,
} from './frame';
import type { Listing } from './api';
import { nameIn, type Language, type Translate } from './locale';
import { scoreText, weightText } from './scoring';
import { CYCLE_TONE, GOAL_TONE, REVIEW_TONE } from './tones';

/**
 * The performance register: which cycles exist, which reviews are in the running one, and which
 * goals they are measured against.
 *
 * **The queue and the goal list open one record each.** That is the whole difference between this
 * screen and the one it replaced: a review is a thing you open, not a row whose rating happens to
 * be rendered four sections further down because it was first in the page.
 *
 * **Every listing names the cycle it is scoped to.** `/goals`, `/reviews`, `/calibration-sessions`,
 * `/talent/matrix` and `/reconciliation` are all filtered by `cycleId` at the server, and a queue
 * headed "Reviews" with no cycle beside it reads as the tenant's whole review set.
 *
 * **No figure here is counted in the browser.** The screen this replaced showed "Reviews completed",
 * "Awaiting manager assessment" and "Awaiting calibration" beside the server's own totals, each
 * computed by filtering the fifty rows it happened to have fetched — and the third invented a state
 * the domain does not publish at all, from "has a score and is not completed". A tenant with four
 * thousand reviews was told twelve were complete. Those three figures are gone: what is left is the
 * cycle's own `participantCount` and each listing's `PagedResult.total`.
 */

export interface RegisterProps {
  readonly t: Translate;
  readonly language: Language;
}

/**
 * The cycle the scoped listings describe, as facts rather than as counters.
 *
 * `participantCount` is the cycle's own published figure. The four due dates are civil dates and are
 * rendered as stored — a review deadline moved by a timezone conversion is a deadline somebody
 * misses.
 */
export const CycleSummary = ({
  t,
  language,
  cycle,
}: RegisterProps & { readonly cycle: CycleView | undefined }): ReactNode =>
  cycle === undefined ? undefined : (
    <Facts>
      <Fact
        label={t('performance.label.cycle')}
        value={<Wrote>{nameIn(cycle.name, language)}</Wrote>}
      />
      <Fact label={t('performance.label.code')} value={<Isolated>{cycle.code}</Isolated>} />
      <Fact
        label={t('performance.label.status')}
        value={
          <Term t={t} group="cycleStatus" value={cycle.status} tone={CYCLE_TONE[cycle.status]} />
        }
      />
      <Fact
        label={t('performance.label.periodStart')}
        value={<Isolated>{day(cycle.periodStart)}</Isolated>}
      />
      <Fact
        label={t('performance.label.periodEnd')}
        value={<Isolated>{day(cycle.periodEnd)}</Isolated>}
      />
      <Fact
        label={t('performance.label.participants')}
        value={<Figure>{count(cycle.participantCount)}</Figure>}
      />
      <Fact
        label={t('performance.label.managerAssessmentDue')}
        value={<Isolated>{day(cycle.managerAssessmentDue)}</Isolated>}
      />
      <Fact
        label={t('performance.label.calibrationDue')}
        value={<Isolated>{day(cycle.calibrationDue)}</Isolated>}
      />
      <Fact
        label={t('performance.label.template')}
        value={<Reference value={reference(cycle.reviewTemplateId)} />}
      />
    </Facts>
  );

/** Every cycle the tenant has, with its own state and its own participant count. */
export const CyclesSection = ({
  t,
  language,
  cycles,
}: RegisterProps & { readonly cycles: Listing<CycleView> | undefined }): ReactNode => {
  const title = t('performance.label.cycles');

  if (cycles === undefined)
    return <Refused t={t} title={title} reason="performance.withheld.cycles" />;
  if (cycles.items.length === 0)
    return <Clear t={t} title={title} message="performance.notice.noCycles" />;

  return (
    <PerformanceSection title={title} description={shownOf(cycles)}>
      <Rows
        headings={[
          t('performance.label.code'),
          t('performance.label.name'),
          t('performance.label.kind'),
          t('performance.label.status'),
          t('performance.label.periodStart'),
          t('performance.label.periodEnd'),
          t('performance.label.participants'),
        ]}
        numeric={[6]}
      >
        {cycles.items.map((cycle) => (
          <Row key={cycle.cycleId}>
            <Cell>
              <Isolated>{cycle.code}</Isolated>
            </Cell>
            <Cell>
              <Wrote>{nameIn(cycle.name, language)}</Wrote>
            </Cell>
            <Cell>{t(`performance.vocabulary.cycleKind.${cycle.kind}`)}</Cell>
            <Cell>
              <Term
                t={t}
                group="cycleStatus"
                value={cycle.status}
                tone={CYCLE_TONE[cycle.status]}
              />
            </Cell>
            <When>
              <Isolated>{day(cycle.periodStart)}</Isolated>
            </When>
            <When>
              <Isolated>{day(cycle.periodEnd)}</Isolated>
            </When>
            <Cell numeric>
              <Figure>{count(cycle.participantCount)}</Figure>
            </Cell>
          </Row>
        ))}
      </Rows>
    </PerformanceSection>
  );
};

/** One review row: who it is about, who is assessing, where it has got to, and what it is worth. */
const ReviewRow = ({
  t,
  language,
  review,
}: RegisterProps & { readonly review: ReviewView }): ReactNode => (
  <Row>
    <Opens
      href={`/performance/reviews/${review.reviewId}`}
      label={t('performance.label.openReview')}
      value={reference(review.reviewId)}
    />
    <Identifier value={reference(review.employmentId)} />
    <Identifier value={reference(review.managerEmploymentId)} />
    <Cell>
      <Term t={t} group="reviewStatus" value={review.status} tone={REVIEW_TONE[review.status]} />
    </Cell>
    <Cell numeric>
      <Figure>{scoreText(review.calculatedScore)}</Figure>
    </Cell>
    {/* The published final score, or nothing. Never the calculated one under this heading. */}
    <Cell numeric>
      <Figure>{scoreText(review.finalScore)}</Figure>
    </Cell>
    <When>
      <Isolated>{instant(review.completedAt, language)}</Isolated>
    </When>
  </Row>
);

/**
 * The review queue for the running cycle.
 *
 * The rows carry the two employment identifiers in full. Resolving either to a name is Employment's
 * read behind Employment's permission, and doing it here would be one request per row.
 */
export const ReviewQueueSection = ({
  t,
  language,
  reviews,
  cycle,
}: RegisterProps & {
  readonly reviews: Listing<ReviewView> | undefined;
  readonly cycle: CycleView | undefined;
}): ReactNode => {
  const title = t('performance.label.reviews');

  if (cycle === undefined) return undefined;
  if (reviews === undefined)
    return <Refused t={t} title={title} reason="performance.withheld.reviews" />;
  if (reviews.items.length === 0)
    return <Clear t={t} title={title} message="performance.notice.noReviews" />;

  return (
    <PerformanceSection title={title} description={shownOf(reviews)}>
      <Rows
        headings={[
          t('performance.label.review'),
          t('performance.label.employment'),
          t('performance.label.manager'),
          t('performance.label.status'),
          t('performance.label.calculatedScore'),
          t('performance.label.finalScore'),
          t('performance.label.completedAt'),
        ]}
        numeric={[4, 5]}
      >
        {reviews.items.map((review) => (
          <ReviewRow key={review.reviewId} t={t} language={language} review={review} />
        ))}
      </Rows>
      <Note t={t} message="performance.notice.scopedToCycle" />
    </PerformanceSection>
  );
};

/** One goal row: what was set, who owns it, what it is worth and how far the domain says it has got. */
const GoalRow = ({ t, goal }: { readonly t: Translate; readonly goal: GoalView }): ReactNode => (
  <Row>
    <Opens
      href={`/performance/goals/${goal.goalId}`}
      label={goal.title}
      value={reference(goal.goalId)}
    />
    <Identifier value={reference(goal.employmentId ?? goal.organizationUnitId)} />
    <Cell>{t(`performance.vocabulary.goalScope.${goal.scope}`)}</Cell>
    <Cell numeric>
      <Figure>{weightText(goal.weightBasisPoints)}</Figure>
    </Cell>
    <Cell numeric>
      <Figure>{weightText(goal.progressBasisPoints)}</Figure>
    </Cell>
    <When>
      <Isolated>{day(goal.dueDate)}</Isolated>
    </When>
    <Cell>
      <Term t={t} group="goalStatus" value={goal.status} tone={GOAL_TONE[goal.status]} />
    </Cell>
  </Row>
);

/** The goals of the running cycle. Filtered by the server, never here. */
export const GoalsSection = ({
  t,
  goals,
  cycle,
}: {
  readonly t: Translate;
  readonly goals: Listing<GoalView> | undefined;
  readonly cycle: CycleView | undefined;
}): ReactNode => {
  const title = t('performance.label.goals');

  if (cycle === undefined) return undefined;
  if (goals === undefined)
    return <Refused t={t} title={title} reason="performance.withheld.goals" />;
  if (goals.items.length === 0)
    return <Clear t={t} title={title} message="performance.notice.noGoals" />;

  return (
    <PerformanceSection title={title} description={shownOf(goals)}>
      <Rows
        headings={[
          t('performance.label.goal'),
          t('performance.label.owner'),
          t('performance.label.scope'),
          t('performance.label.weight'),
          t('performance.label.progress'),
          t('performance.label.dueDate'),
          t('performance.label.status'),
        ]}
        numeric={[3, 4]}
      >
        {goals.items.map((goal) => (
          <GoalRow key={goal.goalId} t={t} goal={goal} />
        ))}
      </Rows>
      <Note t={t} message="performance.notice.scopedToCycle" />
    </PerformanceSection>
  );
};
