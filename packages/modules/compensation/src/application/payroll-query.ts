import { success, type Query, type QueryHandler, type Transaction } from '@work/kernel';

import { moneyView } from '../domain/money-amount.js';
import { isPartialWithin, type RecurringState } from '../domain/recurring.js';
import { payableWithin, type OneTimeState } from '../domain/one-time.js';
import { definedOnly } from '../domain/compensation-aggregate.js';
import { componentsFor, viewOf } from './compensation-queries.js';
import { CompensationPermissions } from './compensation-permissions.js';
import type { CompensationComponentState } from '../domain/compensation-component.js';
import type {
  CompensationCurrencyBlockView,
  CompensationPeriodComponentView,
  CompensationPeriodOneTimeView,
  CompensationPeriodView,
} from '../contracts/views.js';
import type { CompensationDependencies } from './compensation-dependencies.js';

/**
 * **The Phase 11 contract**: what compensation applies to a page of employments over a period.
 *
 * Three properties make it the contract rather than a convenience.
 *
 * **It is set-based.** One statement resolves the effective periods for a whole page of employments
 * — not one timeline read per employment, which at 100,000 employments would be 100,000 round trips
 * per payroll run. This is the read the no-projection decision rests on (D-7): a projection was
 * declined because the authoritative rows answer this fast enough, and this query is the reason
 * that is true.
 *
 * **It publishes facts and no computed total.** No gross, no net, no tax, no social security, no
 * overtime pay, no unpaid-leave deduction, no arrears, no end-of-service and no conversion.
 * `proratable` and `partialPeriod` are *flags* — whether a mid-period change is scaled by calendar
 * days, working days or a statutory formula is a payroll and jurisdictional question, and answering
 * it here would put a country's law inside a generic module.
 *
 * **It includes employments with no compensation**, as empty blocks. A silently shorter list would
 * make Payroll guess whether somebody was omitted or genuinely has nothing.
 */

/** A page bound. A payroll run pages through the workforce; it does not ask for all of it at once. */
export const MAX_PERIOD_EMPLOYMENTS = 500;

/** Bumped when the assembly changes in a way that alters a published figure. */
const CALCULATION_VERSION = 1;

export interface ReadPayrollPeriod extends Query {
  readonly queryName: 'compensation.payroll-period';
  readonly employmentIds: readonly string[];
  readonly periodStart: string;
  readonly periodEnd: string;
}

export interface PayrollPeriodView {
  readonly items: readonly CompensationPeriodView[];
}

export const readPayrollPeriodHandler = (
  dependencies: CompensationDependencies,
): QueryHandler<ReadPayrollPeriod, PayrollPeriodView> => ({
  queryName: 'compensation.payroll-period',
  permission: CompensationPermissions.read,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const employmentIds = query.employmentIds.slice(0, MAX_PERIOD_EMPLOYMENTS);
      const period = {
        employmentIds,
        periodStart: query.periodStart,
        periodEnd: query.periodEnd,
      };
      const recurring = await dependencies.stores.recurring.overlappingPeriod(transaction, period);
      const oneTime = await dependencies.stores.oneTime.payableWithin(transaction, period);
      const components = await componentsFor(dependencies, transaction, recurring);

      return success({
        items: employmentIds.map((employmentId) =>
          periodViewFor(employmentId, { recurring, oneTime, components }, query),
        ),
      });
    }),
});

interface PeriodInputs {
  readonly recurring: readonly RecurringState[];
  readonly oneTime: readonly OneTimeState[];
  readonly components: readonly CompensationComponentState[];
}

const periodViewFor = (
  employmentId: string,
  inputs: PeriodInputs,
  query: ReadPayrollPeriod,
): CompensationPeriodView => {
  const mine = inputs.recurring.filter((record) => record.employmentId === employmentId);
  const mineOneTime = inputs.oneTime.filter(
    (item) =>
      item.employmentId === employmentId &&
      payableWithin(item, { from: query.periodStart, to: query.periodEnd }),
  );
  const currencies = currencyBlocks(mine, mineOneTime, inputs, query);

  return {
    employmentId,
    periodStart: query.periodStart,
    periodEnd: query.periodEnd,
    currencies,
    inputsDigest: digestOf(mine, mineOneTime),
    calculationVersion: CALCULATION_VERSION,
    ...definedOnly({ compensationPlanId: mine[0]?.compensationPlanId }),
  };
};

