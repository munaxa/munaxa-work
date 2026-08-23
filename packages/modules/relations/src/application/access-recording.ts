import { uuidV7, type Transaction } from '@work/kernel';

import { recordAccess } from '../domain/access-event.js';
import type { AccessAction } from '../domain/relations-vocabulary.js';
import { currentActor, currentCorrelationId } from './relations-context.js';
import type { RelationsDependencies } from './relations-dependencies.js';

/**
 * Recording a read of a disciplinary record, **inside the caller's own transaction**.
 *
 * Inside it deliberately: if the trail cannot be written, the read does not happen. A disclosure
 * that left no trace is the failure AD-007 exists to prevent, so the two either both commit or
 * neither does. That makes reads slower and makes a read fail when the trail fails, and both are the
 * intended trade rather than a regression.
 *
 * Its own module rather than a helper inside one query, because both reads write one and neither
 * should have to import the other.
 *
 * **Only violation reads reach here.** The catalogue has no call site, because a list of the words a
 * policy is written in names nobody — and auditing it would be the "audit every query" mechanism the
 * approval forbids (D-5.2-05).
 */
export const recordAccessFor = async (
  dependencies: RelationsDependencies,
  transaction: Transaction,
  what: { readonly violationId: string; readonly action: AccessAction },
): Promise<void> => {
  const recorded = recordAccess({
    accessEventId: uuidV7(),
    violationId: what.violationId,
    action: what.action,
    actor: currentActor(),
    occurredAt: dependencies.clock.now(),
    correlationId: currentCorrelationId(),
  });

  // An access the domain refuses to describe is a defect in this module rather than a caller's
  // problem, and swallowing it would leave a hole in the trail that nothing could reveal.
  if (!recorded.ok) throw new Error(`relations: unrecordable access (${recorded.error.reason})`);
  await dependencies.stores.access.insert(transaction, recorded.value);
};
