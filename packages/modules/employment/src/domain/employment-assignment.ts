import { uuidV7, type EventOrigin } from '@work/kernel';

import { EmploymentEvents } from './employment-events.js';
import { VersionedChild, type VersionedChildState } from './versioned-child.js';
import { accept, refuse, type EmploymentResult } from './employment-rejection.js';
import { checkedOptionalCode } from './employment-aggregate.js';
import type { AssignmentType } from './employment-vocabulary.js';

/**
 * An Assignment: where an employment sits in the organization, and from when.
 *
 * This is the aggregate that makes AD-005 real. Employment stores no department, no position and
 * no cost centre; it holds assignments, and an assignment references the entities `organization`
 * owns. A transfer is a new assignment, never an edited one, which is what lets the product answer
 * *where did this employee belong on this date* and *who was their manager at the time* years
 * afterwards.
 *
 * **The references are identifiers and nothing else.** No name, no code, no copy of the unit's
 * details — a cached name is a second answer, and the second answer is the one that is stale when
 * the department is renamed.
 *
 * **There is no work location.** An organizational unit and a physical place of work are different
 * concepts, and this product holds no authoritative model of the second. Pointing a
 * `workLocationId` at `unitId` would record a false relationship as a true one, which is worse
 * than an absent field because every later module would then rely on it. ADR-0041 names the
 * extension point this arrives through when Organization gains a location model.
 */

export interface EmploymentAssignmentState extends VersionedChildState {
  /** `organization`'s unit. Referenced by identity only — no cached name, no cached code. */
  readonly unitId: string;
  readonly positionId?: string;
  readonly costCenterId?: string;
  readonly assignmentType: AssignmentType;
  /** This assignment's share of a working pattern. Never a share of a salary. */
  readonly fte: number;
  readonly reasonCode?: string;
}

export interface CreateAssignment {
  readonly tenantId: string;
  readonly employmentId: string;
  readonly unitId: string;
  readonly positionId?: string;
  readonly costCenterId?: string;
  readonly assignmentType: AssignmentType;
  readonly fte?: number;
  readonly reasonCode?: string;
  readonly effectiveFrom: Date;
  readonly effectiveTo?: Date;
}

/**
 * A whole assignment, which is what an assignment is unless somebody says otherwise.
 *
 * Defaulted rather than required, because most employments have exactly one assignment at one FTE
 * and demanding the number at every call site is how a screen ends up sending `0` for it.
 */
const WHOLE = 1;

export class EmploymentAssignment extends VersionedChild<EmploymentAssignmentState> {
  private constructor(state: EmploymentAssignmentState) {
    super(state, 'EmploymentAssignment', EmploymentEvents.assignmentClosed);
  }

  public static create(
    request: CreateAssignment,
    origin: EventOrigin,
    occurredAt: Date,
  ): EmploymentResult<EmploymentAssignment> {
    const fte = checkedFte(request.fte);

    if (!fte.ok) return fte;

    const reasonCode = checkedOptionalCode(request.reasonCode, 'reasonCode');

    if (!reasonCode.ok) return reasonCode;
    if (
      request.effectiveTo !== undefined &&
      request.effectiveTo.getTime() <= request.effectiveFrom.getTime()
    ) {
      return refuse('period_ends_before_it_begins', { field: 'effectiveTo' });
    }

    const assignment = new EmploymentAssignment({
      id: uuidV7(occurredAt.getTime()),
      tenantId: request.tenantId,
      employmentId: request.employmentId,
      unitId: request.unitId,
      assignmentType: request.assignmentType,
      fte: fte.value,
      effectiveFrom: request.effectiveFrom,
      ...optionalPlacement(request, reasonCode.value),
      version: 0,
    });

    assignment.raise(
      EmploymentEvents.assignmentCreated,
      {
        assignmentId: assignment.id,
        employmentId: request.employmentId,
        unitId: request.unitId,
        assignmentType: request.assignmentType,
        effectiveFrom: request.effectiveFrom,
      },
      origin,
      occurredAt,
    );
    return accept(assignment);
  }

  public static rehydrate(state: EmploymentAssignmentState): EmploymentAssignment {
    return new EmploymentAssignment(state);
  }

  public get unitId(): string {
    return this.state.unitId;
  }

  public get positionId(): string | undefined {
    return this.state.positionId;
  }

  public get assignmentType(): AssignmentType {
    return this.state.assignmentType;
  }

  public get isPrimary(): boolean {
    return this.state.assignmentType === 'primary';
  }
}

/**
 * The references and the period bound a placement may carry, hoisted out of `create`.
 *
 * Absent rather than null: an assignment with no position is an employment placed in a department
 * without occupying a budgeted post, which is an ordinary thing and a different statement from
 * "we do not know which post".
 */
const optionalPlacement = (
  request: CreateAssignment,
  reasonCode: string | undefined,
): Partial<EmploymentAssignmentState> => ({
  ...(request.positionId === undefined ? {} : { positionId: request.positionId }),
  ...(request.costCenterId === undefined ? {} : { costCenterId: request.costCenterId }),
  ...(reasonCode === undefined ? {} : { reasonCode }),
  ...(request.effectiveTo === undefined ? {} : { effectiveTo: request.effectiveTo }),
});

/**
 * The full-time equivalent of one assignment.
 *
 * Bounded at one, because an FTE greater than one on a *single* assignment is a data-entry
 * mistake rather than a working pattern — somebody working more than full time holds a second
 * assignment, which is the case secondary assignments exist for. Zero is refused for the same
 * reason a period of no duration is: an assignment nobody works is not an assignment.
 */
const checkedFte = (value: number | undefined): EmploymentResult<number> => {
  const fte = value ?? WHOLE;

  if (!Number.isFinite(fte) || fte <= 0 || fte > WHOLE) return refuse('fte_out_of_range');
  return accept(Number(fte.toFixed(4)));
};
