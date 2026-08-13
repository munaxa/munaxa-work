import {
  runWithServiceGrant,
  type HandlerFailure,
  type PagedResult,
  type Query,
  type Result,
} from '@work/kernel';
import type {
  EmploymentFacts,
  EmploymentPort,
  LearningPort,
  OrganizationPort,
  Workforce,
} from '@work/career';
import type { EmploymentView } from '@work/employment';
import type { PositionView } from '@work/organization';
import type { LearningHistoryView } from '@work/learning';

import type { Asking } from '../payroll/asking.js';

/**
 * Career's three cross-module adapters, and the whole of its outward surface.
 *
 * Every one reaches the owning module through its **published queries**, never its repositories, and
 * each call runs inside a **bounded service grant** (ADR-0043). Planning somebody's career must not
 * make the planner a reader of the employment register: the user is checked for the *career*
 * operation, and the module holds the narrow cross-domain read for the length of one call. Each
 * grant permits an **explicit list** of permissions — never a wildcard, never a prefix — cannot
 * nest, leaves the tenant, actor and correlation identifier untouched, and is logged.
 *
 * **Nothing here writes, and there is no shape in which one could.** Every method returns a boolean
 * or a read model. Career recommends and executes nothing (ADR-0072): no adapter moves anybody into
 * a position, changes a salary, or alters an employment, and the absence is structural rather than a
 * rule somebody has to remember.
 *
 * **There is no Performance adapter, deliberately.** Showing a nine-box band beside a nomination
 * needs a filtered, paged placement read; `performance.talent-matrix` is unpaged and cycle-wide, and
 * that contract change was not authorized (D-5). Consuming the existing query per nomination would
 * be an unbounded read at 100,000 employments. `NOT VERIFIED`.
 *
 * **There is no Documents adapter, deliberately.** Checkpoint 4 removed the port when the schema
 * turned out to have nowhere to persist an evidence identifier. An adapter that confirmed a document
 * and then discarded it would be validation theatre. `NOT VERIFIED`.
 *
 * **There is no People adapter and no `JobPort`.** A career plan carries an employment, and a screen
 * that wants a name asks People. Nothing here is scheduled: a succession review comes due because
 * somebody ran a query, and a mobility recommendation expires by being read against a day.
 *
 * **There is no notification adapter.** Career records no intent and claims no delivery, so there is
 * nothing here that a later screen could misread as "sent". `NOT VERIFIED`.
 */

const EMPLOYMENT_READ = 'employment.employment.read';
const POSITION_READ = 'organization.position.read';
const HIERARCHY_READ = 'organization.hierarchy.read';
const ASSIGNMENT_READ = 'learning.assignment.read';
const ASSIGNMENT_READ_ALL = 'learning.assignment.read-all';

/**
 * The dispatcher's `ask`, with the query's own shape kept.
 *
 * `Dispatcher.ask` takes a bare `Query`, so a literal passed to it directly loses everything the
 * interfaces below declare. Threading the query type through one helper keeps the compiler checking
 * what is sent — which is exactly what the Phase 8 adapter defects needed and did not have: a civil
 * date passed as a string where a `Date` was expected.
 */
const asking = <TResult, TQuery extends Query>(
  dispatcher: Asking,
  query: TQuery,
): Promise<Result<TResult, HandlerFailure>> => dispatcher.ask<TResult>(query);

interface ReadEmploymentQuery extends Query {
  readonly queryName: 'employment.read-employment';
  readonly employmentId: string;
  /** A `Date`, because that is what the contract declares. Never a `YYYY-MM-DD` string. */
  readonly asOf?: Date;
}

interface SearchEmploymentsQuery extends Query {
  readonly queryName: 'employment.search';
  readonly status?: string;
  readonly positionId?: string;
  readonly asOf?: Date;
  readonly page?: number;
  readonly size?: number;
}

interface ListPositionsQuery extends Query {
  readonly queryName: 'organization.list-positions';
  /** The exact-identifier filter added for this phase. Bounded, and never an enumeration. */
  readonly positionId?: string;
  readonly page?: number;
  readonly size?: number;
}

interface UnitAncestryQuery extends Query {
  readonly queryName: 'organization.unit-ancestry';
  readonly unitId: string;
}

interface ReadLearningHistoryQuery extends Query {
  readonly queryName: 'learning.read-history';
  readonly employmentId: string;
  readonly size?: number;
}

