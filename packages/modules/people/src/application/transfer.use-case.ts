import {
  success,
  type Command,
  type CommandHandler,
  type HandlerFailure,
  type Query,
  type QueryHandler,
  type Result,
} from '@work/kernel';

import type { PeopleSnapshot } from '../contracts/views.js';

import { PeoplePermissions } from './people-permissions.js';
import { personView } from './people-views.js';
import type { CreatePersonCommand } from './person.use-case.js';
import type { PeopleDependencies } from './people-dependencies.js';

/**
 * Bulk import and export of the register.
 *
 * **Import sends the same commands an administrator would.** Every row goes through
 * `people.create-person`, so every invariant, every duplicate check and every event applies
 * exactly as it does to a single create. Writing rows directly would be faster and would bypass
 * the duplicate detection that is the entire point of AD-001 — an import is precisely when a
 * register acquires its duplicates.
 *
 * Two limitations are inherited deliberately from Phase 3 rather than re-solved here, and both are
 * in the debt register:
 *
 * - **It is bounded.** Beyond `IMPORT_LIMIT` rows the command refuses, by name, rather than being
 *   discovered at a timeout.
 * - **It is not atomic.** A file with one bad row leaves everything before it written. Mitigated
 *   rather than ignored: the import is *resumable*, because an existing person number is skipped
 *   rather than failed, so a corrected file can simply be run again.
 *
 * **Export is deliberately narrower than the profile.** An export leaves the product, and the
 * fields that would make a leaked file catastrophic — identifier values, notes, emergency contacts
 * — are not in it. Exporting those is a separate operation this phase does not ship.
 */

export const IMPORT_LIMIT = 2000;

/** What the import needs of a dispatcher. Deferred, exactly as Organization's import is. */
export interface CommandSender {
  send<TResult, TCommand extends Command>(
    command: TCommand,
  ): Promise<Result<TResult, HandlerFailure>>;
}

export interface ImportPersonRow {
  readonly personNumber: string;
  readonly legalName: Readonly<Record<string, string>>;
  readonly preferredName?: Readonly<Record<string, string>>;
  readonly dateOfBirth?: string;
  readonly placeOfBirth?: string;
  readonly genderCode?: string;
  readonly maritalStatusCode?: string;
}

export interface ImportPeopleCommand extends Command {
  readonly commandName: 'people.import';
  readonly rows: readonly ImportPersonRow[];
  /**
   * Whether rows that match an existing person are created anyway.
   *
   * Defaulting to *false* is the safe direction: an import that silently created a duplicate for
   * every near-match would fill the register with exactly what AD-001 exists to prevent. A row
   * that matches is reported, not written, and the operator decides.
   */
  readonly acknowledgedDuplicates?: boolean;
}

export interface ImportOutcome {
  readonly created: number;
  readonly skipped: number;
  readonly refused: readonly { readonly personNumber: string; readonly reason: string }[];
}

export const importPeopleHandler = (
  sender: CommandSender,
): CommandHandler<ImportPeopleCommand, ImportOutcome> => ({
  commandName: 'people.import',
  permission: PeoplePermissions.importPeople,

  validate: (command) =>
    command.rows.length <= IMPORT_LIMIT
      ? []
      : [
          {
            field: 'rows',
            message: `an import is limited to ${String(IMPORT_LIMIT)} rows; split the file`,
          },
        ],

  handle: async (command) => {
    const refused: { readonly personNumber: string; readonly reason: string }[] = [];
    let created = 0;
    let skipped = 0;

    for (const row of command.rows) {
      const outcome = await sender.send<{ readonly personId: string }, CreatePersonCommand>(
        createFrom(row, command.acknowledgedDuplicates),
      );

      if (outcome.ok) {
        created += 1;
        continue;
      }
      // An existing person number is a re-run, not a failure — which is what makes a corrected
      // file safe to run again.
      if (outcome.error.kind === 'conflict' && outcome.error.reason === 'person_number_taken') {
        skipped += 1;
        continue;
      }
      refused.push({ personNumber: row.personNumber, reason: reasonOf(outcome.error) });
    }
    return success({ created, skipped, refused });
  },
});

/**
 * One row as the command an administrator would send.
 *
 * Hoisted so the loop stays inside its complexity budget, and separate so that the *only*
 * difference between an imported person and a manually created one is visible in eight lines
 * rather than buried in a handler.
 */
const createFrom = (
  row: ImportPersonRow,
  acknowledgedDuplicates: boolean | undefined,
): CreatePersonCommand => ({
  commandName: 'people.create-person',
  personNumber: row.personNumber,
  legalName: row.legalName,
  ...(row.preferredName === undefined ? {} : { preferredName: row.preferredName }),
  ...(row.dateOfBirth === undefined ? {} : { dateOfBirth: row.dateOfBirth }),
  ...(row.placeOfBirth === undefined ? {} : { placeOfBirth: row.placeOfBirth }),
  ...(row.genderCode === undefined ? {} : { genderCode: row.genderCode }),
  ...(row.maritalStatusCode === undefined ? {} : { maritalStatusCode: row.maritalStatusCode }),
  ...(acknowledgedDuplicates === undefined ? {} : { acknowledgedDuplicates }),
});

const reasonOf = (failure: HandlerFailure): string => {
  if (failure.kind === 'validation') return failure.failures.map((f) => f.field).join(', ');
  if (failure.kind === 'conflict') return failure.reason;
  if (failure.kind === 'rejected') return failure.reason;
  if (failure.kind === 'not_found') return failure.resource;
  return failure.permission;
};

export interface ExportPeople extends Query {
  readonly queryName: 'people.export';
  readonly asOf?: Date;
}

export const exportPeopleHandler = (
  dependencies: PeopleDependencies,
): QueryHandler<ExportPeople, PeopleSnapshot> => ({
  queryName: 'people.export',
  permission: PeoplePermissions.exportPeople,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const asOf = query.asOf ?? dependencies.clock.now();
      const people = await dependencies.stores.people.all(transaction);
      const names = await dependencies.stores.names.forPeople(
        transaction,
        people.map((person) => person.id),
      );
      // Even an export holding the export permission does not carry the sensitive fields. A file
      // on somebody's laptop is the one copy this product cannot protect.
      const views = people.map((person) =>
        personView(
          person,
          names.filter((name) => name.personId === person.id),
          asOf,
          { sensitive: false, identifierValues: false },
        ),
      );

      return success({ asOf: asOf.toISOString(), people: views });
    }),
});
