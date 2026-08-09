import {
  success,
  uuidV7,
  type Command,
  type CommandHandler,
  type HandlerFailure,
  type Query,
  type QueryHandler,
  type Result,
} from '@work/kernel';

import type { EventKind } from '../domain/attendance-vocabulary.js';

import { conflicted, currentActor, currentTenant } from './attendance-context.js';
import { AttendancePermissions } from './attendance-permissions.js';
import type { AttendanceDependencies } from './attendance-dependencies.js';
import type { RecordEventCommand } from './ingest.use-case.js';

/**
 * Bulk import, and the export.
 *
 * **Every row goes through the same ingestion command an integrator would call.** Import writes no
 * row directly, so every rule ingestion enforces — the employment is real, the zone is resolved,
 * the deduplication key is computed, the day is opened and marked — applies to a file of ten
 * thousand punches exactly as it does to one. A bulk path that bypassed the application service
 * would bypass the invariants with it, and would drift the first time a rule was added to one and
 * not the other.
 *
 * **A duplicate is skipped, not failed**, which is what makes a re-run safe: a file that stopped at
 * row 900 can be sent again and the first 899 are recognised rather than duplicated. That is
 * resumability, and it is not atomicity — the limitation is carried in the debt register.
 *
 * **Bounded and synchronous**, and the bound is stated in code rather than discovered. Beyond it the
 * command refuses by name. Background jobs are Phase 24's, and a bounded refusal is more honest than
 * a request that times out half way through a month of turnstile data.
 *
 * **No vendor importer.** A CSV is parsed at the edge; a device's own export format is an adapter's
 * problem. What reaches the domain is the normalized row below (ADR-0057).
 */

export const IMPORT_LIMIT = 2000;
export const EXPORT_LIMIT = 5000;

/** How import reaches the dispatcher that was built from a list including import. */
export interface CommandSender {
  send<TResult, TCommand extends Command>(
    command: TCommand,
  ): Promise<Result<TResult, HandlerFailure>>;
}

export interface ImportRow {
  readonly employmentId: string;
  readonly kind: EventKind;
  readonly reportedAt: Date;
  /** The exporting system's own row identifier. Present, a re-import is free. */
  readonly sourceReference?: string;
  readonly deviceReference?: string;
  readonly note?: string;
}

export interface ImportEventsCommand extends Command {
  readonly commandName: 'attendance.import-events';
  readonly sourceLabel?: string;
  readonly rows: readonly ImportRow[];
}

export interface ImportOutcome {
  readonly batchId: string;
  readonly submitted: number;
  readonly created: number;
  readonly skipped: number;
  readonly failures: readonly { readonly row: number; readonly reason: string }[];
}

export const importEventsHandler = (
  dependencies: AttendanceDependencies,
  sender: CommandSender,
): CommandHandler<ImportEventsCommand, ImportOutcome> => ({
  commandName: 'attendance.import-events',
  permission: AttendancePermissions.import,

  handle: async (command) => {
    if (command.rows.length > IMPORT_LIMIT) return conflicted('import_too_large');

    const now = dependencies.clock.now();
    const batchId = uuidV7(now.getTime());
    const failures: { row: number; reason: string }[] = [];
    let created = 0;
    let skipped = 0;

    await dependencies.unitOfWork.execute(async (transaction) => {
      await dependencies.stores.imports.insert(transaction, {
        id: batchId,
        tenantId: currentTenant(),
        source: 'import',
        ...(command.sourceLabel === undefined ? {} : { sourceLabel: command.sourceLabel }),
        submittedAt: now,
        submittedBy: currentActor(),
        rowsSubmitted: command.rows.length,
        rowsCreated: 0,
        rowsSkipped: 0,
        rowsFailed: 0,
        version: 0,
      });
    });

    for (const [index, row] of command.rows.entries()) {
      // Sequentially, deliberately: the deduplication read is what makes a re-run safe, and two
      // rows for one punch running concurrently would both pass it and race on the index.
      const result = await sender.send<{ alreadyRecorded: boolean }, RecordEventCommand>({
        commandName: 'attendance.record-event',
        employmentId: row.employmentId,
        kind: row.kind,
        source: 'import',
        reportedAt: row.reportedAt,
        importBatchId: batchId,
        ...(row.sourceReference === undefined ? {} : { sourceReference: row.sourceReference }),
        ...(row.deviceReference === undefined ? {} : { deviceReference: row.deviceReference }),
        ...(row.note === undefined ? {} : { note: row.note }),
      });

      if (!result.ok) {
        failures.push({ row: index + 1, reason: reasonOf(result.error) });
        continue;
      }
      if (result.value.alreadyRecorded) skipped += 1;
      else created += 1;
    }

    await dependencies.unitOfWork.execute(async (transaction) => {
      const batch = await dependencies.stores.imports.byId(transaction, batchId);

      if (batch === undefined) return;
      await dependencies.stores.imports.update(
        transaction,
        { ...batch, rowsCreated: created, rowsSkipped: skipped, rowsFailed: failures.length },
        batch.version,
      );
    });

    return success({ batchId, submitted: command.rows.length, created, skipped, failures });
  },
});

const reasonOf = (failure: HandlerFailure): string => {
  if (failure.kind === 'rejected' || failure.kind === 'conflict') return failure.reason;
  if (failure.kind === 'not_found') return `not_found:${failure.resource}`;
  if (failure.kind === 'forbidden') return `forbidden:${failure.permission}`;
  return failure.kind;
};

export interface ExportAttendance extends Query {
  readonly queryName: 'attendance.export';
  readonly from: string;
  readonly to: string;
}

export interface AttendanceExport {
  readonly exportedAt: Date;
  readonly from: string;
  readonly to: string;
  readonly days: readonly {
    readonly employmentId: string;
    readonly attendanceDate: string;
    readonly dayKind: string;
    readonly state: string;
    readonly expectedMinutes: number;
    readonly workedMinutes: number;
    readonly overtimeCandidateMinutes: number;
    readonly absenceMinutes: number;
    readonly leaveState: string;
  }[];
}

/**
 * The attendance register, in one response.
 *
 * It carries **no punch location, no device identifier, no note and no justification**. An export is
 * the highest-volume disclosure this module can make, and attendance data already says when a named
 * person came and went; adding where they were standing and what they wrote about a missed shift
 * would put all of it into one file governed by a single permission.
 *
 * Bounded, and it refuses by name beyond the limit rather than returning a truncated register
 * somebody would mistake for the whole one.
 */
export const exportAttendanceHandler = (
  dependencies: AttendanceDependencies,
): QueryHandler<ExportAttendance, AttendanceExport> => ({
  queryName: 'attendance.export',
  permission: AttendancePermissions.export,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const found = await dependencies.stores.days.search(transaction, {
        limit: EXPORT_LIMIT + 1,
        offset: 0,
        fromDate: query.from,
        toDate: query.to,
      });

      if (found.items.length > EXPORT_LIMIT) return conflicted('export_too_large');

      return success({
        exportedAt: dependencies.clock.now(),
        from: query.from,
        to: query.to,
        days: found.items.map((day) => ({
          employmentId: day.employmentId,
          attendanceDate: day.attendanceDate,
          dayKind: day.dayKind,
          state: day.state,
          expectedMinutes: day.expectedMinutes,
          workedMinutes: day.workedMinutes,
          overtimeCandidateMinutes: day.overtimeCandidateMinutes,
          absenceMinutes: day.absenceMinutes,
          leaveState: day.leaveState,
        })),
      });
    }),
});
