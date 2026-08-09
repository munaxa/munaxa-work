import {
  success,
  type Command,
  type CommandHandler,
  type HandlerFailure,
  type Result,
  type Transaction,
} from '@work/kernel';

import { Onboarding } from '../domain/onboarding.js';
import type { Metadata } from '../domain/onboarding-aggregate.js';
import type { OnboardingInstanceState } from '../domain/onboarding-state.js';
import type { TaskTemplateState } from '../domain/plan-version.js';

import {
  conflicted,
  currentTenant,
  notFound,
  originOfCurrentRequest,
  refusedBy,
} from './onboarding-context.js';
import { OnboardingPermissions } from './onboarding-permissions.js';
import { generateTasks } from './task-generation.js';
import type { EmploymentForOnboarding } from './onboarding-ports.js';
import type { OnboardingDependencies } from './onboarding-dependencies.js';

/**
 * Starting an onboarding: the one entry point, and the one that must be safe to send twice.
 *
 * **A command, not an event.** Event delivery in this repository is in-process, post-commit and
 * at-most-once with no outbox: a handler that fails loses its event after the write is durable.
 * Nothing that must happen may depend on one. So the authoritative mechanism is this command; the
 * hire event, where it can be consumed at all, is an accelerator that changes when this runs and
 * never whether it must (ADR-0050).
 *
 * **Idempotent on the employment.** Two properties together, and neither alone is enough:
 *
 * 1. A read of the live onboarding for the employment, which turns the ordinary repeat — a retried
 *    request, reconciliation running twice — into a *successful* answer naming the instance that
 *    already exists.
 * 2. A **partial unique index** on `(tenant_id, employment_id)` where the state is live, which turns
 *    the race — two concurrent starts, neither seeing the other's uncommitted row — into one winner
 *    and one caller who re-reads and gets the winner's instance.
 *
 * The read alone would let a race through; the index alone would answer a legitimate retry with a
 * constraint violation the caller cannot act on. Together they converge deterministically.
 *
 * **Onboarding creates no Person and no Employment.** Recruitment's hire saga created both, through
 * People's and Employment's own application services (ADR-0046). This reads the employment to
 * confirm it is real in this tenant and to take its start date; it writes nothing outside its own
 * module, and the instance's foreign keys would refuse a row pointing at anything it invented.
 */

export interface StartOnboardingCommand extends Command {
  readonly commandName: 'onboarding.start-onboarding';
  readonly employmentId: string;
  /** Optional: an onboarding may be started with no plan and have one applied afterwards. */
  readonly planId?: string;
  /** Defaults to the employment's start date. */
  readonly plannedStartOn?: string;
  /** Recruitment's application, when the hire came from one. */
  readonly applicationId?: string;
  readonly metadata?: Metadata;
}

export interface OnboardingStarted {
  readonly onboardingId: string;
  readonly employmentId: string;
  readonly state: string;
  /** False when this request created it; true when an earlier one had. Both are successes. */
  readonly alreadyExisted: boolean;
  readonly tasksCreated: number;
}

export const startOnboardingHandler = (
  dependencies: OnboardingDependencies,
): CommandHandler<StartOnboardingCommand, OnboardingStarted> => ({
  commandName: 'onboarding.start-onboarding',
  permission: OnboardingPermissions.start,

  handle: async (command) => {
    const started = await dependencies.unitOfWork.execute((transaction) =>
      startOnce(transaction, dependencies, command),
    );

    if (started.ok || started.error.kind !== 'conflict') return started;
    if (started.error.reason !== 'onboarding_race_lost') return started;

    // The race: another request committed its instance between this one's read and its insert, and
    // the partial unique index refused the second row. Re-reading converges on the winner, which is
    // exactly the answer this caller wanted.
    return dependencies.unitOfWork.execute((transaction) =>
      readExisting(transaction, dependencies, command.employmentId),
    );
  },
});

const startOnce = async (
  transaction: Transaction,
  dependencies: OnboardingDependencies,
  command: StartOnboardingCommand,
): Promise<Result<OnboardingStarted, HandlerFailure>> => {
  const existing = await dependencies.stores.onboardings.liveForEmployment(
    transaction,
    command.employmentId,
  );

  // The ordinary repeat: a retried request, or reconciliation running a second time. It is a
  // success naming the instance that exists, not a conflict the caller has to interpret.
  if (existing !== undefined) return success(alreadyStarted(existing));

  const eligible = await eligibleEmployment(dependencies, command.employmentId);

  if (!eligible.ok) return eligible;

  const employment = eligible.value;
  const onboarding = Onboarding.start(
    {
      tenantId: currentTenant(),
      employmentId: command.employmentId,
      personId: employment.personId,
      ...(command.applicationId === undefined ? {} : { applicationId: command.applicationId }),
      plannedStartOn: command.plannedStartOn ?? employment.startDate,
      employmentStartOn: employment.startDate,
      ...(command.metadata === undefined ? {} : { metadata: command.metadata }),
    },
    originOfCurrentRequest(),
    dependencies.clock.now(),
  );

  if (!onboarding.ok) return refusedBy(onboarding.error);

  const tasks = await applyPlanAndInsert(transaction, dependencies, {
    onboarding: onboarding.value,
    employment,
    ...(command.planId === undefined ? {} : { planId: command.planId }),
  });

  if (!tasks.ok) return tasks;

  transaction.collect(onboarding.value.pullEvents());
  return success({
    onboardingId: onboarding.value.id,
    employmentId: command.employmentId,
    state: onboarding.value.state,
    alreadyExisted: false,
    tasksCreated: tasks.value,
  });
};

