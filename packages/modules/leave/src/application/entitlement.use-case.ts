import { success, uuidV7, type Command, type CommandHandler } from '@work/kernel';

import { entitlement } from '../domain/entitlement.js';
import { leaveYearFor } from '../domain/leave-year.js';
import { appendToLedger } from './ledger-writer.js';
import { resolvePolicy } from './policy-resolution.js';
import { currentActor, currentTenant, notFound, refusedBy } from './leave-context.js';
import { LeavePermissions } from './leave-permissions.js';
import type { Metadata } from '../domain/leave-aggregate.js';
import type { LeaveDependencies } from './leave-dependencies.js';

/**
 * Granting entitlement, and adjusting a balance by hand.
 *
 * Both write to the ledger, because the ledger is the only thing a balance is made of. Neither
 * touches a balance figure: `appendToLedger` writes the movement and marks the projection stale in
 * the same transaction, and recalculation does the rest.
 *
 * **An entitlement grant and an adjustment are different acts behind different permissions.** A
 * grant applies a policy to somebody — an opening figure at go-live, a statutory allocation a
 * country pack produced. An adjustment is a correction no rule produced and no request explains,
 * which makes it the movement an auditor looks at first, and it is the only one in this module that
 * **requires both a reason code and a written note**. Somebody has to be able to answer for it
 * years later.
 */

export interface GrantEntitlementCommand extends Command {
  readonly commandName: 'leave.grant-entitlement';
  readonly employmentId: string;
  readonly leaveTypeId: string;
  readonly onDate: string;
  readonly grantedMinutes: number;
  readonly source: string;
  readonly reasonCode?: string;
  readonly metadata?: Metadata;
}

export interface EntitlementGranted {
  readonly entitlementId: string;
  readonly leaveYearStart: string;
}

export const grantEntitlementHandler = (
  dependencies: LeaveDependencies,
): CommandHandler<GrantEntitlementCommand, EntitlementGranted> => ({
  commandName: 'leave.grant-entitlement',
  permission: LeavePermissions.entitlementManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const employment = await dependencies.employment.find(command.employmentId, command.onDate);

      if (employment === undefined) return notFound<EntitlementGranted>('employment');

      const resolved = await resolvePolicy(transaction, dependencies, {
        employment,
        leaveTypeId: command.leaveTypeId,
        onDate: command.onDate,
      });

      if (!resolved.ok) return refusedBy<EntitlementGranted>(resolved.error);

      const leaveYear = leaveYearFor(resolved.value.policy, command.onDate);
      const granted = entitlement(
        {
          ...command,
          tenantId: currentTenant(),
          leavePolicyId: resolved.value.policy.id,
          leaveYear,
        },
        dependencies.clock.now(),
      );

      if (!granted.ok) return refusedBy<EntitlementGranted>(granted.error);

      await dependencies.stores.entitlements.insert(transaction, granted.value);

      // The credit that makes the grant visible in a balance. `opening` rather than the grant's own
      // source word: the ledger's kinds are movements, and a grant of any source is a credit.
      const written = await appendToLedger(transaction, dependencies, {
        tenantId: granted.value.tenantId,
        employmentId: granted.value.employmentId,
        leaveTypeId: granted.value.leaveTypeId,
        leaveYear,
        kind: 'opening',
        minutes: granted.value.grantedMinutes,
        effectiveOn: command.onDate,
        sourceKind: 'entitlement',
        sourceId: granted.value.id,
        leavePolicyId: resolved.value.policy.id,
        ...(command.reasonCode === undefined ? {} : { reasonCode: command.reasonCode }),
      });

      if (!written.ok) return refusedBy<EntitlementGranted>(written.error);

      return success({ entitlementId: granted.value.id, leaveYearStart: leaveYear.start });
    }),
});

export interface AdjustBalanceCommand extends Command {
  readonly commandName: 'leave.adjust-balance';
  readonly employmentId: string;
  readonly leaveTypeId: string;
  readonly effectiveOn: string;
  /** Signed. Positive credits, negative debits. Zero is refused by the domain and by the database. */
  readonly minutes: number;
  readonly reasonCode: string;
  readonly note: string;
  readonly metadata?: Metadata;
}

export interface BalanceAdjusted {
  readonly adjustmentId: string;
  readonly balanceBeforeMinutes: number;
  readonly balanceAfterMinutes: number;
}

export const adjustBalanceHandler = (
  dependencies: LeaveDependencies,
): CommandHandler<AdjustBalanceCommand, BalanceAdjusted> => ({
  commandName: 'leave.adjust-balance',
  permission: LeavePermissions.adjust,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const employment = await dependencies.employment.find(
        command.employmentId,
        command.effectiveOn,
      );

      if (employment === undefined) return notFound<BalanceAdjusted>('employment');

      const resolved = await resolvePolicy(transaction, dependencies, {
        employment,
        leaveTypeId: command.leaveTypeId,
        onDate: command.effectiveOn,
      });

      if (!resolved.ok) return refusedBy<BalanceAdjusted>(resolved.error);

      const leaveYear = leaveYearFor(resolved.value.policy, command.effectiveOn);
      const now = dependencies.clock.now();
      const record = {
        id: uuidV7(now.getTime()),
        tenantId: currentTenant(),
        employmentId: command.employmentId,
        leaveTypeId: command.leaveTypeId,
        leaveYearStart: leaveYear.start,
        minutes: command.minutes,
        effectiveOn: command.effectiveOn,
        reasonCode: command.reasonCode,
        note: command.note,
        adjustedBy: currentActor(),
        adjustedAt: now,
        metadata: command.metadata ?? {},
        version: 0,
      };

      await dependencies.stores.adjustments.insert(transaction, record);

      const written = await appendToLedger(transaction, dependencies, {
        tenantId: record.tenantId,
        employmentId: record.employmentId,
        leaveTypeId: record.leaveTypeId,
        leaveYear,
        kind: 'adjustment',
        minutes: command.minutes,
        effectiveOn: command.effectiveOn,
        sourceKind: 'adjustment',
        sourceId: record.id,
        reasonCode: command.reasonCode,
        note: command.note,
        leavePolicyId: resolved.value.policy.id,
      });

      if (!written.ok) return refusedBy<BalanceAdjusted>(written.error);

      return success({
        adjustmentId: record.id,
        balanceBeforeMinutes: written.value.entry.balanceBeforeMinutes,
        balanceAfterMinutes: written.value.entry.balanceAfterMinutes,
      });
    }),
});
