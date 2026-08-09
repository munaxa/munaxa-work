import {
  onboardingModule,
  postgresOnboardingStores,
  systemClock,
  type CommandSender,
  type EmploymentDirectoryPort,
  type EmploymentForOnboarding,
  type PeopleDirectoryPort,
  type PersonForOnboarding,
} from '@work/onboarding';
import {
  runWithServiceGrant,
  type Command,
  type Dispatcher,
  type HandlerFailure,
  type Query,
  type Result,
  type UnitOfWork,
  type WorkModule,
} from '@work/kernel';

/**
 * Onboarding's composition, and the two adapters that are the whole of its cross-module surface.
 *
 * Onboarding depends on Employment and People, and reaches both through their **published
 * application services**, never their repositories. Each adapter runs its one call inside a
 * **bounded service grant** (ADR-0043), for the reason Phase 6 established: an HR administrator
 * starting an onboarding must not thereby become somebody who may browse the employment register or
 * the person registry. The user is checked for the *onboarding* operation; the module holds the
 * narrow cross-domain read.
 *
 * Each grant here:
 *
 * - is entered *inside* a handler the pipeline has already authorized;
 * - permits an **explicit list** of permissions — never a wildcard, never a prefix;
 * - **cannot nest**, so authority is not accumulated by composition;
 * - leaves the tenant, the actor and the correlation identifier untouched, so every audit column and
 *   every event still names the human being who asked;
 * - is **observable**: every elevation is logged with the operation that caused it.
 *
 * Note what is absent, and stays absent. There is **no `create`** on either adapter. Recruitment's
 * hire creates the Person and the Employment (ADR-0046), and Onboarding could not create either if a
 * defect tried — the instance's foreign keys would refuse the row (ADR-0047). This file is where a
 * future contributor would be tempted to add one, so the absence is stated here rather than only in
 * the port.
 */

/**
 * A sender handed its dispatcher after the dispatcher exists.
 *
 * Reconciliation sends the same start command an administrator would, and the dispatcher that
 * receives it is assembled from a handler list that includes reconciliation — a genuine cycle.
 * Rather than break it by letting reconciliation write rows directly (which would bypass every
 * invariant it exists to enforce), the seam is made explicit. It refuses rather than returning
 * something wrong if used before attachment.
 */
export class DeferredOnboardingSender implements CommandSender {
  private dispatcher: Dispatcher | undefined;

  public attach(dispatcher: Dispatcher): void {
    this.dispatcher = dispatcher;
  }

  public send<TResult, TCommand extends Command>(
    command: TCommand,
  ): Promise<Result<TResult, HandlerFailure>> {
    return this.attached().send<TResult>(command);
  }

  public ask<TResult, TQuery extends Query>(
    query: TQuery,
  ): Promise<Result<TResult, HandlerFailure>> {
    return this.attached().ask<TResult>(query);
  }

  private attached(): Dispatcher {
    if (this.dispatcher === undefined) {
      throw new Error(
        'Onboarding was used before the dispatcher was attached. The composition root must call attach().',
      );
    }
    return this.dispatcher;
  }
}

/** The permissions each grant permits — listed, so a reviewer can see the whole surface at once. */
const EMPLOYMENT_READ = 'employment.employment.read';
const PEOPLE_READ = 'people.person.read';

/**
 * The scan bound reconciliation reads a page of employments at.
 *
 * Bounded rather than unbounded because a run has to finish: an operator calling this against a
 * hundred thousand employments needs a result, not a request that is still open when the next one
 * starts. A run that hits the bound is not a failure — it reports what it scanned, and the next run
 * continues from what still has no onboarding.
 */
const RECONCILIATION_PAGE = 200;

interface EmploymentReadResult {
  readonly employmentId: string;
  readonly personId: string;
  readonly status: string;
  readonly startDate: string;
  readonly managerEmploymentId?: string;
}

interface EmploymentSearchResult {
  readonly items: readonly EmploymentReadResult[];
}

