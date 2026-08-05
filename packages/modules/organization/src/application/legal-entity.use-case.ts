import { success, type Command, type CommandHandler } from '@work/kernel';

import { LegalEntity } from '../domain/legal-entity.js';
import { OrganizationUnitType } from '../domain/organization-unit-type.js';

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
 * Registering the legally constituted entities the tenant operates through, and the country
 * each is registered in.
 *
 * This use case is where 00B's rule that "an employment resolves its country pack from its legal
 * entity, not from the tenant" becomes enforceable. Phase 11.1 will ask this module which
 * country governs an employment; the answer walks up from the employment's unit to the nearest
 * legal entity, and it exists because a registration was made here.
 *
 * A unit may carry a registration only if its *type* says it can. That is not this module
 * deciding which levels are legal entities — it is the tenant deciding, in
 * `organization_unit_type.carries_legal_entity`, because a group that registers each branch
 * separately and one that registers a single company are both ordinary and neither is ours to
 * assume.
 */

export interface RegisterLegalEntityCommand extends Command {
  readonly commandName: 'organization.register-legal-entity';
  readonly unitId: string;
  readonly countryCode: string;
  readonly registeredName: Readonly<Record<string, string>>;
  readonly registrationNumber: string;
  readonly taxIdentifier?: string;
  readonly currencyCode: string;
  readonly incorporatedOn?: Date;
  readonly effectiveFrom: Date;
}

export interface LegalEntityChanged {
  readonly legalEntityId: string;
  readonly unitId: string;
  readonly countryCode: string;
}

export const registerLegalEntityHandler = (
  dependencies: OrganizationDependencies,
): CommandHandler<RegisterLegalEntityCommand, LegalEntityChanged> => ({
  commandName: 'organization.register-legal-entity',
  permission: OrganizationPermissions.legalEntityManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const unit = await dependencies.stores.units.byId(transaction, command.unitId);

      if (unit === undefined) return notFound<LegalEntityChanged>('unit');

      const type = await dependencies.stores.unitTypes.byId(transaction, unit.unitTypeId);

      if (type === undefined) return notFound<LegalEntityChanged>('unit type');
      if (!OrganizationUnitType.rehydrate(type).carriesLegalEntity) {
        return refusedBy<LegalEntityChanged>({
          reason: 'unit_type_carries_no_legal_entity',
          messageKey: 'organization.rejection.unit_type_carries_no_legal_entity',
          values: { type: type.code },
        });
      }

      const existing = await dependencies.stores.legalEntities.forUnit(transaction, command.unitId);

      // One registration per unit. Two would mean two countries for the same node, and every
      // statutory calculation beneath it would depend on which row was read first.
      if (existing !== undefined) return conflicted<LegalEntityChanged>('unit_already_registered');

      const registered = LegalEntity.register(
        {
          tenantId: currentTenant(),
          unitId: command.unitId,
          countryCode: command.countryCode,
          registeredName: command.registeredName,
          registrationNumber: command.registrationNumber,
          ...(command.taxIdentifier === undefined ? {} : { taxIdentifier: command.taxIdentifier }),
          currencyCode: command.currencyCode,
          ...(command.incorporatedOn === undefined
            ? {}
            : { incorporatedOn: command.incorporatedOn }),
          effectiveFrom: command.effectiveFrom,
        },
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!registered.ok) return refusedBy(registered.error);

      await dependencies.stores.legalEntities.insert(transaction, registered.value.snapshot());
      transaction.collect(registered.value.pullEvents());
      return success({
        legalEntityId: registered.value.id,
        unitId: command.unitId,
        countryCode: registered.value.countryCode,
      });
    }),
});

export interface AmendLegalEntityCommand extends Command {
  readonly commandName: 'organization.amend-legal-entity';
  readonly legalEntityId: string;
  readonly registeredName?: Readonly<Record<string, string>>;
  readonly registrationNumber?: string;
  readonly taxIdentifier?: string;
  readonly currencyCode?: string;
  readonly expectedVersion: number;
}

export const amendLegalEntityHandler = (
  dependencies: OrganizationDependencies,
): CommandHandler<AmendLegalEntityCommand, LegalEntityChanged> => ({
  commandName: 'organization.amend-legal-entity',
  permission: OrganizationPermissions.legalEntityManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const existing = await dependencies.stores.legalEntities.byId(
        transaction,
        command.legalEntityId,
      );

      if (existing === undefined) return notFound<LegalEntityChanged>('legal entity');

      const entity = LegalEntity.rehydrate(existing);
      const amended = entity.amend(
        {
          ...(command.registeredName === undefined
            ? {}
            : { registeredName: command.registeredName }),
          ...(command.registrationNumber === undefined
            ? {}
            : { registrationNumber: command.registrationNumber }),
          ...(command.taxIdentifier === undefined ? {} : { taxIdentifier: command.taxIdentifier }),
          ...(command.currencyCode === undefined ? {} : { currencyCode: command.currencyCode }),
        },
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!amended.ok) return refusedBy(amended.error);

      await dependencies.stores.legalEntities.update(
        transaction,
        entity.snapshot(),
        command.expectedVersion,
      );
      transaction.collect(entity.pullEvents());
      return success({
        legalEntityId: entity.id,
        unitId: entity.unitId,
        countryCode: entity.countryCode,
      });
    }),
});

export interface CloseLegalEntityCommand extends Command {
  readonly commandName: 'organization.close-legal-entity';
  readonly legalEntityId: string;
  readonly effectiveTo: Date;
  readonly expectedVersion: number;
}

export const closeLegalEntityHandler = (
  dependencies: OrganizationDependencies,
): CommandHandler<CloseLegalEntityCommand, LegalEntityChanged> => ({
  commandName: 'organization.close-legal-entity',
  permission: OrganizationPermissions.legalEntityManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const existing = await dependencies.stores.legalEntities.byId(
        transaction,
        command.legalEntityId,
      );

      if (existing === undefined) return notFound<LegalEntityChanged>('legal entity');

      const entity = LegalEntity.rehydrate(existing);
      const closed = entity.close(
        command.effectiveTo,
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!closed.ok) return refusedBy(closed.error);

      await dependencies.stores.legalEntities.update(
        transaction,
        entity.snapshot(),
        command.expectedVersion,
      );
      transaction.collect(entity.pullEvents());
      return success({
        legalEntityId: entity.id,
        unitId: entity.unitId,
        countryCode: entity.countryCode,
      });
    }),
});
