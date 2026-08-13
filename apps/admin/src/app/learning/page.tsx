import type { ReactNode } from 'react';

import { loadLearning, type LearningForDisplay } from '../../learning/api';
import { directionOf, isLanguage, translator, type Language } from '../../learning/locale';
import {
  AssessmentsSection,
  CategoriesSection,
  CoursesSection,
  VersionsSection,
} from '../../learning/catalogue';
import { PathsSection, StepsSection } from '../../learning/paths';
import { ReconciliationSection, RulesSection } from '../../learning/compliance';
import { AssignmentsSection, EnrolmentsSection, ResultsSection } from '../../learning/records';
import {
  CertificationsSection,
  HistorySection,
  InstructorsSection,
} from '../../learning/attainment';
import { OverviewSection, UnavailableSection } from '../../learning/overview';
import type { SectionProps } from '../../learning/sections';

/**
 * The learning screen: the catalogue, the paths, what a tenant made mandatory, what people were
 * asked to do, what they sat, what they were assessed on and what they hold.
 *
 * Presentation only: it consumes the module's published contracts through the API and holds no
 * business logic of its own — no validity derived a second time, no overdue flag recomputed, no
 * assessment totalled. Those live in the domain and the application service, and a screen that
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
 * **There is no "My Learning" and no manager view.** The API resolves a caller's scope from what
 * they hold and never from an identifier they supply, and this product cannot yet resolve a
 * signed-in person to their employment (ADR-0032). A picker here would be an administrator's filter
 * wearing an employee's identity; the screen says so rather than faking it.
 */
export default async function LearningPage({
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
  const learning = await loadLearning();
  const props = { t, language };

  return (
    <main dir={directionOf(language)} className="flex flex-col gap-6 p-8">
      <h1 className="text-2xl font-medium">{t('learning.label.learning')}</h1>

      <OverviewSection
        {...props}
        courses={learning.courses}
        coursesTotal={learning.coursesTotal}
        assignments={learning.assignments}
        assignmentsTotal={learning.assignmentsTotal}
        certifications={learning.certifications}
        certificationsTotal={learning.certificationsTotal}
        enrolmentsTotal={learning.enrolmentsTotal}
        rulesTotal={learning.rulesTotal}
        asOf={learning.asOf}
        unavailable={learning.unavailable}
      />

      <Catalogue {...props} learning={learning} />
      <Compliance {...props} learning={learning} />
      <Records {...props} learning={learning} />
      <Attainment {...props} learning={learning} />

      <UnavailableSection {...props} />
    </main>
  );
}

interface Workspace extends SectionProps {
  readonly learning: LearningForDisplay;
}

/** What the tenant offers: the courses, their versions, their assessments and the paths. */
const Catalogue = ({ learning, ...props }: Workspace): ReactNode => (
  <>
    <CoursesSection {...props} courses={learning.courses} total={learning.coursesTotal} />
    <CategoriesSection {...props} courses={learning.courses} />
    <VersionsSection
      {...props}
      course={learning.course?.course}
      versions={learning.course?.versions ?? []}
    />
    <AssessmentsSection {...props} assessments={learning.course?.assessments ?? []} />
    <PathsSection {...props} paths={learning.paths} total={learning.pathsTotal} />
    <StepsSection {...props} path={learning.path} />
  </>
);

/** What the tenant made mandatory, and what running it has already produced. */
const Compliance = ({ learning, ...props }: Workspace): ReactNode => (
  <>
    <RulesSection
      {...props}
      rules={learning.rules}
      assignments={learning.assignments}
      total={learning.rulesTotal}
    />
    <ReconciliationSection
      {...props}
      rules={learning.rules}
      assignments={learning.assignments}
      asOf={learning.asOf}
    />
  </>
);

/** What people were asked to do, what they sat, and what an assessor wrote down. */
const Records = ({ learning, ...props }: Workspace): ReactNode => (
  <>
    <AssignmentsSection
      {...props}
      assignments={learning.assignments}
      total={learning.assignmentsTotal}
      asOf={learning.asOf}
    />
    <EnrolmentsSection
      {...props}
      enrolments={learning.enrolments}
      total={learning.enrolmentsTotal}
    />
    <ResultsSection {...props} results={learning.results} />
  </>
);

/** What they hold, who taught it, and one person's record end to end. */
const Attainment = ({ learning, ...props }: Workspace): ReactNode => (
  <>
    <CertificationsSection
      {...props}
      certifications={learning.certifications}
      total={learning.certificationsTotal}
      asOf={learning.asOf}
    />
    <InstructorsSection
      {...props}
      instructors={learning.instructors}
      total={learning.instructorsTotal}
    />
    <HistorySection {...props} history={learning.history} />
  </>
);
