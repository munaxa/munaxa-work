import {
  Dispatcher,
  runInContext,
  uuidV7,
  type HandlerFailure,
  type PermissionChecker,
  type Result,
} from '@work/kernel';

import { learningModule } from '../application/learning-module.js';
import { ALL_LEARNING_PERMISSIONS } from '../application/learning-permissions.js';
import {
  FakeEmployment,
  FakeOrganization,
  FixedClock,
  knownDocuments,
  recordingNotifications,
} from '../application/learning-test-harness.js';
import type { LearningFixture } from './learning-database.fixture.js';

/**
 * The real handlers, the real dispatcher, and **real PostgreSQL underneath them**.
 *
 * The application suites already prove what the handlers decide; this proves that those decisions
 * survive the database — that the occurrence key a rule computes lands in the column the unique
 * index covers, that a certificate's validity is derived from the date the table actually returned,
 * and that a projection assembled over three real queries stays inside its tenant.
 *
 * **The cross-module ports are still doubles, and deliberately so.** Production adapters are the
 * next checkpoint. Nothing here claims a cross-module scenario is verified: what is verified is the
 * persistence beneath Learning's own decisions.
 */

export const NOW = new Date('2026-08-12T09:00:00.000Z');
export const TODAY = '2026-08-12';
export const HR = 'user:learning-hr';

export interface PostgresHarness {
  readonly dispatcher: Dispatcher;
  readonly clock: FixedClock;
  readonly employment: FakeEmployment;
  readonly organization: FakeOrganization;
  as<TResult>(tenantId: string, work: () => Promise<TResult>): Promise<TResult>;
}

export const postgresHarnessFor = (
  fixture: LearningFixture,
  unitOfWork = fixture.unitOfWork,
): PostgresHarness => {
  const permissions: PermissionChecker = {
    holds: (permission) => Promise.resolve(ALL_LEARNING_PERMISSIONS.includes(permission)),
  };
  const dispatcher = new Dispatcher(permissions);
  const clock = new FixedClock(NOW);
  const employment = new FakeEmployment();
  const organization = new FakeOrganization();
  const module = learningModule({
    unitOfWork,
    stores: fixture.stores,
    employment,
    organization,
    documents: knownDocuments(),
    notifications: recordingNotifications(),
    permissions,
    clock,
  });

  for (const handler of module.commands ?? []) dispatcher.registerCommand(handler);
  for (const handler of module.queries ?? []) dispatcher.registerQuery(handler);

  return {
    dispatcher,
    clock,
    employment,
    organization,
    as: (tenantId, work) => runInContext({ tenantId, correlationId: uuidV7(), actor: HR }, work),
  };
};

/** Sends a command and fails loudly, so a broken step names itself rather than the next one. */
export const send = async <TResult>(
  harness: PostgresHarness,
  command: Record<string, unknown>,
): Promise<TResult> => {
  const result = await harness.dispatcher.send<TResult>(command as never);

  if (!result.ok) throw new Error(`Refused: ${JSON.stringify(result.error)}`);
  return result.value;
};

export const ask = async <TResult>(
  harness: PostgresHarness,
  query: Record<string, unknown>,
): Promise<TResult> => {
  const result = await harness.dispatcher.ask<TResult>(query as never);

  if (!result.ok) throw new Error(`Refused: ${JSON.stringify(result.error)}`);
  return result.value;
};

export const attempt = (
  harness: PostgresHarness,
  command: Record<string, unknown>,
): Promise<Result<unknown, HandlerFailure>> => harness.dispatcher.send(command as never);
