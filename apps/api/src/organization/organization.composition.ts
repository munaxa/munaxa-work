import { organizationModule, postgresOrganizationStores, systemClock } from '@work/organization';
import type { CommandSender, FilledHeadcountPort } from '@work/organization';
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

/**
 * Everything Organization needs, assembled. Registered by the identity module's composition.
 *
 * `filled` is now **Employment's adapter** rather than `NoAssignmentsYet`. That is the port Phase 3
 * declared being used as it was designed: Organization still never counts employees itself
 * (AD-002), and none of its code changed — the composition root chooses the implementation.
 *
 * The visible consequence is that an establishment's `filled` figure stops being zero, and its
 * `vacant` figure stops equalling its budget. That is the number becoming correct rather than
 * changing, and it closes the debt item the Phase 4 register carried against this phase.
 */
export const organizationModuleFor = (
  unitOfWork: UnitOfWork,
  sender: CommandSender,
  filled: FilledHeadcountPort,
): WorkModule =>
  organizationModule(
    { unitOfWork, stores: postgresOrganizationStores(), filled, clock: systemClock },
    sender,
  );
