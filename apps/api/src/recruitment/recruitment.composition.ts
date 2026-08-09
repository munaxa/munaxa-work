import {
  postgresRecruitmentStores,
  recruitmentModule,
  systemClock,
  type CommandSender,
  type CreateEmploymentForHire,
  type CreatePersonForHire,
  type EmploymentDirectoryPort,
  type MatchedPerson,
  type OrganizationDirectoryPort,
  type PeopleDirectoryPort,
} from '@work/recruitment';
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
 * Recruitment's composition — and the place the phase's load-bearing authorization decision is made.
 *
 * Recruitment depends on People, Organization and Employment, and reaches all three through their
 * **published application services**, never their repositories. Phase 5 satisfied the same kind of
 * dependency by inheriting the other module's permission check, which made creating an employment
 * require `people.person.read` on the caller. That is honest for a read the *user* is really making,
 * and wrong for one the module makes on their behalf: a recruiter naming a position must not thereby
 * become somebody who may browse the organization chart, and a recruiter hiring somebody must not
 * hold permission to edit the master registry of human identity (A-1).
 *
 * So each adapter here runs its one call inside a **bounded service grant** (ADR-0043). The grant:
 *
 * - is entered *inside* a handler the pipeline has already authorized for the recruitment operation,
 *   so the user is still checked for what they asked to do;
 * - permits an **explicit list** of permissions — never a wildcard, never a prefix;
 * - **cannot nest**, so authority is not accumulated by composition;
 * - leaves the tenant, the actor and the correlation identifier untouched, so every audit column and
 *   every event still names the human being who asked;
 * - is **observable**: every elevation is logged with the operation that caused it.
 *
 * Nothing here is a second authorization framework. `GrantAwarePermissionChecker` decorates the one
 * Platform checker the pipeline already uses, and adds nothing at all when no grant is open.
 */

/**
 * A sender handed its dispatcher after the dispatcher exists.
 *
 * Candidate import sends the same commands a recruiter would, and the dispatcher that receives them
 * is assembled from a handler list that includes import — a genuine cycle. Rather than break it by
 * letting import write rows directly (which would bypass every invariant it exists to enforce), the
 * seam is made explicit. It refuses rather than returning something wrong if used before attachment.
 */
export class DeferredRecruitmentSender implements CommandSender {
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
        'Recruitment was used before the dispatcher was attached. The composition root must call attach().',
      );
    }
    return this.dispatcher;
  }
}

/** The permissions each grant permits — listed, so a reviewer can see the whole surface at once. */
const PEOPLE_READ = 'people.person.read';
const PEOPLE_MANAGE = 'people.person.manage';
const PEOPLE_CONTACT_MANAGE = 'people.contact.manage';
/** A match list is a suggestion for a human, so it is bounded at what a human will read. */
const MAX_MATCHES = 10;
const ORGANIZATION_READ = 'organization.hierarchy.read';
const EMPLOYMENT_READ = 'employment.employment.read';
const EMPLOYMENT_MANAGE = 'employment.employment.manage';

interface PersonReadResult {
  readonly personId: string;
  readonly status: string;
  readonly mergedIntoPersonId?: string;
  readonly legalName?: Readonly<Record<string, string>>;
}

interface PersonSearchResult {
  readonly items: readonly PersonReadResult[];
}

/**
 * People, reached through its published queries and its published create command.
 *
 * Matching returns *candidates for a human decision* and links nothing. Creating a Person happens
 * once, at hire, through People's own application service — Recruitment writes no row in `person`
 * and duplicates none of People's matching or identity-document protection (A-2).
 */
export class PeopleDirectory implements PeopleDirectoryPort {
  public constructor(private readonly sender: DeferredRecruitmentSender) {}

  public async findByContact(
    email: string,
    phone: string | undefined,
  ): Promise<readonly MatchedPerson[]> {
    // Both contact points, because either can be the one that matches — and de-duplicated by
    // identifier, so somebody whose address *and* telephone number are on file is one suggestion
    // rather than two. More than one distinct match is refused upstream rather than guessed.
    const byEmail = await this.searchByContact('email', email);
    const byPhone = phone === undefined ? [] : await this.searchByContact('mobile', phone);
    const found = new Map<string, MatchedPerson>();

    for (const person of [...byEmail, ...byPhone]) found.set(person.personId, person);
    return [...found.values()];
  }

  private async searchByContact(
    contactChannel: 'email' | 'mobile',
    contactValue: string,
  ): Promise<readonly MatchedPerson[]> {
    const result = await runWithServiceGrant(
      {
        module: 'recruitment',
        operation: 'recruitment.match-candidate',
        permits: [PEOPLE_READ],
        reason: 'suggesting people a candidate might already be',
      },
      () =>
        this.sender.ask<PersonSearchResult, Query>({
          // People normalizes a contact value before comparing it, exactly as this module does, so
          // one address means one address in both.
          queryName: 'people.search',
          contactValue,
          contactChannel,
          size: MAX_MATCHES,
        } as Query),
    );

    return result.ok ? result.value.items.map(matchedPerson) : [];
  }

  public async find(personId: string): Promise<MatchedPerson | undefined> {
    const result = await runWithServiceGrant(
      {
        module: 'recruitment',
        operation: 'recruitment.link-candidate-to-person',
        permits: [PEOPLE_READ],
        reason: 'confirming a person a recruiter named exists and was not merged away',
      },
      () =>
        this.sender.ask<PersonReadResult, Query>({
          queryName: 'people.read-person',
          personId,
        } as Query),
    );

    return result.ok ? matchedPerson(result.value) : undefined;
  }

