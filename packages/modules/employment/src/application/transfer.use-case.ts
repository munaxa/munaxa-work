import {
  success,
  type Command,
  type CommandHandler,
  type HandlerFailure,
  type Query,
  type QueryHandler,
  type Result,
} from '@work/kernel';

import type { WorkforceSnapshot } from '../contracts/views.js';

import { conflicted } from './employment-context.js';
import { EmploymentPermissions } from './employment-permissions.js';
import {
  assignmentView,
  byEffectiveFrom,
  contractView,
  employmentView,
  reportingLineView,
} from './employment-views.js';
import type { CreateEmploymentCommand } from './employment.use-case.js';
import type { EmploymentDependencies } from './employment-dependencies.js';

/**
 * Taking the workforce out of the product, and bringing one in.
 *
 * **Import sends the same commands an administrator would.** It does not write rows. That is the
 * whole design: every invariant a create enforces — the person exists and is not merged, one open
 * employment per person, a generated number allocated from the tenant's counter — applies to a
 * ten-thousand-row migration exactly as it applies to one hire. An import that wrote directly
 * would be the one path in the product where those rules did not hold, and it would be the path
 * that loaded a customer's entire history.
 *
 * **A migration keeps its own numbers, in `externalEmployeeNumber`.** It never supplies the
 * employment number: that is generated here, and a caller cannot override it (ADR-0039). Both
 * travel, and neither pretends to be the other.
 *
 * Both operations are **bounded and synchronous**, and the bound is stated in code rather than
 * discovered. Beyond it the command refuses by name. Making them background jobs is Phase 24's,
 * and a bounded refusal is more honest than a request that times out halfway through a customer's
 * workforce.
 */

export const IMPORT_LIMIT = 2000;
export const EXPORT_LIMIT = 5000;

/**
 * How import reaches the dispatcher that was built from a list including import.
 *
 * A genuine cycle, made explicit rather than broken by letting import bypass the application
 * service. The composition root attaches the dispatcher the moment it has one — the same seam
 * Organization and People use, for the same reason.
 */
export interface CommandSender {
  send<TResult, TCommand extends Command>(
    command: TCommand,
  ): Promise<Result<TResult, HandlerFailure>>;
}

export interface ImportEmploymentsCommand extends Command {
  readonly commandName: 'employment.import-employments';
  readonly rows: readonly ImportRow[];
}

export interface ImportRow {
  readonly personId: string;
  readonly externalEmployeeNumber?: string;
  readonly employmentTypeCode: string;
  readonly employmentCategoryCode?: string;
  readonly employmentClassCode?: string;
  readonly originalHireDate?: string;
  readonly startDate: string;
}

export interface ImportOutcome {
  readonly created: number;
  /** Rows skipped because that person already had an open employment. Resumable, not failed. */
  readonly skipped: number;
  readonly failures: readonly ImportFailure[];
}

export interface ImportFailure {
  /** The row's position in the file. Never the person's identifier — a failure log is read widely. */
  readonly row: number;
  readonly reason: string;
}

/**
 * Imports employments, skipping people who already have one.
 *
 * Skipping rather than failing is what makes a re-run safe: a file that failed at row 900 can be
 * sent again, and the first 899 are recognised as already imported rather than duplicated. That is
 * *resumability*, and it is not the same as atomicity — this import is not atomic, a limitation
 * carried in the debt register with Phase 4's.
 */
export const importEmploymentsHandler = (
  sender: CommandSender,
): CommandHandler<ImportEmploymentsCommand, ImportOutcome> => ({
  commandName: 'employment.import-employments',
  permission: EmploymentPermissions.importEmployments,

  handle: async (command) => {
    if (command.rows.length > IMPORT_LIMIT) return conflicted('import_too_large');

    const failures: ImportFailure[] = [];
    let created = 0;
    let skipped = 0;

    for (const [index, row] of command.rows.entries()) {
      const result = await sender.send<{ employmentId: string }, CreateEmploymentCommand>({
        commandName: 'employment.create-employment',
        ...row,
      });

      if (result.ok) {
        created += 1;
        continue;
      }
      if (result.error.kind === 'conflict' && result.error.reason === 'person_already_employed') {
        skipped += 1;
        continue;
      }
      failures.push({ row: index + 1, reason: reasonOf(result.error) });
    }
    return success({ created, skipped, failures });
  },
});

/** A failure's reason, as something safe to put in a log a customer reads. */
const reasonOf = (failure: HandlerFailure): string => {
  switch (failure.kind) {
    case 'validation':
      return failure.failures.map((entry) => entry.field).join(', ');
    case 'forbidden':
      return failure.permission;
    case 'not_found':
      return `missing ${failure.resource}`;
    case 'conflict':
      return failure.reason;
    case 'rejected':
      return failure.reason;
  }
};

export interface ExportWorkforce extends Query {
  readonly queryName: 'employment.export-workforce';
  readonly asOf?: Date;
}

/**
 * The whole workforce, with every timeline.
 *
 * Permissioned separately from reading, and held by fewer people: a single response here is every
 * employment, every placement and every reporting line in the tenant, which is the file somebody
 * takes with them when they leave.
 *
 * It carries **no person names**. An export is the highest-volume disclosure this module can
 * make, and joining names into it would put the whole register's personal data into one file
 * governed by this module's permission rather than People's.
 */
export const exportWorkforceHandler = (
  dependencies: EmploymentDependencies,
): QueryHandler<ExportWorkforce, WorkforceSnapshot> => ({
  queryName: 'employment.export-workforce',
  permission: EmploymentPermissions.exportEmployments,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const employments = await dependencies.stores.employments.all(transaction);

      if (employments.length > EXPORT_LIMIT) return conflicted('export_too_large');

      const asOf = query.asOf ?? dependencies.clock.now();
      const assignments = await dependencies.stores.assignments.all(transaction);
      const reportingLines = await dependencies.stores.reportingLines.all(transaction);
      const contracts = await dependencies.stores.contracts.all(transaction);

      return success({
        employments: employments.map((state) =>
          employmentView(state, asOf, {
            assignments: assignments.filter((row) => row.employmentId === state.id),
            reportingLines: reportingLines.filter((row) => row.employmentId === state.id),
          }),
        ),
        assignments: [...assignments].sort(byEffectiveFrom).map(assignmentView),
        reportingLines: [...reportingLines].sort(byEffectiveFrom).map(reportingLineView),
        contracts: [...contracts].sort(byEffectiveFrom).map(contractView),
      });
    }),
});
