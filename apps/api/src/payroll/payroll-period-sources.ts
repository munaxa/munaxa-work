import {
  sourceAnswered,
  sourceUnavailable,
  type AttendanceFacts,
  type AttendanceSourcePort,
  type LeaveFacts,
  type LeaveSourcePort,
  type OrganizationSourcePort,
  type PeriodWindow,
  type SourceAnswer,
} from '@work/payroll';
import type { PayableSnapshotView } from '@work/attendance';
import type { LeavePayrollPeriodView } from '@work/leave';
import type { GoverningLegalEntity, LegalEntityView } from '@work/organization';
import { runWithServiceGrant, type HandlerFailure, type Query, type Result } from '@work/kernel';

import type { Asking } from './asking.js';

/**
 * Attendance, Leave and Organization — the three sources that can each be **absent** in a way that
 * changes what a payroll may claim.
 *
 * Each returns `sourceUnavailable()` on a failure rather than an empty answer, because "could not
 * be asked" is not "there was nothing" (ADR-0056). Collapsing the two would let an outage produce a
 * payroll of zero that looks exactly like a correct one.
 */

const ATTENDANCE_READ = 'attendance.read';
const LEAVE_READ = 'leave.read';
const ORGANIZATION_READ = 'organization.legal-entity.read';

interface AttendanceSnapshotQuery extends Query {
  readonly queryName: 'attendance.read-snapshots';
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly employmentId?: string;
}

interface LeavePeriodQuery extends Query {
  readonly queryName: 'leave.payroll-period';
  readonly employmentIds: readonly string[];
  readonly periodStart: string;
  readonly periodEnd: string;
}

interface ListLegalEntitiesQuery extends Query {
  readonly queryName: 'organization.list-legal-entities';
}

interface GoverningLegalEntityQuery extends Query {
  readonly queryName: 'organization.governing-legal-entity';
  readonly unitId: string;
  readonly asOf?: Date;
}

/**
 * Attendance, asked for the **frozen** payable snapshot — and for nothing else.
 *
 * `overtimeCandidateMinutes` is carried into the snapshot because it is part of what Attendance
 * said, and **no code path turns it into an earning** (ADR-0065). There is no second call here for
 * an approved overtime result, because Attendance publishes none.
 */
export class PayrollAttendanceSource implements AttendanceSourcePort {
  public constructor(private readonly dispatcher: Asking) {}

  public async factsFor(
    employmentIds: readonly string[],
    period: PeriodWindow,
  ): Promise<SourceAnswer<AttendanceFacts>> {
    const result = await runWithServiceGrant(
      {
        module: 'payroll',
        operation: 'payroll.calculate',
        permits: [ATTENDANCE_READ],
        reason: 'reading the frozen attendance a payroll period is calculated from',
      },
      () =>
        this.ask<readonly PayableSnapshotView[], AttendanceSnapshotQuery>({
          queryName: 'attendance.read-snapshots',
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
        }),
    );

    if (!result.ok) return sourceUnavailable();

    const wanted = new Set(employmentIds);
    const found = new Map<string, AttendanceFacts>();

    for (const view of result.value) {
      if (wanted.has(view.employmentId)) found.set(view.employmentId, attendanceOf(view));
    }
    return sourceAnswered(found);
  }
  private ask<TResult, TQuery extends Query>(
    query: TQuery,
  ): Promise<Result<TResult, HandlerFailure>> {
    return this.dispatcher.ask<TResult>(query);
  }
}

const attendanceOf = (view: PayableSnapshotView): AttendanceFacts => ({
  snapshotId: view.snapshotId,
  sequence: view.sequence,
  frozenAt: view.frozenAt,
  workedMinutes: view.workedMinutes,
  regularCandidateMinutes: view.regularCandidateMinutes,
  // Carried, and never paid.
  overtimeCandidateMinutes: view.overtimeCandidateMinutes,
  unpaidMinutes: view.unpaidMinutes,
  absenceMinutes: view.absenceMinutes,
  leaveMinutes: view.leaveMinutes,
  leaveState: view.leaveState,
  blockingExceptions: view.blockingExceptions,
  inputsDigest: view.inputsDigest,
  calculationVersion: view.calculationVersion,
});

/**
 * Leave, through the contract it publishes for exactly this consumer.
 *
 * `paidTreatmentCode` arrives already stated by Leave and travels uninterpreted into the snapshot;
 * Payroll reads the literal `unpaid` and never maps a `leaveTypeId` to a meaning (ADR-0060, D-15).
 * Nothing here computes a leave duration — the days and minutes are Leave's own.
 */