interface PersonReadResult {
  readonly personId: string;
  readonly status: string;
  readonly mergedIntoPersonId?: string;
}

/**
 * Employment, asked two questions and never told anything.
 *
 * `find` confirms an employment is real in this tenant and reports the four facts an onboarding
 * needs: its person, its status, when it starts, and who manages it. `liveEmployments` is
 * reconciliation's authoritative half — Onboarding cannot join to Employment's tables, so it asks
 * Employment for a bounded page and removes the ones it already has an instance for.
 *
 * Both are reads. Neither writes, and there is no method here that could.
 */
export class EmploymentDirectory implements EmploymentDirectoryPort {
  public constructor(private readonly sender: DeferredOnboardingSender) {}

  public async find(employmentId: string): Promise<EmploymentForOnboarding | undefined> {
    const result = await runWithServiceGrant(
      {
        module: 'onboarding',
        operation: 'onboarding.start-onboarding',
        permits: [EMPLOYMENT_READ],
        reason: 'confirming the employment an onboarding is for, and reading its start date',
      },
      () =>
        this.sender.ask<EmploymentReadResult, Query>({
          queryName: 'employment.read-employment',
          employmentId,
        } as Query),
    );

    return result.ok ? forOnboarding(result.value) : undefined;
  }

  public async liveEmployments(limit: number): Promise<readonly EmploymentForOnboarding[]> {
    const result = await runWithServiceGrant(
      {
        module: 'onboarding',
        operation: 'onboarding.reconcile',
        permits: [EMPLOYMENT_READ],
        reason: 'finding employments that may be missing an onboarding',
      },
      () =>
        this.sender.ask<EmploymentSearchResult, Query>({
          // Active only. A draft employment is not somebody joining yet, and an ended one is not
          // somebody joining at all — starting an onboarding for either would produce a checklist
          // nobody should be working through.
          queryName: 'employment.search',
          status: 'active',
          size: Math.min(limit, RECONCILIATION_PAGE),
        } as Query),
    );

    return result.ok ? result.value.items.map(forOnboarding) : [];
  }
}

const forOnboarding = (employment: EmploymentReadResult): EmploymentForOnboarding => ({
  employmentId: employment.employmentId,
  personId: employment.personId,
  status: employment.status,
  startDate: employment.startDate,
  ...(employment.managerEmploymentId === undefined
    ? {}
    : { managerEmploymentId: employment.managerEmploymentId }),
});

/**
 * People, asked one question: is this person real in this tenant, and were they merged away.
 *
 * Existence and merge state only. Never a name, never a date of birth, never an identifier —
 * resolving an employment to a human being is People's read, behind People's permission. A task
 * queue shows an employment identifier for exactly that reason.
 */
export class PeopleDirectory implements PeopleDirectoryPort {
  public constructor(private readonly sender: DeferredOnboardingSender) {}

  public async find(personId: string): Promise<PersonForOnboarding | undefined> {
    const result = await runWithServiceGrant(
      {
        module: 'onboarding',
        operation: 'onboarding.start-onboarding',
        permits: [PEOPLE_READ],
        reason: 'confirming the person an onboarding is for was not merged away',
      },
      () =>
        this.sender.ask<PersonReadResult, Query>({
          queryName: 'people.read-person',
          personId,
        } as Query),
    );

    if (!result.ok) return undefined;
    return {
      personId: result.value.personId,
      status: result.value.status,
      ...(result.value.mergedIntoPersonId === undefined
        ? {}
        : { mergedIntoPersonId: result.value.mergedIntoPersonId }),
    };
  }
}

/** Everything Onboarding needs, assembled. Registered by the identity module's composition. */
export const onboardingModuleFor = (
  unitOfWork: UnitOfWork,
  sender: DeferredOnboardingSender,
): WorkModule =>
  onboardingModule(
    {
      unitOfWork,
      stores: postgresOnboardingStores(),
      employment: new EmploymentDirectory(sender),
      people: new PeopleDirectory(sender),
      clock: systemClock,
    },
    sender,
  );
