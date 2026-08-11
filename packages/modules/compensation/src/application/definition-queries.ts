import { success, type Query, type QueryHandler } from '@work/kernel';

import {
  componentView,
  gradeView,
  importBatchView,
  planView,
  scaleView,
  stepView,
  structureView,
} from './compensation-views.js';
import { CompensationPermissions } from './compensation-permissions.js';
import type {
  CompensationComponentView,
  CompensationPlanView,
  ImportBatchView,
  PayGradeView,
  PayScaleView,
  SalaryStepView,
  SalaryStructureView,
} from '../contracts/views.js';
import type { CompensationDependencies } from './compensation-dependencies.js';

/**
 * The configuration reads: plans, structures, grades, scales, steps, components and import batches.
 *
 * **Every one starts empty and stays empty until somebody configures it.** A tenant that has
 * defined no components gets an empty list, and the screen says so. There is no seed, no suggestion
 * and no default to delete (00B).
 *
 * All of them are bounded. The catalogue reads are the ones a screen loads on every visit, so their
 * cost is multiplied by everybody who opens the page.
 */

const DEFAULT_PAGE = 50;
const MAX_PAGE = 200;
const RECENT_BATCHES = 25;

export const paged = (query: {
  readonly limit?: number;
  readonly offset?: number;
}): { readonly limit: number; readonly offset: number } => ({
  limit: Math.min(MAX_PAGE, Math.max(1, query.limit ?? DEFAULT_PAGE)),
  offset: Math.max(0, query.offset ?? 0),
});

export interface ListPlans extends Query {
  readonly queryName: 'compensation.plans';
}

export interface PlansView {
  readonly items: readonly CompensationPlanView[];
}

export const listPlansHandler = (
  dependencies: CompensationDependencies,
): QueryHandler<ListPlans, PlansView> => ({
  queryName: 'compensation.plans',
  permission: CompensationPermissions.read,

  handle: async () =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const plans = await dependencies.stores.plans.all(transaction);
      const items: CompensationPlanView[] = [];

      for (const plan of plans) {
        const assignments = await dependencies.stores.planAssignments.forPlan(transaction, plan.id);
        const components = await dependencies.stores.planComponents.forPlan(transaction, plan.id);

        items.push(planView(plan, assignments, components));
      }
      return success({ items });
    }),
});

export interface ListStructures extends Query {
  readonly queryName: 'compensation.structures';
}

export interface StructuresView {
  readonly items: readonly SalaryStructureView[];
}

export const listStructuresHandler = (
  dependencies: CompensationDependencies,
): QueryHandler<ListStructures, StructuresView> => ({
  queryName: 'compensation.structures',
  permission: CompensationPermissions.read,

  handle: async () =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const structures = await dependencies.stores.structures.all(transaction);

      return success({ items: structures.map(structureView) });
    }),
});

export interface ListGrades extends Query {
  readonly queryName: 'compensation.grades';
  readonly salaryStructureId?: string;
}

export interface GradesView {
  readonly items: readonly PayGradeView[];
}

export const listGradesHandler = (
  dependencies: CompensationDependencies,
): QueryHandler<ListGrades, GradesView> => ({
  queryName: 'compensation.grades',
  permission: CompensationPermissions.read,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const grades =
        query.salaryStructureId === undefined
          ? await dependencies.stores.grades.all(transaction)
          : await dependencies.stores.grades.forStructure(transaction, query.salaryStructureId);

      return success({ items: grades.map(gradeView) });
    }),
});

export interface ListScales extends Query {
  readonly queryName: 'compensation.scales';
  readonly payGradeId?: string;
}

export interface ScalesView {
  readonly items: readonly PayScaleView[];
}

export const listScalesHandler = (
  dependencies: CompensationDependencies,
): QueryHandler<ListScales, ScalesView> => ({
  queryName: 'compensation.scales',
  permission: CompensationPermissions.read,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const scales =
        query.payGradeId === undefined
          ? await dependencies.stores.scales.all(transaction)
          : await dependencies.stores.scales.forGrade(transaction, query.payGradeId);

      return success({ items: scales.map(scaleView) });
    }),
});

export interface ListSteps extends Query {
  readonly queryName: 'compensation.steps';
  readonly payScaleId?: string;
  readonly payGradeId?: string;
}

export interface StepsView {
  readonly items: readonly SalaryStepView[];
}

export const listStepsHandler = (
  dependencies: CompensationDependencies,
): QueryHandler<ListSteps, StepsView> => ({
  queryName: 'compensation.steps',
  permission: CompensationPermissions.read,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const steps =
        query.payScaleId === undefined && query.payGradeId === undefined
          ? await dependencies.stores.steps.all(transaction)
          : await dependencies.stores.steps.forParent(transaction, {
              ...(query.payScaleId === undefined ? {} : { payScaleId: query.payScaleId }),
              ...(query.payGradeId === undefined ? {} : { payGradeId: query.payGradeId }),
            });

      return success({ items: steps.map(stepView) });
    }),
});

export interface ListComponents extends Query {
  readonly queryName: 'compensation.components';
}

export interface ComponentsView {
  readonly items: readonly CompensationComponentView[];
}

/**
 * The component catalogue.
 *
 * Nothing is seeded, so a new tenant gets an empty list. `payrollTreatmentCode` travels
 * uninterpreted — a screen renders the code the customer stored rather than looking it up in a list
 * this product ships, for the same reason the domain refuses to read it.
 */
export const listComponentsHandler = (
  dependencies: CompensationDependencies,
): QueryHandler<ListComponents, ComponentsView> => ({
  queryName: 'compensation.components',
  permission: CompensationPermissions.read,

  handle: async () =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const components = await dependencies.stores.components.all(transaction);

      return success({ items: components.map(componentView) });
    }),
});

export interface ListImports extends Query {
  readonly queryName: 'compensation.imports';
}

export interface ImportsView {
  readonly items: readonly ImportBatchView[];
}

export const listImportsHandler = (
  dependencies: CompensationDependencies,
): QueryHandler<ListImports, ImportsView> => ({
  queryName: 'compensation.imports',
  permission: CompensationPermissions.read,

  handle: async () =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const batches = await dependencies.stores.imports.recent(transaction, RECENT_BATCHES);

      return success({ items: batches.map(importBatchView) });
    }),
});