/**
 * A uuid, by shape.
 *
 * Every identifier below reaches a `uuid` column, and PostgreSQL raises rather than returning
 * nothing when handed a string that is not one. A command field is a caller's string, so the
 * adapter answers the question it was asked — "does this identifier name a row" — with `false` for
 * anything that could never name one, instead of letting a cast error surface as a server fault.
 *
 * Deliberately a general uuid check rather than `isUuidV7`: Career's own identifiers are v7, but an
 * upstream row's need not be, and refusing a valid v4 position would be this adapter inventing a
 * constraint the owning module does not have.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What Career needs to know about an employment, mapped down from what Employment publishes.
 *
 * `EmploymentView` carries a great deal more — contract, probation, termination reason, manager.
 * **The adapter maps and discards rather than passing the view through**, so nothing downstream can
 * come to depend on a field Career has no business holding, and the port stays the narrow thing the
 * module declared. In particular `managerEmploymentId` is *not* mapped: Career has no team scope to
 * resolve and no principal to resolve it for (ADR-0032), and carrying it would invite exactly the
 * self-service shortcut the module refuses.
 */
const factsOf = (view: EmploymentView): EmploymentFacts => ({
  employmentId: view.employmentId,
  status: view.status,
  // "Active" means exactly the status Employment calls active, rather than "not obviously
  // finished": a draft or pending employment is not somebody to nominate as a successor.
  active: view.status === 'active',
  ...(view.assignment?.unitId === undefined ? {} : { organizationUnitId: view.assignment.unitId }),
  ...(view.assignment?.positionId === undefined ? {} : { positionId: view.assignment.positionId }),
});

/**
 * Employment, as Career reads it.
 *
 * **A failed read is `undefined`, never an empty result.** That distinction is the most important
 * line in this file. A nomination refused because Employment could not answer is a nomination
 * somebody retries; a nomination accepted because "nobody works here" would put an unactionable
 * name on a bench a succession review reads as covered. So the port distinguishes "nobody matched"
 * from "I could not ask", and every caller refuses on the second.
 *
 * **There is no `directReportsOf` here**, though `employment.search` would answer it. Career has no
 * routed team scope: without principal-to-employment resolution there is no way to know which
 * employment the caller *is*, and a `managerEmploymentId` from a request is a filter rather than a
 * credential. Declaring the method would imply a capability that resolves to nothing.
 */
export class CareerEmployment implements EmploymentPort {
  public constructor(private readonly dispatcher: Asking) {}

  public async factsFor(employmentId: string): Promise<EmploymentFacts | undefined> {
    if (!UUID.test(employmentId)) return undefined;

    const found = await runWithServiceGrant(
      {
        module: 'career',
        operation: 'read-employment',
        permits: [EMPLOYMENT_READ],
        reason: 'A career plan names an employment, and an unconfirmed one is refused.',
      },
      () =>
        asking<EmploymentView, ReadEmploymentQuery>(this.dispatcher, {
          queryName: 'employment.read-employment',
          employmentId,
        }),
    );

    return found.ok ? factsOf(found.value) : undefined;
  }

  /**
   * Who holds a position, as of a day.
   *
   * The civil date Career speaks becomes the `Date` Employment's contract declares, fixed at UTC
   * midnight of that day. The conversion happens **here, once, at the boundary** — which is the only
   * place it can happen without a `Date` leaking into Career, where every date is a civil string
   * (D-11).
   *
   * The bound is applied twice on purpose: `size` bounds what Employment returns, and the slice
   * bounds what this adapter passes on. Employment clamps `size` to its own maximum, which may be
   * smaller than a caller here asks for, and a caller assuming it had received everything would draw
   * a conclusion about a position from a fraction of the people in it.
   */
  public async inPosition(
    positionId: string,
    asOf: string,
    size: number,
    page: number,
  ): Promise<Workforce> {
    if (!UUID.test(positionId)) return [];

    const found = await runWithServiceGrant(
      {
        module: 'career',
        operation: 'read-position-employments',
        permits: [EMPLOYMENT_READ],
        reason: 'A succession plan shows who holds the position it plans for, on a stated day.',
      },
      () =>
        asking<PagedResult<EmploymentView>, SearchEmploymentsQuery>(this.dispatcher, {
          queryName: 'employment.search',
          status: 'active',
          positionId,
          asOf: new Date(`${asOf}T00:00:00.000Z`),
          page,
          size,
        }),
    );

    // `undefined` is "Employment could not answer". An empty array would say "nobody holds it",
    // which for a succession plan is a meaningful and completely different answer.
    return found.ok ? found.value.items.slice(0, size).map(factsOf) : undefined;
  }
}

