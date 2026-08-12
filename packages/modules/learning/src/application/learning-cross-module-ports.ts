/**
 * What Learning reads from other modules, and nothing more.
 *
 * Published contracts only, under bounded service grants (ADR-0043). Each port is narrower than the
 * view it is adapted from, so the adapter has nothing to leak.
 *
 * **There is deliberately no People port.** An assignment carries an employment, and a screen that
 * wants a name asks People itself. Reaching for a name here would put a second answer to "what is
 * this person called" inside a training record that outlives the name (AD-001, ADR-0037).
 *
 * **There is deliberately no Performance port.** Nothing in Phase 14A reads a rating, a competency
 * or a review: AD-002 says course completion does not imply competency, and a port declared here
 * would imply this module could reach for one. Performance consumes Learning where it wants to know
 * what somebody attained; the arrow points that way and not back (AD-005).
 *
 * **There is deliberately no JobPort.** Nothing schedules anything (ADR-0071), and a declared
 * scheduler port would be a claim that something might.
 */

/**
 * What Learning needs to know about an employment, and nothing else.
 *
 * Narrower than `EmploymentView` on purpose: this module confirms somebody exists and is employed,
 * and resolves who a mandatory rule applies to. It has no business knowing an employment's contract,
 * its probation dates or its termination reason, so the port cannot return them and the adapter has
 * nothing to leak.
 */
export interface EmploymentFacts {
  readonly employmentId: string;
  readonly status: string;
  readonly active: boolean;
  readonly managerEmploymentId?: string;
  readonly organizationUnitId?: string;
  readonly positionId?: string;
}

/**
 * An audience, or the honest admission that it could not be resolved.
 *
 * `undefined` means **Employment could not answer**, and it is deliberately different from an empty
 * list. A reconciliation that turned "the employment service is unreachable" into "nobody needs
 * fire safety training" would report full compliance for an organization it never looked at, which
 * is the single most dangerous failure mode this module has.
 */
export type Audience = readonly EmploymentFacts[] | undefined;

export interface EmploymentPort {
  /**
   * One employment as of a date. `undefined` where it does not exist or the grant does not reach it
   * — and the caller refuses the operation rather than inventing a learner.
   */
  factsFor(employmentId: string, asOf: Date): Promise<EmploymentFacts | undefined>;

  /**
   * The active workforce, for a rule whose audience is everybody.
   *
   * Bounded by the *port* rather than by the caller's good intentions: `limit` is mandatory and the
   * adapter clamps it. The published `employment.search` query already answers this, so no change
   * to Employment is required.
   */
  activeEmployments(asOf: Date, limit: number, offset: number): Promise<Audience>;

  /** The employments in a unit. `employment.search`'s `unitId` filter, narrowed. */
  inUnit(organizationUnitId: string, asOf: Date, limit: number, offset: number): Promise<Audience>;

  /** The employments holding a position. `employment.search`'s `positionId` filter, narrowed. */
  inPosition(positionId: string, asOf: Date, limit: number, offset: number): Promise<Audience>;

  /**
   * Which employments report to this manager, as of a date.
   *
   * Bounded for the same reason. This is what would make `assignment.read-team` mean "this
   * manager's actual reports" rather than "whichever employment identifiers the client typed" —
   * once there is a way to know which employment the caller *is*. There is not (ADR-0032), so
   * nothing routes on it yet and the scope resolver says so rather than guessing.
   */
  directReportsOf(managerEmploymentId: string, asOf: Date, limit: number): Promise<Audience>;
}

/**
 * That an organization unit exists, and nothing else about it.
 *
 * `organization.unit-ancestry` already answers it — it returns not-found for a unit that is not
 * there — so no change to Organization is required. `organization.export-structure` is deliberately
 * **not** used: it returns the whole company, and reaching for it because it happens to contain the
 * answer is how a narrow read becomes a broad grant nobody notices.
 */
export interface OrganizationPort {
  unitExists(organizationUnitId: string): Promise<boolean>;
}

/**
 * Evidence, as a reference and never as a byte (ADR-0070).
 *
 * Phase 12 provides **no `DocumentPort` implementation** — `StoragePort` has no adapter anywhere in
 * this repository. This port answers one question: does the document a certification points at
 * exist, and may this caller know that it does. Learning stores the identifier and nothing else: no
 * filename, no size, no content hash, no URL, and above all **no second expiry date**. Upload and
 * download remain `NOT VERIFIED`, and no method here implies otherwise.
 */
export interface DocumentReferencePort {
  exists(documentId: string): Promise<boolean>;
}

/**
 * The moments this module would tell somebody about, if anything delivered.
 *
 * `RecordingNotificationPort` records the intent and delivers nothing, which is what the kernel
 * provides and what production has. **Intent is a real record; delivery is a missing dependency.**
 * Nothing in this module claims anybody was told that their fire safety training is due, and no
 * screen built later may either.
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
