import { success, type Command, type CommandHandler } from '@work/kernel';

import { Plan } from '../domain/plan.js';
import type { Metadata } from '../domain/onboarding-aggregate.js';

import {
  conflicted,
  currentTenant,
  notFound,
  refusedBy,
} from './onboarding-context.js';
import { OnboardingPermissions } from './onboarding-permissions.js';
import type { OnboardingDependencies } from './onboarding-dependencies.js';

/**
 * Plans: the reusable definitions a tenant configures.
 *
 * **Nothing is shipped.** No plan, no task and no code is seeded by this product — which is the same
 * rule Organization applies to unit types and Recruitment to sources (00B). A customer with no plan
 * gets an onboarding with no tasks and a screen that says so, and that is the honest state: shipping
 * a default checklist would be this product deciding how a business inducts people, and part of that
 * answer is statutory in several of its markets.
 *
 * **The plan holds no tasks.** Those live in its versions, and that split is what stops an edit
 * reaching an onboarding already under way (ADR-0048).
 */

export interface CreatePlanCommand extends Command {
  readonly commandName: 'onboarding.create-plan';
  readonly code: string;
  readonly name: Readonly<Record<string, string>>;
  readonly description?: Readonly<Record<string, string>>;
  readonly metadata?: Metadata;
}

export interface PlanAffected {
  readonly planId: string;
  readonly status: string;
}

export const createPlanHandler = (
  dependencies: OnboardingDependencies,
): CommandHandler<CreatePlanCommand, PlanAffected> => ({
  commandName: 'onboarding.create-plan',
  permission: OnboardingPermissions.planManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const existing = await dependencies.stores.plans.byCode(transaction, command.code);

      // Checked here as well as by the unique index, so the caller gets "that code is taken" rather
      // than a constraint violation they cannot act on.
      if (existing !== undefined) return conflicted('plan_code_taken');

      const plan = Plan.create(
        { tenantId: currentTenant(), ...command },
        dependencies.clock.now(),
      );

      if (!plan.ok) return refusedBy(plan.error);

      await dependencies.stores.plans.insert(transaction, plan.value.snapshot());
      return success({ planId: plan.value.id, status: plan.value.status });
    }),
});

export interface AmendPlanCommand extends Command {
  readonly commandName: 'onboarding.amend-plan';
  readonly planId: string;
  readonly name?: Readonly<Record<string, string>>;
  readonly description?: Readonly<Record<string, string>>;
  readonly metadata?: Metadata;
  readonly expectedVersion: number;
}

/**
 * Corrects a plan's own details — its name and description.
 *
 * It cannot reach a running onboarding, and not because of a rule written here: an instance holds a
 * copy of its tasks and the identifier of the version it came from, so there is nothing on it for
 * this to change.
 */
export const amendPlanHandler = (
  dependencies: OnboardingDependencies,
): CommandHandler<AmendPlanCommand, PlanAffected> => ({
  commandName: 'onboarding.amend-plan',
  permission: OnboardingPermissions.planManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const state = await dependencies.stores.plans.byId(transaction, command.planId);

      if (state === undefined) return notFound<PlanAffected>('plan');

      const plan = Plan.rehydrate(state);
      const amended = plan.amend(command, dependencies.clock.now());

      if (!amended.ok) return refusedBy(amended.error);

      await dependencies.stores.plans.update(transaction, plan.snapshot(), command.expectedVersion);
      return success({ planId: plan.id, status: plan.status });
    }),
});

export interface RetirePlanCommand extends Command {
  readonly commandName: 'onboarding.retire-plan';
  readonly planId: string;
  readonly expectedVersion: number;
}

/**
 * Retires a plan so no new onboarding uses it.
 *
 * Deliberately **not** cascading: onboardings generated from it keep their tasks and keep resolving,
 * because "what were we asking of joiners last March" is a question asked long after the plan that
 * asked it was replaced.
 */
export const retirePlanHandler = (
  dependencies: OnboardingDependencies,
): CommandHandler<RetirePlanCommand, PlanAffected> => ({
  commandName: 'onboarding.retire-plan',
  permission: OnboardingPermissions.planManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const state = await dependencies.stores.plans.byId(transaction, command.planId);

      if (state === undefined) return notFound<PlanAffected>('plan');

      const plan = Plan.rehydrate(state);
      const retired = plan.retire(dependencies.clock.now());

      if (!retired.ok) return refusedBy(retired.error);

      await dependencies.stores.plans.update(transaction, plan.snapshot(), command.expectedVersion);
      return success({ planId: plan.id, status: plan.status });
    }),
});
