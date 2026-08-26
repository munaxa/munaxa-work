import type { ReactNode } from 'react';
import type { CycleView, GoalCategoryView, GoalView } from '@work/performance/contracts';
import type { EmploymentView } from '@work/employment/contracts';

import { day, instant, reference } from './exact';
import {
  Cell,
  Clear,
  Fact,
  Facts,
  Figure,
  Identifier,
  Isolated,
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
import { exactText, scoreText, weightText } from './scoring';
import { GOAL_TONE } from './tones';

/**
 * One goal, with the progress history the domain recorded against it.
 *
 * `GET /performance/goals/:goalId` is the read this page exists for, and it was the one Performance
 * route no screen consumed. The screen it replaces rendered `goals[0].progress` under a heading that
 * said "Progress" and named no goal — a table of measurements about whichever goal happened to sort
 * first in the running cycle.
 *
 * **The list read and this one sit behind different permissions.** `/goals` needs
 * `performance.goal.read-team`; this needs `performance.goal.read`. A caller can therefore reach a
 * goal in the queue and be refused when they open it, and the route renders that as withheld rather
 * than as a goal that does not exist.
 *
 * **`observedValue` is rendered exactly as it arrived, and never parsed.** It is a decimal string
 * because the underlying value is a `bigint` that can exceed 2^53 — a count of transactions, of
 * bytes, of parts — and `Number('9007199254740993')` is `9007199254740992`. A measurement that
 * rounded on the way to a screen is a measurement nobody can falsify.
 *
 * **An evidence document is an identifier and nothing else.** No filename, no size, no link and no
 * download: Performance holds none of those, because no storage adapter exists in this repository.
 */

export interface GoalProps {
  readonly t: Translate;
  readonly language: Language;
}

/** The owner, named where Employment permits it and an identifier where it does not. */
const Owner = ({
  goal,
  owner,
  language,
}: {
  readonly goal: GoalView;
  readonly owner: EmploymentView | undefined;
  readonly language: Language;
}): ReactNode => {
  const name = personIn(owner?.personName, language);

  return name === undefined ? (
    <Reference value={reference(goal.employmentId ?? goal.organizationUnitId)} />
  ) : (
    <span className="flex flex-col gap-0.5">
      <Wrote>{name}</Wrote>
      <Reference value={reference(goal.employmentId)} />
    </span>
  );
};

/** The cycle the goal belongs to, named from the list the page already read. */
const Cycle = ({
  goal,
  cycle,
  language,
}: {
  readonly goal: GoalView;
  readonly cycle: CycleView | undefined;
  readonly language: Language;
}): ReactNode =>
  cycle === undefined ? (
    <Reference value={reference(goal.cycleId)} />
  ) : (
    <span className="flex flex-col gap-0.5">
      <Wrote>{nameIn(cycle.name, language)}</Wrote>
      <Isolated>{cycle.code}</Isolated>
    </span>
  );

/** What the goal is worth and where the domain says it has got to. Every figure published. */
const GoalMeasures = ({
  t,
  goal,
}: {
  readonly t: Translate;
  readonly goal: GoalView;
}): ReactNode => (
  <>
    <Fact
      label={t('performance.label.weight')}
      value={<Figure>{weightText(goal.weightBasisPoints)}</Figure>}
    />
    <Fact
      label={t('performance.label.progress')}
      value={<Figure>{weightText(goal.progressBasisPoints)}</Figure>}
    />
    <Fact
      label={t('performance.label.score')}
      value={<Figure>{scoreText(goal.finalScore)}</Figure>}
    />
    <Fact
      label={t('performance.label.startDate')}
      value={<Isolated>{day(goal.startDate)}</Isolated>}
    />
    <Fact label={t('performance.label.dueDate')} value={<Isolated>{day(goal.dueDate)}</Isolated>} />
  </>
);

/** What was set, who owns it, what it is worth and where the domain says it has got to. */
export const GoalHeader = ({
  t,
  language,
  goal,
  cycle,
  owner,
  category,
}: GoalProps & {
  readonly goal: GoalView;
  readonly cycle: CycleView | undefined;
  readonly owner: EmploymentView | undefined;
  readonly category: GoalCategoryView | undefined;
}): ReactNode => (
  <Facts>
    <Fact
      label={t('performance.label.owner')}
      value={<Owner goal={goal} owner={owner} language={language} />}
    />
    <Fact
      label={t('performance.label.scope')}
      value={t(`performance.vocabulary.goalScope.${goal.scope}`)}
    />
    <Fact
      label={t('performance.label.status')}
      value={<Term t={t} group="goalStatus" value={goal.status} tone={GOAL_TONE[goal.status]} />}
    />
    <GoalMeasures t={t} goal={goal} />
    <Fact
      label={t('performance.label.cycle')}
      value={<Cycle goal={goal} cycle={cycle} language={language} />}
    />
    <Fact
      label={t('performance.label.goalCategory')}
      value={
        category === undefined ? (
          <Reference value={reference(goal.goalCategoryId)} />
        ) : (
          <Wrote>{nameIn(category.name, language)}</Wrote>
        )
      }
    />
    <Fact
      label={t('performance.label.measurement')}
      value={t(`performance.vocabulary.goalMeasurement.${goal.measurement}`)}
    />
    <Fact
      label={t('performance.label.approvedAt')}
      value={<Isolated>{instant(goal.approvedAt, language)}</Isolated>}
    />
  </Facts>
);

/** What the goal actually says: its description and the target somebody set for it. */
export const GoalStatement = ({
  t,
  goal,
}: {
  readonly t: Translate;
  readonly goal: GoalView;
}): ReactNode =>
  goal.description === undefined && goal.targetDescription === undefined ? undefined : (
    <PerformanceSection title={t('performance.label.statement')}>
      {goal.description === undefined ? undefined : (
        <p className="text-sm text-foreground">
          <Wrote>{goal.description}</Wrote>
        </p>
      )}
      {goal.targetDescription === undefined ? undefined : (
        <p className="text-sm text-foreground">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            {`${t('performance.label.target')} · `}
          </span>
          <Wrote>{goal.targetDescription}</Wrote>
        </p>
      )}
    </PerformanceSection>
  );

/**
 * The progress history: what was recorded, when, by whom and against what measurement.
 *
 * Entries are **appended and never rewritten** — a database trigger refuses an update — so this is
 * the history of what actually happened rather than what the goal currently looks like.
 */
export const ProgressSection = ({
  t,
  language,
  goal,
}: GoalProps & { readonly goal: GoalView }): ReactNode => {
  const title = t('performance.label.progress');

  if (goal.progress.length === 0)
    return <Clear t={t} title={title} message="performance.notice.noProgress" />;

  return (
    <PerformanceSection title={title}>
      <Rows
        headings={[
          t('performance.label.progress'),
          t('performance.label.observedValue'),
          t('performance.label.comment'),
          t('performance.label.evidenceDocument'),
          t('performance.label.recordedAt'),
          t('performance.label.recordedBy'),
        ]}
        numeric={[0, 1]}
      >
        {goal.progress.map((entry) => (
          <Row key={entry.goalProgressId}>
            <Cell numeric>
              <Figure>{weightText(entry.progressBasisPoints)}</Figure>
            </Cell>
            {/* The exact string the API sent. Not parsed, not reformatted, not rounded. */}
            <Cell numeric>
              <Figure>{exactText(entry.observedValue)}</Figure>
            </Cell>
            <Sentence>{entry.note}</Sentence>
            {/* A reference. There is no link, because there is nothing to link to. */}
            <Identifier value={reference(entry.evidenceDocumentId)} />
            <When>
              <Isolated>{instant(entry.recordedAt, language)}</Isolated>
            </When>
            <Identifier value={reference(entry.recordedBy)} />
          </Row>
        ))}
      </Rows>
    </PerformanceSection>
  );
};
