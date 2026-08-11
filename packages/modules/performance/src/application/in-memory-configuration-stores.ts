import type { Transaction } from '@work/kernel';

import type {
  PerformanceStores,
  CompetencyFrameworkStore,
  GoalCategoryStore,
  RatingScaleStore,
  TemplateStore,
} from './performance-ports.js';
import {
  ConstraintViolation,
  UNIQUE_VIOLATION,
  bumped,
  expectVersion,
  heldOr,
  type Tables,
} from './in-memory-tables.js';

/**
 * The configuration stores: rating scales with their levels, frameworks with their competencies,
 * goal categories and review templates with their components.
 *
 * Each parent is written with its children in one call, because that is how the domain builds them —
 * a scale whose levels arrive separately would spend the interval in a state the aggregate refuses.
 */

const ratingScalesStore = (tables: Tables): RatingScaleStore => ({
  byId: (_transaction: Transaction, id) => Promise.resolve(tables.scales.get(id)),
  byCode: (_transaction, code) =>
    Promise.resolve([...tables.scales.values()].find((scale) => scale.code === code)),
  all: () => Promise.resolve([...tables.scales.values()]),
  levelsFor: (_transaction, scaleId) =>
    Promise.resolve(tables.scaleLevels.filter((level) => level.ratingScaleId === scaleId)),
  insert: (_transaction, scale, levels) => {
    if (tables.scales.has(scale.ratingScaleId)) throw new ConstraintViolation(UNIQUE_VIOLATION);
    tables.scales.set(scale.ratingScaleId, scale);
    tables.scaleLevels.push(...levels);
    return Promise.resolve();
  },
  update: (_transaction, scale, expected) => {
    const held = heldOr('scales', tables.scales.get(scale.ratingScaleId));

    expectVersion('scales', held, expected);
    tables.scales.set(scale.ratingScaleId, bumped(scale));
    return Promise.resolve();
  },
});

const frameworksStore = (tables: Tables): CompetencyFrameworkStore => ({
  byId: (_transaction, id) => Promise.resolve(tables.frameworks.get(id)),
  byCode: (_transaction, code, frameworkVersion) =>
    Promise.resolve(
      [...tables.frameworks.values()].find(
        (framework) => framework.code === code && framework.frameworkVersion === frameworkVersion,
      ),
    ),
  all: () => Promise.resolve([...tables.frameworks.values()]),
  competenciesFor: (_transaction, frameworkId) =>
    Promise.resolve(
      tables.competencies.filter((competency) => competency.frameworkId === frameworkId),
    ),
  levelsFor: (_transaction, competencyId) =>
    Promise.resolve(tables.competencyLevels.filter((level) => level.competencyId === competencyId)),
  insert: (_transaction, framework) => {
    tables.frameworks.set(framework.frameworkId, framework);
    return Promise.resolve();
  },
  update: (_transaction, framework, expected) => {
    const held = heldOr('frameworks', tables.frameworks.get(framework.frameworkId));

    expectVersion('frameworks', held, expected);
    tables.frameworks.set(framework.frameworkId, bumped(framework));
    return Promise.resolve();
  },
  insertCompetency: (_transaction, competency, levels) => {
    tables.competencies.push(competency);
    tables.competencyLevels.push(...levels);
    return Promise.resolve();
  },
});

const goalCategoriesStore = (tables: Tables): GoalCategoryStore => ({
  byId: (_transaction, id) => Promise.resolve(tables.goalCategories.get(id)),
  byCode: (_transaction, code) =>
    Promise.resolve([...tables.goalCategories.values()].find((category) => category.code === code)),
  all: () => Promise.resolve([...tables.goalCategories.values()]),
  insert: (_transaction, state) => {
    tables.goalCategories.set(state.goalCategoryId, state);
    return Promise.resolve();
  },
  update: (_transaction, state, expected) => {
    const held = heldOr('goalCategories', tables.goalCategories.get(state.goalCategoryId));

    expectVersion('goalCategories', held, expected);
    tables.goalCategories.set(state.goalCategoryId, bumped(state));
    return Promise.resolve();
  },
});

const templatesStore = (tables: Tables): TemplateStore => ({
  byId: (_transaction, id) => Promise.resolve(tables.templates.get(id)),
  byCode: (_transaction, code) =>
    Promise.resolve([...tables.templates.values()].find((template) => template.code === code)),
  all: () => Promise.resolve([...tables.templates.values()]),
  componentsFor: (_transaction, templateId) =>
    Promise.resolve(
      tables.templateComponents.filter((component) => component.templateId === templateId),
    ),
  insert: (_transaction, template, components) => {
    tables.templates.set(template.templateId, template);
    tables.templateComponents.push(...components);
    return Promise.resolve();
  },
  update: (_transaction, template, expected) => {
    const held = heldOr('templates', tables.templates.get(template.templateId));

    expectVersion('templates', held, expected);
    tables.templates.set(template.templateId, bumped(template));
    return Promise.resolve();
  },
});

export const configurationStores = (
  tables: Tables,
): Pick<PerformanceStores, 'ratingScales' | 'frameworks' | 'goalCategories' | 'templates'> => ({
  ratingScales: ratingScalesStore(tables),
  frameworks: frameworksStore(tables),
  goalCategories: goalCategoriesStore(tables),
  templates: templatesStore(tables),
});
