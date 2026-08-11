import { uuidV7 } from '@work/kernel';

import type { EmploymentStatus } from './employment-vocabulary.js';

/**
 * One entry in an employment's status history: what it moved from, what it moved to, when that
 * took effect, why, and who recorded it.
 *
 * **This exists even though every transition also raises an event**, and the duplication is the
 * point. An event is how a *subscriber* hears about a change; this is how the database answers
 * "what was this employment's status on the fourteenth of March" to a consumer that was not
 * subscribed — an auditor, a report, a dispute two years later. A product that could only replay
 * an event stream would have no answer for anybody who arrived afterwards, and §22 requires the
 * history be reconstructable rather than merely broadcast.
 *
 * It is **appended and never amended**. There is no method here that changes a recorded entry,
 * because a history that could be rewritten is not evidence of anything — the same reasoning that
 * makes People's notes immutable.
 *
 * It is not a `VersionedChild`: a transition is an instant, not a period. The period between two
 * transitions is derived by reading consecutive entries, which keeps one fact in one place.
 */

export interface StatusRecordState {
  readonly id: string;
  readonly tenantId: string;
  readonly employmentId: string;
  /** Absent on the first entry, which is the creation itself. */
  readonly fromStatus?: EmploymentStatus;
  readonly toStatus: EmploymentStatus;
  readonly reasonCode?: string;
  readonly note?: string;
  readonly effectiveFrom: Date;
  /** Taken from the authenticated context by the application. A caller cannot supply it. */
  readonly recordedBy: string;
  readonly recordedAt: Date;
  readonly version: number;
}

export interface RecordTransition {
  readonly tenantId: string;
  readonly employmentId: string;
  readonly fromStatus?: EmploymentStatus;
  readonly toStatus: EmploymentStatus;
  readonly reasonCode?: string;
  readonly note?: string;
  readonly effectiveFrom: Date;
  readonly recordedBy: string;
}

/**
 * Builds an entry.
 *
 * A plain function rather than an aggregate with behaviour, because there is no behaviour: nothing
 * about a recorded transition can subsequently change, so there is nothing for an aggregate to
 * protect. Modelling it as one would suggest otherwise.
 */
export const statusRecord = (request: RecordTransition, recordedAt: Date): StatusRecordState => ({
  id: uuidV7(recordedAt.getTime()),
  tenantId: request.tenantId,
  employmentId: request.employmentId,
  ...(request.fromStatus === undefined ? {} : { fromStatus: request.fromStatus }),
  toStatus: request.toStatus,
  ...(request.reasonCode === undefined ? {} : { reasonCode: request.reasonCode }),
  ...(request.note === undefined ? {} : { note: request.note }),
  effectiveFrom: request.effectiveFrom,
  recordedBy: request.recordedBy,
  recordedAt,
  version: 0,
});

/**
 * The status in force on a date, reconstructed from the history.
 *
 * Reads the entries rather than the employment row, which is what makes it answer a question about
 * the *past*. The row answers "now", and the two are different questions that a single mutable
 * column would conflate — the mistake §22 exists to prevent.
 */
export const statusOn = (
  records: readonly StatusRecordState[],
  instant: Date,
): EmploymentStatus | undefined =>
  [...records]
    .filter((record) => record.effectiveFrom.getTime() <= instant.getTime())
    .sort((left, right) => left.effectiveFrom.getTime() - right.effectiveFrom.getTime())
    .at(-1)?.toStatus;
