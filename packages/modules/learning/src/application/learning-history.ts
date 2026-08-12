import { success, type Query, type QueryHandler, type Transaction } from '@work/kernel';

import { isOverdue } from '../domain/assignment.js';
import { validityOf } from '../domain/certification.js';
import type { LearningHistoryView } from '../contracts/views.js';
import { civilDateOf, notFound } from './learning-context.js';
import { LearningPermissions } from './learning-permissions.js';
import { learnerScopeFor, mayRead } from './authorization.js';
import { assignmentView, certificationView, enrolmentView } from './learning-views.js';
import type { LearningDependencies } from './learning-dependencies.js';

/**
 * One person's learning record, assembled on read (ADR-0008).
 *
 * **A projection, and never a write path.** Nothing writes this shape, nothing stores it, and no
 * command takes it — it is what the authoritative tables say, arranged for a reader. A materialized
 * version would need maintaining from six places (an assignment, an enrolment, a completion, a
 * certification, a revocation, a waiver), and the first missed update would be a compliance screen
 * confidently showing training somebody never did.
 *
 * **Every count is derived against a stated day**, echoed in the answer. `overdueAssignments` and
 * `expiringCertifications` are not columns; they are the same functions `assignmentView` and
 * `certificationView` use, applied to the same rows, so a total can never disagree with the list it
 * came from.
 *
 * **Bounded.** A person with a long career still returns a bounded page of each kind, and the bound
 * is the store's rather than a slice taken after loading everything.
 */

export interface ReadLearningHistory extends Query {
  readonly queryName: 'learning.read-history';
  readonly employmentId: string;
  readonly asOf?: string;
  /** How many days ahead counts as expiring. `0` asks a plain yes-or-no question (ADR-0070). */
  readonly noticeDays?: number;
  readonly size?: number;
}

const DEFAULT_SIZE = 100;
const MAX_SIZE = 500;

export const readLearningHistoryHandler = (
  dependencies: LearningDependencies,
): QueryHandler<ReadLearningHistory, LearningHistoryView> => ({
  queryName: 'learning.read-history',
  permission: LearningPermissions.assignmentRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const scope = await learnerScopeFor(dependencies);

      // Not "forbidden": that would confirm this employment has a training record, and a remedial
      // safety course says something about the person on it.
      if (!mayRead(scope, query.employmentId)) {
        return notFound<LearningHistoryView>('learning_history');
      }

      const asOf = query.asOf ?? civilDateOf(dependencies.clock.now());
      const notice = query.noticeDays ?? 0;
      const size = Math.min(MAX_SIZE, Math.max(1, query.size ?? DEFAULT_SIZE));

      return success(
        await assemble(dependencies, transaction, {
          employmentId: query.employmentId,
          asOf,
          noticeDays: notice,
          size,
        }),
      );
    }),
});

/**
 * Reads the three authoritative sets and counts them the same way the views render them.
 *
 * The counts are computed from the rows that were actually returned rather than from a separate
 * aggregate query: two queries could disagree under concurrent writes, and a header that contradicts
 * the list beneath it is worse than either number alone.
 */
interface HistoryRequest {
  readonly employmentId: string;
  readonly asOf: string;
  readonly noticeDays: number;
  readonly size: number;
}

const assemble = async (
  dependencies: LearningDependencies,
  transaction: Transaction,
  request: HistoryRequest,
): Promise<LearningHistoryView> => {
  const { employmentId, asOf, noticeDays } = request;
  const paged = { limit: request.size, offset: 0 };
  const assignments = await dependencies.stores.assignments.search(
    transaction,
    { employmentId },
    paged,
  );
  const enrolments = await dependencies.stores.enrolments.search(
    transaction,
    { employmentId },
    paged,
  );
  const certifications = await dependencies.stores.certifications.search(
    transaction,
    { employmentId },
    paged,
  );
  const open = assignments.items.filter((state) => state.status === 'assigned');
  const validity = certifications.items.map((state) => validityOf(state, asOf, noticeDays));

  return {
    employmentId,
    asOf,
    assignments: assignments.items.map((state) => assignmentView(state, asOf)),
    enrolments: enrolments.items.map(enrolmentView),
    certifications: certifications.items.map((state) => certificationView(state, asOf, noticeDays)),
    openAssignments: open.length,
    overdueAssignments: open.filter((state) => isOverdue(state, asOf)).length,
    completedCourses: enrolments.items.filter((state) => state.status === 'completed').length,
    activeCertifications: validity.filter((state) => state !== 'expired').length,
    expiringCertifications: validity.filter((state) => state === 'expiring_soon').length,
  };
};
