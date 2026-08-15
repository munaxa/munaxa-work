import { Injectable } from '@nestjs/common';
import type { Command, Dispatcher, HandlerFailure, Query, Result } from '@work/kernel';

/**
 * The CQRS dispatcher, as something Nest can inject.
 *
 * A thin wrapper rather than a re-implementation: the pipeline — tenancy, then authorization, then
 * validation, then the handler — lives in the kernel and is the same one every module uses. This
 * exists only because a controller needs a constructor parameter with a type Nest can resolve, and
 * the kernel must not know Nest exists.
 *
 * **There is no method here that bypasses a handler.** No store, no repository and no transaction is
 * reachable from a controller, and in this module that matters twice over: an approval queue is
 * resolved from the membership on the request, and a controller that could reach a repository could
 * read anybody's. The only way from an HTTP request into Workflow is a command or a query the
 * application declared, with the permission it declared.
 *
 * **Nothing here reaches the Recruitment seam.** A terminal decision travels to an adopting module
 * through `BusinessDecisionPort` inside the decision handler; there is no route, and no method on
 * this class, through which the HTTP layer could invoke it.
 */
@Injectable()
export class WorkflowDispatcher {
  public constructor(private readonly dispatcher: Dispatcher) {}

  /**
   * Generic over the command type rather than taking a bare `Command`.
   *
   * With a bare parameter, TypeScript narrows an object literal at the call site to `Command` and
   * rejects every field the command actually carries — so each controller would have to widen or
   * assert, and an assertion at every call site is an assertion nobody reads.
   */
  public send<TResult, TCommand extends Command>(
    command: TCommand,
  ): Promise<Result<TResult, HandlerFailure>> {
    return this.dispatcher.send<TResult>(command);
  }

  public ask<TResult, TQuery extends Query>(
    query: TQuery,
  ): Promise<Result<TResult, HandlerFailure>> {
    return this.dispatcher.ask<TResult>(query);
  }
}
