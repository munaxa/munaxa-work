import { success, type Command, type CommandHandler } from '@work/kernel';

import { AttendancePolicy } from '../domain/attendance-policy.js';
import { rosterEntry } from '../domain/roster-entry.js';
import type { RosterKind, RoundingMode } from '../domain/attendance-vocabulary.js';

import {
  conflicted,
  currentActor,
  currentTenant,
  notFound,
  refusedBy,
} from './attendance-context.js';
import { DEFAULT_ZONE, zoneFor } from './expectation-resolution.js';
import { FAR_FUTURE, markDay } from './assignment.use-case.js';
import { AttendancePermissions } from './attendance-permissions.js';
import type { AttendanceDependencies } from './attendance-dependencies.js';

/**
 * Rostering, and the attendance policy.
 *
 * **A roster entry is where a public holiday lives in this phase.** Organization owns calendars and
 * publishes no read for them, and 00B makes the public-holiday calendar country-pack content that
 * Phase 11.1 supplies. Until then a rest day is a schedule fact and a holiday is something a tenant
 * records here — and Attendance builds no calendar of its own, because two owners of "is the 23rd a
 * holiday" produce two answers (the approved D-2 fallback).
 *
 * Every write in this file **marks the affected day in the same transaction**, so a rota changed in
 * June is found by the reconciliation query rather than by an event that may never arrive.
 */

export interface RosterAffected {
  readonly rosterEntryId: string;
  readonly employmentId: string;
  readonly onDate: string;
}

export interface RosterCommand extends Command {
  readonly commandName: 'attendance.roster';
  readonly employmentId: string;
  readonly onDate: string;
  readonly kind: RosterKind;
  readonly shiftId?: string;
  readonly reasonCode?: string;
  readonly note?: string;
  readonly swapOfEntryId?: string;
  /** Required when an entry already exists for the date — this replaces it, visibly. */
  readonly expectedVersion?: number;
}

export const rosterHandler = (
  dependencies: AttendanceDependencies,
): CommandHandler<RosterCommand, RosterAffected> => ({
  commandName: 'attendance.roster',
  permission: AttendancePermissions.rosterManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const employment = await dependencies.employment.find(command.employmentId, command.onDate);

      if (employment === undefined) return notFound<RosterAffected>('employment');

      if (command.shiftId !== undefined) {
        const shift = await dependencies.stores.shifts.byId(transaction, command.shiftId);

        if (shift === undefined) return notFound<RosterAffected>('shift');
        if (shift.status !== 'published') return conflicted('shift_not_published');
      }

      const existing = await dependencies.stores.rosters.on(
        transaction,
        command.employmentId,
        command.onDate,
      );

      // Replacing an entry is a supersession, never an in-place edit: "who moved the rota, and
      // when" has to stay answerable after somebody disputes a month.
      if (existing !== undefined) {
        if (command.expectedVersion === undefined) return conflicted('roster_entry_exists');
        await dependencies.stores.rosters.remove(transaction, existing.id, command.expectedVersion);
      }

      const entry = rosterEntry(
        { tenantId: currentTenant(), ...command },
        dependencies.clock.now(),
      );

      if (!entry.ok) return refusedBy(entry.error);

      await dependencies.stores.rosters.insert(transaction, entry.value);

      const now = dependencies.clock.now();
      const zone = await zoneFor(transaction, dependencies, {
        employmentId: command.employmentId,
        onDate: command.onDate,
        tenantZone: DEFAULT_ZONE,
      });

      await markDay(
        dependencies,
        transaction,
        { employmentId: command.employmentId, attendanceDate: command.onDate, zone },
        now,
      );
      return success({
        rosterEntryId: entry.value.id,
        employmentId: command.employmentId,
        onDate: command.onDate,
      });
    }),
});

export interface PolicyAffected {
  readonly policyId: string;
  readonly code: string;
  readonly status: string;
}

export interface DefinePolicyCommand extends Command {
  readonly commandName: 'attendance.define-policy';
  readonly code: string;
  readonly name: Readonly<Record<string, string>>;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly roundingMinutes?: number;
  readonly roundingMode?: RoundingMode;
  readonly lateToleranceMinutes?: number;
  readonly earlyDepartureToleranceMinutes?: number;
  readonly duplicateWindowSeconds?: number;
  readonly clockSkewToleranceSeconds?: number;
  readonly overtimeThresholdMinutes?: number;
  readonly overtimeRequiresApproval?: boolean;
  readonly absenceBlocksApproval?: boolean;
  readonly metadata?: Readonly<Record<string, string>>;
}

/**
 * Defining an attendance policy.
 *
 * Nothing statutory ships: every unconfigured value is the inert one, because a shipped grace period
 * would be this product deciding a labour-relations question for a customer who never asked (00B).
 */
export const definePolicyHandler = (
  dependencies: AttendanceDependencies,
): CommandHandler<DefinePolicyCommand, PolicyAffected> => ({
  commandName: 'attendance.define-policy',
  permission: AttendancePermissions.policyManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const policy = AttendancePolicy.define(
        { tenantId: currentTenant(), ...command },
        dependencies.clock.now(),
      );

      if (!policy.ok) return refusedBy(policy.error);

      await dependencies.stores.policies.insert(transaction, policy.value.snapshot());
      return success({
        policyId: policy.value.id,
        code: command.code,
        status: policy.value.status,
      });
    }),
});

export interface PublishPolicyCommand extends Command {
  readonly commandName: 'attendance.publish-policy';
  readonly policyId: string;
  readonly expectedVersion: number;
}

/**
 * Publishing a policy, and marking every day it now governs.
 *
 * A published policy changes what "late" means from its effective date, so the days already
 * calculated under the old one are marked here — in this transaction — and recalculated
 * deliberately. Days *before* the effective date are untouched: a grace period widened in June does
 * not retroactively forgive March.
 */
export const publishPolicyHandler = (
  dependencies: AttendanceDependencies,
): CommandHandler<PublishPolicyCommand, PolicyAffected> => ({
  commandName: 'attendance.publish-policy',
  permission: AttendancePermissions.policyManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const state = await dependencies.stores.policies.byId(transaction, command.policyId);

      if (state === undefined) return notFound<PolicyAffected>('policy');

      const policy = AttendancePolicy.rehydrate(state);
      const published = policy.publish(currentActor(), dependencies.clock.now());

      if (!published.ok) return refusedBy(published.error);

      await dependencies.stores.policies.update(
        transaction,
        policy.snapshot(),
        command.expectedVersion,
      );
      await dependencies.stores.days.markStale(
        transaction,
        { from: state.effectiveFrom, to: state.effectiveTo ?? FAR_FUTURE },
        dependencies.clock.now(),
      );
      return success({ policyId: policy.id, code: state.code, status: policy.status });
    }),
});
