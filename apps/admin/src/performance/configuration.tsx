import type { ReactNode } from 'react';
import type {
  CompetencyFrameworkView,
  CycleView,
  GoalCategoryView,
  RatingScaleView,
  ReviewTemplateView,
} from '@work/performance/contracts';

import { cycleActionsFor, cycleWithheldBecause } from './lifecycle';
import { scoreText, weightText } from './scoring';
import { Actions, Empty, Section, Status, Table, named, type SectionProps } from './sections';

/**
 * What a tenant rates against: scales, frameworks, competencies, templates, categories — and the
 * cycles that run on them.
 *
 * **The 10,000 basis-point rule is on the screen, not in the head.** A template's components are
 * shown with their weights and their total, and the total is labelled against the whole. The domain
 * refuses a template whose components do not sum to one whole rather than normalizing them, so an
 * administrator who sees 9,000 here is looking at a template the API would have refused — the
 * screen states the rule rather than silently rescaling anything.
 *
 * **Retirement is not deletion.** A retired scale or template shows as inactive and stays on the
 * screen, because completed reviews carry a frozen copy of the one they were rated against and a
 * screen that hid it would make a historical rating unexplainable.
 */

export const ScalesSection = ({
  t,
  language,
  scales,
}: SectionProps & { readonly scales: readonly RatingScaleView[] }): ReactNode => (
  <Section t={t} title="ratingScales" note="performance.notice.exactScore">
    {scales.length === 0 ? (
      <Empty t={t} />
    ) : (
      <Table
        t={t}
        headers={['code', 'name', 'minimumScore', 'maximumScore', 'effectiveFrom', 'status']}
      >
        {scales.map((scale) => (
          <tr key={scale.ratingScaleId}>
            <td>{scale.code}</td>
            <td>{named(scale.name, language)}</td>
            {/* Hundredths, rendered by inserting a point. Never divided by a hundred. */}
            <td>{scoreText(scale.minimumScore)}</td>
            <td>{scoreText(scale.maximumScore)}</td>
            {/* A civil date, rendered as stored. A scale takes effect on a date, not an instant. */}
            <td>{scale.effectiveFrom}</td>
            <td>
              {scale.active ? t('performance.label.available') : t('performance.action.retire')}
            </td>
          </tr>
        ))}
      </Table>
    )}
  </Section>
);

export const FrameworksSection = ({
  t,
  language,
  frameworks,
}: SectionProps & { readonly frameworks: readonly CompetencyFrameworkView[] }): ReactNode => (
  <Section t={t} title="frameworks">
    {frameworks.length === 0 ? (
      <Empty t={t} />
    ) : (
      frameworks.map((framework) => (
        <div key={framework.frameworkId} className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">
            {`${named(framework.name, language)} · ${t('performance.label.version')} ${String(framework.frameworkVersion)}`}
          </h3>

          {/* The published competency view carries no behavioural levels: they are configuration a
              framework screen would edit, and the listing publishes what a reader needs to know a
              competency *is*. Showing an empty column for them would imply the framework had none. */}
          <Table t={t} headers={['code', 'competency', 'component', 'weight', 'status']}>
            {framework.competencies.map((competency) => (
              <tr key={competency.competencyId}>
                <td>{competency.code}</td>
                <td>{named(competency.name, language)}</td>
                <td>{t(`performance.vocabulary.competencyCategory.${competency.category}`)}</td>
                {/* Absent is not zero. An unweighted competency in an unweighted framework shows a
                    dash, because the difference decides whether it leaves the denominator. */}
                <td>{weightText(competency.weightBasisPoints)}</td>
                <td>
                  {competency.active
                    ? t('performance.label.available')
                    : t('performance.action.retire')}
                </td>
              </tr>
            ))}
          </Table>
        </div>
      ))
    )}
  </Section>
);

/**
 * A template's components and what each is worth.
 *
 * The total is displayed beside the components rather than left for the reader to add up, and it is
 * the sum of integers the API returned — the one place this screen adds anything, and it adds whole
 * basis points, which is exact.
 */
export const TemplatesSection = ({
  t,
  language,
  templates,
}: SectionProps & { readonly templates: readonly ReviewTemplateView[] }): ReactNode => (
  <Section t={t} title="templates" note="performance.notice.weightsTotal">
    {templates.length === 0 ? (
      <Empty t={t} />
    ) : (
      templates.map((template) => (
        <div key={template.templateId} className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">
            {`${template.code} · ${named(template.name, language)}`}
          </h3>

          <Table t={t} headers={['component', 'weight']}>
            {template.components.map((component) => (
              <tr key={component.component}>
                <td>{t(`performance.vocabulary.scoreComponent.${component.component}`)}</td>
                <td>{weightText(component.weightBasisPoints)}</td>
              </tr>
            ))}
            <tr>
              <td className="font-medium">{t('performance.label.total')}</td>
              <td className="font-medium">
                {weightText(
                  template.components.reduce(
                    (running, each) => running + each.weightBasisPoints,
                    0,
                  ),
                )}
              </td>
            </tr>
          </Table>

          {/* Self and peer are expected or not. Neither is weighted, and no figure here says one is. */}
          <p className="text-xs opacity-70">
            {[
              template.requiresSelfAssessment ? t('performance.notice.selfNotCounted') : undefined,
              template.requiresPeerAssessment ? t('performance.notice.peerNotCounted') : undefined,
            ]
              .filter((each): each is string => each !== undefined)
              .join(' ')}
          </p>
        </div>
      ))
    )}
  </Section>
);

export const CategoriesSection = ({
  t,
  language,
  categories,
}: SectionProps & { readonly categories: readonly GoalCategoryView[] }): ReactNode => (
  <Section t={t} title="goalCategories">
    {categories.length === 0 ? (
      <Empty t={t} />
    ) : (
      <Table t={t} headers={['code', 'name', 'status']}>
        {categories.map((category) => (
          <tr key={category.goalCategoryId}>
            <td>{category.code}</td>
            <td>{named(category.name, language)}</td>
            <td>
              {category.active ? t('performance.label.available') : t('performance.action.retire')}
            </td>
          </tr>
        ))}
      </Table>
    )}
  </Section>
);

export const CyclesSection = ({
  t,
  language,
  cycles,
  cycle,
}: SectionProps & {
  readonly cycles: readonly CycleView[];
  readonly cycle: CycleView | undefined;
}): ReactNode => (
  <Section t={t} title="cycles" note="performance.notice.noSchedule">
    {cycles.length === 0 ? (
      <Empty t={t} />
    ) : (
      <>
        <Table t={t} headers={['code', 'name', 'kind', 'periodStart', 'periodEnd', 'status']}>
          {cycles.map((each) => (
            <tr key={each.cycleId}>
              <td>{each.code}</td>
              <td>{named(each.name, language)}</td>
              <td>{t(`performance.vocabulary.cycleKind.${each.kind}`)}</td>
              <td>{each.periodStart}</td>
              <td>{each.periodEnd}</td>
              <td>
                <Status t={t} group="cycleStatus" status={each.status} />
              </td>
            </tr>
          ))}
        </Table>

        <Actions t={t} actions={cycleActionsFor(cycle)} withheld={cycleWithheldBecause(cycle)} />
      </>
    )}
  </Section>
);
