import {
  success,
  type Command,
  type CommandHandler,
  type HandlerFailure,
  type Result,
  type Transaction,
} from '@work/kernel';

import { EmploymentAssignment } from '../domain/employment-assignment.js';
import { openOn, supersessionAt } from '../domain/versioned-child.js';
import type { AssignmentType } from '../domain/employment-vocabulary.js';
import type { EmploymentAssignmentState } from '../domain/employment-assignment.js';

import {
  conflicted,
  currentTenant,
  originOfCurrentRequest,
  refusedBy,
} from './employment-context.js';
import { EmploymentPermissions } from './employment-permissions.js';
import { checkUnit, loadWritableEmployment } from './employment-guard.js';
import type { EmploymentDependencies } from './employment-dependencies.js';

/**
 * Assigning an employment to a place in the organization, and moving it.
 *
 * **A transfer is a new assignment, never an edited one.** Recording a move on the existing row
 * would destroy the answer to "which department did this person belong to when that decision was
 * taken", and that question is asked by an audit, a payroll re-run and a dispute — all of them
 * after the fact. So a move closes the period in force at the effective date and opens a new one,
 * and the past stays exactly as it was.
 *
 * **Back-dating works properly.** Recording a March transfer for somebody who also moved in June
 * closes March's predecessor at March and bounds the new period at June, rather than running the
 * new record through the June move and silently discarding it. That is `supersessionAt`, shared
 * with Phases 3 and 4 rather than reinvented here with a subtly different answer.
 */

export interface CreateAssignmentCommand extends Command {
  readonly commandName: 'employment.create-assignment';
  readonly employmentId: string;
  readonly unitId: string;
  readonly positionId?: string;
  readonly costCenterId?: string;
  readonly assignmentType?: AssignmentType;
  readonly fte?: number;
  readonly reasonCode?: string;
  readonly effectiveFrom?: Date;
}

export interface AssignmentAffected {
  readonly employmentId: string;
  readonly assignmentId: string;
}

export const createAssignmentHandler = (
  dependencies: EmploymentDependencies,
): CommandHandler<CreateAssignmentCommand, AssignmentAffected> => ({
  commandName: 'employment.create-assignment',
  permission: EmploymentPermissions.assignmentManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const employment = await loadWritableEmployment(
        transaction,
        dependencies.stores,
        command.employmentId,
      );

      if (!employment.ok) return employment;

      const now = dependencies.clock.now();
      const effectiveFrom = command.effectiveFrom ?? now;
      const unit = await checkUnit(dependencies, command.unitId, effectiveFrom);

      if (!unit.ok) return unit;

      const assignmentType = command.assignmentType ?? 'primary';
      const existing = await dependencies.stores.assignments.forEmployment(
        transaction,
        command.employmentId,
      );
      const clash = refusedForPrimaryClash(existing, assignmentType, effectiveFrom);

      if (clash !== undefined) return clash;

      return writeAssignment(transaction, dependencies, command, {
        assignmentType,
        effectiveFrom,
      });
    }),
});

/**
 * An employment has at most one primary assignment in force at a time.
 *
 * Checked here so the caller is told which rule they met, and enforced again by the partial unique
 * index so two concurrent requests cannot both win. A secondary assignment has no such limit: a
 * second contract, a secondment or a shared role is exactly what secondaries are for.
 */
const refusedForPrimaryClash = (
  existing: readonly EmploymentAssignmentState[],
  assignmentType: AssignmentType,
  effectiveFrom: Date,
): Result<AssignmentAffected, HandlerFailure> | undefined => {
  if (assignmentType !== 'primary') return undefined;

  const openPrimaries = openOn(existing, effectiveFrom).filter(
    (state) => state.assignmentType === 'primary',
  );

  return openPrimaries.length > 0 ? conflicted('primary_assignment_already_in_force') : undefined;
};

/** The write, shared by creating an assignment and moving one. */
const writeAssignment = async (
  transaction: Transaction,
  dependencies: EmploymentDependencies,
  command: CreateAssignmentCommand,
  placement: { readonly assignmentType: AssignmentType; readonly effectiveFrom: Date },
): Promise<Result<AssignmentAffected, HandlerFailure>> => {
  const now = dependencies.clock.now();
  const assignment = EmploymentAssignment.create(
    {
      tenantId: currentTenant(),
      employmentId: command.employmentId,
      unitId: command.unitId,
      ...(command.positionId === undefined ? {} : { positionId: command.positionId }),
      ...(command.costCenterId === undefined ? {} : { costCenterId: command.costCenterId }),
      assignmentType: placement.assignmentType,
      ...(command.fte === undefined ? {} : { fte: command.fte }),
      ...(command.reasonCode === undefined ? {} : { reasonCode: command.reasonCode }),
      effectiveFrom: placement.effectiveFrom,
    },
    originOfCurrentRequest(),
    now,
  );

  if (!assignment.ok) return refusedBy(assignment.error);

  await dependencies.stores.assignments.insert(transaction, assignment.value.snapshot());
  transaction.collect(assignment.value.pullEvents());
  return success({ employmentId: command.employmentId, assignmentId: assignment.value.id });
};

