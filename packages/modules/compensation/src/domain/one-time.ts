import { uuidV7 } from '@work/kernel';

import {
  checkedCivilDate,
  checkedCode,
  checkedMetadata,
  checkedText,
  definedOnly,
  type Metadata,
} from './compensation-aggregate.js';
import { accept, refuse, type CompensationResult } from './compensation-rejection.js';
import { checkedMoney, type MoneyAmount, type MoneyInput } from './money-amount.js';
import {
  isCompensationSource,
  type ApprovalState,
  type CompensationSource,
} from './compensation-vocabulary.js';

/**
 * One-time compensation: a bonus, a commission, an award.
 *
 * **Compensation records that it is owed and on what date it becomes payable. Payroll decides which
 * period it falls into.** Working out which payroll run consumes a 15 March bonus depends on the
 * period calendar, the cut-off and the jurisdiction — all Payroll's, and none of them knowable here.
 *
 * A one-time item has **no effective period and therefore no overlap rule**: two bonuses on one
 * date is ordinary, not a mistake. Idempotency comes from `(source, sourceId, component,
 * employment)` instead, so an import retried writes once.
 *
 * **No expense or reimbursement workflow.** A reimbursement-shaped component may be *defined* by a
 * tenant, but there is no claim here, no receipt, no approval chain of its own and no document.
 * Those belong to a domain that does not exist yet, and building a fragment of one would be the
 * fake completeness this phase refuses.
 */

export interface OneTimeState {
  readonly id: string;
  readonly tenantId: string;
  readonly employmentId: string;
  readonly componentId: string;
  readonly compensationPlanId: string;
  readonly amount: MoneyAmount;
  /** The civil date it becomes payable. **Not** the period that pays it — that is Payroll's. */
  readonly payableOn: string;
  readonly reasonCode: string;
  readonly note?: string;
  readonly source: CompensationSource;
  readonly sourceId?: string;
  readonly recordedAt: Date;
  readonly recordedBy: string;
  readonly approvalState: ApprovalState;
  readonly approvedAt?: Date;
  readonly metadata: Metadata;
  readonly version: number;
}

export interface RecordOneTime {
  readonly tenantId: string;
  readonly employmentId: string;
  readonly componentId: string;
  readonly compensationPlanId: string;
  readonly amount: MoneyInput;
  readonly payableOn: string;
  readonly reasonCode: string;
  readonly note?: string;
  readonly source?: string;
  readonly sourceId?: string;
  readonly recordedBy: string;
  readonly approvalState: ApprovalState;
  readonly metadata?: Metadata;
}

const NOTE_LIMIT = 1024;
const SOURCE_ID_LIMIT = 128;

export const oneTime = (
  request: RecordOneTime,
  recordedAt: Date,
): CompensationResult<OneTimeState> => {
  const amount = checkedMoney(request.amount, 'amount');

  if (!amount.ok) return amount;

  const payableOn = checkedCivilDate(request.payableOn, 'payableOn');

  if (!payableOn.ok) return payableOn;

  // A reason is required on a one-time item, and not on a recurring one, for a reason: a recurring
  // entitlement is explained by the plan and the component it came from, whereas a bonus is a
  // discretionary movement whose only explanation is the one somebody wrote down.
  const reason = checkedCode(request.reasonCode, 'reasonCode');

  if (!reason.ok) return reason;

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
    payableOn: payableOn.value,
    reasonCode: reason.value,
    recordedAt,
    recordedBy: request.recordedBy,
    approvalState: request.approvalState,
    ...origin.value,
    metadata: metadata.value,
    version: 0,
  });
};

const checkedOrigin = (
  request: RecordOneTime,
): CompensationResult<{
  readonly source: CompensationSource;
  readonly sourceId?: string;
  readonly note?: string;
}> => {
  const source = request.source ?? 'manual';

  if (!isCompensationSource(source)) return refuse('compensation_source_unknown', { source });

  const sourceId = checkedText(request.sourceId, 'sourceId', SOURCE_ID_LIMIT);

  if (!sourceId.ok) return sourceId;

  const note = checkedText(request.note, 'note', NOTE_LIMIT);

  if (!note.ok) return note;

  return accept({ source, ...definedOnly({ sourceId: sourceId.value, note: note.value }) });
};

/** Whether a one-time item becomes payable inside a period. Inclusive of both ends. */
export const payableWithin = (
  state: OneTimeState,
  period: { readonly from: string; readonly to: string },
): boolean => state.payableOn >= period.from && state.payableOn <= period.to;