  /**
   * Registers the Person a hired candidate turned out to be, then records how to reach them.
   *
   * **Duplicates are not acknowledged away.** People runs its own detection on the name, and this
   * deliberately does not pass `acknowledgedDuplicates`: if People thinks this might be somebody it
   * already holds, the hire stops with a resumable state and a recruiter links the right Person
   * explicitly. Suppressing that check from inside another module would defeat the protection People
   * exists to provide.
   *
   * The contact point is a second command because that is how People models it. A failure to record
   * it does **not** fail the hire — the Person exists and the employment can proceed — and it is
   * reported by the same result the caller sees.
   */
  public async create(request: CreatePersonForHire): Promise<MatchedPerson> {
    const created = await runWithServiceGrant(
      {
        module: 'recruitment',
        operation: 'recruitment.hire-candidate',
        permits: [PEOPLE_MANAGE, PEOPLE_READ, PEOPLE_CONTACT_MANAGE],
        reason: 'registering the person a hired candidate turned out to be',
      },
      async () => {
        const person = await this.sender.send<{ personId: string }, Command>({
          commandName: 'people.create-person',
          personNumber: request.personNumber,
          legalName: request.legalName,
        } as Command);

        if (!person.ok) return person;

        await this.sender.send<unknown, Command>({
          commandName: 'people.record-contact',
          personId: person.value.personId,
          channel: 'email',
          purpose: 'personal',
          value: request.email,
          isPrimary: true,
          effectiveFrom: new Date(),
        } as Command);
        return person;
      },
    );

    if (!created.ok) {
      // The saga treats a throw here as the person step failing, which leaves a resumable state
      // rather than an application that reads hired with nobody behind it.
      throw new Error(`People refused the create: ${JSON.stringify(created.error)}`);
    }
    return { personId: created.value.personId, status: 'active' };
  }
}

const matchedPerson = (person: PersonReadResult): MatchedPerson => ({
  personId: person.personId,
  status: person.status,
  ...(person.mergedIntoPersonId === undefined
    ? {}
    : { mergedIntoPersonId: person.mergedIntoPersonId }),
  ...(person.legalName === undefined ? {} : { legalName: person.legalName }),
});

/**
 * Organization, asked one question: does this unit exist in this tenant.
 *
 * Existence only — a boolean, never data. The recruiter naming a unit on a requisition does not
 * thereby become somebody who may browse the organization chart, which is the whole point of A-1.
 */
export class OrganizationDirectory implements OrganizationDirectoryPort {
  public constructor(private readonly sender: DeferredRecruitmentSender) {}

  public async unitExists(unitId: string): Promise<boolean> {
    const result = await runWithServiceGrant(
      {
        module: 'recruitment',
        operation: 'recruitment.create-requisition',
        permits: [ORGANIZATION_READ],
        reason: 'confirming a unit named on a requisition is real',
      },
      () =>
        this.sender.ask<unknown, Query>({
          queryName: 'organization.unit-ancestry',
          unitId,
          asOf: new Date(),
        } as Query),
    );

    return result.ok;
  }
}

/**
 * Employment: whether an employment is real in this tenant, and the one cross-module **write** this
 * module makes.
 *
 * `create` sends the command an administrator would send. Recruitment duplicates none of
 * Employment's logic — the number generation, the one-open-employment-per-person rule, the contract
 * and the status history are all Employment's, and stay Employment's (AD-003, ADR-0046).
 */
export class EmploymentDirectory implements EmploymentDirectoryPort {
  public constructor(private readonly sender: DeferredRecruitmentSender) {}

  public async exists(employmentId: string): Promise<boolean> {
    const result = await runWithServiceGrant(
      {
        module: 'recruitment',
        operation: 'recruitment.schedule-interview',
        permits: [EMPLOYMENT_READ],
        reason: 'confirming an interviewer is an employment in this tenant',
      },
      () =>
        this.sender.ask<unknown, Query>({
          queryName: 'employment.read-employment',
          employmentId,
        } as Query),
    );

    return result.ok;
  }

  public async create(
    request: CreateEmploymentForHire,
  ): Promise<{ readonly employmentId: string }> {
    const result = await runWithServiceGrant(
      {
        module: 'recruitment',
        operation: 'recruitment.hire-candidate',
        permits: [EMPLOYMENT_MANAGE, PEOPLE_READ],
        reason: 'creating the employment a hired candidate begins',
      },
      () =>
        this.sender.send<{ employmentId: string }, Command>({
          commandName: 'employment.create-employment',
          personId: request.personId,
          employmentTypeCode: request.employmentTypeCode,
          startDate: request.startDate,
        } as Command),
    );

    if (!result.ok) {
      throw new Error(`Employment refused the create: ${JSON.stringify(result.error)}`);
    }
    return { employmentId: result.value.employmentId };
  }
}

/** Everything Recruitment needs, assembled. Registered by the identity module's composition. */
export const recruitmentModuleFor = (
  unitOfWork: UnitOfWork,
  sender: DeferredRecruitmentSender,
): WorkModule =>
  recruitmentModule(
    {
      unitOfWork,
      stores: postgresRecruitmentStores(),
      people: new PeopleDirectory(sender),
      organization: new OrganizationDirectory(sender),
      employment: new EmploymentDirectory(sender),
      clock: systemClock,
    },
    sender,
  );
