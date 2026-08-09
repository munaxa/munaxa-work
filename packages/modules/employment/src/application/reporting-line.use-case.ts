import {
  success,
  type Command,
  type CommandHandler,
  type HandlerFailure,
  type Result,
  type Transaction,
} from '@work/kernel';

import { ReportingLine, wouldCloseALoop } from '../domain/reporting-line.js';
import { openOn, supersessionAt } from '../domain/versioned-child.js';
import type { ReportingLineState } from '../domain/reporting-line.js';

import {
  conflicted,
  currentTenant,
  notFound,
  originOfCurrentRequest,
  refusedBy,
} from './employment-context.js';
import { EmploymentPermissions } from './employment-permissions.js';
import { loadWritableEmployment } from './employment-guard.js';
import type { EmploymentDependencies } from './employment-dependencies.js';

/**
 * Setting and changing who an employment reports to.
 *
 * A manager change is a **new period**, exactly as an assignment change is: "who was this person's
 * manager in March" must survive both of them changing jobs afterwards. The manager is named by
 * *employment*, never by person (§16).
 *
 * Two refusals here are worth defending, because both are cheap to omit and expensive to discover.
 *
 * **A manager must be an employment that is still open.** Pointing a live reporting line at an
 * ended employment produces an approval chain that terminates at somebody who left, which is how
 * requests sit unactioned for a fortnight before anybody works out why.
 *
 * **A cycle is refused.** Two people promoted into each other's chain during a reorganization is
 * ordinary, and the result is an escalation that never terminates. The database catches the
 * length-one case; the walk here catches the rest, and is bounded so an already-cyclic graph
 * reports the problem rather than hanging on it.
 */

export interface ChangeManagerCommand extends Command {
  readonly commandName: 'employment.change-manager';
  readonly employmentId: string;
  readonly managerEmploymentId: string;
  readonly effectiveFrom?: Date;
}

export interface ReportingLineAffected {
  readonly employmentId: string;
  readonly reportingLineId: string;
}

export const changeManagerHandler = (
  dependencies: EmploymentDependencies,
): CommandHandler<ChangeManagerCommand, ReportingLineAffected> => ({
  commandName: 'employment.change-manager',
  permission: EmploymentPermissions.reportingLineManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const employment = await loadWritableEmployment(
        transaction,
        dependencies.stores,
        command.employmentId,
      );

      if (!employment.ok) return employment;

      const manager = await checkManager(transaction, dependencies, command);

      if (!manager.ok) return manager;

      const now = dependencies.clock.now();
      const effectiveFrom = command.effectiveFrom ?? now;
      const existing = (
        await dependencies.stores.reportingLines.forEmployment(transaction, command.employmentId)
      ).filter((state) => state.lineType === 'primary');

      const closed = await closeCurrentLine(
        transaction,
        dependencies,
        existing,
        effectiveFrom,
        now,
      );

      if (closed !== undefined) return closed;

      const line = ReportingLine.create(
        {
          tenantId: currentTenant(),
          employmentId: command.employmentId,
          managerEmploymentId: command.managerEmploymentId,
          lineType: 'primary',
          effectiveFrom,
        },
        originOfCurrentRequest(),
        now,
      );

      if (!line.ok) return refusedBy(line.error);

      await dependencies.stores.reportingLines.insert(transaction, line.value.snapshot());
      transaction.collect(line.value.pullEvents());
      return success({
        employmentId: command.employmentId,
        reportingLineId: line.value.id,
      });
    }),
});

/** The manager exists, is open, and does not already report to this employment. */
const checkManager = async (
  transaction: Transaction,
  dependencies: EmploymentDependencies,
  command: ChangeManagerCommand,
): Promise<Result<string, HandlerFailure>> => {
  if (command.managerEmploymentId === command.employmentId) {
    return refusedBy({
      reason: 'manager_cannot_be_self',
      messageKey: 'employment.rejection.manager_cannot_be_self',
    });
  }

  const manager = await dependencies.stores.employments.byId(
    transaction,
    command.managerEmploymentId,
  );

  if (manager === undefined) return notFound('manager employment');
  if (manager.status === 'ended') return conflicted('manager_employment_ended');

  const managerOf = await currentManagerGraph(transaction, dependencies);

  if (wouldCloseALoop(command.employmentId, command.managerEmploymentId, managerOf)) {
    return conflicted('reporting_line_would_close_a_loop');
  }
  return { ok: true, value: command.managerEmploymentId };
};

/**
 * Who currently reports to whom, as a map, for the cycle check.
 *
 * Reads every open primary line in the tenant. That is bounded by the number of *employments*
 * rather than by history, and it is the honest shape for a check that has to see the whole graph —
 * a walk that loaded one line per step would be a query per level of the hierarchy, on a hierarchy
 * with no maximum depth (AD-003). When a tenant's workforce makes this expensive, the answer is
 * the Phase 20 projection store, not a shallower check.
 */
const currentManagerGraph = async (
  transaction: Transaction,
  dependencies: EmploymentDependencies,
): Promise<ReadonlyMap<string, string>> => {
  const lines = await dependencies.stores.reportingLines.all(transaction);

  return new Map(
    lines
      .filter((line) => line.lineType === 'primary' && line.effectiveTo === undefined)
      .map((line) => [line.employmentId, line.managerEmploymentId] as const),
  );
};

/** Closes the line in force at the effective date, if there is one. */
const closeCurrentLine = async (
  transaction: Transaction,
  dependencies: EmploymentDependencies,
  existing: readonly ReportingLineState[],
  effectiveFrom: Date,
  now: Date,
): Promise<Result<ReportingLineAffected, HandlerFailure> | undefined> => {
  const { superseded } = supersessionAt(existing, effectiveFrom);

  if (superseded === undefined) return undefined;

  const previous = ReportingLine.rehydrate(superseded);
  const closed = previous.closeAt(effectiveFrom, originOfCurrentRequest(), now);

  if (!closed.ok) return refusedBy(closed.error);

  await dependencies.stores.reportingLines.update(
    transaction,
    previous.snapshot(),
    superseded.version,
  );
  transaction.collect(previous.pullEvents());
  return undefined;
};

/**
 * How many people report to a manager on a date.
 *
 * Exported because the employment view uses it, and because Manager Self-Service (Phase 19) will
 * need exactly this question answered — through the contract, not by reading the table.
 */
export const directReportsOn = (
  lines: readonly ReportingLineState[],
  managerEmploymentId: string,
  asOf: Date,
): readonly string[] =>
  openOn(lines, asOf)
    .filter((line) => line.managerEmploymentId === managerEmploymentId)
    .map((line) => line.employmentId);
