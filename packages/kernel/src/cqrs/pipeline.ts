import { AsyncLocalStorage } from 'node:async_hooks';

import { TenantIsolationException } from '../errors/domain-exception.js';
import { currentContext, isSystemContext } from '../tenancy/tenant-context.js';
import { err, ok, type Result } from '../result/result.js';

/**
 * Commands and queries, and the pipeline every one passes through.
 *
 * The separation is not ceremony. A command changes state, needs a transaction, raises events
 * and must be authorized against the actor. A query does none of those and will eventually read
 * a projection rather than the transactional tables. Keeping them apart is what makes it
 * possible to route reads elsewhere later without touching a single handler.
 *
 * The pipeline exists so that authorization, validation and tenancy are applied *centrally*.
 * A handler that has to remember to check a permission is a handler that will one day forget,
 * and the forgetting is silent.
 */

export interface Command {
  readonly commandName: string;
}

export interface Query {
  readonly queryName: string;
}

export type ValidationFailure = { readonly field: string; readonly message: string };

export type HandlerFailure =
  | { readonly kind: 'validation'; readonly failures: readonly ValidationFailure[] }
  | { readonly kind: 'forbidden'; readonly permission: string }
  | { readonly kind: 'not_found'; readonly resource: string }
  | { readonly kind: 'conflict'; readonly reason: string }
  | { readonly kind: 'rejected'; readonly reason: string };

export interface CommandHandler<TCommand extends Command, TResult> {
  readonly commandName: string;
  /** The permission the actor must hold. Declared, not checked inside the handler. */
  readonly permission: string;
  validate?(command: TCommand): readonly ValidationFailure[];
  handle(command: TCommand): Promise<Result<TResult, HandlerFailure>>;
}

export interface QueryHandler<TQuery extends Query, TResult> {
  readonly queryName: string;
  readonly permission: string;
  handle(query: TQuery): Promise<Result<TResult, HandlerFailure>>;
}

/** Answers whether the current actor holds a permission. Platform supplies the implementation. */
export interface PermissionChecker {
  holds(permission: string): Promise<boolean>;
}

/**
 * A ceiling on what permissions allow — what the organisation is entitled to, say. Supplied by the
 * platform; the kernel never learns what it means.
 *
 * Asked only for the **outermost** operation: the one a person or a job started. An operation one
 * module dispatches while handling another — Leave asking Compensation, Payroll asking Employment —
 * is collaboration between modules on behalf of an operation already admitted, and refusing it
 * would let one module's entitlement break another module's work.
 *
 * Never a grant: it runs after the permission check, so a caller without the permission learns
 * nothing about entitlements, and passing it still leaves validation and the handler to decide.
 */
export interface OperationGate {
  /** Resolves to admit; throws `NotEntitledException` to refuse. */
  admit(operation: {
    readonly kind: 'command' | 'query';
    readonly name: string;
    readonly permission: string;
  }): Promise<void>;
}

/** Set while an operation runs, so the gate can tell an outermost operation from a nested one. */
const operating = new AsyncLocalStorage<true>();

interface Registry {
  readonly commands: Map<string, CommandHandler<Command, unknown>>;
  readonly queries: Map<string, QueryHandler<Query, unknown>>;
}

export class Dispatcher {
  private readonly registry: Registry = { commands: new Map(), queries: new Map() };

  public constructor(
    private readonly permissions: PermissionChecker,
    private readonly gate?: OperationGate,
  ) {}

  public registerCommand<TCommand extends Command, TResult>(
    handler: CommandHandler<TCommand, TResult>,
  ): void {
    if (this.registry.commands.has(handler.commandName)) {
      throw new Error(`Two handlers registered for command ${handler.commandName}.`);
    }
    this.registry.commands.set(handler.commandName, handler);
  }

  public registerQuery<TQuery extends Query, TResult>(
    handler: QueryHandler<TQuery, TResult>,
  ): void {
    if (this.registry.queries.has(handler.queryName)) {
      throw new Error(`Two handlers registered for query ${handler.queryName}.`);
    }
    this.registry.queries.set(handler.queryName, handler);
  }

  /**
   * Runs a command through the pipeline: tenancy, then authorization, then the operation gate (when
   * there is one, and this is the outermost operation), then validation, then the handler. In that order deliberately — an unauthorized caller learns nothing about whether
   * their payload was well formed.
   *
   * Generic over the command type as well as the result. With a bare `Command` parameter,
   * TypeScript narrows an object literal at the call site to `Command` and rejects every field
   * the command actually carries, so each caller would have to assert — and an assertion at
   * every call site is an assertion nobody reads.
   */
  public async send<TResult, TCommand extends Command = Command>(
    command: TCommand,
  ): Promise<Result<TResult, HandlerFailure>> {
    const handler = this.registry.commands.get(command.commandName);

    if (handler === undefined) {
      return err({ kind: 'not_found', resource: `handler for ${command.commandName}` });
    }
    assertTenantScoped(command.commandName);

    if (!(await this.permissions.holds(handler.permission))) {
      return err({ kind: 'forbidden', permission: handler.permission });
    }
    await this.admit('command', command.commandName, handler.permission);
    const failures = handler.validate?.(command) ?? [];

    if (failures.length > 0) return err({ kind: 'validation', failures });

    return (await operating.run(true, () => handler.handle(command))) as Result<
      TResult,
      HandlerFailure
    >;
  }

  public async ask<TResult, TQuery extends Query = Query>(
    query: TQuery,
  ): Promise<Result<TResult, HandlerFailure>> {
    const handler = this.registry.queries.get(query.queryName);

    if (handler === undefined) {
      return err({ kind: 'not_found', resource: `handler for ${query.queryName}` });
    }
    assertTenantScoped(query.queryName);

    if (!(await this.permissions.holds(handler.permission))) {
      return err({ kind: 'forbidden', permission: handler.permission });
    }
    await this.admit('query', query.queryName, handler.permission);

    return (await operating.run(true, () => handler.handle(query))) as Result<
      TResult,
      HandlerFailure
    >;
  }

  private async admit(kind: 'command' | 'query', name: string, permission: string): Promise<void> {
    if (this.gate === undefined || operating.getStore() === true) return;
    await this.gate.admit({ kind, name, permission });
  }

  /** Every registered permission, for the module registry and the administration UI. */
  public declaredPermissions(): readonly string[] {
    return [
      ...new Set([
        ...[...this.registry.commands.values()].map((handler) => handler.permission),
        ...[...this.registry.queries.values()].map((handler) => handler.permission),
      ]),
    ].sort();
  }
}

/**
 * Business operations run inside a tenant. The system context is for migrations and platform
 * maintenance, and reaching a business handler from it means a job forgot to adopt a tenant.
 *
 * A **machine** context passes, and passing here buys it nothing: it still has to hold the handler's
 * declared permission, which the platform grants to a non-human principal explicitly or not at all.
 * That is the whole design — automatic work goes through the *same* gate as a person, so there is
 * one place authorization is decided rather than two that can disagree.
 */
const assertTenantScoped = (operation: string): void => {
  const context = currentContext();

  if (context === undefined || isSystemContext(context)) {
    throw new TenantIsolationException(`${operation}, which ran without a tenant context`);
  }
};

export const success = <TResult>(value: TResult): Result<TResult, HandlerFailure> => ok(value);
export const rejected = <TResult>(reason: string): Result<TResult, HandlerFailure> =>
  err({ kind: 'rejected', reason });
