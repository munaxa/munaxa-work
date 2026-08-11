import {
  sourceAnswered,
  sourceUnavailable,
  type CompensationFacts,
  type CompensationSourcePort,
  type EmploymentFacts,
  type EmploymentSourcePort,
  type PeriodWindow,
  type SourceAnswer,
} from '@work/payroll';
import type { CompensationPeriodView, MoneyAmountView } from '@work/compensation';
import type { EmploymentSnapshot, EmploymentView } from '@work/employment';
import { runWithServiceGrant, type HandlerFailure, type Query, type Result } from '@work/kernel';

import type { Asking } from './asking.js';

/**
 * Employment and Compensation — the two sources a payroll cannot be calculated without.
 *
 * Every call runs inside a **bounded service grant** (ADR-0043): running a payroll must not make
 * somebody a reader of the employment register, the attendance log, the leave ledger or the
 * compensation record. **No adapter writes anything** — there is no method that could.
 *
 * Two absences are load-bearing. `organization.export-structure` is never called; the payroll path
 * uses the bounded legal-entity read and nothing else (D-17). And there is no attendance overtime
 * call, because Attendance publishes no approved-overtime contract to call (ADR-0065).
 */

/** The permissions the grants permit — five, listed, so a reviewer sees the whole surface at once. */
const EMPLOYMENT_READ = 'employment.employment.read';
const COMPENSATION_READ = 'compensation.read';

/**
 * The queries these adapters send, typed rather than asserted.
 *
 * Typed because the alternative — an object literal cast to bare `Query` — is what let the Phase 8
 * defect through: a civil-date string was passed where the contract takes an instant, and the
 * compiler could not see it because the cast had already discarded the shape.
 */
interface SearchEmploymentsQuery extends Query {
  readonly queryName: 'employment.search';
  readonly status?: string;
  readonly size?: number;
  readonly page?: number;
}

interface ReadEmploymentQuery extends Query {
  readonly queryName: 'employment.read-employment';
  readonly employmentId: string;
  readonly asOf?: Date;
}

interface CompensationPeriodQuery extends Query {
  readonly queryName: 'compensation.payroll-period';
  readonly employmentIds: readonly string[];
  readonly periodStart: string;
  readonly periodEnd: string;
}

interface CompensationChangedQuery extends Query {
  readonly queryName: 'compensation.changed-since';
  readonly employmentIds: readonly string[];
  readonly recordedAfter: Date;
}

/**
 * A civil date, as the instant Employment's timeline is compared against.
 *
 * `employment.read-employment` takes an instant and compares it through `DateRange.contains`, which
 * calls `getTime()` on whatever it is given; a string reaching that comparison throws. UTC midnight
 * is the conversion Employment's own edge performs on a ten-character date — the Phase 8 fix.
 */
const asOfInstant = (civilDate: string): Date => new Date(`${civilDate}T00:00:00.000Z`);

/** Employment, asked two questions and never told anything. */
export class PayrollEmploymentSource implements EmploymentSourcePort {
  public constructor(private readonly dispatcher: Asking) {}

  public async employmentIds(
    _legalEntityId: string,
    after: string | undefined,
    limit: number,
  ): Promise<readonly string[]> {
    const result = await runWithServiceGrant(
      {
        module: 'payroll',
        operation: 'payroll.calculate',
        permits: [EMPLOYMENT_READ],
        reason: 'resolving the population a payroll run covers',
      },
      () =>
        this.ask<{ readonly items: readonly EmploymentView[] }, SearchEmploymentsQuery>({
          queryName: 'employment.search',
          size: limit,
        }),
    );

    if (!result.ok) return [];

    // Employment pages by page number rather than by cursor, so the cursor is applied here. The
    // identifiers are sorted so a resumed run continues where it stopped rather than restarting.
    const sorted = result.value.items.map((employment) => employment.employmentId).sort();
    const from = after === undefined ? 0 : sorted.indexOf(after) + 1;

    return sorted.slice(from, from + limit);
  }

  /**
   * The facts, **as at the period end** rather than as they are now.
   *
   * `statusOn` is preferred over the employment row's `status`, and the difference is the whole
   * reason this adapter passes a date: the row answers "now"; `statusOn` is reconstructed from the
   * status history and answers "then". A period that closed in March is snapshotted against March.
   */
  public async factsFor(
    employmentIds: readonly string[],
    asOf: string,
  ): Promise<SourceAnswer<EmploymentFacts>> {
    const found = new Map<string, EmploymentFacts>();

    for (const employmentId of employmentIds) {
      const result = await runWithServiceGrant(
        {
          module: 'payroll',
          operation: 'payroll.calculate',
          permits: [EMPLOYMENT_READ],
          reason: 'reading the employment a payroll result belongs to, as at the period',
        },
        () =>
          this.ask<EmploymentSnapshot, ReadEmploymentQuery>({
            queryName: 'employment.read-employment',
            employmentId,
            asOf: asOfInstant(asOf),
          }),
      );

      if (result.ok) found.set(employmentId, factsOf(result.value));
    }

    return sourceAnswered(found);
  }
  private ask<TResult, TQuery extends Query>(
    query: TQuery,
  ): Promise<Result<TResult, HandlerFailure>> {
    return this.dispatcher.ask<TResult>(query);
  }
}

