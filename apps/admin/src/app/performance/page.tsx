import type { ReactNode } from 'react';

import { loadPerformance, type PerformanceForDisplay } from '../../performance/api';
import { directionOf, isLanguage, translator, type Language } from '../../performance/locale';
import {
  CategoriesSection,
  CyclesSection,
  FrameworksSection,
  ScalesSection,
  TemplatesSection,
} from '../../performance/configuration';
import { GoalsSection, ProgressSection } from '../../performance/goals';
import { OverviewSection, UnavailableSection } from '../../performance/overview';
import {
  CalibrationSection,
  FeedbackSection,
  FindingsSection,
  PanelSection,
  TalentSection,
} from '../../performance/panel';
import {
  AssessmentsSection,
  RatingSection,
  ReviewQueueSection,
  WorkingSection,
} from '../../performance/reviews';
import type { SectionProps } from '../../performance/sections';

/**
 * The performance screen: cycles, configuration, goals, reviews, the panel, calibration, the
 * nine-box and feedback.
 *
 * Presentation only: it consumes the module's published contracts through the API and holds no
 * business logic of its own — no score computed a second time, no rule about who may read a review,
 * no rating derived here. Those live in the domain and the application service, and a screen that
 * reimplemented them would be a second, weaker answer to a question the API already decided. **It
 * reaches no repository and no database.**
 *
 * **`?lang=ar`** switches language *and* direction together. Direction follows language and is never
 * a separate control — separating them is how a page ends up left-aligned in Arabic.
 *
 * **Nothing on this page mutates anything.** There is no form, no button that posts and no state
 * this screen owns, which is the shape every Admin screen in this product has. Where a state permits
 * an action, the page names it and says the server decides — see `lifecycle.ts`. A workspace that
 * offered controls would be a second UI architecture, and one that offered controls the API would
 * refuse would be worse than offering none.
 *
 * **There is no "My Team".** The API honours a manager filter only for a caller who could already
 * read everything, so a picker here would be an administrator's filter wearing an employee's
 * identity. This product cannot yet resolve a signed-in person to their employment; the screen says
 * so rather than faking it.
 */
export default async function PerformancePage({
  searchParams,
}: {
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const parameters = (await searchParams) ?? {};
  const requested = parameters['lang'];
  const language: Language = isLanguage(typeof requested === 'string' ? requested : undefined)
    ? (requested as Language)
    : 'en';
  const t = translator(language);
  const performance = await loadPerformance();
  const props = { t, language };

  return (
    <div dir={directionOf(language)} className="flex flex-col gap-6 p-8">
      <h1 className="text-2xl font-medium">{t('performance.label.performance')}</h1>

      <OverviewSection
        {...props}
        cycle={performance.cycle}
        cycles={performance.cycles}
        reviews={performance.reviews}
        reviewsTotal={performance.reviewsTotal}
        goalsTotal={performance.goalsTotal}
        unavailable={performance.unavailable}
      />

      <Configuration {...props} performance={performance} />
      <Work {...props} performance={performance} />
      <Outcomes {...props} performance={performance} />

      <UnavailableSection {...props} />
    </div>
  );
}

interface Workspace extends SectionProps {
  readonly performance: PerformanceForDisplay;
}

/** What the tenant rates against, and the cycles that run on it. */
const Configuration = ({ performance, ...props }: Workspace): ReactNode => (
  <>
    <CyclesSection {...props} cycles={performance.cycles} cycle={performance.cycle} />
    <ScalesSection {...props} scales={performance.scales} />
    <FrameworksSection {...props} frameworks={performance.frameworks} />
    <TemplatesSection {...props} templates={performance.templates} />
    <CategoriesSection {...props} categories={performance.categories} />
  </>
);

/** The work being measured, and the reviews measuring it. */
const Work = ({ performance, ...props }: Workspace): ReactNode => (
  <>
    <GoalsSection {...props} goals={performance.goals} total={performance.goalsTotal} />
    <ProgressSection {...props} goal={performance.goals[0]} />
    <ReviewQueueSection {...props} reviews={performance.reviews} total={performance.reviewsTotal} />
    <RatingSection {...props} detail={performance.review} />
    <WorkingSection {...props} detail={performance.review} />
    <AssessmentsSection {...props} assessments={performance.review?.assessments ?? []} />
  </>
);

/** What came out of it: the panel, the moderation, the matrix, the feedback, the findings. */
const Outcomes = ({ performance, ...props }: Workspace): ReactNode => (
  <>
    <PanelSection
      {...props}
      reviewers={performance.review?.reviewers ?? []}
      aggregate={performance.review?.peerAggregate}
    />
    <CalibrationSection {...props} sessions={performance.sessions} />
    <TalentSection
      {...props}
      placements={performance.placements}
      withheld={performance.talentWithheld}
    />
    <FeedbackSection {...props} feedback={performance.feedback} />
    <FindingsSection
      {...props}
      findings={performance.findings}
      withheld={performance.findingsWithheld}
    />
  </>
);
