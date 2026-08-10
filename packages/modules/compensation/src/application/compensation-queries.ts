import { success, type Query, type QueryHandler, type Transaction } from '@work/kernel';

import { moneyView } from '../domain/money-amount.js';
import { inForceOn } from '../domain/recurring.js';
import { resolutionOf } from './percentage-resolution.js';
import {
  adjustmentView,
  approvalChainView,
  changeView,
  oneTimeView,
  recurringView,
} from './compensation-views.js';
import { paged } from './definition-queries.js';
import { CompensationPermissions } from './compensation-permissions.js';
import type { CompensationComponentState } from '../domain/compensation-component.js';
import type { RecurringState } from '../domain/recurring.js';
import type {
  CompensationAdjustmentView,
  CompensationApprovalChainView,
  CompensationChangeView,
  EmploymentCompensationView,
  OneTimeCompensationView,
  RecurringCompensationView,
} from '../contracts/views.js';
import type { CompensationDependencies } from './compensation-dependencies.js';

/**
 * The employment-facing reads: current compensation, compensation as of a past date, history,
 * future changes, the registers and the approval chain.
 *
 * Two things hold across all of them.
 *
 * **`asOf` is required to answer a historical question, and ignoring it is a visible choice.** The
 * current read is `as-of today`, spelled that way, so there is no path that silently answers "now"
 * to a question about "then".
 *
 * **Nothing is summed across currencies.** An employment may hold a local salary and a
 * foreign-currency allowance, and the totals published are **one per currency**. A single figure
 * would require a conversion, and nothing in this module converts (§20.4).
 */

export interface ReadEmploymentCompensation extends Query {
  readonly queryName: 'compensation.for-employment';
  readonly employmentId: string;
  /** Absent means today. Present answers "what was true then", from the same code path. */
  readonly asOf?: string;
}

export const readEmploymentCompensationHandler = (
  dependencies: CompensationDependencies,
): QueryHandler<ReadEmploymentCompensation, EmploymentCompensationView> => ({
  queryName: 'compensation.for-employment',
  permission: CompensationPermissions.read,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const asOf = query.asOf ?? today(dependencies);
      const records = await dependencies.stores.recurring.inForceOn(
        transaction,
        query.employmentId,
        asOf,
      );
      const components = await componentsFor(dependencies, transaction, records);
      const views = records.map((record) => viewOf(record, records, components));

      return success({
        employmentId: query.employmentId,
        asOf,
        components: views,
        totalsByCurrency: totalsByCurrency(records),
        ...(records[0] === undefined ? {} : { compensationPlanId: records[0].compensationPlanId }),
      });
    }),
});

export interface ReadFutureChanges extends Query {
  readonly queryName: 'compensation.future-changes';
  readonly employmentId: string;
}

export interface FutureChangesView {
  readonly items: readonly RecurringCompensationView[];
}

/**
 * What is scheduled and not yet effective.
 *
 * A future-dated change is stored immediately and is visible here **before** it takes effect,
 * which is what makes "a raise agreed in March effective in July" a thing somebody can see rather
 * than a thing they have to remember.
 */
export const readFutureChangesHandler = (
  dependencies: CompensationDependencies,
): QueryHandler<ReadFutureChanges, FutureChangesView> => ({
  queryName: 'compensation.future-changes',
  permission: CompensationPermissions.read,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const now = today(dependencies);
      const records = await dependencies.stores.recurring.forEmployment(
        transaction,
        query.employmentId,
      );
      const future = records.filter((record) => record.effectiveFrom > now);
      const components = await componentsFor(dependencies, transaction, future);

      return success({
        items: future.map((record) => viewOf(record, records, components)),
      });
    }),
});

