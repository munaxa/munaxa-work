import { uuidV7 } from '@work/kernel';

import { definedOnly } from './compensation-aggregate.js';
import { accept, refuse, type CompensationResult } from './compensation-rejection.js';
import {
  CHANGE_KINDS,
  isCompensationSource,
  isSubjectKind,
  type ChangeKind,
  type CompensationSource,
  type SubjectKind,
} from './compensation-vocabulary.js';

/**
 * Append-only compensation history.
 *
 * The effective-dated periods answer *what the salary was*. This answers *what happened, who did it
 * and why* — including the events that changed no value at all, such as an approval or a reversal.
 * Leave keeps `leave_request_event` for the same reason, and Employment keeps a status history.
 *
 * **Inserted and read. No update, no delete**, and no repository method that could offer either
 * (ADR-0052 applied to a fourth module). A compensation figure somebody disputes is explained by
 * these rows, and the cheapest guarantee that nobody rewrote one is to have no method that could.
 *
 * **Full jsonb snapshots rather than column deltas.** A delta needs the schema it was written
 * against to stay interpretable, and a compensation record has to be readable years after the
 * column it referenced was renamed. A snapshot costs bytes and buys that.
 *
 * The snapshot **omits nothing and adds nothing**: it is the state as written, monetary amounts
 * included. That is the one place in this module where an amount is duplicated, and it is
 * deliberate — the history is the audit, and an audit that referred to a figure without recording
 * it would be useless in the dispute it exists for. It sits behind the same permission as the
 * figures themselves.
 */

export type StateSnapshot = Readonly<Record<string, unknown>>;

export interface CompensationChangeState {
  readonly id: string;
  readonly tenantId: string;
  readonly employmentId: string;
  readonly componentId?: string;
  readonly subjectKind: SubjectKind;
  readonly subjectId: string;
  readonly changeKind: ChangeKind;
  readonly previousState?: StateSnapshot;
  readonly newState?: StateSnapshot;
  readonly effectiveFrom?: string;
  readonly recordedAt: Date;
  readonly actor: string;
  readonly reasonCode?: string;
  readonly source: CompensationSource;
  readonly version: number;
}

export interface RecordChange {
  readonly tenantId: string;
  readonly employmentId: string;
  readonly componentId?: string;
  readonly subjectKind: string;
  readonly subjectId: string;
  readonly changeKind: string;
  readonly previousState?: StateSnapshot;
  readonly newState?: StateSnapshot;
  readonly effectiveFrom?: string;
  readonly actor: string;
  readonly reasonCode?: string;
  readonly source?: string;
}

const isChangeKind = (value: string): value is ChangeKind =>
  (CHANGE_KINDS as readonly string[]).includes(value);

export const compensationChange = (
  request: RecordChange,
  recordedAt: Date,
): CompensationResult<CompensationChangeState> => {
  if (!isSubjectKind(request.subjectKind)) {
    return refuse('subject_kind_unknown', { subjectKind: request.subjectKind });
  }
  if (!isChangeKind(request.changeKind)) {
    return refuse('change_kind_unknown', { changeKind: request.changeKind });
  }

  const source = request.source ?? 'manual';

  if (!isCompensationSource(source)) return refuse('compensation_source_unknown', { source });

  return accept({
    id: uuidV7(recordedAt.getTime()),
    tenantId: request.tenantId,
    employmentId: request.employmentId,
    subjectKind: request.subjectKind,
    subjectId: request.subjectId,
    changeKind: request.changeKind,
    recordedAt,
    actor: request.actor,
    source,
    ...definedOnly({
      componentId: request.componentId,
      previousState: request.previousState,
      newState: request.newState,
      effectiveFrom: request.effectiveFrom,
      reasonCode: request.reasonCode,
    }),
    version: 0,
  });
};

/**
 * A state as a snapshot.
 *
 * `bigint` is not JSON-serialisable, so every monetary amount becomes its exact decimal **string**
 * — the same discipline the wire uses, and for the same reason: a JSON number would lose precision
 * above 2^53 and would invite a `Number()` at the far end.
 */
export const snapshotOf = (state: object): StateSnapshot =>
  Object.fromEntries(Object.entries(state).map(([key, value]) => [key, serialisable(value)]));

const serialisable = (value: unknown): unknown => {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serialisable);
  if (typeof value === 'object' && value !== null) return snapshotOf(value);
  return value;
};
