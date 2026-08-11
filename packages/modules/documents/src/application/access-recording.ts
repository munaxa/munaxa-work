import { uuidV7, type Transaction } from '@work/kernel';

import { recordAccess } from '../domain/access-event.js';
import { currentActor, currentCorrelationId } from './documents-context.js';
import type { DocumentsDependencies } from './documents-dependencies.js';

/**
 * Recording an access, inside the caller's transaction.
 *
 * Its own module rather than a helper inside one use case, because both the commands and the reads
 * record accesses: a metadata read of somebody's file is exactly what the trail exists to capture,
 * and leaving reads out would make "who has been looking at this employee" unanswerable. Keeping it
 * here means neither side has to import the other.
 *
 * The correlation identifier the request arrived with is recorded alongside, which is what lets an
 * investigator join a document read to the request that made it.
 */
export const recordAccessFor = async (
  dependencies: DocumentsDependencies,
  transaction: Transaction,
  what: {
    readonly documentId: string;
    readonly documentVersionId?: string;
    readonly action: string;
    readonly outcome?: 'permitted' | 'refused';
  },
): Promise<void> => {
  const recorded = recordAccess({
    accessEventId: uuidV7(),
    documentId: what.documentId,
    action: what.action,
    actor: currentActor(),
    occurredAt: dependencies.clock.now(),
    correlationId: currentCorrelationId(),
    outcome: what.outcome ?? 'permitted',
    ...(what.documentVersionId === undefined ? {} : { documentVersionId: what.documentVersionId }),
  });

  // An access the domain refuses to describe is a defect in this module rather than a caller's
  // problem, and swallowing it would leave a gap in the trail nobody could see.
  if (!recorded.ok) throw new Error(`documents: unrecordable access (${recorded.error.reason})`);
  await dependencies.stores.access.insert(transaction, recorded.value);
};
