/**
 * What Career reads from other modules, and nothing more.
 *
 * Published contracts only, under bounded service grants (ADR-0043). Each port is narrower than the
 * view it is adapted from, so the adapter has nothing to leak.
 *
 * **Every method here is a read. There is no write anywhere in this file, and there is no shape
 * that could become one.** Career recommends and executes nothing (ADR-0072): no port method
 * changes an employment, moves anybody into a position, alters a salary or issues a letter, and a
 * method that did would be the whole module's premise undone in one signature.
 *
 * **There is deliberately no People port.** A plan names an employment, and a screen that wants a
 * name asks People itself. Reaching for a name here would put a second answer to "what is this
 * person called" inside a succession record that outlives the name (AD-001, ADR-0037).
 *
 * **There is deliberately no Performance port.** Showing a nine-box band beside a nomination needs
 * a *filtered, paged* placement read; `performance.talent-matrix` is unpaged and cycle-wide, and
 * that contract change was not authorized (D-5). Consuming the existing query per nomination would
 * be an unbounded read at 100,000 employments — exactly what this file is written to make
 * impossible — so the port does not exist and the capability is `NOT VERIFIED`. Declaring an empty
 * one would imply this module could reach for a band.
 *
 * **There is deliberately no `JobPort`.** Nothing schedules anything: a succession review comes due
 * because somebody ran a query, and a mobility recommendation expires by being read against a day.
 * A declared scheduler port would be a claim that something might.
 *
 * **There is deliberately no Documents port, and no `StoragePort`.** The plan listed
 * `documents.read-document` as available for citing evidence on a readiness assessment — but
 * Checkpoint 3's schema has no evidence column, so there is nothing for a confirmed identifier to be
 * stored in. A port that confirmed a document and then discarded it would be validation theatre. The
 * capability is `NOT VERIFIED`; upload, download and signed URLs never were buildable, because
 * `StoragePort` has no adapter anywhere in this repository.
 */

/**
 * What Career needs to know about an employment, and nothing else.
 *
 * Narrower than `EmploymentView` on purpose: this module confirms somebody exists and is employed
 * before nominating them, and answers "is this nominee still eligible" for a succession review. It
 * has no business knowing an employment's contract, its probation dates or its termination reason,
 * so the port cannot return them and the adapter has nothing to leak.
 */
export interface EmploymentFacts {
  readonly employmentId: string;
  readonly status: string;
  readonly active: boolean;
  readonly positionId?: string;
  readonly organizationUnitId?: string;
}

/**
 * A set of employments, or the honest admission that it could not be resolved.
 *
 * `undefined` means **Employment could not answer**, and it is deliberately different from an empty
 * list. A succession review that turned "the employment service is unreachable" into "no successor
 * has left the company" would report a healthy bench for an organization it never looked at.
 */
export type Workforce = readonly EmploymentFacts[] | undefined;

export interface EmploymentPort {
  /**
   * One employment. `undefined` where it does not exist or the grant does not reach it — and the
   * caller refuses the operation rather than nominating somebody who may not work here.
   */
  factsFor(employmentId: string): Promise<EmploymentFacts | undefined>;

  /**
   * The employments holding a position, as of a day.
   *
   * `employment.search`'s `positionId` filter, narrowed. Answers "who holds this position today",
   * which is the question beside every succession plan.
   *
   * **Paged, not offset.** Every published search contract in this repository speaks pages, and an
   * adapter converting an arbitrary offset into one would be lossy the moment the offset was not a
   * multiple of the size — it would silently return the wrong window and report success.
   */
  inPosition(positionId: string, asOf: string, size: number, page: number): Promise<Workforce>;
}

/**
 * That a position exists, and nothing else.
 *
 * `organization.list-positions` already answers it, so no change to Organization is required — and
 * none is permitted: the `criticality` filter this module would have liked was not authorized
 * (D-4).
 *
 * **`criticality` is deliberately absent from this interface.** Career stores no copy of it
 * (AD-004, ADR-0072), and a port that returned it would be the first step towards one. "List this
 * tenant's critical positions" is `NOT VERIFIED`: Career can show the succession plans it holds and
 * cannot enumerate positions it has no plan for. Answering it by paging the whole catalogue and
 * filtering here would be unbounded work over another module's data, and the total would be wrong.
 */
export interface OrganizationPort {
  positionExists(positionId: string): Promise<boolean>;
  unitExists(organizationUnitId: string): Promise<boolean>;
}

/**
 * That a Learning assignment exists, and that it is the one somebody named.
 *
 * A `course` development item stores a `learningAssignmentId` and **no status of its own**
 * (ADR-0073, D-2): whether somebody finished is `learning_enrolment`'s answer, and a second copy
 * here would be the one that goes stale the first time an enrolment was withdrawn. So this port
 * confirms the reference is real at the moment it is written, and returns nothing else — no title,
 * no completion date, no progress, because a field for any of them is where the second copy starts.
 */
export interface LearningPort {
  assignmentExists(assignmentId: string): Promise<boolean>;
}