export interface ReadCompensationHistory extends Query {
  readonly queryName: 'compensation.history';
  readonly employmentId: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface CompensationHistoryView {
  readonly items: readonly CompensationChangeView[];
  readonly total: number;
}

/**
 * The change log for one employment — the screen that answers "why is it this number".
 *
 * Reads the append-only history rather than reconstructing from the periods, because the periods
 * cannot express the events that changed no value: an approval, a reversal, an adjustment recorded
 * against an amount that stayed the same.
 */
export const readCompensationHistoryHandler = (
  dependencies: CompensationDependencies,
): QueryHandler<ReadCompensationHistory, CompensationHistoryView> => ({
  queryName: 'compensation.history',
  permission: CompensationPermissions.read,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const page = await dependencies.stores.changes.forEmployment(
        transaction,
        query.employmentId,
        paged(query),
      );

      return success({ items: page.items.map(changeView), total: page.total });
    }),
});

export interface SearchRecurring extends Query {
  readonly queryName: 'compensation.recurring';
  readonly employmentId?: string;
  readonly componentId?: string;
  readonly effectiveOn?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface RecurringRegisterView {
  readonly items: readonly RecurringCompensationView[];
  readonly total: number;
}

export const searchRecurringHandler = (
  dependencies: CompensationDependencies,
): QueryHandler<SearchRecurring, RecurringRegisterView> => ({
  queryName: 'compensation.recurring',
  permission: CompensationPermissions.read,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const page = await dependencies.stores.recurring.search(transaction, {
        ...paged(query),
        ...(query.employmentId === undefined ? {} : { employmentId: query.employmentId }),
        ...(query.componentId === undefined ? {} : { componentId: query.componentId }),
        ...(query.effectiveOn === undefined ? {} : { effectiveOn: query.effectiveOn }),
      });
      const components = await componentsFor(dependencies, transaction, page.items);

      return success({
        items: page.items.map((record) => viewOf(record, page.items, components)),
        total: page.total,
      });
    }),
});

export interface SearchOneTime extends Query {
  readonly queryName: 'compensation.one-time';
  readonly employmentId?: string;
  readonly componentId?: string;
  readonly fromDate?: string;
  readonly toDate?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface OneTimeRegisterView {
  readonly items: readonly OneTimeCompensationView[];
  readonly total: number;
}

export const searchOneTimeHandler = (
  dependencies: CompensationDependencies,
): QueryHandler<SearchOneTime, OneTimeRegisterView> => ({
  queryName: 'compensation.one-time',
  permission: CompensationPermissions.read,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const page = await dependencies.stores.oneTime.search(transaction, {
        ...paged(query),
        ...(query.employmentId === undefined ? {} : { employmentId: query.employmentId }),
        ...(query.componentId === undefined ? {} : { componentId: query.componentId }),
        ...(query.fromDate === undefined ? {} : { fromDate: query.fromDate }),
        ...(query.toDate === undefined ? {} : { toDate: query.toDate }),
      });
      const components = await dependencies.stores.components.byIds(
        transaction,
        page.items.map((item) => item.componentId),
      );
      const codes = new Map(components.map((component) => [component.id, component.code]));

      return success({
        items: page.items.map((item) => oneTimeView(item, codes.get(item.componentId) ?? '')),
        total: page.total,
      });
    }),
});

export interface SearchAdjustments extends Query {
  readonly queryName: 'compensation.adjustments';
  readonly employmentId?: string;
  readonly componentId?: string;
  /** Whether the caller holds `compensation.adjust` — set by the pipeline, not by a caller. */
  readonly reasonsVisible?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}

export interface AdjustmentRegisterView {
  readonly items: readonly CompensationAdjustmentView[];
  readonly total: number;
}

/**
 * The adjustment register.
 *
 * Behind `compensation.adjust` rather than `compensation.read`, because an adjustment's note is the
 * sentence somebody wrote about *why* a person's pay changed — frequently about performance, a
 * dispute or a settlement — and it is a narrower disclosure than the figure itself.
 */
