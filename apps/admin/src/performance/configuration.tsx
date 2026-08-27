import type { ReactNode } from 'react';
import type {
  CompetencyFrameworkView,
  GoalCategoryView,
  RatingScaleView,
  ReviewTemplateView,
} from '@work/performance/contracts';

import { count, reference } from './exact';
import {
  Cell,
  Clear,
  Figure,
  Identifier,
  Isolated,
  Note,
  PerformanceSection,
  Refused,
  Row,
  Rows,
  Term,
  Wrote,
  shownOf,
} from './frame';
import type { Listing } from './api';
import { nameIn, type Language, type Translate } from './locale';
import { scoreText, weightText } from './scoring';

/**
 * What the tenant rates against: the scales, the competency frameworks, the review templates and
 * the goal categories.
 *
 * All four sit behind **one** permission, `performance.configure.read`, so they refuse together —
 * which is why a caller who can see the review queue may still see none of this, and why each
 * section says withheld rather than showing an empty table.
 *
 * **A component weight is basis points and the domain requires them to total 10,000.** The template
 * rows show each component's own weight exactly as published. Nothing here adds them up to check:
 * the aggregate enforces it, a check constraint enforces it, and a third arithmetic in a browser
 * would be the one that disagreed.
 */

export interface ConfigurationProps {
  readonly t: Translate;
  readonly language: Language;
}

/** The rating scales, and the levels each one is scored against. */
export const ScalesSection = ({
  t,
  language,
  scales,
}: ConfigurationProps & { readonly scales: Listing<RatingScaleView> | undefined }): ReactNode => {
  const title = t('performance.label.ratingScales');

  if (scales === undefined)
    return <Refused t={t} title={title} reason="performance.withheld.configuration" />;
  if (scales.items.length === 0)
    return <Clear t={t} title={title} message="performance.notice.noConfiguration" />;

  return (
    <PerformanceSection title={title} description={shownOf(scales)}>
      <Rows
        headings={[
          t('performance.label.code'),
          t('performance.label.name'),
          t('performance.label.minimumScore'),
          t('performance.label.maximumScore'),
          t('performance.label.level'),
        ]}
        numeric={[2, 3, 4]}
      >
        {scales.items.map((scale) => (
          <Row key={scale.ratingScaleId}>
            <Cell>
              <Isolated>{scale.code}</Isolated>
            </Cell>
            <Cell>
              <Wrote>{nameIn(scale.name, language)}</Wrote>
            </Cell>
            <Cell numeric>
              <Figure>{scoreText(scale.minimumScore)}</Figure>
            </Cell>
            <Cell numeric>
              <Figure>{scoreText(scale.maximumScore)}</Figure>
            </Cell>
            <Cell numeric>
              <Figure>{count(scale.levels.length)}</Figure>
            </Cell>
          </Row>
        ))}
      </Rows>
    </PerformanceSection>
  );
};

/** The competency frameworks, and how many competencies each carries. */
export const FrameworksSection = ({
  t,
  language,
  frameworks,
}: ConfigurationProps & {
  readonly frameworks: Listing<CompetencyFrameworkView> | undefined;
}): ReactNode => {
  const title = t('performance.label.frameworks');

  if (frameworks === undefined)
    return <Refused t={t} title={title} reason="performance.withheld.configuration" />;
  if (frameworks.items.length === 0)
    return <Clear t={t} title={title} message="performance.notice.noConfiguration" />;

  return (
    <PerformanceSection title={title} description={shownOf(frameworks)}>
      <Rows
        headings={[
          t('performance.label.code'),
          t('performance.label.name'),
          t('performance.label.competencies'),
          t('performance.label.version'),
        ]}
        numeric={[2, 3]}
      >
        {frameworks.items.map((framework) => (
          <Row key={framework.frameworkId}>
            <Cell>
              <Isolated>{framework.code}</Isolated>
            </Cell>
            <Cell>
              <Wrote>{nameIn(framework.name, language)}</Wrote>
            </Cell>
            <Cell numeric>
              <Figure>{count(framework.competencies.length)}</Figure>
            </Cell>
            <Cell numeric>
              <Figure>{count(framework.frameworkVersion)}</Figure>
            </Cell>
          </Row>
        ))}
      </Rows>
    </PerformanceSection>
  );
};

