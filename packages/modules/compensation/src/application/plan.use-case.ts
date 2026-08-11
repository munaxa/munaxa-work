import { success, type Command, type CommandHandler, type RuleDefinition } from '@work/kernel';

import { CompensationPlan, type DefineCompensationPlan } from '../domain/compensation-plan.js';
import { planAssignment } from '../domain/plan-assignment.js';
import { accept, type CompensationResult } from '../domain/compensation-rejection.js';
import { checkedMoney, type MoneyAmount, type MoneyInput } from '../domain/money-amount.js';
import { uuidV7 } from '@work/kernel';
import {
  definedOnly,
  type BilingualInput,
  type Metadata,
} from '../domain/compensation-aggregate.js';
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
 * Configuring compensation plans, their component terms and their assignment to a scope.
 *
 * **Nothing is seeded and nothing is suggested.** There is no bootstrap that creates a plan, no
 * migration that inserts a component set, and no default a tenant has to delete. A tenant that has
 * configured no plans has no plans, and the screen says so.
 *
 * Publication is a **separate command behind a separate permission**, because a published plan
 * version governs everybody assigned to it and every compensation record created under it will name
 * it by identity for as long as the record exists.
 */

export interface DefineCompensationPlanCommand extends Command {
  readonly commandName: 'compensation.define-plan';
  readonly code: string;
  readonly name: BilingualInput;
  readonly defaultCurrencyCode: string;
  readonly defaultCurrencyExponent: number;
  readonly salaryStructureId?: string;
  readonly approvalRequired?: boolean;
  readonly approvalsRequired?: number;
  readonly selfApprovalPermitted?: boolean;
  readonly maximumIncreaseBasisPoints?: number;
  readonly maximumDecreaseBasisPoints?: number;
  readonly countryPackId?: string;
  readonly countryPackVersion?: number;
  readonly versionNumber?: number;
  readonly metadata?: Metadata;
}

export interface CompensationPlanDefined {
  readonly compensationPlanId: string;
}

export const defineCompensationPlanHandler = (
  dependencies: CompensationDependencies,
): CommandHandler<DefineCompensationPlanCommand, CompensationPlanDefined> => ({
  commandName: 'compensation.define-plan',
  permission: CompensationPermissions.planManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const request: DefineCompensationPlan = { ...command, tenantId: currentTenant() };
      const drafted = CompensationPlan.define(request, dependencies.clock.now());

      if (!drafted.ok) return refusedBy<CompensationPlanDefined>(drafted.error);

      const state = drafted.value.snapshot();
      const existing = await dependencies.stores.plans.byCode(transaction, state.code);

      // Checked before the insert so the caller gets a business conflict rather than a unique
      // violation; the index is still what guarantees it under concurrency.
      if (existing !== undefined && existing.versionNumber === state.versionNumber) {
        return conflicted<CompensationPlanDefined>('compensation.rejection.plan_code_taken');
      }

      await dependencies.stores.plans.insert(transaction, state);
      return success({ compensationPlanId: state.id });
    }),
});

export interface PublishCompensationPlanCommand extends Command {
  readonly commandName: 'compensation.publish-plan';
  readonly compensationPlanId: string;
  readonly expectedVersion: number;
}

export interface CompensationPlanPublished {
  readonly compensationPlanId: string;
  readonly status: string;
}

export const publishCompensationPlanHandler = (
  dependencies: CompensationDependencies,
): CommandHandler<PublishCompensationPlanCommand, CompensationPlanPublished> => ({
  commandName: 'compensation.publish-plan',
  permission: CompensationPermissions.planPublish,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const found = await dependencies.stores.plans.byId(transaction, command.compensationPlanId);

      if (found === undefined) return notFound<CompensationPlanPublished>('compensation plan');

      const plan = CompensationPlan.rehydrate(found);
      const published = plan.publish(currentActor(), dependencies.clock.now());

      if (!published.ok) return refusedBy<CompensationPlanPublished>(published.error);

      await dependencies.stores.plans.update(transaction, published.value, command.expectedVersion);
      return success({ compensationPlanId: published.value.id, status: published.value.status });
    }),
});

