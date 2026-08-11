import { uuidV7 } from '@work/kernel';

import {
  checkedOptionalCode,
  checkedPeriod,
  checkedText,
  definedOnly,
  type EffectivePeriod,
  type Metadata,
  checkedMetadata,
} from './compensation-aggregate.js';
import { accept, refuse, type CompensationResult } from './compensation-rejection.js';
import { checkedMoney, type MoneyAmount, type MoneyInput } from './money-amount.js';
import {
  MAX_BASIS_POINTS,
  isCompensationSource,
  periodContains,
  periodsOverlap,
  type ApprovalState,
  type CompensationSource,
} from './compensation-vocabulary.js';

/**
 * The authoritative record of what an employment is entitled to receive repeatedly.
 *
 * **Value columns are never updated.** A change closes the previous period by writing its
 * `effectiveTo` and inserts a new row — the `Timeline.change` semantics Employment already uses for
 * assignments and contracts. Closing a period records *when it ended*; it does not rewrite what it
 * was. Nothing else on a historical row is ever written, which is what lets a payroll re-run for a
 * closed period produce that period's figure.
 *
 * **The amount is copied here, never joined.** Where an assignment came from a salary step, the
 * step's amount at the effective date is stored on the row. Revising the step next year must not
 * restate what last year's payroll was run against, and a join to a mutable reference table would
 * do exactly that.
 *
 * **Two time axes are recorded.** `effectiveFrom` answers "what was true on this date";
 * `recordedAt` answers "when did we learn it". A raise effective 1 March entered on 20 April has
 * both, and without the second a payroll dispute cannot distinguish a back-dated raise from one
 * everybody always knew about (D-5).
 *
 * **Overlap is refused by the database** — one employment holds at most one active assignment of
 * the same component at a time. Two administrators assigning the same allowance concurrently both
 * read before either wrote, so only the exclusion constraint can settle it (D-4).
 */

export interface RecurringState extends EffectivePeriod {
  readonly id: string;
  readonly tenantId: string;
  readonly employmentId: string;
  readonly componentId: string;
  /** Which plan version governed this record. Recorded, never re-resolved. */
  readonly compensationPlanId: string;
  readonly payGradeId?: string;
  readonly payScaleId?: string;
  readonly salaryStepId?: string;
  readonly amount: MoneyAmount;
  /** Present where the amount was resolved from a percentage, so the working is checkable. */
  readonly percentageBasisPoints?: number;
  readonly basisComponentId?: string;
  readonly recordedAt: Date;
  readonly recordedBy: string;
  readonly source: CompensationSource;
  readonly sourceId?: string;
  readonly reasonCode?: string;
  readonly note?: string;
  readonly approvalState: ApprovalState;
  readonly approvedAt?: Date;
  readonly supersedesId?: string;
  readonly metadata: Metadata;
  readonly version: number;
}

export interface AssignRecurring {
  readonly tenantId: string;
  readonly employmentId: string;
  readonly componentId: string;
  readonly compensationPlanId: string;
  readonly payGradeId?: string;
  readonly payScaleId?: string;
  readonly salaryStepId?: string;
  readonly amount: MoneyInput;
  readonly percentageBasisPoints?: number;
  readonly basisComponentId?: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly recordedBy: string;
  readonly source?: string;
  readonly sourceId?: string;
  readonly reasonCode?: string;
  readonly note?: string;
  readonly approvalState: ApprovalState;
  readonly supersedesId?: string;
  readonly metadata?: Metadata;
}

const NOTE_LIMIT = 1024;
const SOURCE_ID_LIMIT = 128;

export const recurring = (
  request: AssignRecurring,
  recordedAt: Date,
): CompensationResult<RecurringState> => {
  const amount = checkedMoney(request.amount, 'amount');

  if (!amount.ok) return amount;

  const percentage = checkedPercentage(request);

  if (!percentage.ok) return percentage;

  const period = checkedPeriod(request.effectiveFrom, request.effectiveTo, 'recurring');

  if (!period.ok) return period;

  const origin = checkedOrigin(request);

  if (!origin.ok) return origin;

  const metadata = checkedMetadata(request.metadata);

  if (!metadata.ok) return metadata;

  return accept({
    id: uuidV7(recordedAt.getTime()),
    tenantId: request.tenantId,
    employmentId: request.employmentId,
    componentId: request.componentId,
    compensationPlanId: request.compensationPlanId,
    amount: amount.value,
    recordedAt,
    recordedBy: request.recordedBy,
    approvalState: request.approvalState,
    ...definedOnly({
      payGradeId: request.payGradeId,
      payScaleId: request.payScaleId,
      salaryStepId: request.salaryStepId,
      supersedesId: request.supersedesId,
    }),
    ...percentage.value,
    ...period.value,
    ...origin.value,
    metadata: metadata.value,
    version: 0,
  });
};

