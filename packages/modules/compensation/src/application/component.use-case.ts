import { success, type Command, type CommandHandler, type RuleDefinition } from '@work/kernel';

import {
  CompensationComponent,
  chainIsCircular,
  type DefineCompensationComponent,
} from '../domain/compensation-component.js';
import type { BilingualInput, Metadata } from '../domain/compensation-aggregate.js';
import {
  conflicted,
  currentActor,
  currentTenant,
  notFound,
  refusedBy,
} from './compensation-context.js';
import { CompensationPermissions } from './compensation-permissions.js';
import type { CompensationDependencies } from './compensation-dependencies.js';

/**
 * Defining what an employment can be entitled to.
 *
 * **Nothing is seeded.** No basic salary, no housing allowance, no transport allowance, no meal
 * allowance and no statutory component of any jurisdiction. Every one of those is a component a
 * tenant or a country pack defines, and a product that shipped them would be asserting that every
 * customer in every market wants the same set (00B).
 *
 * **No deduction kind exists** (D-1). A caller asking for one is refused by the domain, by the
 * check constraint and by the absence of any code that would know what to do with it.
 *
 * Publication is separate and behind a separate permission: a published component is what every
 * plan and every compensation record in the tenant will reference by identity.
 */

export interface DefineComponentCommand extends Command {
  readonly commandName: 'compensation.define-component';
  readonly code: string;
  readonly name: BilingualInput;
  readonly kind: string;
  readonly calculationBasis: string;
  readonly basisComponentId?: string;
  readonly percentageBasisPoints?: number;
  readonly roundingMode: string;
  readonly recurrence?: string;
  readonly payrollTreatmentCode: string;
  readonly proratable?: boolean;
  readonly eligibilityRule?: RuleDefinition;
  readonly statutorySourceCode?: string;
  readonly versionNumber?: number;
  readonly metadata?: Metadata;
}

export interface ComponentDefined {
  readonly componentId: string;
}

export const defineComponentHandler = (
  dependencies: CompensationDependencies,
): CommandHandler<DefineComponentCommand, ComponentDefined> => ({
  commandName: 'compensation.define-component',
  permission: CompensationPermissions.componentManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const request: DefineCompensationComponent = { ...command, tenantId: currentTenant() };
      const drafted = CompensationComponent.define(request, dependencies.clock.now());

      if (!drafted.ok) return refusedBy<ComponentDefined>(drafted.error);

      const state = drafted.value.snapshot();
      const existing = await dependencies.stores.components.byCode(transaction, state.code);

      if (existing !== undefined && existing.versionNumber === state.versionNumber) {
        return conflicted<ComponentDefined>('compensation.rejection.component_code_taken');
      }

      const refusal = await checkedBasis(dependencies, transaction, state);

      if (refusal !== undefined) return refusal as never;

      await dependencies.stores.components.insert(transaction, state);
      return success({ componentId: state.id });
    }),
});

/**
 * The basis component must exist, and the chain it joins must not return to itself.
 *
 * **Circularity is refused at definition time**, because a self-referential allowance — 40% of a
 * component that is 10% of it — has no value and would loop when somebody's payslip is being
 * assembled. Refusing it here means the configuration cannot be saved rather than failing later for
 * a person who did not make it.
 */
const checkedBasis = async (
  dependencies: CompensationDependencies,
  transaction: Parameters<Parameters<CompensationDependencies['unitOfWork']['execute']>[0]>[0],
  state: { readonly id: string; readonly basisComponentId?: string },
): Promise<unknown> => {
  if (state.basisComponentId === undefined) return undefined;

  const basis = await dependencies.stores.components.byId(transaction, state.basisComponentId);

  if (basis === undefined) return notFound<ComponentDefined>('basis component');

  const existing = await dependencies.stores.components.all(transaction);

  if (chainIsCircular(state, existing)) {
    return conflicted<ComponentDefined>('compensation.rejection.component_basis_is_circular');
  }
  return undefined;
};

export interface PublishComponentCommand extends Command {
  readonly commandName: 'compensation.publish-component';
  readonly componentId: string;
  readonly expectedVersion: number;
}

export interface ComponentPublished {
  readonly componentId: string;
  readonly status: string;
}

export const publishComponentHandler = (
  dependencies: CompensationDependencies,
): CommandHandler<PublishComponentCommand, ComponentPublished> => ({
  commandName: 'compensation.publish-component',
  permission: CompensationPermissions.componentManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const found = await dependencies.stores.components.byId(transaction, command.componentId);

      if (found === undefined) return notFound<ComponentPublished>('compensation component');

      const component = CompensationComponent.rehydrate(found);
      const published = component.publish(currentActor(), dependencies.clock.now());

      if (!published.ok) return refusedBy<ComponentPublished>(published.error);

      await dependencies.stores.components.update(
        transaction,
        published.value,
        command.expectedVersion,
      );
      return success({ componentId: published.value.id, status: published.value.status });
    }),
});
