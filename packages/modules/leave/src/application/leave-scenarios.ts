import { harnessFor, type Harness } from './leave-test-harness.js';
import { datesBetween } from '../domain/leave-year.js';
import type {
  AccrualSettings,
  CarryOverSettings,
  LimitSettings,
} from '../domain/leave-policy-settings.js';

/**
 * A configured tenant, assembled through the module's own commands.
 *
 * Through the commands rather than by inserting rows, because a fixture that wrote rows directly
 * would pass even if publication, assignment or resolution were broken — and those three are
 * exactly what a request depends on.
 *
 * The leave type and policy here are **invented for the test** and carry no statutory meaning:
 * `holiday` with a configured accrual is a shape, not an entitlement this product ships.
 */

export interface Configured {
  readonly harness: Harness;
  readonly leaveTypeId: string;
  readonly leavePolicyId: string;
  readonly employmentId: string;
}

export interface ConfigureOptions {
  readonly limits?: Partial<LimitSettings>;
  readonly accrual?: Partial<AccrualSettings>;
  readonly carryOver?: Partial<CarryOverSettings>;
  readonly approvalsRequired?: number;
  readonly now?: Date;
  readonly workingDates?: readonly string[];
  readonly permissions?: readonly string[];
}

const ADMIN = 'user:hr-administrator';

export const configured = async (options: ConfigureOptions = {}): Promise<Configured> => {
  const harness = harnessFor({
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.permissions === undefined ? {} : { permissions: options.permissions }),
  });
  const employmentId = harness.employment.addOne();

  harness.attendance.expects(options.workingDates ?? datesBetween('2026-06-01', '2026-08-31'));

  const built = await harness.as(ADMIN, async () => {
    const type = await send<{ leaveTypeId: string }>(harness, {
      commandName: 'leave.define-type',
      code: 'holiday',
      name: { en: 'Holiday', ar: 'عطلة' },
      unit: 'days',
      paidTreatmentCode: 'full-pay',
    });

    await send(harness, {
      commandName: 'leave.publish-type',
      leaveTypeId: type.leaveTypeId,
      expectedVersion: 1,
    });

    const policy = await send<{ leavePolicyId: string }>(harness, {
      commandName: 'leave.define-policy',
      leaveTypeId: type.leaveTypeId,
      code: 'standard',
      name: { en: 'Standard', ar: 'قياسي' },
      effectiveFrom: '2020-01-01',
      approvalsRequired: options.approvalsRequired ?? 1,
      limits: { halfDayPermitted: true, hourlyPermitted: true, ...options.limits },
      ...(options.accrual === undefined ? {} : { accrual: options.accrual }),
      ...(options.carryOver === undefined ? {} : { carryOver: options.carryOver }),
    });

    await send(harness, {
      commandName: 'leave.publish-policy',
      leavePolicyId: policy.leavePolicyId,
      expectedVersion: 1,
    });

    await send(harness, {
      commandName: 'leave.assign-policy',
      leavePolicyId: policy.leavePolicyId,
      scope: 'tenant',
      effectiveFrom: '2020-01-01',
    });

    return { leaveTypeId: type.leaveTypeId, leavePolicyId: policy.leavePolicyId };
  });

  return { harness, employmentId, ...built };
};

/** Sends a command and throws where it was refused, so a fixture fails loudly rather than subtly. */
export const send = async <TResult>(
  harness: Harness,
  command: Record<string, unknown>,
): Promise<TResult> => {
  const result = await harness.dispatcher.send<TResult>(command as never);

  if (!result.ok) {
    throw new Error(`${String(command['commandName'])} refused: ${JSON.stringify(result.error)}`);
  }
  return result.value;
};

/** Sends a command and returns the failure, for the tests whose subject is the refusal. */
export const attempt = (
  harness: Harness,
  command: Record<string, unknown>,
): ReturnType<Harness['dispatcher']['send']> => harness.dispatcher.send(command as never);

export const ask = async <TResult>(
  harness: Harness,
  query: Record<string, unknown>,
): Promise<TResult> => {
  const result = await harness.dispatcher.ask<TResult>(query as never);

  if (!result.ok) {
    throw new Error(`${String(query['queryName'])} refused: ${JSON.stringify(result.error)}`);
  }
  return result.value;
};

/** Grants an opening entitlement, so a request has balance to draw on. */
export const withOpeningBalance = async (
  configuration: Configured,
  minutes: number,
  onDate = '2026-01-01',
): Promise<void> => {
  await configuration.harness.as(ADMIN, async () => {
    await send(configuration.harness, {
      commandName: 'leave.grant-entitlement',
      employmentId: configuration.employmentId,
      leaveTypeId: configuration.leaveTypeId,
      onDate,
      grantedMinutes: minutes,
      source: 'opening',
    });
    await send(configuration.harness, { commandName: 'leave.recalculate-balances' });
  });
};

export const ADMINISTRATOR = ADMIN;
export const APPROVER = 'user:line-manager';
