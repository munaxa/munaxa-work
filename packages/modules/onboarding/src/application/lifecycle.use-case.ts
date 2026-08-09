import {
  success,
  type Command,
  type CommandHandler,
  type HandlerFailure,
  type Result,
  type Transaction,
} from '@work/kernel';

import { Onboarding } from '../domain/onboarding.js';
import { Task } from '../domain/task.js';
import { civilDateOf } from '../domain/onboarding-vocabulary.js';

import { currentActor, notFound, originOfCurrentRequest, refusedBy } from './onboarding-context.js';
import { OnboardingPermissions } from './onboarding-permissions.js';
import type { OnboardingDependencies } from './onboarding-dependencies.js';

/**
 * What happens to an onboarding after it is started: preboarding, the first day, completion and
 * cancellation.
 *
 * **None of these changes an employment fact.** Not the status, not a date, not an assignment.
 * Employment owns the relationship and Offboarding (Phase 11.2) owns its end; what this module
 * records is how far the *process* got (ADR-0047). A tenant that wants activation on completion adds
 * a task that activates it, and that act is audited as its own.
 */

export interface OnboardingAffected {
  readonly onboardingId: string;
  readonly state: string;
}

export interface BeginPreboardingCommand extends Command {
  readonly commandName: 'onboarding.begin-preboarding';
  readonly onboardingId: string;
  readonly expectedVersion: number;
}

/**
 * Work begins before the first day.
 *
 * A state of the *onboarding*, not of the employment: the person is not an employee because
 * preboarding started, and no legal rule about when employment commences is invented here. The only
 * date this product treats as authoritative for the relationship is Employment's start date.
 */
export const beginPreboardingHandler = (
  dependencies: OnboardingDependencies,
): CommandHandler<BeginPreboardingCommand, OnboardingAffected> => ({
  commandName: 'onboarding.begin-preboarding',
  permission: OnboardingPermissions.manage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) =>
      withOnboarding(transaction, dependencies, command, (onboarding, now) =>
        onboarding.beginPreboarding(originOfCurrentRequest(), now),
      ),
    ),
});

export interface BeginOnboardingCommand extends Command {
  readonly commandName: 'onboarding.begin-onboarding';
  readonly onboardingId: string;
  readonly expectedVersion: number;
}

export const beginOnboardingHandler = (
  dependencies: OnboardingDependencies,
): CommandHandler<BeginOnboardingCommand, OnboardingAffected> => ({
  commandName: 'onboarding.begin-onboarding',
  permission: OnboardingPermissions.manage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) =>
      withOnboarding(transaction, dependencies, command, (onboarding, now) =>
        onboarding.beginOnboarding(originOfCurrentRequest(), now),
      ),
    ),
});

export interface CompleteOnboardingCommand extends Command {
  readonly commandName: 'onboarding.complete-onboarding';
  readonly onboardingId: string;
  readonly expectedVersion: number;
}

/**
 * Completion: explicit, permissioned, and refused while a required task is open.
 *
 * The tally is counted in the database rather than by loading the task list, and `done` and `waived`
 * both satisfy — a waiver is a decision somebody made and recorded a reason for. `cancelled` does
 * not: a task cancelled while the onboarding ran was never dealt with.
 */
export const completeOnboardingHandler = (
  dependencies: OnboardingDependencies,
): CommandHandler<CompleteOnboardingCommand, OnboardingAffected> => ({
  commandName: 'onboarding.complete-onboarding',
  permission: OnboardingPermissions.complete,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const state = await dependencies.stores.onboardings.byId(transaction, command.onboardingId);

      if (state === undefined) return notFound<OnboardingAffected>('onboarding');

      const now = dependencies.clock.now();
      const tally = await dependencies.stores.tasks.tally(
        transaction,
        command.onboardingId,
        civilDateOf(now),
      );
      const onboarding = Onboarding.rehydrate(state);
      const completed = onboarding.complete(tally, currentActor(), originOfCurrentRequest(), now);

      if (!completed.ok) return refusedBy(completed.error);

      await dependencies.stores.onboardings.update(
        transaction,
        onboarding.snapshot(),
        command.expectedVersion,
      );
      transaction.collect(onboarding.pullEvents());
      return success({ onboardingId: onboarding.id, state: onboarding.state });
    }),
});

