import { success, type Command, type CommandHandler, type Transaction } from '@work/kernel';

import { Plan } from '../domain/plan.js';
import { PlanVersion, taskTemplate } from '../domain/plan-version.js';

import {
  conflicted,
  currentActor,
  currentTenant,
  notFound,
  originOfCurrentRequest,
  refusedBy,
} from './onboarding-context.js';
import { OnboardingPermissions } from './onboarding-permissions.js';
import type { OnboardingDependencies } from './onboarding-dependencies.js';

/**
 * Plan versions: drafting the next checklist, and freezing the one in force.
 *
 * **A published version is immutable.** Every write here refuses once `publish` has run, and that
 * single rule is what makes plan versioning mean anything: an onboarding is generated from a
 * version, so a version that could change afterwards would silently change what somebody was
 * measured against (ADR-0048).
 *
 * **Publishing supersedes the previous version and activates the plan**, in one transaction. Three
 * separate commands would leave a tenant one crash away from two published versions, and "which
 * checklist is in force" is not a question that should have two answers.
 */

export interface DraftPlanVersionCommand extends Command {
  readonly commandName: 'onboarding.draft-plan-version';
  readonly planId: string;
  /** Copy the templates of the plan's published version as a starting point. */
  readonly copyFromPublished?: boolean;
}

export interface PlanVersionAffected {
  readonly planVersionId: string;
  readonly versionNumber: number;
  readonly status: string;
}

export const draftPlanVersionHandler = (
  dependencies: OnboardingDependencies,
): CommandHandler<DraftPlanVersionCommand, PlanVersionAffected> => ({
  commandName: 'onboarding.draft-plan-version',
  permission: OnboardingPermissions.planManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const plan = await dependencies.stores.plans.byId(transaction, command.planId);

      if (plan === undefined) return notFound<PlanVersionAffected>('plan');
      if (plan.status === 'retired') return conflicted('plan_retired');

      const versions = await dependencies.stores.planVersions.forPlan(transaction, command.planId);

      if (versions.some((existing) => existing.status === 'draft')) {
        // One draft at a time. Two would make "the next version" ambiguous, and publishing either
        // would leave the other permanently orphaned.
        return conflicted('plan_already_has_a_draft');
      }

      const next =
        versions.reduce((highest, version) => Math.max(highest, version.versionNumber), 0) + 1;
      const drafted = PlanVersion.draft(
        { tenantId: currentTenant(), planId: command.planId, versionNumber: next },
        dependencies.clock.now(),
      );

      if (!drafted.ok) return refusedBy(drafted.error);

      await dependencies.stores.planVersions.insert(transaction, drafted.value.snapshot());

      if (command.copyFromPublished === true) {
        await copyTemplates(transaction, dependencies, versions, drafted.value.id);
      }
      return success({
        planVersionId: drafted.value.id,
        versionNumber: next,
        status: drafted.value.status,
      });
    }),
});

/** Copies the published version's templates into the new draft, so an edit starts from what is live. */
const copyTemplates = async (
  transaction: Transaction,
  dependencies: OnboardingDependencies,
  versions: readonly { readonly id: string; readonly status: string }[],
  intoVersionId: string,
): Promise<void> => {
  const published = versions.find((version) => version.status === 'published');

  if (published === undefined) return;

  const templates = await dependencies.stores.templates.forVersion(transaction, published.id);
  const now = dependencies.clock.now();

  for (const template of templates) {
    const copy = taskTemplate(
      { ...template, tenantId: currentTenant(), planVersionId: intoVersionId },
      now,
    );

    if (copy.ok) await dependencies.stores.templates.insert(transaction, copy.value);
  }
};

export interface PublishPlanVersionCommand extends Command {
  readonly commandName: 'onboarding.publish-plan-version';
  readonly planVersionId: string;
  readonly expectedVersion: number;
}

/**
 * Freezes a draft, supersedes the previous published version, and activates the plan.
 *
 * One transaction and one permission — `onboarding.plan.publish`, which the person drafting the next
 * checklist does not automatically hold. A published version is what every onboarding started
 * afterwards is generated from, which makes it a control rather than a document.
 */
export const publishPlanVersionHandler = (
  dependencies: OnboardingDependencies,
): CommandHandler<PublishPlanVersionCommand, PlanVersionAffected> => ({
  commandName: 'onboarding.publish-plan-version',
  permission: OnboardingPermissions.planPublish,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const state = await dependencies.stores.planVersions.byId(transaction, command.planVersionId);

      if (state === undefined) return notFound<PlanVersionAffected>('plan version');

      const templates = await dependencies.stores.templates.forVersion(
        transaction,
        command.planVersionId,
      );
      const version = PlanVersion.rehydrate(state);
      const published = version.publish(
        templates.length,
        currentActor(),
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!published.ok) return refusedBy(published.error);

      await dependencies.stores.planVersions.update(
        transaction,
        version.snapshot(),
        command.expectedVersion,
      );
      transaction.collect(version.pullEvents());
      await supersedePrevious(transaction, dependencies, state.planId, version.id);
      await activatePlan(transaction, dependencies, state.planId);
      return success({
        planVersionId: version.id,
        versionNumber: version.versionNumber,
        status: version.status,
      });
    }),
});

/** The version that was in force is now history. Instances generated from it are untouched. */
const supersedePrevious = async (
  transaction: Transaction,
  dependencies: OnboardingDependencies,
  planId: string,
  keepId: string,
): Promise<void> => {
  const versions = await dependencies.stores.planVersions.forPlan(transaction, planId);

  for (const state of versions) {
    if (state.id === keepId || state.status !== 'published') continue;

    const version = PlanVersion.rehydrate(state);

    if (version.supersede().ok) {
      await dependencies.stores.planVersions.update(transaction, version.snapshot(), state.version);
    }
  }
};

const activatePlan = async (
  transaction: Transaction,
  dependencies: OnboardingDependencies,
  planId: string,
): Promise<void> => {
  const state = await dependencies.stores.plans.byId(transaction, planId);

  if (state === undefined || state.status === 'active') return;

  const plan = Plan.rehydrate(state);

  if (plan.activate(true, dependencies.clock.now()).ok) {
    await dependencies.stores.plans.update(transaction, plan.snapshot(), state.version);
  }
};
