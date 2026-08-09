import {
  success,
  type Command,
  type CommandHandler,
  type HandlerFailure,
  type Query,
  type QueryHandler,
  type Result,
} from '@work/kernel';

import type { Metadata } from '../domain/recruitment-aggregate.js';
import type { RecruitmentExport } from '../contracts/views.js';

import { conflicted } from './recruitment-context.js';
import { RecruitmentPermissions } from './recruitment-permissions.js';
import { applicationView, candidateView } from './recruitment-views.js';
import type { CreateCandidateCommand } from './candidate.use-case.js';
import type { RecruitmentDependencies } from './recruitment-dependencies.js';

/**
 * Bringing a candidate pool in, and taking the register out.
 *
 * **Import sends the same commands a recruiter would.** It writes no rows, so every rule a create
 * enforces — the duplicate-email check, the generated candidate number, the refusal to invent a
 * Person — applies to a two-thousand-row migration exactly as it applies to one applicant. An import
 * that wrote directly would be the one path in the product where those rules did not hold, and it
 * would be the path that loaded a customer's entire history.
 *
 * **A duplicate is skipped, not failed**, which is what makes a re-run safe: a file that stopped at
 * row 900 can be sent again and the first 899 are recognised rather than duplicated. That is
 * resumability, and it is not atomicity — the limitation is carried in the debt register.
 *
 * Both operations are **bounded and synchronous**, and the bound is stated in code rather than
 * discovered. Beyond it the command refuses by name. Making them background jobs is Phase 24's, and
 * a bounded refusal is more honest than a request that times out halfway through a migration.
 */

export const IMPORT_LIMIT = 2000;
export const EXPORT_LIMIT = 5000;

/**
 * How import reaches the dispatcher that was built from a list including import.
 *
 * A genuine cycle, made explicit rather than broken by letting import bypass the application
 * service — the same seam Organization, People and Employment use, for the same reason.
 */
export interface CommandSender {
  send<TResult, TCommand extends Command>(
    command: TCommand,
  ): Promise<Result<TResult, HandlerFailure>>;
}

export interface ImportCandidatesCommand extends Command {
  readonly commandName: 'recruitment.import-candidates';
  readonly rows: readonly ImportRow[];
}

export interface ImportRow {
  readonly displayName: Readonly<Record<string, string>>;
  readonly email: string;
  readonly phone?: string;
  readonly sourceCode: string;
  readonly metadata?: Metadata;
}

export interface ImportOutcome {
  readonly created: number;
  /** Rows skipped because that address is already a candidate. Resumable, not failed. */
  readonly skipped: number;
  readonly failures: readonly ImportFailure[];
}

export interface ImportFailure {
  /** The row's position in the file. Never the address — a failure log is read widely. */
  readonly row: number;
  readonly reason: string;
}

export const importCandidatesHandler = (
  sender: CommandSender,
): CommandHandler<ImportCandidatesCommand, ImportOutcome> => ({
  commandName: 'recruitment.import-candidates',
  permission: RecruitmentPermissions.importCandidates,

  handle: async (command) => {
    if (command.rows.length > IMPORT_LIMIT) return conflicted('import_too_large');

    const failures: ImportFailure[] = [];
    let created = 0;
    let skipped = 0;

    for (const [index, row] of command.rows.entries()) {
      // Sequentially, deliberately: the duplicate check is what makes a re-run safe, and two rows
      // for one address running concurrently would both pass it.
      const result = await sender.send<{ candidateId: string }, CreateCandidateCommand>({
        commandName: 'recruitment.create-candidate',
        ...row,
      });

      if (result.ok) {
        created += 1;
        continue;
      }
      if (
        result.error.kind === 'conflict' &&
        result.error.reason === 'candidate_email_already_known'
      ) {
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

export interface ExportRecruitment extends Query {
  readonly queryName: 'recruitment.export';
}

/**
 * The candidate register and every application, in one response.
 *
 * Permissioned separately from reading, and held by fewer people: this is the highest-volume
 * disclosure this module can make, and every row in it is personal data belonging to somebody who
 * does not work here and never agreed to a personnel file.
 *
 * Anonymized candidates export as anonymized. The erasure is in the data, not in a filter somebody
 * could forget to apply.
 */
export const exportRecruitmentHandler = (
  dependencies: RecruitmentDependencies,
): QueryHandler<ExportRecruitment, RecruitmentExport> => ({
  queryName: 'recruitment.export',
  permission: RecruitmentPermissions.exportRecruitment,

  handle: async () =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const candidates = await dependencies.stores.candidates.all(transaction);

      if (candidates.length > EXPORT_LIMIT) return conflicted('export_too_large');

      const applications = await dependencies.stores.applications.all(transaction);

      return success({
        generatedAt: dependencies.clock.now(),
        candidates: candidates.map(candidateView),
        applications: applications.map(applicationView),
      });
    }),
});
