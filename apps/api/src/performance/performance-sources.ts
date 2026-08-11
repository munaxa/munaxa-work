import {
  runWithServiceGrant,
  type HandlerFailure,
  type PagedResult,
  type Query,
  type Result,
} from '@work/kernel';
import type {
  DocumentReferencePort,
  EmploymentFacts,
  EmploymentPort,
  NotificationIntentPort,
  OrganizationPort,
} from '@work/performance';
import type { EmploymentView } from '@work/employment';
import type { DocumentView } from '@work/documents';

import type { Asking } from '../payroll/asking.js';

/**
 * Performance's four cross-module adapters, and the whole of its outward surface.
 *
 * Every one reaches the owning module through its **published queries**, never its repositories,
 * and each call runs inside a **bounded service grant** (ADR-0043). Running a performance cycle
 * must not make somebody a reader of the employment register: the user is checked for the
 * *performance* operation, and the module holds the narrow cross-domain read for the length of one
 * call. Each grant permits an **explicit list** of permissions — never a wildcard, never a prefix —
 * cannot nest, leaves the tenant, actor and correlation identifier untouched, and is logged.
 *
 * **Nothing here writes.** There is no `create` and no `update` on any adapter. Performance
 * measures and decides nothing: Compensation, Learning and Career pull a rating when they want one
 * (AD-005, ADR-0058).
 *
 * **There is no People adapter, deliberately.** A review carries an employment; a screen that wants
 * a name asks People itself, which owns it and knows whether the caller may see it. Resolving a
 * name here would put a second answer to "what is this person called" inside a performance record
 * that outlives the name (AD-001, ADR-0037).
 *
 * **There is no Compensation or Payroll adapter, deliberately.** A performance review must not
 * display a salary, so there is no method that could fetch one and no grant that would permit it.
 *
 * One absence is load-bearing in the other direction: the Employment grant is
 * `employment.employment.read` and nothing else. It is not `employment.*`, and it does not include
 * `employment.history.read` or `employment.workforce.export` — a performance cycle has no business
 * carrying the register out of the product.
 */

const EMPLOYMENT_READ = 'employment.employment.read';
const LEGAL_ENTITY_READ = 'organization.legal-entity.read';
const DOCUMENT_READ = 'document.read';

/**
 * The dispatcher's `ask`, with the query's own shape kept.
 *
 * `Dispatcher.ask` takes a bare `Query`, so a literal passed to it directly loses everything the
 * interfaces below declare. Threading the query type through one helper keeps the compiler checking
 * what is sent — which is exactly what the Phase 8 adapter defects needed and did not have: a civil
 * date passed as a string where a `Date` was expected, and a wrapped snapshot read as flat data.
 * Neither would have compiled through this helper.
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
  readonly managerEmploymentId?: string;
  readonly unitId?: string;
  readonly asOf?: Date;
  readonly page?: number;
  readonly size?: number;
}

interface GoverningLegalEntityQuery extends Query {
  readonly queryName: 'organization.governing-legal-entity';
  readonly unitId: string;
}

interface ReadDocumentQuery extends Query {
  readonly queryName: 'documents.read-document';
  readonly documentId: string;
}

/**
 * What Performance needs to know about an employment, mapped down from what Employment publishes.
 *
 * `EmploymentView` carries a great deal more — contract, probation, termination reason. **The
 * adapter maps and discards rather than passing the view through**, so nothing downstream can come
 * to depend on a field Performance has no business holding, and the port stays the narrow thing the
 * module declared.
 */
const factsOf = (view: EmploymentView): EmploymentFacts => ({
  employmentId: view.employmentId,
  status: view.status,
  // `ended` is the only terminal status Employment declares. A `draft` or `pending_approval`
  // employment is not somebody to enrol in a review cycle either, so "active" here means exactly
  // the status Employment calls active rather than "not obviously finished".
  active: view.status === 'active',
  ...(view.managerEmploymentId === undefined
    ? {}
    : { managerEmploymentId: view.managerEmploymentId }),
  ...(view.assignment?.unitId === undefined ? {} : { organizationUnitId: view.assignment.unitId }),
  ...(view.assignment?.positionId === undefined ? {} : { positionId: view.assignment.positionId }),
});

/**
 * Employment, as Performance reads it.
 *
 * **`directReportsOf` uses the existing `employment.search` contract**, filtered by
 * `managerEmploymentId` and resolved against the reporting line as of a date. That query already
 * exists, is indexed, is bounded and cursor-paged, and carries its own integration test — so no
 * change to Employment was made or needed. The published response is wider than this port; the
 * adapter narrows it, which is the correct place to narrow.
 *
 * The `asOf` is a `Date`. Employment's contract declares one, and passing a civil-date string
 * instead is the Phase 8 defect this repository has already paid for once.
 */