export const searchAdjustmentsHandler = (
  dependencies: CompensationDependencies,
): QueryHandler<SearchAdjustments, AdjustmentRegisterView> => ({
  queryName: 'compensation.adjustments',
  permission: CompensationPermissions.adjust,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const page = await dependencies.stores.adjustments.search(transaction, {
        ...paged(query),
        ...(query.employmentId === undefined ? {} : { employmentId: query.employmentId }),
        ...(query.componentId === undefined ? {} : { componentId: query.componentId }),
      });

      return success({
        items: page.items.map((item) => adjustmentView(item, true)),
        total: page.total,
      });
    }),
});

export interface ReadApprovalChain extends Query {
  readonly queryName: 'compensation.approval-chain';
  readonly subjectKind: string;
  readonly subjectId: string;
}

export const readApprovalChainHandler = (
  dependencies: CompensationDependencies,
): QueryHandler<ReadApprovalChain, CompensationApprovalChainView> => ({
  queryName: 'compensation.approval-chain',
  permission: CompensationPermissions.read,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const decisions = await dependencies.stores.decisions.forSubject(
        transaction,
        query.subjectKind,
        query.subjectId,
      );
      const required = await approvalsRequiredFor(dependencies, transaction, query);

      return success(
        approvalChainView({ kind: query.subjectKind, id: query.subjectId }, decisions, required),
      );
    }),
});

const approvalsRequiredFor = async (
  dependencies: CompensationDependencies,
  transaction: Transaction,
  query: ReadApprovalChain,
): Promise<number> => {
  if (query.subjectKind !== 'recurring') return 1;

  const record = await dependencies.stores.recurring.byId(transaction, query.subjectId);

  if (record === undefined) return 1;

  const plan = await dependencies.stores.plans.byId(transaction, record.compensationPlanId);

  return plan?.approvalsRequired ?? 1;
};

const today = (dependencies: CompensationDependencies): string =>
  dependencies.clock.now().toISOString().slice(0, 10);

/** The component definitions a page of records refers to, read once rather than per record. */
export const componentsFor = async (
  dependencies: CompensationDependencies,
  transaction: Transaction,
  records: readonly RecurringState[],
): Promise<readonly CompensationComponentState[]> =>
  dependencies.stores.components.byIds(transaction, [
    ...new Set(records.map((record) => record.componentId)),
  ]);

/**
 * A record as a view, with the percentage rule attached where the amount came from one.
 *
 * The basis amount comes from the *sibling records* already read, so publishing the working costs
 * no extra query — and the rule published is the one **stored on the record**, not the component's
 * current one, so a component revised since cannot restate what a historical figure was a
 * percentage of.
 */
export const viewOf = (
  record: RecurringState,
  siblings: readonly RecurringState[],
  components: readonly CompensationComponentState[],
): RecurringCompensationView => {
  const component = components.find((one) => one.id === record.componentId);
  const basis = siblings.find(
    (one) => one.componentId === record.basisComponentId && inForceOn(one, record.effectiveFrom),
  );
  const resolved = resolutionOf(record, component?.roundingMode ?? 'half-up', basis?.amount);

  return recurringView(record, component?.code ?? '', resolved);
};

/**
 * One total per currency.
 *
 * **Never a single figure.** Summing a salary in JOD and an allowance in USD would require a
 * conversion this module refuses to perform, and a consumer asking for one total gets one per
 * currency instead (§20.4).
 */
export const totalsByCurrency = (
  records: readonly RecurringState[],
): readonly ReturnType<typeof moneyView>[] => {
  const totals = new Map<string, { amountMinor: bigint; exponent: number }>();

  for (const record of records) {
    const existing = totals.get(record.amount.currencyCode);

    totals.set(record.amount.currencyCode, {
      amountMinor: (existing?.amountMinor ?? 0n) + record.amount.amountMinor,
      exponent: record.amount.currencyExponent,
    });
  }
  return [...totals.entries()].map(([currencyCode, total]) =>
    moneyView({
      amountMinor: total.amountMinor,
      currencyCode,
      currencyExponent: total.exponent,
    }),
  );
};
