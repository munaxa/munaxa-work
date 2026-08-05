import {
  NoAssignmentsYet,
  organizationModule,
  postgresOrganizationStores,
  systemClock,
} from '@work/organization';
import type { CommandSender } from '@work/organization';
import {
  type Command,
  type Dispatcher,
  type HandlerFailure,
  type Result,
  type UnitOfWork,
  type WorkModule,
} from '@work/kernel';

/**
 * Organization's composition, kept out of its Nest module on purpose.
 *
 * The identity module's composition registers Organization on the shared registry, and
 * Organization's Nest module imports the identity module to reach the dispatcher it built. Put
 * both in one file and those two facts are a cycle. This file imports nothing from either.
 */

/**
 * A command sender that is handed its dispatcher after the dispatcher exists.
 *
 * Bulk import sends the same commands an administrator would, and the dispatcher that receives
 * them is assembled from a handler list that includes import — a genuine cycle. Rather than
 * break it by letting import write rows directly (which would bypass every invariant it exists
 * to enforce), the seam is made explicit: the module is built with this, and the composition
 * root attaches the dispatcher the moment it has one.
 *
 * It refuses rather than returning something wrong if it is used before attachment, so a wiring
 * mistake is an immediate, named failure instead of a silent no-op import.
 */
export class DeferredCommandSender implements CommandSender {
  private dispatcher: Dispatcher | undefined;

  public attach(dispatcher: Dispatcher): void {
    this.dispatcher = dispatcher;
  }

  public send<TResult, TCommand extends Command>(
    command: TCommand,
  ): Promise<Result<TResult, HandlerFailure>> {
    if (this.dispatcher === undefined) {
      throw new Error(
        'Organization bulk import was used before the dispatcher was attached. The composition root must call attach().',
      );
    }
    return this.dispatcher.send<TResult>(command);
  }
}

/** Everything Organization needs, assembled. Registered by the identity module's composition. */
export const organizationModuleFor = (unitOfWork: UnitOfWork, sender: CommandSender): WorkModule =>
  organizationModule(
    {
      unitOfWork,
      stores: postgresOrganizationStores(),
      // Employment supplies the real one from Phase 5. Zero until then, honestly and by
      // construction: there are no assignments to count, and Organization never counts (AD-002).
      filled: new NoAssignmentsYet(),
      clock: systemClock,
    },
    sender,
  );
