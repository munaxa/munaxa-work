import {
  Dispatcher,
  runInContext,
  uuidV7,
  type HandlerFailure,
  type PermissionChecker,
  type Result,
} from '@work/kernel';
import { InMemoryUnitOfWork } from '@work/testing';

import { inMemoryAssetsStores, type InMemoryAssetsStores } from './in-memory-stores.js';
import { assetsModule } from './assets-module.js';
import { ALL_ASSETS_PERMISSIONS } from './assets-permissions.js';

/**
 * The harness the application suites run against: the real module, the real dispatcher, the real
 * handlers — and a fake for the database.
 *
 * **There is nothing else to fake, and that is the checkpoint's shape.** Relations' harness carries
 * a fake Employment directory and a fake Identity membership directory because Relations asks those
 * modules questions. This one carries neither, because Checkpoint 1 asks nobody anything. The day a
 * fake appears here, a cross-module dependency has appeared with it.
 */

export const TENANT = uuidV7();

export const STOREKEEPER = 'user:assets-storekeeper';
export const ADMINISTRATOR = 'user:assets-administrator';

export interface Harness {
  readonly dispatcher: Dispatcher;
  readonly stores: InMemoryAssetsStores;
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
  const module = assetsModule({ unitOfWork: new InMemoryUnitOfWork(TENANT), stores });

  for (const handler of module.commands ?? []) dispatcher.registerCommand(handler);
  for (const handler of module.queries ?? []) dispatcher.registerQuery(handler);

  return {
    dispatcher,
    stores,
    as: (actor, work) => runInContext({ tenantId: TENANT, correlationId: uuidV7(), actor }, work),
  };
};

/** Sends a command and fails loudly, so a broken step names itself rather than the next one. */
export const send = async <TResult>(
  harness: Harness,
  command: Record<string, unknown>,
): Promise<TResult> => {
  const result = await harness.dispatcher.send<TResult>(command as never);

  if (!result.ok) throw new Error(`Refused: ${JSON.stringify(result.error)}`);
  return result.value;
};

export const attempt = (
  harness: Harness,
  command: Record<string, unknown>,
): Promise<Result<unknown, HandlerFailure>> => harness.dispatcher.send(command as never);

export const ask = async <TResult>(
  harness: Harness,
  query: Record<string, unknown>,
): Promise<TResult> => {
  const result = await harness.dispatcher.ask<TResult>(query as never);

  if (!result.ok) throw new Error(`Refused: ${JSON.stringify(result.error)}`);
  return result.value;
};

export const tryAsk = (
  harness: Harness,
  query: Record<string, unknown>,
): Promise<Result<unknown, HandlerFailure>> => harness.dispatcher.ask(query as never);

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
  const assetCategoryId =
    (overrides.assetCategoryId as string | undefined) ?? (await givenCategory(harness));
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
