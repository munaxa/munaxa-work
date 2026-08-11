/**
 * What Performance reads from other modules, and nothing more.
 *
 * Published contracts only, under bounded service grants (ADR-0043). Each port is narrower than the
 * view it is adapted from, so the adapter has nothing to leak: this module enrols participants,
 * resolves a manager and reads a placement for the snapshot, and has no business knowing an
 * employment's contract or a person's name.
 */

// ------------------------------------------------------------------------------------------------
// Cross-module reads. Published contracts only, under bounded service grants (ADR-0043).
// ------------------------------------------------------------------------------------------------

/**
 * What Performance needs to know about an employment, and nothing else.
 *
 * Narrower than `EmploymentView` on purpose: this module enrols participants, resolves a manager
 * and reads an assignment for the completion snapshot. It has no business knowing an employment's
 * contract, its probation dates or its termination reason, so the port cannot return them and the
 * adapter has nothing to leak.
 */
export interface EmploymentFacts {
  readonly employmentId: string;
  readonly status: string;
  readonly active: boolean;
  readonly managerEmploymentId?: string;
  readonly organizationUnitId?: string;
  readonly positionId?: string;
}

export interface EmploymentPort {
  /**
   * One employment as of a date. `undefined` where it does not exist or the grant does not reach
   * it — and the caller refuses the operation rather than inventing a participant.
   */
  factsFor(employmentId: string, asOf: Date): Promise<EmploymentFacts | undefined>;

  /**
   * **D-31: which employments report to this manager, as of a date.**
   *
   * Bounded, and bounded by the *port* rather than by the caller's good intentions: `limit` is
   * mandatory and the adapter clamps it. This is the manager review queue's central question and
   * the only thing that makes `review.read-team` mean "this manager's actual reports" rather than
   * "whichever employment identifiers the client typed".
   *
   * The published `employment.search` query already answers it — see the adapter — so no change to
   * Employment is required.
   */
  directReportsOf(
    managerEmploymentId: string,
    asOf: Date,
    limit: number,
  ): Promise<readonly EmploymentFacts[]>;

  /** The employments in a unit, for enrolling a cycle. Bounded for the same reason. */
  inUnit(
    organizationUnitId: string,
    asOf: Date,
    limit: number,
  ): Promise<readonly EmploymentFacts[]>;
}

/**
 * The organizational placement a completed review is snapshotted with.
 *
 * Only the legal entity governing a unit, which Organization already publishes as a narrow query.
 * `organization.export-structure` is deliberately **not** used: it returns the whole company, and
 * reaching for it because it happens to contain the answer is how a narrow read becomes a broad
 * grant nobody notices.
 */
export interface OrganizationPort {
  governingLegalEntityOf(organizationUnitId: string): Promise<string | undefined>;
}

/**
 * Evidence, as a reference and never as a byte.
 *
 * Phase 12 provides **no `DocumentPort` implementation** — `StoragePort` has no adapter anywhere in
 * this repository. This port therefore answers one question: does the document a goal or a review
 * points at exist and may this caller know that it does. Performance stores the identifier and
 * nothing else: no filename, no size, no content hash, no URL. Upload and download remain
 * `NOT VERIFIED`, and no method here implies otherwise.
 */
export interface DocumentReferencePort {
  exists(documentId: string): Promise<boolean>;
}

/**
 * The moments this module would tell somebody about, if anything delivered.
 *
 * `RecordingNotificationPort` records the intent and delivers nothing, which is what the kernel
 * provides and what production has. **Intent is a real record; delivery is a missing dependency**
 * (D-21). Nothing in this module claims anybody was told, and no screen built later may either.
 */
export interface NotificationIntentPort {
  intend(request: {
    readonly templateKey: string;
    readonly recipients: readonly string[];
    readonly variables: Readonly<Record<string, string | number>>;
  }): Promise<void>;
}

/** The default: nothing is reachable. Production has no adapter, and neither does this. */
export const documentsUnavailable: DocumentReferencePort = {
  exists: () => Promise.resolve(false),
};
