import { uuidV7 } from '@work/kernel';

import {
  checkedCivilDate,
  checkedCode,
  checkedMetadata,
  definedOnly,
  requiredText,
  type Metadata,
} from './compensation-aggregate.js';
import { accept, refuse, type CompensationResult } from './compensation-rejection.js';
import { checkedMoney, sameCurrency, type MoneyAmount, type MoneyInput } from './money-amount.js';
import type { ApprovalState } from './compensation-vocabulary.js';

/**
 * An adjustment is the **reason record beside a compensation change**, not a second way to change
 * something.
 *
 * ```text
 * current recurring period
 *         ├── compensation_adjustment   (why, who, when, from → to)
 *         └── new recurring period effective from D
 * ```
 *
 * **It never mutates a historical row.** It records the intent; the effective-dated supersession
 * records the effect. Both are written in one transaction, so a reason without its change — or a
 * change without its reason — cannot exist.
 *
 * **Both a reason code and a written note are required**, for the reason Leave requires them on a
 * balance adjustment: this is the movement no rule produced, which makes it the one an auditor
 * reads first. A code alone is a category; the note is what a human actually decided.
 */

export interface AdjustmentState {
  readonly id: string;
  readonly tenantId: string;
  readonly employmentId: string;
  readonly componentId?: string;
  /** A code — `merit`, `promotion`, `correction`, `market`, whatever a tenant names. */
  readonly adjustmentType: string;
  readonly previousAmount?: MoneyAmount;
  readonly newAmount?: MoneyAmount;
  readonly currencyCode: string;
  readonly currencyExponent: number;
  readonly effectiveFrom: string;
  readonly reasonCode: string;
  readonly note: string;
  readonly requestedBy: string;
  readonly recordedAt: Date;
  readonly approvalState: ApprovalState;
  /** The recurring period this adjustment explains, where it explains one. */
  readonly recurringId?: string;
  readonly metadata: Metadata;
  readonly version: number;
}

export interface RecordAdjustment {
  readonly tenantId: string;
  readonly employmentId: string;
  readonly componentId?: string;
  readonly adjustmentType: string;
  readonly previousAmount?: MoneyInput;
  readonly newAmount?: MoneyInput;
  readonly currencyCode: string;
  readonly currencyExponent: number;
  readonly effectiveFrom: string;
  readonly reasonCode: string;
  readonly note: string;
  readonly requestedBy: string;
  readonly approvalState: ApprovalState;
  readonly recurringId?: string;
  readonly metadata?: Metadata;
}

const NOTE_LIMIT = 1024;

export const adjustment = (
  request: RecordAdjustment,
  recordedAt: Date,
): CompensationResult<AdjustmentState> => {
  const type = checkedCode(request.adjustmentType, 'adjustmentType');

  if (!type.ok) return type;

  const reason = checkedCode(request.reasonCode, 'reasonCode');

  if (!reason.ok) return reason;

  const note = requiredText(request.note, 'note', NOTE_LIMIT);

  if (!note.ok) return note;

  const effectiveFrom = checkedCivilDate(request.effectiveFrom, 'effectiveFrom');

  if (!effectiveFrom.ok) return effectiveFrom;

  const amounts = checkedAmounts(request);

  if (!amounts.ok) return amounts;

  const metadata = checkedMetadata(request.metadata);

  if (!metadata.ok) return metadata;

  return accept({
    id: uuidV7(recordedAt.getTime()),
    tenantId: request.tenantId,
    employmentId: request.employmentId,
    adjustmentType: type.value,
    currencyCode: request.currencyCode,
    currencyExponent: request.currencyExponent,
    effectiveFrom: effectiveFrom.value,
    reasonCode: reason.value,
    note: note.value,
    requestedBy: request.requestedBy,
    recordedAt,
    approvalState: request.approvalState,
    ...definedOnly({ componentId: request.componentId, recurringId: request.recurringId }),
    ...amounts.value,
    metadata: metadata.value,
    version: 0,
  });
};

/**
 * The before and the after.
 *
 * Both are optional — an adjustment that *opens* a component has no previous amount, and one that
 * ends it has no new one — but where both are present they must be in the same currency as each
 * other and as the adjustment. A "change" from one currency to another is a currency change, which
 * is an ordinary effective-dated supersession rather than an adjustment of an amount, and nothing
 * in this module converts (§20.4).
 */
const checkedAmounts = (
  request: RecordAdjustment,
): CompensationResult<{
  readonly previousAmount?: MoneyAmount;
  readonly newAmount?: MoneyAmount;
}> => {
  const previous = optionalAmount(request.previousAmount, 'previousAmount');

  if (!previous.ok) return previous;

  const next = optionalAmount(request.newAmount, 'newAmount');

  if (!next.ok) return next;

  const declared = {
    amountMinor: 0n,
    currencyCode: request.currencyCode,
    currencyExponent: request.currencyExponent,
  };

  for (const amount of [previous.value, next.value]) {
    if (amount !== undefined && !sameCurrency(amount, declared)) {
      return refuse('adjustment_currencies_differ');
    }
  }
  return accept(definedOnly({ previousAmount: previous.value, newAmount: next.value }));
};

const optionalAmount = (
  input: MoneyInput | undefined,
  field: string,
): CompensationResult<MoneyAmount | undefined> =>
  input === undefined ? accept(undefined) : checkedMoney(input, field);