/**
 * The employment this onboarding is for, if it may have one.
 *
 * Both reads run under a bounded service grant (ADR-0043): the caller is authorized for the
 * *onboarding* operation, and the module holds the narrow Employment and People reads these checks
 * need. Neither read writes anything, and neither could — the ports expose no `create`, and the
 * instance's foreign keys would refuse a row pointing at something this module invented.
 */
const eligibleEmployment = async (
  dependencies: OnboardingDependencies,
  employmentId: string,
): Promise<Result<EmploymentForOnboarding, HandlerFailure>> => {
  const employment = await dependencies.employment.find(employmentId);

  if (employment === undefined) return notFound<EmploymentForOnboarding>('employment');
  // An ended employment is not somebody joining. Onboarding one would produce a checklist for
  // a person who has already left.
  if (employment.status === 'ended') return conflicted('employment_ended');

  const person = await dependencies.people.find(employment.personId);

  if (person === undefined) return notFound<EmploymentForOnboarding>('person');
  if (person.mergedIntoPersonId !== undefined) return conflicted('person_merged');

  return success(employment);
};

/**
 * Writes the instance and, when a plan was named, its tasks.
 *
 * The insert is where the race is decided. A unique-violation from the partial index is translated
 * into one named conflict the handler recognises, rather than surfacing a driver error a caller
 * would have to parse.
 */
const applyPlanAndInsert = async (
  transaction: Transaction,
  dependencies: OnboardingDependencies,
  request: {
    readonly onboarding: Onboarding;
    readonly employment: EmploymentForOnboarding;
    readonly planId?: string;
  },
): Promise<Result<number, HandlerFailure>> => {
  const templates = await resolvePlan(transaction, dependencies, request.onboarding, request.planId);

  if (!templates.ok) return templates;

  try {
    await dependencies.stores.onboardings.insert(transaction, request.onboarding.snapshot());
  } catch (error) {
    if (isUniqueViolation(error)) return conflicted<number>('onboarding_race_lost');
    throw error;
  }

  const generated = await generateTasks(
    transaction,
    dependencies,
    request.onboarding.snapshot(),
    templates.value,
    request.employment,
  );

  return success(generated.created);
};

/** The plan's published version, and the templates to copy. Nothing, when no plan was named. */
const resolvePlan = async (
  transaction: Transaction,
  dependencies: OnboardingDependencies,
  onboarding: Onboarding,
  planId: string | undefined,
): Promise<Result<readonly TaskTemplateState[], HandlerFailure>> => {
  if (planId === undefined) return success([]);

  const plan = await dependencies.stores.plans.byId(transaction, planId);

  if (plan === undefined) return notFound<readonly TaskTemplateState[]>('plan');

  const version = await dependencies.stores.planVersions.publishedForPlan(transaction, planId);

  if (version === undefined) {
    return conflicted<readonly TaskTemplateState[]>(
      'plan_has_no_published_version',
    );
  }

  const recorded = onboarding.recordPlan(planId, version.id);

  if (!recorded.ok) {
    return refusedBy<readonly TaskTemplateState[]>(recorded.error);
  }
  return success(await dependencies.stores.templates.forVersion(transaction, version.id));
};

/** Re-reads after losing the race. If it is somehow gone, the caller is told rather than guessed at. */
const readExisting = async (
  transaction: Transaction,
  dependencies: OnboardingDependencies,
  employmentId: string,
): Promise<Result<OnboardingStarted, HandlerFailure>> => {
  const existing = await dependencies.stores.onboardings.liveForEmployment(
    transaction,
    employmentId,
  );

  if (existing === undefined) return conflicted<OnboardingStarted>('onboarding_race_lost');
  return success(alreadyStarted(existing));
};

const alreadyStarted = (state: OnboardingInstanceState): OnboardingStarted => ({
  onboardingId: state.id,
  employmentId: state.employmentId,
  state: state.state,
  alreadyExisted: true,
  tasksCreated: 0,
});

/**
 * A PostgreSQL unique violation, recognised without importing the driver.
 *
 * The application layer may not depend on `pg` — the lint layer enforces it, and the rule is right:
 * a use case that knew the driver would be a use case the in-memory stores could not exercise. What
 * it checks is the SQLSTATE every PostgreSQL client surfaces, and the in-memory store raises the
 * same shape so both paths take the same branch.
 */
const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { readonly code?: unknown }).code === '23505';