/**
 * That an organization position or unit exists, and nothing else about either.
 *
 * **`positionExists` uses the exact-identifier filter added to `organization.list-positions` for
 * this phase**, with a page of one. That filter is why this adapter exists in the shape it does:
 * before it, the only way to confirm an identifier was to page the whole catalogue and search it in
 * Career, which is unbounded work over another module's data.
 *
 * **It confirms and does not discover.** The question is "does this identifier, which I already
 * hold, name a position in my tenant" — a strictly narrower result than the same caller could
 * already obtain with the same `organization.position.read` permission. There is no criticality here
 * and no way to ask for one: enumerating a tenant's critical positions remains `NOT VERIFIED` (D-4),
 * and no method on this class moves towards it.
 *
 * **The `PositionView` is discarded.** Only its existence is returned. Career stores a `position_id`
 * and no title, no grade and above all no `criticality` (AD-004) — and an adapter that returned the
 * view would be the first step towards a second, staler copy of all three.
 *
 * **A failure is `false`, and the caller refuses.** A succession plan recorded against a position
 * nobody confirmed is a plan for something that may not exist, and a review would read it as cover.
 */
export class CareerOrganization implements OrganizationPort {
  public constructor(private readonly dispatcher: Asking) {}

  public async positionExists(positionId: string): Promise<boolean> {
    if (!UUID.test(positionId)) return false;

    const found = await runWithServiceGrant(
      {
        module: 'career',
        operation: 'confirm-position',
        permits: [POSITION_READ],
        reason:
          'A succession plan, a career stage and a move all name a position; each is confirmed.',
      },
      () =>
        asking<PagedResult<PositionView>, ListPositionsQuery>(this.dispatcher, {
          queryName: 'organization.list-positions',
          positionId,
          page: 1,
          // One row answers the question. A larger page would fetch rows nobody asked about.
          size: 1,
        }),
    );

    return found.ok && found.value.items.length > 0;
  }

  /**
   * That a unit exists.
   *
   * `organization.unit-ancestry` is the narrowest published read that answers it with a handler: it
   * returns not-found for a unit that is not there. `organization.export-structure` would also
   * contain the answer, and reaching for it because it happens to is how a narrow read becomes a
   * broad grant nobody notices. Learning's adapter made the same choice for the same reason.
   */
  public async unitExists(organizationUnitId: string): Promise<boolean> {
    if (!UUID.test(organizationUnitId)) return false;

    const found = await runWithServiceGrant(
      {
        module: 'career',
        operation: 'confirm-organization-unit',
        permits: [HIERARCHY_READ],
        reason: 'A mobility recommendation may name a destination unit; an unknown one is refused.',
      },
      () =>
        asking<{ readonly unitId: string }, UnitAncestryQuery>(this.dispatcher, {
          queryName: 'organization.unit-ancestry',
          unitId: organizationUnitId,
        }),
    );

    return found.ok;
  }
}

/**
 * That a Learning assignment exists **and belongs to this employment**.
 *
 * The plan called for `assignmentExists(assignmentId)`. Learning publishes no such query:
 * `learning.search-assignments` filters on employment, course, status and due date, never on an
 * assignment's own identifier. Rather than add a contract to a completed module, Career asks the
 * narrower question `learning.read-history` already answers — what *this employment* was assigned —
 * and looks for the identifier among the results.
 *
 * **The narrowing is an improvement, not a workaround.** A development item hangs off a plan that
 * names an employment, so the employment is always at hand; and confirming the assignment is *that
 * person's* refuses something `assignmentExists` could not — attaching a colleague's course to
 * somebody else's development plan.
 *
 * **A tenant-wide search is deliberately not how this is answered.** "Some assignment with this
 * identifier exists somewhere in the tenant" is not the fact a development item needs, and asking it
 * that way would accept a reference to a course this person was never given.
 *
 * `read-all` is in the grant because Learning's own scope resolver returns an empty page without it:
 * `learning.read-history` gates on `assignment.read`, and `learnerScopeFor` widens to every
 * employment only for a caller holding `assignment.read-all`. Managing development plans across an
 * organization is exactly that HR-wide capability, and plan §9 authorized this grant. **An empty
 * page from a narrower grant would read as "no such assignment"**, which is the failure this file
 * exists to avoid — so the grant is stated at the width the question genuinely needs.
 *
 * **A failure is `false`, and the caller refuses.** Storing a reference to an assignment Learning
 * could not confirm would put a course on a development plan that may not exist.
 */
export class CareerLearning implements LearningPort {
  public constructor(private readonly dispatcher: Asking) {}

  public async assignmentIsFor(employmentId: string, assignmentId: string): Promise<boolean> {
    if (!UUID.test(employmentId) || !UUID.test(assignmentId)) return false;

    const found = await runWithServiceGrant(
      {
        module: 'career',
        operation: 'confirm-learning-assignment',
        permits: [ASSIGNMENT_READ, ASSIGNMENT_READ_ALL],
        reason:
          'A course development item references a Learning assignment; Career confirms it is this ' +
          'person’s and stores no status of its own.',
      },
      () =>
        asking<LearningHistoryView, ReadLearningHistoryQuery>(this.dispatcher, {
          queryName: 'learning.read-history',
          employmentId,
        }),
    );

    return found.ok && found.value.assignments.some((held) => held.assignmentId === assignmentId);
  }
}
