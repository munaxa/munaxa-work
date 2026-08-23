import { success, uuidV7, type Command, type CommandHandler } from '@work/kernel';

import { recordViolation } from '../domain/violation.js';
import { currentActor, notFound, refusedBy } from './relations-context.js';
import { RelationsPermissions } from './relations-permissions.js';
import type { RelationsDependencies } from './relations-dependencies.js';

/**
 * Recording that a violation occurred, against an employment.
 *
 * The order of the checks is the design. **The employment is confirmed before anything is written**,
 * and it is confirmed through Employment's own published read rather than by looking at a table this
 * module does not own — so a violation cannot be filed against an identifier that is not an
 * employment, or is another tenant's.
 *
 * **Both refusals are `not_found`, and both say the same thing.** An employment in another tenant is
 * indistinguishable from one that never existed, and so is a category — because a caller who could
 * tell the difference could use this command to enumerate another tenant's workforce one identifier
 * at a time.
 *
 * **Three things are taken from the execution context and cannot be supplied:** the tenant, the
 * actor, and the instant. A command carrying any of them would let a caller file a disciplinary
 * allegation into another tenant, under a colleague's name, or backdated.
 *
 * **Nothing is emitted.** `ViolationRecorded` is in the specification's event list and is not raised
 * here: the dispatch is at-most-once with no outbox (ADR-0053/0064), no module subscribes to it, and
 * an event nobody consumes is a promise about delivery this module would not be keeping. It arrives
 * when a consumer does.
 */

export interface RecordViolationCommand extends Command {
  readonly commandName: 'relations.record-violation';
  readonly employmentId: string;
  readonly violationCategoryId: string;
  /** The civil date the conduct occurred, `YYYY-MM-DD`. */
  readonly occurredOn: string;
  readonly description: string;
}

export interface ViolationRecorded {
  readonly violationId: string;
}

export const recordViolationHandler = (
  dependencies: RelationsDependencies,
): CommandHandler<RecordViolationCommand, ViolationRecorded> => ({
  commandName: 'relations.record-violation',
  permission: RelationsPermissions.violationRecord,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const employed = await dependencies.employments.exists(command.employmentId);

      if (!employed) return notFound<ViolationRecorded>('employment');

      const category = await dependencies.stores.categories.byId(
        transaction,
        command.violationCategoryId,
      );

      if (category === undefined) return notFound<ViolationRecorded>('violation_category');

      const now = dependencies.clock.now();
      const recorded = recordViolation({
        violationId: uuidV7(),
        employmentId: command.employmentId,
        category,
        occurredOn: command.occurredOn,
        // Never from the command. See `relations-context.ts`.
        reportedBy: currentActor(),
        description: command.description,
        recordedAt: now,
        today: civilDateOf(now),
      });

      if (!recorded.ok) return refusedBy<ViolationRecorded>(recorded.error);

      await dependencies.stores.violations.insert(transaction, recorded.value);
      return success({ violationId: recorded.value.violationId });
    }),
});

/**
 * The civil date at an instant, in UTC.
 *
 * UTC rather than a tenant time zone, and that is a limitation stated rather than hidden: near
 * midnight in a tenant well east or west of UTC, "today" here may differ from "today" there by a
 * day, so conduct reported on the local evening of the 5th could be refused as future-dated. Reading
 * a tenant's time zone means a cross-module contract with Organization that Checkpoint 1 was not
 * authorized to open, and inventing a per-request offset would be worse. Recorded in the checkpoint
 * report as a known limitation.
 */
const civilDateOf = (instant: Date): string => instant.toISOString().slice(0, 10);
