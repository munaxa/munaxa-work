import {
  success,
  type Command,
  type HandlerFailure,
  type Query,
  type QueryHandler,
  type Result,
} from '@work/kernel';

import { conflicted } from './onboarding-context.js';
import { OnboardingPermissions } from './onboarding-permissions.js';
import { onboardingView, taskView } from './onboarding-views.js';
import type { OnboardingExport } from '../contracts/views.js';
import type { OnboardingDependencies } from './onboarding-dependencies.js';

/**
 * Taking the onboarding register out of the product.
 *
 * There is deliberately **no import**. Onboarding is generated from a plan against an employment
 * that already exists; a bulk import would either invent instances for employments nobody hired
 * through this product, or duplicate the reconciliation that already exists for exactly that case.
 * Reconciliation is the supported way to onboard a migrated workforce.
 *
 * The export is **separately permissioned and bounded**, refusing by name beyond the limit rather
 * than timing out halfway through a customer's register.
 */

export const EXPORT_LIMIT = 5000;

/**
 * How a command reaches the dispatcher that was built from a list including it.
 *
 * Reconciliation sends the same start command an administrator would, and the dispatcher that
 * receives it is assembled from a handler list that includes reconciliation — a genuine cycle. The
 * composition root attaches the dispatcher the moment it has one, which is the seam every module
 * before this uses for the same reason.
 */
export interface CommandSender {
  send<TResult, TCommand extends Command>(
    command: TCommand,
  ): Promise<Result<TResult, HandlerFailure>>;
}

export interface ExportOnboarding extends Query {
  readonly queryName: 'onboarding.export';
}

/**
 * Every onboarding and every task, in one response.
 *
 * It carries **no person's name** and no document reference: an export is the highest-volume
 * disclosure this module can make, and joining names into it would put the register's personal data
 * into one file governed by this module's permission rather than People's (§29 of the phase plan).
 */
export const exportOnboardingHandler = (
  dependencies: OnboardingDependencies,
): QueryHandler<ExportOnboarding, OnboardingExport> => ({
  queryName: 'onboarding.export',
  permission: OnboardingPermissions.export,

  handle: async () =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const onboardings = await dependencies.stores.onboardings.all(transaction);

      if (onboardings.length > EXPORT_LIMIT) return conflicted('export_too_large');

      const tasks = await dependencies.stores.tasks.all(transaction);

      return success({
        generatedAt: dependencies.clock.now(),
        onboardings: onboardings.map(onboardingView),
        tasks: tasks.map(taskView),
      });
    }),
});
