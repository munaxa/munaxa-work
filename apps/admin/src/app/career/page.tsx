import type { ReactNode } from 'react';

import { loadCareer, type CareerForDisplay } from '../../career/api';
import { directionOf, isLanguage, translator, type Language } from '../../career/locale';
import { OverviewSection, SummarySection } from '../../career/overview';
import { PathsSection, PlansSection, StagesSection } from '../../career/paths';
import { MembershipsSection, PoolsSection } from '../../career/pools';
import { BenchSection, SuccessionSection, SuccessorsSection } from '../../career/succession';
import { LevelsSection, ReadinessSection } from '../../career/readiness';
import { DevelopmentSection, ItemsSection, MobilitySection } from '../../career/development';
import { StatusSection } from '../../career/status';
import type { SectionProps } from '../../career/sections';

/**
 * The career screen: the ladders a tenant defined, who is on them, the benches it keeps, what people
 * have been judged ready for, what they agreed to do, and where somebody suggested they move next.
 *
 * Presentation only: it consumes the module's published contracts through the API and holds no
 * business logic of its own — no `inForce` derived a second time, no `reviewDue` recomputed, no
 * bench counted. Those live in the domain and the application service, and a screen that
 * reimplemented them would be a second, weaker answer to a question the API already decided. **It
 * reaches no repository, no store, no domain entity and no database.**
 *
 * **`?lang=ar`** switches language *and* direction together. Direction follows language and is never
 * a separate control — separating them is how a page ends up left-aligned in Arabic.
 *
 * **Nothing on this page mutates anything.** There is no form, no button that posts and no state
 * this screen owns, which is the shape every Admin screen in this product has. Where a state permits
 * a transition, the page names it and says the server decides — see `lifecycle.ts`. A workspace that
 * offered controls would be a second UI architecture, and one that offered controls the API would
 * refuse would be worse than offering none.
 *
 * **There is no "My Career" and no "My Team".** The API resolves a caller's scope from what they
 * hold and never from an identifier they supply, and this product cannot yet resolve a signed-in
 * person to their employment (ADR-0032). The two reads that name an employment name one an
 * administrator's own listing already returned; they are an administrator reading a record, not a
 * person reading their own. The status section says so rather than faking it.
 *
 * **No position on this page is called critical.** Career stores a `position_id` on a succession
 * plan and no property of it, has no criticality filter to ask with, and this screen adds none
 * (D-4). **No nine-box band or potential rating appears against a nomination**, because Career holds
 * none and this screen consumes no Performance contract (D-5).
 */
export default async function CareerPage({
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
  const career = await loadCareer();
  const props = { t, language };

  return (
    <main dir={directionOf(language)} className="flex flex-col gap-6 p-8">
      <h1 className="text-2xl font-medium">{t('career.label.career')}</h1>

      <OverviewSection
        {...props}
        pathsTotal={career.pathsTotal}
        plansTotal={career.plansTotal}
        poolsTotal={career.poolsTotal}
        membershipsTotal={career.membershipsTotal}
        successionPlansTotal={career.successionPlansTotal}
        recommendationsTotal={career.recommendationsTotal}
        levelCount={career.levels.length}
        asOf={career.asOf}
        unavailable={career.unavailable}
      />
      <SummarySection {...props} summary={career.summary} />

      <Ladders {...props} career={career} />
      <Pools {...props} career={career} />
      <Succession {...props} career={career} />
      <Readiness {...props} career={career} />
      <Development {...props} career={career} />

      <StatusSection {...props} />
    </main>
  );
}

interface Workspace extends SectionProps {
  readonly career: CareerForDisplay;
}

/** What a tenant says a career can look like, and who is on one. */
const Ladders = ({ career, ...props }: Workspace): ReactNode => (
  <>
    <PathsSection {...props} paths={career.paths} total={career.pathsTotal} />
    <StagesSection {...props} detail={career.path} />
    <PlansSection {...props} plans={career.plans} total={career.plansTotal} />
  </>
);

/** The groups an organization maintains, and who it decided belongs in one. */
const Pools = ({ career, ...props }: Workspace): ReactNode => (
  <>
    <PoolsSection {...props} pools={career.pools} total={career.poolsTotal} />
    <MembershipsSection
      {...props}
      memberships={career.memberships}
      total={career.membershipsTotal}
    />
  </>
);

/** The benches, the people on one of them, and how strong it is. */
const Succession = ({ career, ...props }: Workspace): ReactNode => (
  <>
    <SuccessionSection
      {...props}
      plans={career.successionPlans}
      total={career.successionPlansTotal}
      withheld={career.successionWithheld}
    />
    <SuccessorsSection {...props} detail={career.succession} />
    <BenchSection {...props} bench={career.bench} />
  </>
);

/** The rungs, and every statement made against them about one person. */
const Readiness = ({ career, ...props }: Workspace): ReactNode => (
  <>
    <LevelsSection {...props} levels={career.levels} />
    <ReadinessSection {...props} history={career.readiness} />
  </>
);

/** What somebody agreed to do, and where somebody suggested they go next. */
const Development = ({ career, ...props }: Workspace): ReactNode => (
  <>
    <DevelopmentSection {...props} detail={career.development} />
    <ItemsSection {...props} detail={career.development} />
    <MobilitySection
      {...props}
      recommendations={career.recommendations}
      total={career.recommendationsTotal}
      asOf={career.asOf}
    />
  </>
);