const factsOf = (snapshot: EmploymentSnapshot): EmploymentFacts => {
  const employment = snapshot.employment;
  const assignment = snapshot.assignments[0];

  return {
    employmentId: employment.employmentId,
    // "Then", never "now".
    status: snapshot.statusOn ?? employment.status,
    startDate: employment.startDate,
    employmentTypeCode: employment.employmentTypeCode,
    version: employment.version,
    ...(employment.endDate === undefined ? {} : { endDate: employment.endDate }),
    ...(assignment?.unitId === undefined ? {} : { unitId: assignment.unitId }),
    ...(assignment?.positionId === undefined ? {} : { positionId: assignment.positionId }),
    ...(assignment?.costCenterId === undefined ? {} : { costCenterId: assignment.costCenterId }),
  };
};

/** Compensation, asked for a period and for what has moved since. Never for a table. */
export class PayrollCompensationSource implements CompensationSourcePort {
  public constructor(private readonly dispatcher: Asking) {}

  public async factsFor(
    employmentIds: readonly string[],
    period: PeriodWindow,
  ): Promise<SourceAnswer<CompensationFacts>> {
    const result = await runWithServiceGrant(
      {
        module: 'payroll',
        operation: 'payroll.calculate',
        permits: [COMPENSATION_READ],
        reason: 'reading the compensation a payroll period is calculated from',
      },
      () =>
        this.ask<{ readonly items: readonly CompensationPeriodView[] }, CompensationPeriodQuery>({
          queryName: 'compensation.payroll-period',
          employmentIds,
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
        }),
    );

    // **Unavailable, not empty.** A failure here must not become "this workforce is entitled to
    // nothing", which would calculate a payroll of zero and look exactly like a correct one.
    if (!result.ok) return sourceUnavailable();

    return sourceAnswered(
      new Map(result.value.items.map((view) => [view.employmentId, compensationOf(view)])),
    );
  }

  public async changedSince(
    employmentIds: readonly string[],
    recordedAfter: Date,
  ): Promise<readonly string[]> {
    const result = await runWithServiceGrant(
      {
        module: 'payroll',
        operation: 'payroll.reconcile',
        permits: [COMPENSATION_READ],
        reason: 'finding compensation recorded since a payroll run was calculated',
      },
      () =>
        this.ask<{ readonly employmentIds: readonly string[] }, CompensationChangedQuery>({
          queryName: 'compensation.changed-since',
          employmentIds,
          recordedAfter,
        }),
    );

    return result.ok ? result.value.employmentIds : [];
  }
  private ask<TResult, TQuery extends Query>(
    query: TQuery,
  ): Promise<Result<TResult, HandlerFailure>> {
    return this.dispatcher.ask<TResult>(query);
  }
}

/**
 * Compensation's view, mapped onto the facts the snapshot holds — **and nothing added**.
 *
 * `payrollTreatmentCode` and `proratable` are carried unchanged; the percentage resolution stays a
 * recorded fact rather than being re-derived, because Compensation resolved it with the rounding
 * mode stated on the component and a second resolution here would disagree by a fil (ADR-0062).
 */
const compensationOf = (view: CompensationPeriodView): CompensationFacts => ({
  currencies: view.currencies.map((block) => ({
    currencyCode: block.currencyCode,
    currencyExponent: block.currencyExponent,
    recurring: block.recurring.map((component) => ({
      componentId: component.componentId,
      componentCode: component.componentCode,
      kind: component.kind,
      payrollTreatmentCode: component.payrollTreatmentCode,
      proratable: component.proratable,
      amount: amountOf(component.amount),
      effectiveFrom: component.effectiveFrom,
      partialPeriod: component.partialPeriod,
      ...(component.effectiveTo === undefined ? {} : { effectiveTo: component.effectiveTo }),
      ...(component.resolvedFrom === undefined
        ? {}
        : { resolvedFromBasisPoints: component.resolvedFrom.percentageBasisPoints }),
    })),
    oneTime: block.oneTime.map((item) => ({
      oneTimeId: item.oneTimeId,
      componentId: item.componentId,
      componentCode: item.componentCode,
      payrollTreatmentCode: item.payrollTreatmentCode,
      amount: amountOf(item.amount),
      payableOn: item.payableOn,
    })),
  })),
  inputsDigest: view.inputsDigest,
  calculationVersion: view.calculationVersion,
  ...(view.compensationPlanId === undefined ? {} : { compensationPlanId: view.compensationPlanId }),
  ...(view.planVersion === undefined ? {} : { planVersion: view.planVersion }),
});

/**
 * A published amount, parsed **exactly**.
 *
 * `amountMinor` crosses the contract as a decimal string precisely so nothing above 2^53 is
 * mangled, and `BigInt` is the only correct way to read it. A `Number()` here would be the single
 * line that undoes every exactness guarantee in both modules.
 */
const amountOf = (
  view: MoneyAmountView,
): { amountMinor: bigint; currencyCode: string; currencyExponent: number } => ({
  amountMinor: BigInt(view.amountMinor),
  currencyCode: view.currencyCode,
  currencyExponent: view.currencyExponent,
});
