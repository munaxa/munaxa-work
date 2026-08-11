import {
  compensationModule,
  postgresCompensationStores,
  systemClock,
  type EmploymentDirectoryPort,
  type EmploymentForCompensation,
  type GoverningEntity,
  type OrganizationDirectoryPort,
} from '@work/compensation';
import type { EmploymentSnapshot, EmploymentView } from '@work/employment';
import type { GoverningLegalEntity } from '@work/organization';
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
 * Compensation's composition, and the two adapters that are the whole of its cross-module surface.
 *
 * Compensation reaches Employment and Organization through their **published application
 * services**, never their repositories. Each call runs inside a **bounded service grant**
 * (ADR-0043), for the reason every phase since Phase 6 has established: an HR administrator
 * managing somebody's salary must not thereby become a reader of the employment register, nor of
 * the organizational structure. The user is checked for the *compensation* operation; the module
 * holds the narrow cross-domain read.
 *
 * Each grant here:
 *
 * - is entered *inside* a handler the pipeline has already authorized;
 * - permits an **explicit list** of permissions — never a wildcard, never a prefix;
 * - **cannot nest**, so authority is not accumulated by composition;
 * - leaves the tenant, the actor and the correlation identifier untouched, so every audit column
 *   and every event still names the human being who asked;
 * - is **observable**: every elevation is logged with the operation that caused it.
 *
 * **Neither adapter writes anything.** There is no `create` and no `update` on either, and no
 * method that could change an employment or an organizational unit. The dependency points one way,
 * and Payroll will later pull from Compensation the same way — through a published read.
 *
 * Note what is absent and stays absent: no `personId`, no employment status Compensation stores,
 * and nothing that reads Attendance or Leave. What a leave day or an overtime minute is worth is
 * Payroll's arithmetic, not this module's (ADR-0054, ADR-0060).
 */

/** The permissions the grants permit — two, listed, so a reviewer sees the whole surface at once. */
const EMPLOYMENT_READ = 'employment.employment.read';
const ORGANIZATION_READ = 'organization.legal-entity.read';

/** The page bound a bulk operation reads employments at. Bounded, because a run has to finish. */
const SCAN_PAGE = 200;

/**
 * The queries these adapters send, typed rather than asserted.
 *
 * Typed because the alternative — an object literal cast to bare `Query` — is what let the Phase 8
 * defect through: a civil-date string was passed where the contract takes an instant, and the
 * compiler could not see it because the cast had already discarded the shape.
 */
interface ReadEmploymentQuery extends Query {
  readonly queryName: 'employment.read-employment';
  readonly employmentId: string;
  readonly asOf?: Date;
}

interface SearchEmploymentsQuery extends Query {
  readonly queryName: 'employment.search';
  readonly status?: string;
  readonly size?: number;
}

interface EmploymentSearchResult {
  readonly items: readonly EmploymentView[];
}

interface GoverningLegalEntityQuery extends Query {
  readonly queryName: 'organization.governing-legal-entity';
  readonly unitId: string;
  readonly asOf?: Date;
}

/**
 * A civil date, as the instant Employment's and Organization's timelines are compared against.
 *
 * Compensation speaks civil dates — an effective date is a date on somebody's calendar, not an
 * instant. `employment.read-employment` takes an instant and compares it through
 * `DateRange.contains`, which calls `getTime()` on whatever it is given; a string reaching that
 * comparison throws. UTC midnight is not a guess: it is the conversion Employment's own edge
 * performs on a ten-character date.
 *
 * This is the Phase 8 defect's fix, applied here from the start rather than found later.
 */
const asOfInstant = (civilDate: string): Date => new Date(`${civilDate}T00:00:00.000Z`);

/**
 * The one capability both adapters need.
 *
 * Narrower than `Dispatcher` on purpose: an adapter that held the whole dispatcher could *send a
 * command*, and neither of these has any business writing anything.
 */
export interface Asking {
  ask<TResult>(query: Query): Promise<Result<TResult, HandlerFailure>>;
}

/** Employment, asked two questions and never told anything. */
export class CompensationEmploymentDirectory implements EmploymentDirectoryPort {
  public constructor(private readonly dispatcher: Asking) {}

  public async find(
    employmentId: string,
    asOf: string,
  ): Promise<EmploymentForCompensation | undefined> {
    const result = await runWithServiceGrant(
      {
        module: 'compensation',
        operation: 'compensation.assign-recurring',
        permits: [EMPLOYMENT_READ],
        reason:
          'confirming the employment a compensation record belongs to, as at its effective date',
      },
      () =>
        this.ask<EmploymentSnapshot, ReadEmploymentQuery>({
          queryName: 'employment.read-employment',
          employmentId,
          asOf: asOfInstant(asOf),
        }),
    );

    return result.ok ? fromSnapshot(result.value) : undefined;
  }