/**
 * One block per currency, and **nothing summed across them**.
 *
 * A local salary and a foreign-currency allowance is a real arrangement, and the only honest way to
 * publish both without converting is to keep them apart.
 */
const currencyBlocks = (
  recurring: readonly RecurringState[],
  oneTime: readonly OneTimeState[],
  inputs: PeriodInputs,
  query: ReadPayrollPeriod,
): readonly CompensationCurrencyBlockView[] => {
  const codes = new Set([
    ...recurring.map((record) => record.amount.currencyCode),
    ...oneTime.map((item) => item.amount.currencyCode),
  ]);

  return [...codes].map((currencyCode) => ({
    currencyCode,
    currencyExponent: exponentFor(currencyCode, recurring, oneTime),
    recurring: recurring
      .filter((record) => record.amount.currencyCode === currencyCode)
      .map((record) => periodComponent(record, recurring, inputs, query)),
    oneTime: oneTime
      .filter((item) => item.amount.currencyCode === currencyCode)
      .map((item) => periodOneTime(item, inputs)),
  }));
};

const exponentFor = (
  currencyCode: string,
  recurring: readonly RecurringState[],
  oneTime: readonly OneTimeState[],
): number =>
  recurring.find((record) => record.amount.currencyCode === currencyCode)?.amount
    .currencyExponent ??
  oneTime.find((item) => item.amount.currencyCode === currencyCode)?.amount.currencyExponent ??
  2;

const periodComponent = (
  record: RecurringState,
  siblings: readonly RecurringState[],
  inputs: PeriodInputs,
  query: ReadPayrollPeriod,
): CompensationPeriodComponentView => {
  const component = inputs.components.find((one) => one.id === record.componentId);
  const view = viewOf(record, siblings, inputs.components);

  return {
    componentId: record.componentId,
    componentCode: component?.code ?? '',
    kind: component?.kind ?? '',
    // Stored, never interpreted. Compensation does not know what this code means and must not.
    payrollTreatmentCode: component?.payrollTreatmentCode ?? '',
    proratable: component?.proratable ?? false,
    amount: moneyView(record.amount),
    effectiveFrom: record.effectiveFrom,
    // A fact, not a proration. Payroll decides how — or whether — to scale it.
    partialPeriod: isPartialWithin(record, { from: query.periodStart, to: query.periodEnd }),
    ...definedOnly({ effectiveTo: record.effectiveTo, resolvedFrom: view.resolvedFrom }),
  };
};

const periodOneTime = (item: OneTimeState, inputs: PeriodInputs): CompensationPeriodOneTimeView => {
  const component = inputs.components.find((one) => one.id === item.componentId);

  return {
    oneTimeId: item.id,
    componentId: item.componentId,
    componentCode: component?.code ?? '',
    payrollTreatmentCode: component?.payrollTreatmentCode ?? '',
    amount: moneyView(item.amount),
    payableOn: item.payableOn,
  };
};

/**
 * A deterministic digest of the inputs.
 *
 * Not a cryptographic hash and not claimed to be one: it is a stable fingerprint of the identifiers,
 * amounts and periods that produced this view, so a disputed payslip can be traced to the exact set
 * of records behind it and a re-run producing a different digest is visibly a different question.
 */
const digestOf = (
  recurring: readonly RecurringState[],
  oneTime: readonly OneTimeState[],
): string => {
  const parts = [
    ...recurring.map(
      (record) =>
        `r:${record.id}:${record.amount.amountMinor.toString()}:${record.amount.currencyCode}:${record.effectiveFrom}:${record.effectiveTo ?? ''}`,
    ),
    ...oneTime.map(
      (item) => `o:${item.id}:${item.amount.amountMinor.toString()}:${item.payableOn}`,
    ),
  ].sort();

  return fingerprint(parts.join('|'));
};

/** FNV-1a, 32-bit, as unsigned hex. Deterministic across processes and cheap. */
const fingerprint = (value: string): string => {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

/** Reads a period's inputs without assembling a view — used by the reconciliation query. */
export const periodInputsFor = async (
  dependencies: CompensationDependencies,
  transaction: Transaction,
  period: {
    readonly employmentIds: readonly string[];
    readonly periodStart: string;
    readonly periodEnd: string;
  },
): Promise<readonly RecurringState[]> =>
  dependencies.stores.recurring.overlappingPeriod(transaction, period);
