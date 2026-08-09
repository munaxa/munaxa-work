import {
  employmentModule,
  postgresEmploymentStores,
  systemClock,
  type CommandSender,
  type EmployablePerson,
  type OrganizationDirectoryPort,
  type PersonDirectoryPort,
} from '@work/employment';
import {
  type Command,
  type Dispatcher,
  type HandlerFailure,
  type Query,
  type Result,
  type UnitOfWork,
  type WorkModule,
} from '@work/kernel';

/**
 * Employment's composition, kept out of its Nest module on purpose — the same split Organization
 * and People use, for the same reason: the identity module's composition registers Employment on
 * the shared registry, while Employment's Nest module imports the identity module to reach the
 * dispatcher it built. Put both in one file and those two facts are a cycle. This file imports
 * neither.
 *
 * **This is where Employment's two cross-module dependencies are satisfied**, and how they are
 * satisfied is the load-bearing decision of the phase's wiring.
 *
 * Employment must check that a person exists and has not been merged, and that an organizational
 * unit is real. It may not read `people`'s or `organization`'s tables to find out — a module
 * reaches another through its **published application service**, never its repositories. So both
 * ports are implemented here, on top of the *same dispatcher* every request uses, and the queries
 * they send are the ones those modules publish.
 *
 * The consequence is deliberate and worth stating: creating an employment requires the caller to
 * hold `people.person.read`, and placing one requires `organization.hierarchy.read`. That is not a
 * leak of one module's permissions into another — it is the honest composition. Attaching somebody
 * to a person you may not see, or to a department you may not see, is not an operation this product
 * should offer.
 */

/**
 * A sender handed its dispatcher after the dispatcher exists.
 *
 * Bulk import sends the same commands an administrator would, and the dispatcher that receives them
 * is assembled from a handler list that includes import — a genuine cycle. Rather than break it by
 * letting import write rows directly (which would bypass every invariant it exists to enforce), the
 * seam is made explicit.
 *
 * It refuses rather than returning something wrong if used before attachment, so a wiring mistake
 * is an immediate, named failure instead of a silent no-op import.
 */
export class DeferredEmploymentSender implements CommandSender {
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
        'Employment was used before the dispatcher was attached. The composition root must call attach().',
      );
    }
    return this.dispatcher;
  }
}

/** The shape People's `people.read-person` query answers with. Only what Employment needs is read. */
interface PersonReadResult {
  readonly personId: string;
  readonly status: string;
  readonly mergedIntoPersonId?: string;
  readonly legalName?: Readonly<Record<string, string>>;
}

/**
 * People, reached through its published query.
 *
 * A person in another tenant, a person that does not exist, and a person the caller may not read
 * all answer the same way — `undefined` — and Employment turns all three into *not found*. That is
 * correct rather than lossy: telling a caller which of the three it was would disclose that an
 * identifier names a real human being in this system.
 */
export class PeopleDirectory implements PersonDirectoryPort {
  public constructor(private readonly sender: DeferredEmploymentSender) {}

  public async find(personId: string, asOf: Date): Promise<EmployablePerson | undefined> {
    const result = await this.sender.ask<PersonReadResult, Query>({
      queryName: 'people.read-person',
      personId,
      asOf,
    } as Query);

    if (!result.ok) return undefined;

    const person = result.value;

    return {
      personId: person.personId,
      status: person.status,
      ...(person.mergedIntoPersonId === undefined
        ? {}
        : { mergedIntoPersonId: person.mergedIntoPersonId }),
      ...(person.legalName === undefined ? {} : { legalName: person.legalName }),
    };
  }
}

/**
 * Organization, reached through its published query.
 *
 * `organization.unit-ancestry` answers not-found for a unit that does not exist in the caller's
 * tenant, which is exactly the question being asked. There is deliberately **no position or
 * cost-centre check**: Organization publishes no single-entity read for either — `list-positions`
 * is paged and filtered, and centres have no query at all — and Employment neither reaches into its
 * tables nor adds an index to its schema to compensate. Those references rest on row-level
 * security, and the missing reads are recorded as a gap rather than worked around (ADR-0042).
 */
export class OrganizationDirectory implements OrganizationDirectoryPort {
  public constructor(private readonly sender: DeferredEmploymentSender) {}

  public async unitExists(unitId: string, asOf: Date): Promise<boolean> {
    const result = await this.sender.ask<unknown, Query>({
      queryName: 'organization.unit-ancestry',
      unitId,
      asOf,
    } as Query);

    return result.ok;
  }
}

/** Everything Employment needs, assembled. Registered by the identity module's composition. */
export const employmentModuleFor = (
  unitOfWork: UnitOfWork,
  sender: DeferredEmploymentSender,
): WorkModule =>
  employmentModule(
    {
      unitOfWork,
      stores: postgresEmploymentStores(),
      people: new PeopleDirectory(sender),
      organization: new OrganizationDirectory(sender),
      clock: systemClock,
    },
    sender,
  );
