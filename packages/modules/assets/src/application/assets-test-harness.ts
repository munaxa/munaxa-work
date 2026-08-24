import {
  Dispatcher,
  runInContext,
  uuidV7,
  type Command,
  type HandlerFailure,
  type PermissionChecker,
  type Query,
  type Result,
} from '@work/kernel';
import { InMemoryUnitOfWork } from '@work/testing';

import { inMemoryAssetsStores, type InMemoryAssetsStores } from './in-memory-stores.js';
import { assetsModule } from './assets-module.js';
import { ALL_ASSETS_PERMISSIONS } from './assets-permissions.js';
import type { Clock, EmploymentDirectoryPort } from './assets-ports.js';

/**
 * The harness the application suites run against: the real module, the real dispatcher, the real
 * handlers — and a fake for the database.
 *
 * **Employment is faked, not assumed.** An employment absent from `FakeEmployments` is refused rather
 * than invented, so a suite can prove that an asset cannot be issued to an identifier Employment does
 * not recognise — which is the same answer another tenant's employment gets. It starts empty, so a
 * test that forgets to arrange one meets a refusal rather than a pass.
 *
 * **There is exactly one fake here, and that is the module's shape.** Checkpoint 1 had none;
 * Checkpoint 2 asks one module one question. The day a second appears, a second cross-module
 * dependency has appeared with it.
 */

export const TENANT = uuidV7();

export const STOREKEEPER = 'user:assets-storekeeper';
export const ADMINISTRATOR = 'user:assets-administrator';

/** The day every suite's clock is held at, so a "not in the future" rule is testable at all. */
export const TODAY = new Date('2026-08-23T09:00:00Z');

export class FixedClock implements Clock {
  public constructor(private moment: Date) {}

  public now(): Date {
    return this.moment;
  }

  public advanceTo(moment: Date): void {
    this.moment = moment;
  }
}

/** Which employments exist, as Employment would answer. One absent here is refused, not invented. */
export class FakeEmployments implements EmploymentDirectoryPort {
  private readonly known = new Set<string>();

  public add(employmentId: string): void {
    this.known.add(employmentId);
  }

  public exists(employmentId: string): Promise<boolean> {
    return Promise.resolve(this.known.has(employmentId));
  }
}

export interface Harness {
  readonly dispatcher: Dispatcher;
  readonly stores: InMemoryAssetsStores;
  readonly employments: FakeEmployments;
  readonly clock: FixedClock;
  as<TResult>(actor: string, work: () => Promise<TResult>): Promise<TResult>;
}

export interface HarnessOptions {
  readonly permissions?: readonly string[];
}

export const harnessFor = (options: HarnessOptions = {}): Harness => {
  const granted = options.permissions ?? ALL_ASSETS_PERMISSIONS;
  const permissions: PermissionChecker = {
    holds: (permission) => Promise.resolve(granted.includes(permission)),
  };
  const dispatcher = new Dispatcher(permissions);
  const stores = inMemoryAssetsStores();
  const employments = new FakeEmployments();
  const clock = new FixedClock(TODAY);
  const module = assetsModule({
    unitOfWork: new InMemoryUnitOfWork(TENANT),
    stores,
    employments,
    clock,
  });

  for (const handler of module.commands ?? []) dispatcher.registerCommand(handler);
  for (const handler of module.queries ?? []) dispatcher.registerQuery(handler);

  return {
    dispatcher,
    stores,
    employments,
    clock,
    as: (actor, work) => runInContext({ tenantId: TENANT, correlationId: uuidV7(), actor }, work),
  };
};

/**
 * What a suite may send, typed rather than asserted.
 *
 * A command carries a `commandName` and whatever else it needs, so the intersection describes it
 * exactly — and a suite that forgot the name fails to compile instead of being cast past the type
 * system. Checkpoint 1 asserted these through `as never`, copying Relations; the assertion bought
 * nothing the intersection does not, and it hid the one mistake worth catching.
 */
type SentCommand = Command & Record<string, unknown>;
type AskedQuery = Query & Record<string, unknown>;

/** Sends a command and fails loudly, so a broken step names itself rather than the next one. */
export const send = async <TResult>(harness: Harness, command: SentCommand): Promise<TResult> => {
  const result = await harness.dispatcher.send<TResult>(command);

  if (!result.ok) throw new Error(`Refused: ${JSON.stringify(result.error)}`);
  return result.value;
};

export const attempt = (
  harness: Harness,
  command: SentCommand,
): Promise<Result<unknown, HandlerFailure>> => harness.dispatcher.send(command);

export const ask = async <TResult>(harness: Harness, query: AskedQuery): Promise<TResult> => {
  const result = await harness.dispatcher.ask<TResult>(query);

  if (!result.ok) throw new Error(`Refused: ${JSON.stringify(result.error)}`);
  return result.value;
};

export const tryAsk = (
  harness: Harness,
  query: AskedQuery,
): Promise<Result<unknown, HandlerFailure>> => harness.dispatcher.ask(query);

/** A catalogue entry, defined through the real command. Overrides ride on top. */
export const givenCategory = async (
  harness: Harness,
  overrides: Record<string, unknown> = {},
): Promise<string> => {
  const created = await harness.as(ADMINISTRATOR, () =>
    send<{ assetCategoryId: string }>(harness, {
      commandName: 'assets.define-category',
      code: 'laptop',
      name: { en: 'Laptop', ar: 'حاسوب محمول' },
      sequence: 10,
      ...overrides,
    }),
  );

  return created.assetCategoryId;
};

/** An item, registered through the real command, under a category this harness created. */
export const givenAsset = async (
  harness: Harness,
  overrides: Record<string, unknown> = {},
): Promise<string> => {
  // An existing category is reused rather than a second one defined: catalogue codes are unique per
  // tenant, so a suite registering three assets would otherwise meet `category_code_taken` on the
  // second — a refusal about the *fixture* rather than about what the test is asserting.
  const assetCategoryId =
    (overrides.assetCategoryId as string | undefined) ??
    [...harness.stores.categoryRows.keys()][0] ??
    (await givenCategory(harness));
  const registeredAsset = await harness.as(STOREKEEPER, () =>
    send<{ assetId: string }>(harness, {
      commandName: 'assets.register-asset',
      assetCategoryId,
      assetTag: 'IT-00417',
      ...overrides,
    }),
  );

  return registeredAsset.assetId;
};

/** An open custody, through the real command, against an employment this harness knows. */
export const givenCustody = async (
  harness: Harness,
  overrides: Record<string, unknown> = {},
): Promise<{ readonly assetId: string; readonly assetCustodyId: string }> => {
  const assetId = (overrides.assetId as string | undefined) ?? (await givenAvailableAsset(harness));
  const employmentId = (overrides.employmentId as string | undefined) ?? uuidV7();

  harness.employments.add(employmentId);

  const issued = await harness.as(STOREKEEPER, () =>
    send<{ assetCustodyId: string }>(harness, {
      commandName: 'assets.issue-custody',
      assetId,
      employmentId,
      issuedOn: '2026-08-20',
      ...overrides,
    }),
  );

  return { assetId, assetCustodyId: issued.assetCustodyId };
};

/** An asset moved into service, which is the one status a custody may open from. */
export const givenAvailableAsset = async (
  harness: Harness,
  overrides: Record<string, unknown> = {},
): Promise<string> => {
  const assetId = await givenAsset(harness, overrides);

  await harness.as(STOREKEEPER, () =>
    send(harness, {
      commandName: 'assets.change-asset-status',
      assetId,
      expectedVersion: 1,
      status: 'available',
    }),
  );

  return assetId;
};