export interface PermitComponentCommand extends Command {
  readonly commandName: 'compensation.permit-component';
  readonly compensationPlanId: string;
  readonly componentId: string;
  readonly mandatory?: boolean;
  readonly minimum?: MoneyInput;
  readonly maximum?: MoneyInput;
  readonly eligibilityRule?: RuleDefinition;
}

export interface ComponentPermitted {
  readonly planComponentId: string;
}

/**
 * Which components a plan version permits, and on what terms.
 *
 * The bounds are a plan's own change control, not a statutory one: nullable, inert when null, and
 * nothing anywhere implies a minimum wage or a mandated allowance (00B).
 */
export const permitComponentHandler = (
  dependencies: CompensationDependencies,
): CommandHandler<PermitComponentCommand, ComponentPermitted> => ({
  commandName: 'compensation.permit-component',
  permission: CompensationPermissions.planManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const plan = await dependencies.stores.plans.byId(transaction, command.compensationPlanId);

      if (plan === undefined) return notFound<ComponentPermitted>('compensation plan');
      // A published version is frozen. Adding a component to it would change what every record
      // already created under it was permitted to hold (ADR-0048).
      if (plan.status !== 'draft') {
        return conflicted<ComponentPermitted>('compensation.rejection.plan_not_draft');
      }

      const component = await dependencies.stores.components.byId(transaction, command.componentId);

      if (component === undefined) return notFound<ComponentPermitted>('compensation component');

      const bounds = checkedBounds(command);

      if (!bounds.ok) return refusedBy<ComponentPermitted>(bounds.error);

      const id = uuidV7(dependencies.clock.now().getTime());

      await dependencies.stores.planComponents.insert(transaction, {
        id,
        tenantId: currentTenant(),
        compensationPlanId: command.compensationPlanId,
        componentId: command.componentId,
        mandatory: command.mandatory ?? false,
        ...definedOnly({ eligibilityRule: command.eligibilityRule }),
        ...bounds.value,
        version: 0,
      });
      return success({ planComponentId: id });
    }),
});

/**
 * A plan's optional bounds on a component.
 *
 * Both are optional, and both are a *plan's* change control rather than a statutory one — nullable,
 * inert when absent, and nothing anywhere implies a minimum wage or a mandated allowance (00B).
 */
const checkedBounds = (
  command: PermitComponentCommand,
): CompensationResult<{ readonly minimum?: MoneyAmount; readonly maximum?: MoneyAmount }> => {
  const minimum = optionalAmount(command.minimum, 'minimum');

  if (!minimum.ok) return minimum;

  const maximum = optionalAmount(command.maximum, 'maximum');

  if (!maximum.ok) return maximum;

  return accept(definedOnly({ minimum: minimum.value, maximum: maximum.value }));
};

const optionalAmount = (
  input: MoneyInput | undefined,
  field: string,
): CompensationResult<MoneyAmount | undefined> =>
  input === undefined ? accept(undefined) : checkedMoney(input, field);

export interface AssignCompensationPlanCommand extends Command {
  readonly commandName: 'compensation.assign-plan';
  readonly compensationPlanId: string;
  readonly scope: string;
  readonly scopeId?: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly reasonCode?: string;
}

export interface CompensationPlanAssigned {
  readonly planAssignmentId: string;
}

/**
 * Binding a published plan version to a scope, effective-dated.
 *
 * **Only a published version may be assigned.** A draft is somebody's work in progress, and
 * assigning one would put an unfrozen configuration behind everybody's compensation in a unit.
 */
export const assignCompensationPlanHandler = (
  dependencies: CompensationDependencies,
): CommandHandler<AssignCompensationPlanCommand, CompensationPlanAssigned> => ({
  commandName: 'compensation.assign-plan',
  permission: CompensationPermissions.planManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const plan = await dependencies.stores.plans.byId(transaction, command.compensationPlanId);

      if (plan === undefined) return notFound<CompensationPlanAssigned>('compensation plan');
      if (plan.status !== 'published') {
        return conflicted<CompensationPlanAssigned>('compensation.rejection.plan_not_published');
      }

      const built = planAssignment(
        { ...command, tenantId: currentTenant() },
        dependencies.clock.now(),
      );

      if (!built.ok) return refusedBy<CompensationPlanAssigned>(built.error);

      await dependencies.stores.planAssignments.insert(transaction, built.value);
      return success({ planAssignmentId: built.value.id });
    }),
});
