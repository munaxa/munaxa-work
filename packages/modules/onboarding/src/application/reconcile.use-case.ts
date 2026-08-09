import {
  success,
  type Command,
  type CommandHandler,
  type HandlerFailure,
  type Query,
  type QueryHandler,
  type Result,
  type Transaction,
} from '@work/kernel';

import { notFound } from './onboarding-context.js';
import { OnboardingPermissions } from './onboarding-permissions.js';
import type { CommandSender } from './transfer.use-case.js';
import type { EmploymentForOnboarding } from './onboarding-ports.js';
import type { StartOnboardingCommand, OnboardingStarted } from './start.use-case.js';
import type { OnboardingDependencies } from './onboarding-dependencies.js';

/**
 * Reconciliation: the mechanism that makes onboarding reliable without a durable event bus.
 *
 * **Why it exists.** Event delivery here is in-process, post-commit and at-most-once: a hire event
 * whose handler fails is gone once the hire has committed. If onboarding depended on that event, a
 * joiner would silently have no checklist and nobody would learn until their first morning. So the
 * event is an accelerator and *this* is the guarantee (ADR-0050).
 *
 * **What it does.** Asks Employment — the authoritative source — for a bounded page of live
 * employments, removes the ones that already have an onboarding, and sends the ordinary
 * `start-onboarding` command for the rest. That is all. It has no state of its own, no cursor and
 * no schedule: no job infrastructure is introduced in this phase.
 *
 * **Why it is safe to rerun.** It creates nothing directly. Every creation goes through the
 * idempotent start command, which is protected by a read *and* a partial unique index — so a second
 * run over the same employments reports them as already started rather than duplicating them.
 *
 * The query half is the same mechanism without the writes: "which hires are waiting for an
 * onboarding", answerable on a screen and safe for anybody who may read onboardings.
 */

const DEFAULT_SCAN = 100;
const MAX_SCAN = 500;

export interface AwaitingOnboarding extends Query {
  readonly queryName: 'onboarding.awaiting-onboarding';
  readonly limit?: number;
}

export interface AwaitingOnboardingView {
  readonly scanned: number;
  readonly employments: readonly {
    readonly employmentId: string;
    readonly personId: string;
    readonly startDate: string;
    readonly status: string;
  }[];
}

export const awaitingOnboardingHandler = (
  dependencies: OnboardingDependencies,
): QueryHandler<AwaitingOnboarding, AwaitingOnboardingView> => ({
  queryName: 'onboarding.awaiting-onboarding',
  permission: OnboardingPermissions.read,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const found = await awaiting(transaction, dependencies, boundedScan(query.limit));

      return success({
        scanned: found.scanned,
        employments: found.employments.map((employment) => ({
          employmentId: employment.employmentId,
          personId: employment.personId,
          startDate: employment.startDate,
          status: employment.status,
        })),
      });
    }),
});

export interface ReconcileOnboardingCommand extends Command {
  readonly commandName: 'onboarding.reconcile';
  /** Applied to every onboarding this run starts. Omitted, they start with no tasks. */
  readonly planId?: string;
  readonly limit?: number;
}

export interface ReconciliationOutcome {
  readonly scanned: number;
  readonly started: number;
  /** Employments that already had an onboarding by the time the start command ran. */
  readonly alreadyStarted: number;
  readonly failures: readonly { readonly employmentId: string; readonly reason: string }[];
}

/**
 * Starts an onboarding for every eligible employment that has none.
 *
 * It sends the **same command** an administrator would, through the same dispatcher, rather than
 * writing rows: every rule the start enforces — the employment is real and not ended, the person is
 * not merged away, one live onboarding per employment — applies to a reconciliation run exactly as
 * it applies to one click. A reconciliation that wrote directly would be the one path in the product
 * where those rules did not hold, and it would be the path that ran unattended.
 */
export const reconcileOnboardingHandler = (
  dependencies: OnboardingDependencies,
  sender: CommandSender,
): CommandHandler<ReconcileOnboardingCommand, ReconciliationOutcome> => ({
  commandName: 'onboarding.reconcile',
  permission: OnboardingPermissions.start,

  handle: async (command) => {
    const found = await dependencies.unitOfWork.execute((transaction) =>
      awaiting(transaction, dependencies, boundedScan(command.limit)),
    );
    const failures: { employmentId: string; reason: string }[] = [];
    let started = 0;
    let alreadyStarted = 0;

    for (const employment of found.employments) {
      // Sequentially, deliberately. Two concurrent starts for *different* employments would be
      // safe, but a bounded run that hammers the dispatcher is a run somebody notices in production
      // for the wrong reason — and the page is a hundred rows, not a hundred thousand.
      const result = await sender.send<OnboardingStarted, StartOnboardingCommand>({
        commandName: 'onboarding.start-onboarding',
        employmentId: employment.employmentId,
        ...(command.planId === undefined ? {} : { planId: command.planId }),
      });

      if (!result.ok) {
        failures.push({ employmentId: employment.employmentId, reason: reasonOf(result.error) });
        continue;
      }
      if (result.value.alreadyExisted) alreadyStarted += 1;
      else started += 1;
    }
    return success({ scanned: found.scanned, started, alreadyStarted, failures });
  },
});

/**
 * The employments that need an onboarding and do not have one.
 *
 * Two reads and a set difference: Employment's bounded page of live employments, and this module's
 * answer to "which of these do I already know about". Deterministic, tenant-scoped by both sides,
 * and it writes nothing.
 */
const awaiting = async (
  transaction: Transaction,
  dependencies: OnboardingDependencies,
  limit: number,
): Promise<{ scanned: number; employments: readonly EmploymentForOnboarding[] }> => {
  const employments = await dependencies.employment.liveEmployments(limit);

  if (employments.length === 0) return { scanned: 0, employments: [] };

  const known = new Set(
    await dependencies.stores.onboardings.employmentsWithAny(
      transaction,
      employments.map((employment) => employment.employmentId),
    ),
  );

  return {
    scanned: employments.length,
    employments: employments.filter((employment) => !known.has(employment.employmentId)),
  };
};

const boundedScan = (limit: number | undefined): number =>
  Math.min(MAX_SCAN, Math.max(1, limit ?? DEFAULT_SCAN));

/** A failure's reason, as something safe to put in a log an administrator reads. */
const reasonOf = (failure: HandlerFailure): string => {
  switch (failure.kind) {
    case 'validation':
      return failure.failures.map((entry) => entry.field).join(', ');
    case 'forbidden':
      return failure.permission;
    case 'not_found':
      return `missing ${failure.resource}`;
    case 'conflict':
      return failure.reason;
    case 'rejected':
      return failure.reason;
  }
};

/** Kept so the module's other reads can reuse the not-found shape without importing the context. */
export const onboardingNotFound = <TValue>(): Result<TValue, HandlerFailure> =>
  notFound<TValue>('onboarding');
