import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { EmptyState, Page, PageHeader, Stack } from '@munaxa/ui';

import {
  categoryAmong,
  cycleAmong,
  loadDetailContext,
  loadEmployments,
  loadGoal,
} from '../../../../performance/api';
import {
  directionOf,
  isLanguage,
  performanceTranslator,
  type Language,
} from '../../../../performance/locale';
import { Boundaries, Wrote } from '../../../../performance/frame';
import { GoalHeader, GoalStatement, ProgressSection } from '../../../../performance/goal';

/**
 * One goal, opened by its own identifier, with the progress history recorded against it.
 *
 * This route consumes `GET /performance/goals/:goalId` — the one Performance read no screen in this
 * product had ever made. The register's goal list sits behind `performance.goal.read-team`; this
 * read sits behind `performance.goal.read`, a **different permission**, so a caller can see a goal
 * in the queue and be refused when they open it. That is rendered as withheld, never as a goal that
 * does not exist.
 *
 * Unlike the review route, a 404 here means exactly one thing: the module holds no goal with this
 * identifier. `readGoalHandler` returns `notFound` only for an absent row.
 *
 * **The goal's title is the page heading**, because a goal is a thing somebody wrote a sentence
 * about and the identifier is not what anybody is looking for. The identifier stays on the page.
 */

export const metadata: Metadata = { title: 'Goal' };

interface PageProps {
  readonly params: Promise<{ readonly goalId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const single = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const BOUNDARIES = [
  'performance.notice.noDocumentBytes',
  'performance.notice.exactScore',
  'performance.notice.progressAppended',
  'performance.notice.noOkr',
];

const GoalPage = async ({ params, searchParams }: PageProps): Promise<ReactNode> => {
  const { goalId } = await params;
  const requested = single((await searchParams)['lang']);
  const language: Language = isLanguage(requested) ? requested : 'en';
  const t = performanceTranslator(language);
  const answer = await loadGoal(goalId);

  if (answer.kind === 'missing') notFound();

  if (answer.kind === 'refused') {
    return (
      <div dir={directionOf(language)} lang={language}>
        <Page width="wide">
          <PageHeader title={t('performance.label.goal')} />
          <EmptyState
            title={t('performance.label.nothingReadable')}
            description={t('performance.withheld.goalRead')}
          />
        </Page>
      </div>
    );
  }

  const goal = answer.value;
  const [context, employments] = await Promise.all([
    loadDetailContext(),
    loadEmployments(goal.employmentId, undefined),
  ]);
  const props = { t, language };

  return (
    <div dir={directionOf(language)} lang={language}>
      <Page width="wide">
        <PageHeader
          title={<Wrote>{goal.title}</Wrote>}
          description={t('performance.label.goalLead')}
        />

        <GoalHeader
          {...props}
          goal={goal}
          cycle={cycleAmong(context.cycles, goal.cycleId)}
          owner={employments.subject}
          category={categoryAmong(context.categories, goal.goalCategoryId)}
        />

        <Stack gap={8}>
          <GoalStatement t={t} goal={goal} />
          <ProgressSection {...props} goal={goal} />
        </Stack>

        <a className="text-sm underline underline-offset-4" href="/performance">
          {t('performance.label.backToPerformance')}
        </a>

        <Boundaries t={t} keys={BOUNDARIES} />
      </Page>
    </div>
  );
};

export default GoalPage;