export class PerformanceEmployment implements EmploymentPort {
  public constructor(private readonly dispatcher: Asking) {}

  public async factsFor(employmentId: string, asOf: Date): Promise<EmploymentFacts | undefined> {
    const found = await runWithServiceGrant(
      {
        module: 'performance',
        operation: 'read-employment',
        permits: [EMPLOYMENT_READ],
        reason: 'A performance review names an employment, and an unconfirmed one is refused.',
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

  public directReportsOf(
    managerEmploymentId: string,
    asOf: Date,
    limit: number,
  ): Promise<readonly EmploymentFacts[]> {
    return this.search(
      { queryName: 'employment.search', managerEmploymentId, asOf, page: 1, size: limit },
      'read-direct-reports',
      'A manager review queue is the reports Employment resolves, never identifiers a client typed.',
      limit,
    );
  }

  public inUnit(
    organizationUnitId: string,
    asOf: Date,
    limit: number,
  ): Promise<readonly EmploymentFacts[]> {
    return this.search(
      { queryName: 'employment.search', unitId: organizationUnitId, asOf, page: 1, size: limit },
      'read-unit-employments',
      'Enrolling a cycle from a unit reads that unit’s employments as of the enrolment date.',
      limit,
    );
  }

  /**
   * One bounded search, and the bound is applied twice on purpose.
   *
   * `size` bounds what Employment returns, and the slice bounds what this adapter passes on. The
   * second is not redundant: Employment clamps `size` to its own maximum, which is *smaller* than
   * some callers here ask for, and a caller that assumed it had received everything would enrol a
   * fraction of a unit and report success.
   */
  private async search(
    query: SearchEmploymentsQuery,
    operation: string,
    reason: string,
    limit: number,
  ): Promise<readonly EmploymentFacts[]> {
    const found = await runWithServiceGrant(
      { module: 'performance', operation, permits: [EMPLOYMENT_READ], reason },
      () => asking<PagedResult<EmploymentView>, SearchEmploymentsQuery>(this.dispatcher, query),
    );

    return found.ok ? found.value.items.slice(0, limit).map(factsOf) : [];
  }
}

/**
 * The legal entity governing a unit, for the completion snapshot.
 *
 * `organization.governing-legal-entity` and nothing else. `organization.export-structure` would
 * also contain the answer, and reaching for it because it happens to is how a narrow read becomes a
 * broad grant nobody notices.
 */
export class PerformanceOrganization implements OrganizationPort {
  public constructor(private readonly dispatcher: Asking) {}

  public async governingLegalEntityOf(organizationUnitId: string): Promise<string | undefined> {
    const found = await runWithServiceGrant(
      {
        module: 'performance',
        operation: 'read-governing-legal-entity',
        permits: [LEGAL_ENTITY_READ],
        reason:
          'A completed review snapshots where the work happened, so a later move cannot change it.',
      },
      () =>
        asking<{ readonly legalEntityId?: string }, GoverningLegalEntityQuery>(this.dispatcher, {
          queryName: 'organization.governing-legal-entity',
          unitId: organizationUnitId,
        }),
    );

    return found.ok ? found.value.legalEntityId : undefined;
  }
}

/**
 * Whether an evidence document exists.
 *
 * **This is the whole of the Documents integration, and it is deliberately one question.** Phase 12
 * provides no `DocumentPort` implementation and `StoragePort` has no adapter anywhere in this
 * repository, so there is nothing to fetch. Performance stores the identifier and no filename, no
 * size, no hash and no URL; upload, download and signed links remain `NOT VERIFIED`, and no method
 * here implies otherwise.
 */
export class PerformanceDocuments implements DocumentReferencePort {
  public constructor(private readonly dispatcher: Asking) {}

  public async exists(documentId: string): Promise<boolean> {
    const found = await runWithServiceGrant(
      {
        module: 'performance',
        operation: 'confirm-evidence-document',
        permits: [DOCUMENT_READ],
        reason: 'A goal may cite evidence; a citation of a document nobody can find is refused.',
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
 * real record; delivery is a missing dependency** (D-21). This adapter exists so the module has
 * somewhere to record one, and no screen built later may imply anybody was told.
 */
export class PerformanceNotifications implements NotificationIntentPort {
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
