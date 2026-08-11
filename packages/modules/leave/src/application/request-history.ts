import { uuidV7, type Transaction } from '@work/kernel';

import { currentActor, currentTenant } from './leave-context.js';
import type { RequestEventKind, RequestState } from '../domain/leave-vocabulary.js';
import type { LeaveDependencies } from './leave-dependencies.js';

/**
 * The history row every transition writes.
 *
 * Kept as a table rather than reconstructed from audit columns or from domain events, because "what
 * state was this request in on the fourteenth" has to be answerable to somebody who was not
 * subscribed to anything — and event delivery here is post-commit, in-process and at-most-once with
 * no outbox, so a history rebuilt from events would have holes exactly where somebody is looking
 * (§35.1).
 *
 * The actor comes from the authenticated context, never from a caller. `detail` is short and
 * structural — a state, a count, a reason code. **It never carries the justification**: a
 * sick-leave reason in a history row is health-adjacent data in a table read by everybody who can
 * read the request register (§30).
 */

export interface RecordEvent {
  readonly requestId: string;
  readonly kind: RequestEventKind;
  readonly fromState?: RequestState;
  readonly toState?: RequestState;
  readonly detail?: string;
}

export const recordRequestEvent = async (
  transaction: Transaction,
  dependencies: LeaveDependencies,
  event: RecordEvent,
): Promise<void> => {
  const now = dependencies.clock.now();

  await dependencies.stores.requestEvents.insert(transaction, {
    id: uuidV7(now.getTime()),
    tenantId: currentTenant(),
    leaveRequestId: event.requestId,
    kind: event.kind,
    ...(event.fromState === undefined ? {} : { fromState: event.fromState }),
    ...(event.toState === undefined ? {} : { toState: event.toState }),
    ...(event.detail === undefined ? {} : { detail: event.detail }),
    occurredAt: now,
    recordedBy: currentActor(),
    version: 0,
  });
};