/** One template's components, each with the weight the domain published for it. */
const TemplateRow = ({
  t,
  language,
  template,
}: ConfigurationProps & { readonly template: ReviewTemplateView }): ReactNode => (
  <Row>
    <Cell>
      <Isolated>{template.code}</Isolated>
    </Cell>
    <Cell>
      <Wrote>{nameIn(template.name, language)}</Wrote>
    </Cell>
    {/*
      Each component's weight is its own isolate. Joining the translated name and the percentage
      into one string would put a Latin run inside Arabic text, and a bare `40.00%` in a
      right-to-left paragraph renders as `%40.00` — the percent sign is neutral and takes the
      paragraph's direction.
    */}
    <Cell>
      <span className="flex flex-col gap-0.5">
        {template.components.map((component) => (
          <span key={component.component}>
            {`${t(`performance.vocabulary.scoreComponent.${component.component}`)} `}
            <Figure>{weightText(component.weightBasisPoints)}</Figure>
          </span>
        ))}
      </span>
    </Cell>
    <Identifier value={reference(template.competencyFrameworkId)} />
    <Cell numeric>
      <Figure>{count(template.version)}</Figure>
    </Cell>
  </Row>
);

/** The review templates: what a review is made of, and what each part is worth. */
export const TemplatesSection = ({
  t,
  language,
  templates,
}: ConfigurationProps & {
  readonly templates: Listing<ReviewTemplateView> | undefined;
}): ReactNode => {
  const title = t('performance.label.templates');

  if (templates === undefined)
    return <Refused t={t} title={title} reason="performance.withheld.configuration" />;
  if (templates.items.length === 0)
    return <Clear t={t} title={title} message="performance.notice.noConfiguration" />;

  return (
    <PerformanceSection title={title} description={shownOf(templates)}>
      <Rows
        headings={[
          t('performance.label.code'),
          t('performance.label.name'),
          t('performance.label.components'),
          t('performance.label.framework'),
          t('performance.label.version'),
        ]}
        numeric={[4]}
      >
        {templates.items.map((template) => (
          <TemplateRow key={template.templateId} t={t} language={language} template={template} />
        ))}
      </Rows>
      <Note t={t} message="performance.notice.weightsTotal" />
    </PerformanceSection>
  );
};

/** The goal categories, and whether each is still in use. */
export const CategoriesSection = ({
  t,
  language,
  categories,
}: ConfigurationProps & {
  readonly categories: Listing<GoalCategoryView> | undefined;
}): ReactNode => {
  const title = t('performance.label.goalCategories');

  if (categories === undefined)
    return <Refused t={t} title={title} reason="performance.withheld.configuration" />;
  if (categories.items.length === 0)
    return <Clear t={t} title={title} message="performance.notice.noConfiguration" />;

  return (
    <PerformanceSection title={title} description={shownOf(categories)}>
      <Rows
        headings={[
          t('performance.label.code'),
          t('performance.label.name'),
          t('performance.label.status'),
        ]}
      >
        {categories.items.map((category) => (
          <Row key={category.goalCategoryId}>
            <Cell>
              <Isolated>{category.code}</Isolated>
            </Cell>
            <Cell>
              <Wrote>{nameIn(category.name, language)}</Wrote>
            </Cell>
            <Cell>
              <Term
                t={t}
                group="categoryStatus"
                value={category.active ? 'active' : 'retired'}
                tone={category.active ? 'success' : 'muted'}
              />
            </Cell>
          </Row>
        ))}
      </Rows>
    </PerformanceSection>
  );
};
