import { success, type Query, type QueryHandler, type Transaction } from '@work/kernel';

import { LeavePermissions } from './leave-permissions.js';
import type { CoveredDay } from './leave-ports.js';
import type { LeaveDependencies } from './leave-dependencies.js';
import type { LeavePayrollPeriodView } from '../contracts/views.js';

/**
 * What Payroll reads, so it never reads a Leave table.
 *
 * `LeavePayrollPeriodView` was declared in Phase 9 and published for exactly this consumer; Phase
 * 11 found that **no query handler returned it** — the type existed and the contract did not. This
 * is that handler, added additively: no schema change, no new view type, no behaviour change to
 * anything Leave already does (Phase 11 D-15).
 *
 * Two properties are the whole point of it existing at all.
 *
 * **`paidTreatmentCode` travels uninterpreted.** Leave states it; Payroll reads the literal string
 * and never maps a `leaveTypeId` to a meaning. Without this query Payroll would have had to resolve
 * a type's treatment itself, which is Payroll deciding what Leave means — exactly what ADR-0060
 * keeps it from doing.
 *
 * **`days` states its own basis.** A day is `minutes ÷ expectedMinutes` for the dates covered, using
 * what the working-day basis said was expected *on that date* rather than a constant. There is no
 * eight-hour day and no six-day week in this calculation, because both are somebody's jurisdiction.
 *
 * `inputsDigest` and `calculationVersion` are what make a payroll run reproducible: Payroll stores
 * them in its snapshot and compares them on reconciliation, which is how a cancelled leave request
 * is found without an event (ADR-0058, ADR-0064).
 */

/** Bumped when the shape of what this returns changes in a way that changes a payroll figure. */
const CALCULATION_VERSION = 1;

export interface ReadLeavePayrollPeriod extends Query {
  readonly queryName: 'leave.payroll-period';
  readonly employmentIds: readonly string[];
  readonly periodStart: string;
  readonly periodEnd: string;
}

export interface LeavePayrollPeriodPage {
  readonly items: readonly LeavePayrollPeriodView[];
}

/** Bounded, because Payroll calls this per batch and an unbounded read has no place on that path. */
const MAX_PERIOD_EMPLOYMENTS = 500;

export const readLeavePayrollPeriodHandler = (
  dependencies: LeaveDependencies,
): QueryHandler<ReadLeavePayrollPeriod, LeavePayrollPeriodPage> => ({
  queryName: 'leave.payroll-period',
  permission: LeavePermissions.read,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const employmentIds = query.employmentIds.slice(0, MAX_PERIOD_EMPLOYMENTS);
      const types = await typeIndex(dependencies, transaction);
      const items: LeavePayrollPeriodView[] = [];

      for (const employmentId of employmentIds) {
        const days = await dependencies.stores.requestDays.covering(transaction, {
          employmentId,
          from: query.periodStart,
          to: query.periodEnd,
        });

        items.push(viewFor(query, employmentId, days, types));
      }

      return success({ items });
    }),
});

interface TypeFacts {
  readonly code: string;
  readonly paidTreatmentCode: string;
}

const typeIndex = async (
  dependencies: LeaveDependencies,
  transaction: Transaction,
): Promise<ReadonlyMap<string, TypeFacts>> => {
  const types = await dependencies.stores.types.all(transaction);

  return new Map(
    types.map((type) => [type.id, { code: type.code, paidTreatmentCode: type.paidTreatmentCode }]),
  );
};

const viewFor = (
  query: ReadLeavePayrollPeriod,
  employmentId: string,
  days: readonly CoveredDay[],
  types: ReadonlyMap<string, TypeFacts>,
): LeavePayrollPeriodView => {
  const byType = new Map<string, MutableLine>();

  for (const day of days) {
    const line = byType.get(day.leaveTypeId) ?? blankLine(day.leaveTypeId, types);

    line.minutes += day.minutes;
    // The day's own expected minutes, not a constant. A half day on a six-hour Thursday is half a
    // day; a constant divisor would make it something else.
    line.days += day.expectedMinutes > 0 ? day.minutes / day.expectedMinutes : 0;
    if (!line.requestIds.includes(day.leaveRequestId)) line.requestIds.push(day.leaveRequestId);
    byType.set(day.leaveTypeId, line);
  }

  const lines = [...byType.values()].map((line) => ({
    leaveTypeId: line.leaveTypeId,
    leaveTypeCode: line.leaveTypeCode,
    paidTreatmentCode: line.paidTreatmentCode,
    minutes: line.minutes,
    days: Math.round(line.days * 100) / 100,
    requestIds: line.requestIds,
  }));

  return {
    employmentId,
    periodStart: query.periodStart,
    periodEnd: query.periodEnd,
    lines,
    // **Eligibility, not worth.** Encashment is a policy permission; what a minute is worth is
    // Payroll's, and Leave publishes no rate. Nothing in Phase 9 records an encashment *request*,
    // so this is zero rather than a number invented to fill the field.
    encashableMinutes: 0,
    calculationVersion: CALCULATION_VERSION,
    inputsDigest: digestOf(days),
  };
};

interface MutableLine {
  readonly leaveTypeId: string;
  readonly leaveTypeCode: string;
  readonly paidTreatmentCode: string;
  minutes: number;
  days: number;
  readonly requestIds: string[];
}

const blankLine = (leaveTypeId: string, types: ReadonlyMap<string, TypeFacts>): MutableLine => {
  const facts = types.get(leaveTypeId);

  return {
    leaveTypeId,
    // An unresolvable type is reported as `unknown` rather than guessed. Payroll refuses to treat
    // an unknown treatment as unpaid, which is the safe direction.
    leaveTypeCode: facts?.code ?? 'unknown',
    paidTreatmentCode: facts?.paidTreatmentCode ?? 'unknown',
    minutes: 0,
    days: 0,
    requestIds: [],
  };
};

/**
 * The fingerprint Payroll compares on reconciliation.
 *
 * Over the **day rows themselves** — their identifiers, dates, minutes and versions — so a
 * cancelled request, an amended one and a re-approved one all change it. FNV-1a, 32-bit, as
 * unsigned hex: the same function Attendance and Compensation publish theirs with.
 */
const digestOf = (days: readonly CoveredDay[]): string => {
  const parts = [...days]
    .map((day) => `${day.id}:${day.onDate}:${day.minutes}:${day.version}`)
    .sort();
  let hash = 0x811c9dc5;

  for (const part of parts) {
    for (let index = 0; index < part.length; index += 1) {
      hash ^= part.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return hash.toString(16).padStart(8, '0');
};
