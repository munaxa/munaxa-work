import { success, type Command, type CommandHandler, type Transaction } from '@work/kernel';

import { completed, importBatch, MAX_IMPORT_ROWS } from '../domain/import-batch.js';
import { writeAssignment, type AssignmentInput } from './assignment-writer.js';
import { withSavepoint } from './recurring-writer.js';
import { currentActor, currentTenant, refusedBy } from './compensation-context.js';
import { CompensationPermissions } from './compensation-permissions.js';
import type { MoneyInput } from '../domain/money-amount.js';
import type { CompensationDependencies } from './compensation-dependencies.js';

/**
 * A bounded, idempotent bulk load of recurring compensation.
 *
 * **An import is not a back door.** Every row goes through `writeAssignment` — the same employment
 * check, the same plan resolution, the same component checks, the same grade bounds and the same
 * exclusion constraint a manual assignment goes through. A second, weaker write path into the
 * module's most sensitive data is exactly what this refuses to be.
 *
 * **Retry-safe and deduplicated.** A row carrying a `sourceId` is looked up first, and a resubmitted
 * file finds its rows already present and reports them as **skipped**. `rowsSkipped` is what
 * demonstrates idempotency rather than merely claiming it: a batch reporting `submitted: 100,
 * created: 0, skipped: 100` is proof the second run wrote nothing.
 *
 * **Bounded.** A batch takes a page and reports what it covered. A row that fails is counted and
 * the batch continues, because one malformed row in a hundred should not discard the ninety-nine
 * that were fine — and the batch record is what tells an administrator which is which.
 *
 * **No vendor-specific importer.** A normalized row shape arrives here; the adapter that produces
 * it from a particular file or system lives outside, exactly as a device adapter does for
 * Attendance (ADR-0057). Wiring Recruitment's `proposed_compensation` to this is deliberately not
 * in this phase — that would reopen a completed one.
 */

export interface ImportRow {
  readonly employmentId: string;
  readonly componentId: string;
  readonly amount: MoneyInput;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly payGradeId?: string;
  readonly salaryStepId?: string;
  readonly reasonCode?: string;
  /** The caller's own identifier for this row. What makes a resubmission idempotent. */
  readonly sourceId: string;
}

export interface ImportCompensationCommand extends Command {
  readonly commandName: 'compensation.import';
  readonly source: string;
  readonly sourceLabel?: string;
  readonly rows: readonly ImportRow[];
}

export interface CompensationImported {
  readonly importBatchId: string;
  readonly rowsSubmitted: number;
  readonly rowsCreated: number;
  readonly rowsSkipped: number;
  readonly rowsFailed: number;
}

export const importCompensationHandler = (
  dependencies: CompensationDependencies,
): CommandHandler<ImportCompensationCommand, CompensationImported> => ({
  commandName: 'compensation.import',
  permission: CompensationPermissions.import,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const opened = importBatch(
        {
          tenantId: currentTenant(),
          source: command.source,
          rowsSubmitted: command.rows.length,
          submittedBy: currentActor(),
          ...(command.sourceLabel === undefined ? {} : { sourceLabel: command.sourceLabel }),
        },
        dependencies.clock.now(),
      );

      if (!opened.ok) return refusedBy<CompensationImported>(opened.error);

      await dependencies.stores.imports.insert(transaction, opened.value);

      // Re-read, because the repository stamps `version` on insert while the state built in the
      // domain still carries the version it had before there was a row. Closing the batch with the
      // stale number would be refused for a concurrency conflict that never happened.
      const persisted =
        (await dependencies.stores.imports.byId(transaction, opened.value.id)) ?? opened.value;
      const counts = await applyRows(dependencies, transaction, command);
      const finished = completed(persisted, counts);

      if (!finished.ok) return refusedBy<CompensationImported>(finished.error);

      await dependencies.stores.imports.update(transaction, finished.value, persisted.version);

      return success({
        importBatchId: finished.value.id,
        rowsSubmitted: finished.value.rowsSubmitted,
        rowsCreated: finished.value.rowsCreated,
        rowsSkipped: finished.value.rowsSkipped,
        rowsFailed: finished.value.rowsFailed,
      });
    }),
});

interface Counts {
  readonly rowsCreated: number;
  readonly rowsSkipped: number;
  readonly rowsFailed: number;
}

/**
 * Every row, attempted.
 *
 * Sequential rather than concurrent, deliberately: two rows for the same `(employment, component)`
 * in one file would race against the exclusion constraint, and a bulk load that produced different
 * results depending on scheduling is not a bulk load anybody can re-run.
 */
const applyRows = async (
  dependencies: CompensationDependencies,
  transaction: Transaction,
  command: ImportCompensationCommand,
): Promise<Counts> => {
  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const [index, row] of command.rows.slice(0, MAX_IMPORT_ROWS).entries()) {
    const outcome = await withSavepoint(
      transaction,
      `compensation_import_${String(index)}`,
      () => applyRow(dependencies, transaction, command.source, row),
      // A row that failed for a reason nothing anticipated is counted and reported, never
      // swallowed: the batch's `rowsFailed` is what tells an administrator to look.
      () => 'failed' as const,
    );

    if (outcome === 'created') created += 1;
    else if (outcome === 'skipped') skipped += 1;
    else failed += 1;
  }
  return { rowsCreated: created, rowsSkipped: skipped, rowsFailed: failed };
};

const applyRow = async (
  dependencies: CompensationDependencies,
  transaction: Transaction,
  source: string,
  row: ImportRow,
): Promise<'created' | 'skipped' | 'failed'> => {
  const existing = await dependencies.stores.recurring.bySource(transaction, {
    source: 'import',
    sourceId: row.sourceId,
    componentId: row.componentId,
    employmentId: row.employmentId,
  });

  if (existing !== undefined) return 'skipped';

  const input: AssignmentInput = {
    ...row,
    source: 'import',
    metadata: { importSource: source },
  };
  const written = await writeAssignment(dependencies, transaction, input, 'imported');

  return written.ok ? 'created' : 'failed';
};
