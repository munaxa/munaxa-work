import { success, type Command, type CommandHandler } from '@work/kernel';

import type { Metadata } from '../domain/organization-aggregate.js';
import {
  POSITION_CRITICALITIES,
  type OrganizationStatus,
  type PositionCriticality,
} from '../domain/organization-vocabulary.js';
import { Position } from '../domain/position.js';

import {
  conflicted,
  currentTenant,
  notFound,
  originOfCurrentRequest,
  refusedBy,
} from './organization-context.js';
import { OrganizationPermissions } from './organization-permissions.js';
import type { OrganizationDependencies } from './organization-dependencies.js';

/**
 * The position catalogue: reusable role definitions the whole organization draws on.
 *
 * No command here takes a person, and none ever will (AD-006). Employment assigns people to
 * positions; this module defines what a position *is*.
 */

export interface DefinePositionCommand extends Command {
  readonly commandName: 'organization.define-position';
  readonly code: string;
  readonly title: Readonly<Record<string, string>>;
  readonly description?: Readonly<Record<string, string>>;
  readonly family?: string;
  readonly grade?: string;
  readonly criticality?: PositionCriticality;
  readonly metadata?: Metadata;
  readonly effectiveFrom: Date;
}

export interface PositionChanged {
  readonly positionId: string;
  readonly code: string;
  readonly status: OrganizationStatus;
}

export const definePositionHandler = (
  dependencies: OrganizationDependencies,
): CommandHandler<DefinePositionCommand, PositionChanged> => ({
  commandName: 'organization.define-position',
  permission: OrganizationPermissions.positionManage,

  validate: (command) =>
    command.criticality === undefined || POSITION_CRITICALITIES.includes(command.criticality)
      ? []
      : [
          {
            field: 'criticality',
            message: `must be one of ${POSITION_CRITICALITIES.join(', ')}`,
          },
        ],

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const taken = await dependencies.stores.positions.byCode(transaction, command.code);

      if (taken !== undefined) return conflicted<PositionChanged>('position_code_taken');

      const defined = Position.define(
        {
          tenantId: currentTenant(),
          code: command.code,
          title: command.title,
          ...(command.description === undefined ? {} : { description: command.description }),
          ...(command.family === undefined ? {} : { family: command.family }),
          ...(command.grade === undefined ? {} : { grade: command.grade }),
          ...(command.criticality === undefined ? {} : { criticality: command.criticality }),
          ...(command.metadata === undefined ? {} : { metadata: command.metadata }),
          effectiveFrom: command.effectiveFrom,
        },
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!defined.ok) return refusedBy(defined.error);

      await dependencies.stores.positions.insert(transaction, defined.value.snapshot());
      transaction.collect(defined.value.pullEvents());
      return success({
        positionId: defined.value.id,
        code: defined.value.code,
        status: defined.value.currentStatus,
      });
    }),
});

export interface RevisePositionCommand extends Command {
  readonly commandName: 'organization.revise-position';
  readonly positionId: string;
  readonly title?: Readonly<Record<string, string>>;
  readonly description?: Readonly<Record<string, string>>;
  readonly family?: string;
  readonly grade?: string;
  readonly criticality?: PositionCriticality;
  readonly expectedVersion: number;
}

export const revisePositionHandler = (
  dependencies: OrganizationDependencies,
): CommandHandler<RevisePositionCommand, PositionChanged> => ({
  commandName: 'organization.revise-position',
  permission: OrganizationPermissions.positionManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const existing = await dependencies.stores.positions.byId(transaction, command.positionId);

      if (existing === undefined) return notFound<PositionChanged>('position');

      const position = Position.rehydrate(existing);
      const revised = position.revise(
        {
          ...(command.title === undefined ? {} : { title: command.title }),
          ...(command.description === undefined ? {} : { description: command.description }),
          ...(command.family === undefined ? {} : { family: command.family }),
          ...(command.grade === undefined ? {} : { grade: command.grade }),
          ...(command.criticality === undefined ? {} : { criticality: command.criticality }),
        },
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!revised.ok) return refusedBy(revised.error);

      await dependencies.stores.positions.update(
        transaction,
        position.snapshot(),
        command.expectedVersion,
      );
      transaction.collect(position.pullEvents());
      return success({
        positionId: position.id,
        code: position.code,
        status: position.currentStatus,
      });
    }),
});

export interface RetirePositionCommand extends Command {
  readonly commandName: 'organization.retire-position';
  readonly positionId: string;
  readonly effectiveTo: Date;
  readonly expectedVersion: number;
}

export const retirePositionHandler = (
  dependencies: OrganizationDependencies,
): CommandHandler<RetirePositionCommand, PositionChanged> => ({
  commandName: 'organization.retire-position',
  permission: OrganizationPermissions.positionManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const existing = await dependencies.stores.positions.byId(transaction, command.positionId);

      if (existing === undefined) return notFound<PositionChanged>('position');

      const position = Position.rehydrate(existing);
      const retired = position.retire(
        command.effectiveTo,
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!retired.ok) return refusedBy(retired.error);

      await dependencies.stores.positions.update(
        transaction,
        position.snapshot(),
        command.expectedVersion,
      );
      transaction.collect(position.pullEvents());
      return success({
        positionId: position.id,
        code: position.code,
        status: position.currentStatus,
      });
    }),
});
