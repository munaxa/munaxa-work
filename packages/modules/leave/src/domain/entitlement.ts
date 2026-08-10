import { uuidV7 } from '@work/kernel';

import { checkedMinutes, checkedOptionalCode, type Metadata } from './leave-aggregate.js';
import { accept, refuse, type LeaveResult } from './leave-rejection.js';
import { ENTITLEMENT_SOURCES, MINUTES_IN_DAY, type EntitlementSource } from './leave-vocabulary.js';
import type { LeaveYear } from './leave-year.js';

/**
 * A grant of leave, for one employment, one leave type and one leave year.
 *
 * **An entitlement is not a balance.** It is one of the inputs a balance is derived from, and the
 * distinction is load-bearing: an entitlement records *that a grant was made and why*, while the
 * balance records what is left after everything that happened to it. Somebody granted twenty-one
 * days who has taken five has one entitlement and one balance, and a model that conflated them
 * could not answer "how much were they given" after the first request.
 *
 * Every entitlement writes a **credit to the ledger** in the same transaction, and the ledger entry
 * is what the balance sums. The entitlement row is the administrative record beside it, naming the
 * source — an opening figure carried in at go-live, an accrual run, a carry-over, an adjustment, or
 * a statutory grant a country pack produced.
 *
 * `grantedMinutes` is bounded at a year of minutes rather than at some figure resembling a
 * statutory maximum. **There is no statutory maximum in this module**; the bound exists to catch a
 * mis-keyed number, not to encode a law (§22).
 */

export interface EntitlementState {
  readonly id: string;
  readonly tenantId: string;
  readonly employmentId: string;
  readonly leaveTypeId: string;
  readonly leavePolicyId: string;
  readonly leaveYearStart: string;
  readonly leaveYearEnd: string;
  readonly grantedMinutes: number;
  readonly source: EntitlementSource;
  /** The run, the request or the adjustment that produced it. Absent for an opening figure. */
  readonly sourceId?: string;
  readonly reasonCode?: string;
  readonly metadata: Metadata;
  readonly version: number;
}

export interface GrantEntitlement {
  readonly tenantId: string;
  readonly employmentId: string;
  readonly leaveTypeId: string;
  readonly leavePolicyId: string;
  readonly leaveYear: LeaveYear;
  readonly grantedMinutes: number;
  readonly source: string;
  readonly sourceId?: string;
  readonly reasonCode?: string;
  readonly metadata?: Metadata;
}

/** A year of minutes. A grant beyond it is a typing mistake, not a policy. */
const MAX_GRANT_MINUTES = MINUTES_IN_DAY * 366;

export const entitlement = (
  request: GrantEntitlement,
  occurredAt: Date,
): LeaveResult<EntitlementState> => {
  if (!isEntitlementSource(request.source)) {
    return refuse('entitlement_source_unknown', { source: request.source });
  }

  const minutes = checkedMinutes(request.grantedMinutes, 'grantedMinutes', {
    min: 1,
    max: MAX_GRANT_MINUTES,
  });

  if (!minutes.ok) return minutes;

  const reason = checkedOptionalCode(request.reasonCode, 'reasonCode');

  if (!reason.ok) return reason;

  return accept({
    id: uuidV7(occurredAt.getTime()),
    tenantId: request.tenantId,
    employmentId: request.employmentId,
    leaveTypeId: request.leaveTypeId,
    leavePolicyId: request.leavePolicyId,
    leaveYearStart: request.leaveYear.start,
    leaveYearEnd: request.leaveYear.end,
    grantedMinutes: minutes.value,
    source: request.source,
    ...(request.sourceId === undefined ? {} : { sourceId: request.sourceId }),
    ...(reason.value === undefined ? {} : { reasonCode: reason.value }),
    metadata: request.metadata ?? {},
    version: 0,
  });
};

/**
 * An administrative movement of somebody's balance, and the record that has to justify it.
 *
 * Both a `reasonCode` and a `note` are **required** — the code so a report can group adjustments,
 * the note so a human can read why this one was made. An adjustment is the one movement in this
 * module that no rule produced and no request explains, so the explanation has to be written down
 * at the moment it is made or it never will be (§25).
 *
 * The signed minutes may be positive or negative. What they may not be is zero, which the ledger
 * refuses and the database refuses too.
 */
export interface AdjustmentState {
  readonly id: string;
  readonly tenantId: string;
  readonly employmentId: string;
  readonly leaveTypeId: string;
  readonly leaveYearStart: string;
  readonly minutes: number;
  readonly effectiveOn: string;
  readonly reasonCode: string;
  readonly note: string;
  readonly adjustedBy: string;
  readonly adjustedAt: Date;
  readonly metadata: Metadata;
  readonly version: number;
}

const isEntitlementSource = (value: string): value is EntitlementSource =>
  (ENTITLEMENT_SOURCES as readonly string[]).includes(value);
