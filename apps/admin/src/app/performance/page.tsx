import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { EmptyState, Page, PageHeader, Stack } from '@munaxa/ui';

import { loadPerformanceRegister, registerAnsweredNothing } from '../../performance/api';
import {
  directionOf,
  isLanguage,
  performanceTranslator,
  type Language,
} from '../../performance/locale';
import { Boundaries } from '../../performance/frame';
import {
  CyclesSection,
  CycleSummary,
  GoalsSection,
  ReviewQueueSection,
} from '../../performance/register';
import {
  CategoriesSection,
  FrameworksSection,
  ScalesSection,
  TemplatesSection,
} from '../../performance/configuration';
import {
  CalibrationSection,
  FeedbackSection,
  FindingsSection,
  TalentSection,
} from '../../performance/outcomes';

/**
 * Performance, as work rather than as sixteen cards.
 *
 * The screen this replaced stacked sixteen sections down one column, and five of them — the rating,
 * the working, the assessments, the panel and the progress history — described **whichever record
 * happened to be first** in the page the API returned, with nothing anywhere naming it. It opened
 * nothing at all: there was no route in this application that could show one review or one goal.
 *
 * The order here is an HR administrator's own: which cycle is running, then **the review queue**,
 * because that is the work, then the goals those reviews are measured against, then what came out
 * of the cycle, and only then the configuration everybody is rated by.
 *
 * **Every figure is the server's.** The cycle block is the cycle's own published fields; the count
 * beside each section is `PagedResult.total`. The three figures the old overview counted in the
 * browser from one page of fifty rows — completed, awaiting manager assessment, awaiting
 * calibration — are gone, and the third was worse than a miscount: it derived a state the domain
 * does not publish from "has a score and is not completed".
 *
 * **`?lang=ar`** switches language *and* direction together.
 *
 * **It offers no control.** Opening a cycle, assessing, scoring, calibrating, completing and
 * archiving are writes, and a request from this portal carries no principal, so a button here would
 * post unauthenticated and answer 401.
 *
 * **There is no "My Team".** The API honours `managerEmploymentId` only for a caller who could
 * already read everything, so a picker here would be an administrator's filter wearing an
 * employee's identity. This product cannot yet resolve a signed-in person to their employment.
 */

export const metadata: Metadata = { title: 'Performance' };

interface PageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const single = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const BOUNDARIES = [
  'performance.notice.readTeamUnavailable',
  'performance.notice.noNotifications',
  'performance.notice.noSchedule',
  'performance.notice.noDocumentBytes',
  'performance.notice.notAnonymous',
  'performance.notice.noOkr',
];

const PerformancePage = async ({ searchParams }: PageProps): Promise<ReactNode> => {
  const parameters = await searchParams;
  const requested = single(parameters['lang']);
  const language: Language = isLanguage(requested) ? requested : 'en';
  const t = performanceTranslator(language);
  const register = await loadPerformanceRegister();
  const props = { t, language };

  return (
    <div dir={directionOf(language)} lang={language}>
      <Page width="wide">
        <PageHeader
          title={t('performance.label.performance')}
          description={t('performance.label.performanceLead')}
        />

        {registerAnsweredNothing(register) ? (
          <EmptyState
            title={t('performance.label.nothingReadable')}
            description={t('performance.notice.unauthenticated')}
          />
        ) : (
          <>
            <CycleSummary {...props} cycle={register.cycle} />

            <Stack gap={8}>
              <ReviewQueueSection {...props} reviews={register.reviews} cycle={register.cycle} />
              <GoalsSection t={t} goals={register.goals} cycle={register.cycle} />
              <CalibrationSection {...props} sessions={register.sessions} cycle={register.cycle} />
              <TalentSection t={t} placements={register.placements} cycle={register.cycle} />
              <FeedbackSection {...props} feedback={register.feedback} cycle={register.cycle} />
              <FindingsSection t={t} findings={register.findings} cycle={register.cycle} />
              <CyclesSection {...props} cycles={register.cycles} />
              <ScalesSection {...props} scales={register.scales} />
              <FrameworksSection {...props} frameworks={register.frameworks} />
              <TemplatesSection {...props} templates={register.templates} />
              <CategoriesSection {...props} categories={register.categories} />
            </Stack>
          </>
        )}

        <Boundaries t={t} keys={BOUNDARIES} />
      </Page>
    </div>
  );
};

export default PerformancePage;
