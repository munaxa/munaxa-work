import {
  pagedResult,
  success,
  type PagedResult,
  type Query,
  type QueryHandler,
} from '@work/kernel';

import { civilDateOf } from '../domain/onboarding-vocabulary.js';
import type {
  OnboardingSnapshot,
  OnboardingView,
  PlanSnapshot,
  PlanView,
} from '../contracts/views.js';

import { notFound } from './onboarding-context.js';
import { OnboardingPermissions } from './onboarding-permissions.js';
import {
  onboardingView,
  planVersionView,
  planView,
  progressView,
  taskTemplateView,
  taskView,
} from './onboarding-views.js';
import type { OnboardingDependencies } from './onboarding-dependencies.js';

/**
 * Reading plans and onboardings.
 *
 * **Progress is an aggregate query, never a page of rows.** An onboarding with sixty tasks is
 * summarised by counting in the database; loading the list to count it is the N+1 a dashboard makes
 * a hundred times over.
 *
 * **No read joins a person's name.** A screen that wants one asks People, behind People's
 * permission — which is what keeps a task queue readable by IT without making IT a reader of the
 * person register.
 */

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

const boundsOf = (query: { readonly page?: number; readonly size?: number }) => {
  const page = Math.max(1, query.page ?? 1);
  const size = Math.min(MAX_PAGE_SIZE, Math.max(1, query.size ?? DEFAULT_PAGE_SIZE));

  return { page, size, limit: size, offset: (page - 1) * size };
};

export interface SearchPlans extends Query {
  readonly queryName: 'onboarding.search-plans';
  readonly status?: string;
  readonly code?: string;
  readonly page?: number;
  readonly size?: number;
}

export const searchPlansHandler = (
  dependencies: OnboardingDependencies,
): QueryHandler<SearchPlans, PagedResult<PlanView>> => ({
  queryName: 'onboarding.search-plans',
  permission: OnboardingPermissions.planRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const bounds = boundsOf(query);
      const found = await dependencies.stores.plans.search(transaction, {
        limit: bounds.limit,
        offset: bounds.offset,
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.code === undefined ? {} : { code: query.code }),
      });

      return success(pagedResult(found.items.map(planView), bounds.page, bounds.size, found.total));
    }),
});

export interface ReadPlan extends Query {
  readonly queryName: 'onboarding.read-plan';
  readonly planId: string;
  /** Which version's templates to return. Defaults to the published one. */
  readonly planVersionId?: string;
}

/**
 * One plan, its versions and the templates of the version asked for.
 *
 * The versions are published in full because "what were we asking of joiners last March" is a
 * question answered by reading the version an onboarding was generated from — and a superseded
 * version stays readable for exactly that reason (ADR-0048).
 */
export const readPlanHandler = (
  dependencies: OnboardingDependencies,
): QueryHandler<ReadPlan, PlanSnapshot> => ({
  queryName: 'onboarding.read-plan',
  permission: OnboardingPermissions.planRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const plan = await dependencies.stores.plans.byId(transaction, query.planId);

      if (plan === undefined) return notFound<PlanSnapshot>('plan');

      const versions = await dependencies.stores.planVersions.forPlan(transaction, query.planId);
      const chosen =
        query.planVersionId === undefined
          ? versions.find((version) => version.status === 'published')
          : versions.find((version) => version.id === query.planVersionId);
      const templates =
        chosen === undefined
          ? []
          : await dependencies.stores.templates.forVersion(transaction, chosen.id);

      return success({
        plan: planView(plan),
        versions: [...versions]
          .sort((left, right) => left.versionNumber - right.versionNumber)
          .map(planVersionView),
        templates: [...templates]
          .sort((left, right) => left.sequence - right.sequence)
          .map(taskTemplateView),
      });
    }),
});

export interface SearchOnboardings extends Query {
  readonly queryName: 'onboarding.search';
  readonly state?: string;
  readonly planId?: string;
  readonly employmentId?: string;
  /** Onboardings with at least one required task past its due date and not concluded. */
  readonly overdue?: boolean;
  readonly plannedStartFrom?: string;
  readonly plannedStartTo?: string;
  readonly page?: number;
  readonly size?: number;
}

export const searchOnboardingsHandler = (
  dependencies: OnboardingDependencies,
): QueryHandler<SearchOnboardings, PagedResult<OnboardingView>> => ({
  queryName: 'onboarding.search',
  permission: OnboardingPermissions.read,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const bounds = boundsOf(query);
      const found = await dependencies.stores.onboardings.search(transaction, {
        limit: bounds.limit,
        offset: bounds.offset,
        ...(query.state === undefined ? {} : { state: query.state }),
        ...(query.planId === undefined ? {} : { planId: query.planId }),
        ...(query.employmentId === undefined ? {} : { employmentId: query.employmentId }),
        ...(query.overdue === true
          ? { overdueAsOf: civilDateOf(dependencies.clock.now()) }
          : {}),
        ...(query.plannedStartFrom === undefined
          ? {}
          : { plannedStartFrom: query.plannedStartFrom }),
        ...(query.plannedStartTo === undefined ? {} : { plannedStartTo: query.plannedStartTo }),
      });

      return success(
        pagedResult(found.items.map(onboardingView), bounds.page, bounds.size, found.total),
      );
    }),
});

export interface ReadOnboarding extends Query {
  readonly queryName: 'onboarding.read';
  readonly onboardingId: string;
}

/**
 * One onboarding, its tasks and its progress.
 *
 * Three reads rather than one per task: how far somebody has got is one question, and answering it
 * in sixty round trips is sixty chances for a screen to show a stale count beside a fresh list.
 */
export const readOnboardingHandler = (
  dependencies: OnboardingDependencies,
): QueryHandler<ReadOnboarding, OnboardingSnapshot> => ({
  queryName: 'onboarding.read',
  permission: OnboardingPermissions.read,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const state = await dependencies.stores.onboardings.byId(transaction, query.onboardingId);

      if (state === undefined) return notFound<OnboardingSnapshot>('onboarding');

      const tasks = await dependencies.stores.tasks.forOnboarding(transaction, query.onboardingId);
      const tally = await dependencies.stores.tasks.tally(
        transaction,
        query.onboardingId,
        civilDateOf(dependencies.clock.now()),
      );

      return success({
        onboarding: onboardingView(state),
        tasks: [...tasks].sort((left, right) => left.sequence - right.sequence).map(taskView),
        progress: progressView(query.onboardingId, tally),
      });
    }),
});
