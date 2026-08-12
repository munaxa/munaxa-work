import {
  runWithServiceGrant,
  type HandlerFailure,
  type PagedResult,
  type Query,
  type Result,
} from '@work/kernel';
import type {
  Audience,
  DocumentReferencePort,
  EmploymentFacts,
  EmploymentPort,
  NotificationIntentPort,
  OrganizationPort,
} from '@work/learning';
import type { EmploymentView } from '@work/employment';
import type { DocumentView } from '@work/documents';

import type { Asking } from '../payroll/asking.js';

/**
 * Learning's four cross-module adapters, and the whole of its outward surface.
 *
 * Every one reaches the owning module through its **published queries**, never its repositories, and
 * each call runs inside a **bounded service grant** (ADR-0043). Running a training programme must
 * not make somebody a reader of the employment register: the user is checked for the *learning*
 * operation, and the module holds the narrow cross-domain read for the length of one call. Each
 * grant permits an **explicit list** of permissions — never a wildcard, never a prefix — cannot
 * nest, leaves the tenant, actor and correlation identifier untouched, and is logged.
 *
 * **Nothing here writes.** There is no `create` and no `update` on any adapter. Learning modifies
 * nothing outside itself (AD-005): in particular it writes no capability to People, because what
 * somebody *claims* is People's record and what they *attained* is Learning's, and AD-002 says the
 * second does not imply a competency.
 *
 * **There is no People adapter, deliberately.** A training record carries an employment; a screen
 * that wants a name asks People, which owns it and knows whether the caller may see it. Resolving a
 * name here would put a second answer to "what is this person called" inside a certification that
 * outlives the name (AD-001, ADR-0037).
 *
 * **There is no Performance adapter, deliberately.** Nothing in Phase 14A reads a rating, a
 * competency or a review, and a port declared here would imply this module could reach for one.
 *
 * **There is no JobPort adapter**, because none exists anywhere in this repository. Recurring
 * training is computed by a command an administrator runs (ADR-0071), and scheduled execution
 * remains `NOT VERIFIED`.
 *
 * One absence is load-bearing in the other direction: the Employment grant is
 * `employment.employment.read` and nothing else. It is not `employment.*`, and it does not include
 * `employment.history.read` or `employment.workforce.export` — a compliance queue has no business
 * carrying the register out of the product.
 */

const EMPLOYMENT_READ = 'employment.employment.read';
const HIERARCHY_READ = 'organization.hierarchy.read';
const DOCUMENT_READ = 'document.read';

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
  readonly managerEmploymentId?: string;
  readonly unitId?: string;
  readonly positionId?: string;
  readonly asOf?: Date;
  readonly page?: number;
  readonly size?: number;
}

interface UnitAncestryQuery extends Query {
  readonly queryName: 'organization.unit-ancestry';
  readonly unitId: string;
}

interface ReadDocumentQuery extends Query {
  readonly queryName: 'documents.read-document';
  readonly documentId: string;
}

/**
 * What Learning needs to know about an employment, mapped down from what Employment publishes.
 *
 * `EmploymentView` carries a great deal more — contract, probation, termination reason. **The
 * adapter maps and discards rather than passing the view through**, so nothing downstream can come
 * to depend on a field Learning has no business holding, and the port stays the narrow thing the
 * module declared.
 */
const factsOf = (view: EmploymentView): EmploymentFacts => ({
  employmentId: view.employmentId,
  status: view.status,
  // "Active" means exactly the status Employment calls active, rather than "not obviously
  // finished": a draft or pending employment is not somebody to oblige with safety training.
  active: view.status === 'active',
  ...(view.managerEmploymentId === undefined
    ? {}
    : { managerEmploymentId: view.managerEmploymentId }),
  ...(view.assignment?.unitId === undefined ? {} : { organizationUnitId: view.assignment.unitId }),
  ...(view.assignment?.positionId === undefined ? {} : { positionId: view.assignment.positionId }),
});

/**
 * Employment, as Learning reads it.
 *
 * **A failed read is `undefined`, never an empty audience.** That distinction is the single most
 * important line in this file. Performance's equivalent adapter returns `[]` when a search fails,
 * which is correct there — an enrolment that found nobody enrols nobody. Here it would be a
 * reconciliation reporting "0 generated, 0 already present" for an organization it never looked at,
 * which reads as full compliance on a screen. So every audience read distinguishes "nobody matched"
 * from "I could not ask", and the command refuses on the second.
 *
 * **`directReportsOf` uses the existing `employment.search` contract**, filtered by
 * `managerEmploymentId` and resolved against the reporting line as of a date. That query already
 * exists, is indexed, is bounded and paged, and carries its own integration test — so no change to
 * Employment was made or needed. Nothing routes on it yet: without principal-to-employment
 * resolution (ADR-0032) there is no way to know which employment the caller *is*, so the scope
 * resolver returns nothing rather than trusting an identifier a client typed.
 */
export class LearningEmployment implements EmploymentPort {
  public constructor(private readonly dispatcher: Asking) {}

  public async factsFor(employmentId: string, asOf: Date): Promise<EmploymentFacts | undefined> {
    const found = await runWithServiceGrant(
      {
        module: 'learning',
        operation: 'read-employment',
        permits: [EMPLOYMENT_READ],
        reason: 'A training record names an employment, and an unconfirmed one is refused.',
      },
      () =>
        asking<EmploymentView, ReadEmploymentQuery>(this.dispatcher, {
          queryName: 'employment.read-employment',
          employmentId,
          asOf,
        }),
    );

    return found.ok ? factsOf(found.value) : undefined;
  }