const checkedPercentage = (
  request: AssignRecurring,
): CompensationResult<{
  readonly percentageBasisPoints?: number;
  readonly basisComponentId?: string;
}> => {
  const hasPoints = request.percentageBasisPoints !== undefined;
  const hasBasis = request.basisComponentId !== undefined;

  if (hasPoints !== hasBasis) return refuse('percentage_requires_a_basis');
  if (
    request.percentageBasisPoints !== undefined &&
    (!Number.isInteger(request.percentageBasisPoints) ||
      request.percentageBasisPoints < 0 ||
      request.percentageBasisPoints > MAX_BASIS_POINTS)
  ) {
    return refuse('basis_points_out_of_range', { field: 'percentageBasisPoints' });
  }
  return accept(
    definedOnly({
      percentageBasisPoints: request.percentageBasisPoints,
      basisComponentId: request.basisComponentId,
    }),
  );
};

const checkedOrigin = (
  request: AssignRecurring,
): CompensationResult<{
  readonly source: CompensationSource;
  readonly sourceId?: string;
  readonly reasonCode?: string;
  readonly note?: string;
}> => {
  const source = request.source ?? 'manual';

  if (!isCompensationSource(source)) return refuse('compensation_source_unknown', { source });

  const sourceId = checkedText(request.sourceId, 'sourceId', SOURCE_ID_LIMIT);

  if (!sourceId.ok) return sourceId;

  const reason = checkedOptionalCode(request.reasonCode, 'reasonCode');

  if (!reason.ok) return reason;

  const note = checkedText(request.note, 'note', NOTE_LIMIT);

  if (!note.ok) return note;

  return accept({
    source,
    ...definedOnly({ sourceId: sourceId.value, reasonCode: reason.value, note: note.value }),
  });
};

/**
 * Closing a period.
 *
 * The **only** write ever made to a historical row, and it writes exactly one value column's worth:
 * the end date. The amount, the currency, the plan, the actor and both timestamps stay as they
 * were, which is what makes "what was this on that date" answerable for ever.
 */
export const closed = (
  state: RecurringState,
  effectiveTo: string,
): CompensationResult<RecurringState> => {
  if (effectiveTo <= state.effectiveFrom) return refuse('period_ends_before_it_starts');
  if (state.effectiveTo !== undefined && state.effectiveTo <= effectiveTo) {
    return accept(state);
  }
  return accept({ ...state, effectiveTo, version: state.version });
};

/** Whether a record is in force on a civil date. Half-open, matching the database's `daterange`. */
export const inForceOn = (state: RecurringState, onDate: string): boolean =>
  periodContains({ from: state.effectiveFrom, ...definedOnly({ to: state.effectiveTo }) }, onDate);

/** Whether two records for one `(employment, component)` would both be in force at once. */
export const overlaps = (left: RecurringState, right: RecurringState): boolean =>
  periodsOverlap(
    { from: left.effectiveFrom, ...definedOnly({ to: left.effectiveTo }) },
    { from: right.effectiveFrom, ...definedOnly({ to: right.effectiveTo }) },
  );

/**
 * Whether a record's period is only partly inside a payroll period.
 *
 * States a fact and prorates nothing: whether a mid-period change is scaled by calendar days,
 * working days or a statutory formula is a payroll and jurisdictional question, and answering it
 * here would put a country's law inside a generic module (§28).
 */
export const isPartialWithin = (
  state: RecurringState,
  period: { readonly from: string; readonly to: string },
): boolean =>
  state.effectiveFrom > period.from ||
  (state.effectiveTo !== undefined && state.effectiveTo <= period.to);