export class PayrollLeaveSource implements LeaveSourcePort {
  public constructor(private readonly dispatcher: Asking) {}

  public async factsFor(
    employmentIds: readonly string[],
    period: PeriodWindow,
  ): Promise<SourceAnswer<LeaveFacts>> {
    const result = await runWithServiceGrant(
      {
        module: 'payroll',
        operation: 'payroll.calculate',
        permits: [LEAVE_READ],
        reason: 'reading the approved leave a payroll period is calculated from',
      },
      () =>
        this.ask<{ readonly items: readonly LeavePayrollPeriodView[] }, LeavePeriodQuery>({
          queryName: 'leave.payroll-period',
          employmentIds,
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
        }),
    );

    if (!result.ok) return sourceUnavailable();

    return sourceAnswered(
      new Map(result.value.items.map((view) => [view.employmentId, leaveOf(view)])),
    );
  }
  private ask<TResult, TQuery extends Query>(
    query: TQuery,
  ): Promise<Result<TResult, HandlerFailure>> {
    return this.dispatcher.ask<TResult>(query);
  }
}

const leaveOf = (view: LeavePayrollPeriodView): LeaveFacts => ({
  lines: view.lines.map((line) => ({
    leaveTypeId: line.leaveTypeId,
    leaveTypeCode: line.leaveTypeCode,
    paidTreatmentCode: line.paidTreatmentCode,
    minutes: line.minutes,
    days: line.days,
  })),
  encashableMinutes: view.encashableMinutes,
  inputsDigest: view.inputsDigest,
  calculationVersion: view.calculationVersion,
});

/**
 * Organization, asked two bounded questions: which unit the group's legal entity is registered
 * on, then which legal entity governs that unit. A payroll group names a legal *entity*, and the
 * governing-entity query walks from a *unit*; asking it with the entity's id found no unit, so
 * every calculation refused with `organization_unavailable` (MW-072). The first question reads the
 * tenant's legal-entity registrations, which are few by nature (one per registered company).
 *
 * `organization.export-structure` is never called from a payroll path — an unbounded structure
 * export per run is the read D-17 forbids. Where a cost-centre code is wanted for a human-readable
 * export, the identifier is carried instead and no label is fabricated.
 *
 * **A failure answers `known: false`, and that is not "no legal entity".** It means Organization
 * could not be asked, and the calculation refuses rather than proceeding under no country.
 */
export class PayrollOrganizationSource implements OrganizationSourcePort {
  public constructor(private readonly dispatcher: Asking) {}

  public async legalEntity(legalEntityId: string): Promise<
    | { readonly known: false }
    | {
        readonly known: true;
        readonly entity?: {
          readonly legalEntityId: string;
          readonly countryCode: string;
          readonly currencyCode: string;
        };
      }
  > {
    const listed = await this.withGrant(() =>
      this.ask<readonly LegalEntityView[], ListLegalEntitiesQuery>({
        queryName: 'organization.list-legal-entities',
      }),
    );

    if (!listed.ok) return { known: false };

    const named = listed.value.find((entity) => entity.id === legalEntityId);

    // An identifier Organization does not hold cannot be resolved to a country, which is what an
    // unknown unit answered before; the calculation refuses rather than running under none.
    if (named === undefined) return { known: false };

    const result = await this.withGrant(() =>
      this.ask<GoverningLegalEntity, GoverningLegalEntityQuery>({
        queryName: 'organization.governing-legal-entity',
        unitId: named.unitId,
      }),
    );

    if (!result.ok) return { known: false };

    const entity = result.value.legalEntity;

    // Known, and possibly *none*: a group whose entity has no declared country is a real
    // configuration, and it is a different answer from "Organization could not be asked".
    return {
      known: true,
      ...(entity === undefined
        ? {}
        : {
            entity: {
              legalEntityId: entity.id,
              countryCode: entity.countryCode,
              currencyCode: entity.currencyCode,
            },
          }),
    };
  }
  private withGrant<TResult>(work: () => Promise<TResult>): Promise<TResult> {
    return runWithServiceGrant(
      {
        module: 'payroll',
        operation: 'payroll.calculate',
        permits: [ORGANIZATION_READ],
        reason: 'reading the legal entity whose country governs a payroll run',
      },
      work,
    );
  }
  private ask<TResult, TQuery extends Query>(
    query: TQuery,
  ): Promise<Result<TResult, HandlerFailure>> {
    return this.dispatcher.ask<TResult>(query);
  }
}