export interface CancelOnboardingCommand extends Command {
  readonly commandName: 'onboarding.cancel-onboarding';
  readonly onboardingId: string;
  /** A tenant or country-pack code: withdrawn, no-show, ended before completion, superseded. */
  readonly reasonCode: string;
  readonly expectedVersion: number;
}

/**
 * Cancels the onboarding and every task still open on it.
 *
 * Nothing is deleted, and **no employment is ended**. A withdrawn hire and a no-show are employment
 * facts; ending an employment is Employment's operation and the exit process is Offboarding's. What
 * this records is that this onboarding will not finish, and why.
 */
export const cancelOnboardingHandler = (
  dependencies: OnboardingDependencies,
): CommandHandler<CancelOnboardingCommand, OnboardingAffected> => ({
  commandName: 'onboarding.cancel-onboarding',
  permission: OnboardingPermissions.cancel,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const state = await dependencies.stores.onboardings.byId(transaction, command.onboardingId);

      if (state === undefined) return notFound<OnboardingAffected>('onboarding');

      const now = dependencies.clock.now();
      const onboarding = Onboarding.rehydrate(state);
      const cancelled = onboarding.cancel(
        command.reasonCode,
        currentActor(),
        originOfCurrentRequest(),
        now,
      );

      if (!cancelled.ok) return refusedBy(cancelled.error);

      await dependencies.stores.onboardings.update(
        transaction,
        onboarding.snapshot(),
        command.expectedVersion,
      );
      transaction.collect(onboarding.pullEvents());
      await cancelOpenTasks(transaction, dependencies, command.onboardingId);
      return success({ onboardingId: onboarding.id, state: onboarding.state });
    }),
});

/** Everything unfinished goes with the onboarding. Concluded tasks keep the record of what happened. */
const cancelOpenTasks = async (
  transaction: Transaction,
  dependencies: OnboardingDependencies,
  onboardingId: string,
): Promise<void> => {
  const tasks = await dependencies.stores.tasks.forOnboarding(transaction, onboardingId);
  const now = dependencies.clock.now();

  for (const state of tasks) {
    const task = Task.rehydrate(state);

    if (!task.cancel(originOfCurrentRequest(), now).ok) continue;
    if (task.status !== 'cancelled') continue;

    await dependencies.stores.tasks.update(transaction, task.snapshot(), state.version);
  }
};

/**
 * Load, act, persist — the shape every lifecycle command shares.
 *
 * Written once because it precedes all of them, and a version check that has to be remembered in
 * four handlers is a check that will be missing from one.
 */
const withOnboarding = async (
  transaction: Transaction,
  dependencies: OnboardingDependencies,
  command: { readonly onboardingId: string; readonly expectedVersion: number },
  act: (onboarding: Onboarding, now: Date) => ReturnType<Onboarding['beginOnboarding']>,
): Promise<Result<OnboardingAffected, HandlerFailure>> => {
  const state = await dependencies.stores.onboardings.byId(transaction, command.onboardingId);

  if (state === undefined) return notFound<OnboardingAffected>('onboarding');

  const onboarding = Onboarding.rehydrate(state);
  const acted = act(onboarding, dependencies.clock.now());

  if (!acted.ok) return refusedBy(acted.error);

  await dependencies.stores.onboardings.update(
    transaction,
    onboarding.snapshot(),
    command.expectedVersion,
  );
  transaction.collect(onboarding.pullEvents());
  return success({ onboardingId: onboarding.id, state: onboarding.state });
};