export interface ChangeAssignmentCommand extends Command {
  readonly commandName: 'employment.change-assignment';
  readonly employmentId: string;
  readonly unitId: string;
  readonly positionId?: string;
  readonly costCenterId?: string;
  readonly fte?: number;
  readonly reasonCode?: string;
  /** When the move takes effect. Back-dating a correction is ordinary and handled properly. */
  readonly effectiveFrom?: Date;
}

/**
 * Moves an employment's primary assignment: a transfer, a promotion into another position, a
 * change of cost centre.
 *
 * One command rather than four (`change-position`, `change-location`, `change-cost-centre`,
 * `transfer`), because all four are the same event in the business — somebody's placement changed
 * on a date — and modelling them separately would produce four rows for one move, each closing and
 * opening a period, and a timeline nobody could read. The API still exposes the operations §38
 * asks for; they resolve to this.
 */
export const changeAssignmentHandler = (
  dependencies: EmploymentDependencies,
): CommandHandler<ChangeAssignmentCommand, AssignmentAffected> => ({
  commandName: 'employment.change-assignment',
  permission: EmploymentPermissions.assignmentManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const employment = await loadWritableEmployment(
        transaction,
        dependencies.stores,
        command.employmentId,
      );

      if (!employment.ok) return employment;

      const now = dependencies.clock.now();
      const effectiveFrom = command.effectiveFrom ?? now;
      const unit = await checkUnit(dependencies, command.unitId, effectiveFrom);

      if (!unit.ok) return unit;

      const existing = (
        await dependencies.stores.assignments.forEmployment(transaction, command.employmentId)
      ).filter((state) => state.assignmentType === 'primary');
      const { superseded, boundedAt } = supersessionAt(existing, effectiveFrom);

      if (superseded === undefined) return conflicted('no_primary_assignment_to_change');

      const closed = await closeSuperseded(
        transaction,
        dependencies,
        superseded,
        effectiveFrom,
        now,
      );

      if (closed !== undefined) return closed;

      return writeAssignment(
        transaction,
        dependencies,
        { ...command, commandName: 'employment.create-assignment' },
        {
          assignmentType: 'primary',
          effectiveFrom,
        },
      ).then((result) => boundNewPeriod(result, transaction, dependencies, boundedAt, now));
    }),
});

/** Closes the period the move supersedes, at the move's own effective date. */
const closeSuperseded = async (
  transaction: Transaction,
  dependencies: EmploymentDependencies,
  superseded: EmploymentAssignmentState,
  effectiveFrom: Date,
  now: Date,
): Promise<Result<AssignmentAffected, HandlerFailure> | undefined> => {
  const previous = EmploymentAssignment.rehydrate(superseded);
  const closedAt = previous.closeAt(effectiveFrom, originOfCurrentRequest(), now);

  if (!closedAt.ok) return refusedBy(closedAt.error);

  await dependencies.stores.assignments.update(
    transaction,
    previous.snapshot(),
    superseded.version,
  );
  transaction.collect(previous.pullEvents());
  return undefined;
};

/**
 * Bounds a back-dated move at the start of whatever already followed it.
 *
 * Without this, recording a March transfer for somebody who also moved in June would leave two
 * periods in force from June onward — which the kernel's `Timeline` refuses to represent, so the
 * next read of that employment's history would throw rather than answer.
 */
const boundNewPeriod = async (
  result: Result<AssignmentAffected, HandlerFailure>,
  transaction: Transaction,
  dependencies: EmploymentDependencies,
  boundedAt: Date | undefined,
  now: Date,
): Promise<Result<AssignmentAffected, HandlerFailure>> => {
  if (!result.ok || boundedAt === undefined) return result;

  const created = await dependencies.stores.assignments.byId(
    transaction,
    result.value.assignmentId,
  );

  if (created === undefined) return result;

  const assignment = EmploymentAssignment.rehydrate(created);
  const closed = assignment.closeAt(boundedAt, originOfCurrentRequest(), now);

  if (!closed.ok) return refusedBy(closed.error);

  await dependencies.stores.assignments.update(transaction, assignment.snapshot(), created.version);
  transaction.collect(assignment.pullEvents());
  return result;
};
