import {
  Dispatcher,
  runInContext,
  uuidV7,
  type Command,
  type HandlerFailure,
  type Query,
  type Result,
} from '@work/kernel';
import { InMemoryUnitOfWork, assertSucceeded, permitting } from '@work/testing';

import { identityModule } from './identity-module.js';
import { IdentityPermissions } from './identity-permissions.js';
import { inMemoryIdentityStores } from './in-memory-stores.js';
import type { Clock, IdentityStores } from './identity-ports.js';
import type { IdentityDependencies } from './identity-dependencies.js';
import { ConfiguredTenantSettingsForTest } from './test-settings.js';

/**
 * The harness the module's application-service tests share.
 *
 * Everything goes through `Dispatcher` rather than calling handlers directly, because the
 * pipeline is where tenancy and authorization are applied — a test that bypassed it would prove
 * a handler works for a caller who was never checked.
 *
 * Shared rather than repeated per suite so that the three test files exercise identically
 * configured modules; a harness that differed slightly between files would make a failure in one
 * of them mean nothing about the others.
 */

export const TENANT_A = uuidV7();
export const TENANT_B = uuidV7();

/** Mutable so a test can move time forward — an invitation lapsing, a delegation ending. */
export const testClock = {
  value: new Date('2026-08-05T10:00:00Z'),
  reset(): void {
    this.value = new Date('2026-08-05T10:00:00Z');
  },
};

export const clock: Clock = { now: () => testClock.value };

export const ALL = Object.values(IdentityPermissions);

/** What a caller gets back from inviting somebody. */
export interface InvitationIssued {
  readonly invitationId: string;
  readonly expiresAt: Date;
}

/** What a caller gets back once somebody has joined. */
export interface JoinedMember {
  readonly membershipId: string;
  readonly workforceUserId: string;
}

export interface Harness {
  readonly stores: IdentityStores;
  readonly work: InMemoryUnitOfWork;
  readonly dispatcher: Dispatcher;
}

export const harnessFor = (tenantId: string, granted: readonly string[] = ALL): Harness => {
  const stores = inMemoryIdentityStores();
  const work = new InMemoryUnitOfWork(tenantId);
  const dependencies: IdentityDependencies = {
    unitOfWork: work,
    stores,
    settings: new ConfiguredTenantSettingsForTest(),
    clock,
  };
  const dispatcher = new Dispatcher(permitting(...granted));
  const module = identityModule(dependencies);

  for (const handler of module.commands ?? []) {
    dispatcher.registerCommand(handler);
  }
  for (const handler of module.queries ?? []) {
    dispatcher.registerQuery(handler);
  }
  // The module's event handlers are registered too, exactly as the composition root does. A
  // harness that skipped them would leave the reaction to a departure — portals closing, cover
  // withdrawn — untested while the docs describe it as automatic.
  for (const handler of module.eventHandlers ?? []) {
    work.events.register(handler);
  }
  return { stores, work, dispatcher };
};

/**
 * Dispatch helpers for the tests.
 *
 * The index signature is what lets a test write a command as an inline literal: without it,
 * TypeScript narrows the literal to bare `Command` and rejects every field the command carries.
 * The dispatcher's own signature stays strict; this widening lives in the tests only.
 */
export const send = <TResult>(
  harness: Harness,
  command: Command & Record<string, unknown>,
): Promise<Result<TResult, HandlerFailure>> => harness.dispatcher.send<TResult>(command);

export const ask = <TResult>(
  harness: Harness,
  query: Query & Record<string, unknown>,
): Promise<Result<TResult, HandlerFailure>> => harness.dispatcher.ask<TResult>(query);

/** Runs work inside a tenant context, as the request pipeline does in production. */
export const asTenant = <TResult>(
  tenantId: string,
  work: () => Promise<TResult>,
): Promise<TResult> =>
  runInContext({ tenantId, correlationId: uuidV7(), actor: `user:${uuidV7()}` }, work);

export const invite = (
  harness: Harness,
  email = 'sara@example.com',
): Promise<Result<InvitationIssued, HandlerFailure>> =>
  send<{ invitationId: string; expiresAt: Date }>(harness, {
    commandName: 'identity.invite-member',
    email,
  });

export const accept = (
  harness: Harness,
  invitationId: string,
  email = 'sara@example.com',
): Promise<Result<JoinedMember, HandlerFailure>> =>
  send<{ membershipId: string; workforceUserId: string }>(harness, {
    commandName: 'identity.accept-invitation',
    invitationId,
    platformUserId: 'platform-sara',
    principalEmail: email,
  });

/** Invites and accepts, which is the ordinary way somebody becomes a member. */
export const joinedMember = async (
  harness: Harness,
  email = 'sara@example.com',
): Promise<JoinedMember> => {
  const invitation = assertSucceeded(await invite(harness, email));
  return assertSucceeded(await accept(harness, invitation.invitationId, email));
};

/** A harness sharing an existing store, for the cross-tenant tests. */
export function harnessWithStores(tenantId: string, stores: IdentityStores): Harness {
  const work = new InMemoryUnitOfWork(tenantId);
  const dispatcher = new Dispatcher(permitting(...ALL));
  const module = identityModule({
    unitOfWork: work,
    stores,
    settings: new ConfiguredTenantSettingsForTest(),
    clock,
  });

  for (const handler of module.commands ?? []) {
    dispatcher.registerCommand(handler);
  }
  for (const handler of module.queries ?? []) {
    dispatcher.registerQuery(handler);
  }
  for (const handler of module.eventHandlers ?? []) {
    work.events.register(handler);
  }
  return { stores, work, dispatcher };
}

/** Joins as a specific Platform account, for tests needing two distinct people. */
export async function joinedMemberAs(
  harness: Harness,
  email: string,
  platformUserId: string,
): Promise<JoinedMember> {
  const issued = assertSucceeded(await invite(harness, email));

  return assertSucceeded(
    await send<{ membershipId: string; workforceUserId: string }>(harness, {
      commandName: 'identity.accept-invitation',
      invitationId: issued.invitationId,
      platformUserId,
      principalEmail: email,
    }),
  );
}
