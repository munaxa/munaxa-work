import type { UnitOfWork } from '@work/kernel';
import type { FilledHeadcountPort } from '@work/organization';

import type { EmploymentStores } from '../application/employment-ports.js';

/**
 * How many employment assignments exist against a position in a unit — the real adapter for the
 * port Phase 3 declared and shipped `NoAssignmentsYet` for.
 *
 * This is the seam being used as it was designed, not a completed module being modified.
 * Organization must never count employees itself (AD-002), so the number has to come from outside;
 * `NoAssignmentsYet` was the honest answer while there were no assignments to count, and its own
 * documentation says Phase 5 supplies this. Nothing in Organization changes — the composition root
 * chooses this implementation instead, and the establishment projection's arithmetic is untouched.
 *
 * The consequence is visible and worth stating: a tenant that has been reading `filled: 0` and
 * `vacant = budgeted` on every establishment now sees real figures. That is the number becoming
 * correct rather than changing.
 *
 * It counts assignments whose employment is **not ended**. A filled headcount that included people
 * who have left would report a department as fully staffed while it was advertising the vacancy.
 */
export class AssignmentFilledHeadcount implements FilledHeadcountPort {
  public constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly stores: EmploymentStores,
  ) {}

  public async filledFor(positionId: string, unitId: string, asOf: Date): Promise<number> {
    return this.unitOfWork.execute((transaction) =>
      this.stores.assignments.countInForce(transaction, positionId, unitId, asOf),
    );
  }
}

/**
 * Exported for the same reason the class is: the composition root needs it, and nothing else does.
 *
 * No tenant is adopted here. This adapter runs inside whichever request asked
 * Organization for an establishment posture, so it inherits that request's tenant — adopting a
 * different one would be this module choosing a tenant on a caller's behalf, which is the one
 * thing tenant resolution exists to prevent (ADR-0032).
 */
export const assignmentFilledHeadcount = (
  unitOfWork: UnitOfWork,
  stores: EmploymentStores,
): FilledHeadcountPort => new AssignmentFilledHeadcount(unitOfWork, stores);