  public activeEmployments(asOf: Date, size: number, page: number): Promise<Audience> {
    return this.search(
      { queryName: 'employment.search', status: 'active', asOf, page, size },
      'read-active-workforce',
      'A requirement for everybody is the active workforce Employment resolves, not a stored list.',
      size,
    );
  }

  public inUnit(
    organizationUnitId: string,
    asOf: Date,
    size: number,
    page: number,
  ): Promise<Audience> {
    return this.search(
      {
        queryName: 'employment.search',
        status: 'active',
        unitId: organizationUnitId,
        asOf,
        page,
        size,
      },
      'read-unit-employments',
      'A requirement for a unit covers whoever is in it now, including yesterday’s transfer.',
      size,
    );
  }

  public inPosition(positionId: string, asOf: Date, size: number, page: number): Promise<Audience> {
    return this.search(
      { queryName: 'employment.search', status: 'active', positionId, asOf, page, size },
      'read-position-employments',
      'A requirement for a position covers whoever holds it on the day it is reconciled.',
      size,
    );
  }

  public directReportsOf(managerEmploymentId: string, asOf: Date, size: number): Promise<Audience> {
    return this.search(
      { queryName: 'employment.search', managerEmploymentId, asOf, page: 1, size },
      'read-direct-reports',
      'A manager’s queue is the reports Employment resolves, never identifiers a client typed.',
      size,
    );
  }

  /**
   * One bounded search, and the bound is applied twice on purpose.
   *
   * `size` bounds what Employment returns, and the slice bounds what this adapter passes on. The
   * second is not redundant: Employment clamps `size` to its own maximum, which is *smaller* than
   * some callers here ask for, and a caller that assumed it had received everything would reconcile
   * a fraction of the workforce and report success.
   */
  private async search(
    query: SearchEmploymentsQuery,
    operation: string,
    reason: string,
    size: number,
  ): Promise<Audience> {
    const found = await runWithServiceGrant(
      { module: 'learning', operation, permits: [EMPLOYMENT_READ], reason },
      () => asking<PagedResult<EmploymentView>, SearchEmploymentsQuery>(this.dispatcher, query),
    );

    // `undefined` is "Employment could not answer". An empty array would say "nobody works here".
    return found.ok ? found.value.items.slice(0, size).map(factsOf) : undefined;
  }
}

/**
 * That an organization unit exists.
 *
 * `organization.unit-ancestry` is the narrowest published read that answers it with a handler: it
 * returns not-found for a unit that is not there. `organization.export-structure` would also contain
 * the answer, and reaching for it because it happens to is how a narrow read becomes a broad grant
 * nobody notices.
 *
 * **A failure is `false`, and the caller refuses.** A rule recorded against a unit nobody confirmed
 * would resolve to nobody at reconciliation time, and a compliance rule that silently covers nobody
 * is worse than no rule at all.
 */
export class LearningOrganization implements OrganizationPort {
  public constructor(private readonly dispatcher: Asking) {}

  public async unitExists(organizationUnitId: string): Promise<boolean> {
    const found = await runWithServiceGrant(
      {
        module: 'learning',
        operation: 'confirm-organization-unit',
        permits: [HIERARCHY_READ],
        reason: 'A mandatory requirement for a unit is refused unless the unit is confirmed.',
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
 * Whether an evidence document exists.
 *
 * **This is the whole of the Documents integration, and it is deliberately one question.** Phase 12
 * provides no `DocumentPort` implementation and `StoragePort` has no adapter anywhere in this
 * repository, so there is nothing to fetch. Learning stores the identifier and no filename, no size,
 * no hash, no URL — and above all **no second expiry date**, because ADR-0070 gives Documents the
 * validity of the scan and Learning the validity of the qualification. Upload, download and signed
 * links remain `NOT VERIFIED`, and no method here implies otherwise.
 */
export class LearningDocuments implements DocumentReferencePort {
  public constructor(private readonly dispatcher: Asking) {}

  public async exists(documentId: string): Promise<boolean> {
    const found = await runWithServiceGrant(
      {
        module: 'learning',
        operation: 'confirm-evidence-document',
        permits: [DOCUMENT_READ],
        reason: 'A certification may cite evidence; a citation nobody can find is refused.',
      },
      () =>
        asking<DocumentView, ReadDocumentQuery>(this.dispatcher, {
          queryName: 'documents.read-document',
          documentId,
        }),
    );

    return found.ok;
  }
}

/**
 * A notification intent, recorded and delivered by nothing.
 *
 * `RecordingNotificationPort` is what the kernel provides and what production has. **Intent is a
 * real record; delivery is a missing dependency.** This adapter exists so the module has somewhere
 * to record that somebody's training became due, and no screen built later may imply anybody was
 * told. Notification delivery remains `NOT VERIFIED`.
 */
export class LearningNotifications implements NotificationIntentPort {
  public constructor(
    private readonly record: (request: {
      readonly templateKey: string;
      readonly recipients: readonly { readonly userId: string }[];
      readonly variables: Readonly<Record<string, string | number>>;
      readonly correlationId: string;
    }) => Promise<void>,
    private readonly correlationOf: () => string,
  ) {}

  public intend(request: {
    readonly templateKey: string;
    readonly recipients: readonly string[];
    readonly variables: Readonly<Record<string, string | number>>;
  }): Promise<void> {
    return this.record({
      templateKey: request.templateKey,
      recipients: request.recipients.map((userId) => ({ userId })),
      variables: request.variables,
      correlationId: this.correlationOf(),
    });
  }
}