  public async activeEmployments(limit: number): Promise<readonly EmploymentForCompensation[]> {
    const result = await runWithServiceGrant(
      {
        module: 'compensation',
        operation: 'compensation.dashboard',
        permits: [EMPLOYMENT_READ],
        reason: 'listing the employments a bulk compensation operation covers',
      },
      () =>
        this.ask<EmploymentSearchResult, SearchEmploymentsQuery>({
          queryName: 'employment.search',
          status: 'active',
          size: Math.min(limit, SCAN_PAGE),
        }),
    );

    return result.ok ? result.value.items.map(forCompensation) : [];
  }

  private ask<TResult, TQuery extends Query>(
    query: TQuery,
  ): Promise<Result<TResult, HandlerFailure>> {
    return this.dispatcher.ask<TResult>(query);
  }
}

/**
 * Organization, asked one question: which legal entity governs this unit, and in which currency.
 *
 * **A failure answers `known: false`, and that is not "no legal entity".** It means Organization
 * could not be asked, and a caller relying on the entity currency is refused by name rather than
 * silently given one this module invented — which would price somebody in the wrong currency.
 */
export class CompensationOrganizationDirectory implements OrganizationDirectoryPort {
  public constructor(private readonly dispatcher: Asking) {}

  public async governingLegalEntity(unitId: string, asOf: string): Promise<GoverningEntity> {
    const result = await runWithServiceGrant(
      {
        module: 'compensation',
        operation: 'compensation.assign-recurring',
        permits: [ORGANIZATION_READ],
        reason: 'reading the legal entity whose country and currency govern a compensation record',
      },
      () =>
        this.ask<GoverningLegalEntity, GoverningLegalEntityQuery>({
          queryName: 'organization.governing-legal-entity',
          unitId,
          asOf: asOfInstant(asOf),
        }),
    );

    if (!result.ok) return { known: false };

    const entity = result.value.legalEntity;

    // Known, and possibly *none*: a unit above which no legal entity has been declared is a real
    // configuration, and it is a different answer from "Organization could not be asked".
    return {
      known: true,
      ...(entity === undefined
        ? { entity: undefined }
        : {
            entity: {
              legalEntityId: entity.id,
              countryCode: entity.countryCode,
              currencyCode: entity.currencyCode,
            },
          }),
    };
  }

  private ask<TResult, TQuery extends Query>(
    query: TQuery,
  ): Promise<Result<TResult, HandlerFailure>> {
    return this.dispatcher.ask<TResult>(query);
  }
}

/** One employment as Compensation needs it, from the view the search returns. */
const forCompensation = (employment: EmploymentView): EmploymentForCompensation => ({
  employmentId: employment.employmentId,
  status: employment.status,
  startDate: employment.startDate,
  ...(employment.endDate === undefined ? {} : { endDate: employment.endDate }),
  ...(employment.assignment?.unitId === undefined ? {} : { unitId: employment.assignment.unitId }),
  ...(employment.assignment?.positionId === undefined
    ? {}
    : { positionId: employment.assignment.positionId }),
  ...(employment.assignment?.costCenterId === undefined
    ? {}
    : { costCenterId: employment.assignment.costCenterId }),
});

/**
 * The snapshot, flattened to what Compensation may hold.
 *
 * **`statusOn` is preferred over the employment row's `status`**, and the difference is the whole
 * reason this adapter passes a date. The row answers "now"; `statusOn` is reconstructed from the
 * status history and answers "then". A raise effective in March is checked against March's status.
 */
const fromSnapshot = (snapshot: EmploymentSnapshot): EmploymentForCompensation => ({
  ...forCompensation(snapshot.employment),
  status: snapshot.statusOn ?? snapshot.employment.status,
});

/**
 * A dispatcher handed over after it exists.
 *
 * Compensation's handler list does not send Compensation commands, so there is no cycle in the
 * module itself — but its two adapters need the dispatcher that is assembled *from* that list. It
 * refuses rather than answering wrongly if used before attachment.
 */
export class DeferredCompensationDispatcher implements Asking {
  private dispatcher: Dispatcher | undefined;

  public attach(dispatcher: Dispatcher): void {
    this.dispatcher = dispatcher;
  }

  public ask<TResult>(query: Query): Promise<Result<TResult, HandlerFailure>> {
    return this.attached().ask<TResult>(query);
  }

  public send<TResult>(command: Command): Promise<Result<TResult, HandlerFailure>> {
    return this.attached().send<TResult>(command);
  }

  private attached(): Dispatcher {
    if (this.dispatcher === undefined) {
      throw new Error(
        'Compensation was used before the dispatcher was attached. The composition root must call attach().',
      );
    }
    return this.dispatcher;
  }
}

/** Everything Compensation needs, assembled. Registered by the identity module's composition. */
export const compensationModuleFor = (
  unitOfWork: UnitOfWork,
  dispatcher: DeferredCompensationDispatcher,
): WorkModule =>
  compensationModule({
    unitOfWork,
    stores: postgresCompensationStores(),
    employment: new CompensationEmploymentDirectory(dispatcher),
    organization: new CompensationOrganizationDirectory(dispatcher),
    clock: systemClock,
  });
