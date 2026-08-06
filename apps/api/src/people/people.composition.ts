import {
  HmacIdentifierDigest,
  StructuredDisclosureLog,
  peopleModule,
  postgresPeopleStores,
  systemClock,
} from '@work/people';
import type { CommandSender } from '@work/people';
import {
  type Command,
  type Dispatcher,
  type HandlerFailure,
  type PermissionChecker,
  type Result,
  type UnitOfWork,
  type WorkModule,
} from '@work/kernel';
import type { Environment } from '@work/config';
import type { Logger } from 'pino';

/**
 * People's composition, kept out of its Nest module on purpose — the same split Organization
 * uses, for the same reason: the identity module's composition registers People on the shared
 * registry, while People's Nest module imports the identity module to reach the dispatcher it
 * built. Put both in one file and those two facts are a cycle. This file imports neither.
 */

/**
 * A command sender that is handed its dispatcher after the dispatcher exists.
 *
 * Bulk import sends the same commands an administrator would, and the dispatcher that receives
 * them is assembled from a handler list that includes import — a genuine cycle. Rather than break
 * it by letting import write rows directly (which would bypass the duplicate detection it exists
 * to run), the seam is made explicit.
 *
 * It refuses rather than returning something wrong if used before attachment, so a wiring mistake
 * is an immediate, named failure instead of a silent no-op import.
 */
export class DeferredPeopleSender implements CommandSender {
  private dispatcher: Dispatcher | undefined;

  public attach(dispatcher: Dispatcher): void {
    this.dispatcher = dispatcher;
  }

  public send<TResult, TCommand extends Command>(
    command: TCommand,
  ): Promise<Result<TResult, HandlerFailure>> {
    if (this.dispatcher === undefined) {
      throw new Error(
        'People bulk import was used before the dispatcher was attached. The composition root must call attach().',
      );
    }
    return this.dispatcher.send<TResult>(command);
  }
}

/**
 * Everything People needs, assembled.
 *
 * Two dependencies here are what make this module's PII protections real rather than
 * presentational, and both are supplied at the composition root because both need something the
 * module must not read for itself:
 *
 * - the **digest key**, which is validated configuration (`PII_MATCH_SECRET`), refused in
 *   production if it is the shipped development default;
 * - the **disclosure log**, which writes through the application's own structured logger, so a
 *   record of somebody being shown a national identifier reaches the same pipeline every other
 *   log line does and can be alerted on without this module knowing what the pipeline is.
 *
 * The `permissions` checker is the same one the pipeline uses. A *read* in this module assembles
 * its answer from what the caller holds — a caller with `people.person.read` and nothing else gets
 * the person with sensitive fields withheld rather than a 403 — and that is only possible if the
 * handler can ask.
 */
export const peopleModuleFor = (
  unitOfWork: UnitOfWork,
  permissions: PermissionChecker,
  environment: Environment,
  logger: Logger,
  sender: CommandSender,
): WorkModule =>
  peopleModule(
    {
      unitOfWork,
      stores: postgresPeopleStores(),
      permissions,
      digest: new HmacIdentifierDigest(environment.PII_MATCH_SECRET),
      disclosure: new StructuredDisclosureLog((record) => {
        logger.info(record, 'A government identifier value was disclosed.');
      }),
      clock: systemClock,
    },
    sender,
  );
