/**
 * What a caller must hold, and the separations that matter.
 *
 * More granular than any module before this one, and deliberately so: performance data is more
 * sensitive than most of what this product holds. It records what one named person thinks of
 * another's work, and it is read years later by people who were not in the room.
 *
 * **`review.read-team` and `review.read-all` are separate on purpose.** A manager reading their own
 * reports is a different capability from HR reading the organization, and a single permission
 * covering both is exactly how a manager comes to read a peer's review. `read-team` is resolved
 * from Employment's reporting line at the moment of the read — never from an employment identifier
 * the caller supplied, which would be an IDOR by another name.
 *
 * **`assess` and `assess-peer` are separate.** Assessing somebody you manage and being asked for a
 * peer opinion are different acts with different blast radii, and a reviewer invited for one review
 * should not thereby be able to assess anybody.
 *
 * **`calibrate` and `complete` are separate.** Moving a rating in a meeting and signing a review off
 * are different decisions; one permission covering both would let whoever ran the meeting finalize
 * its outcomes unreviewed.
 *
 * **`review.read-own` is declared and enforced nowhere**, exactly as `read-own` is in Attendance,
 * Compensation, Documents, Leave and Payroll. There is no authenticated-principal-to-employment
 * resolution in this repository (ADR-0032), so the permission names a capability the platform
 * cannot yet grant. It exists so the contract does; self-service routing is `NOT VERIFIED`, and
 * accepting an employment identifier from the client instead would let anybody read anybody's
 * review by changing a number in a URL.
 */
export const PerformancePermissions = {
  /** Rating scales, competency frameworks, review templates and goal categories. */
  configure: 'performance.configure',
  configureRead: 'performance.configure.read',

  cycleManage: 'performance.cycle.manage',
  cycleRead: 'performance.cycle.read',

  goalRead: 'performance.goal.read',
  goalManage: 'performance.goal.manage',
  /** A manager's own reports' goals. Resolved from Employment, never from a supplied identifier. */
  goalReadTeam: 'performance.goal.read-team',

  /** Declared; enforced nowhere. Self-service routing does not exist (ADR-0032). */
  reviewReadOwn: 'performance.review.read-own',
  reviewReadTeam: 'performance.review.read-team',
  reviewReadAll: 'performance.review.read-all',

  /** Writing an assessment of somebody one manages. */
  assess: 'performance.assess',
  /** Responding to a multi-rater invitation. Narrower: it reaches only the review invited to. */
  assessPeer: 'performance.assess-peer',
  /** Inviting reviewers — the 360° panel. Distinct from responding to an invitation. */
  reviewerManage: 'performance.reviewer.manage',

  calibrate: 'performance.calibrate',
  /** Signing a review off. Deliberately not implied by `calibrate`. */
  complete: 'performance.complete',

  talentRead: 'performance.talent.read',
  talentManage: 'performance.talent.manage',

  feedbackGive: 'performance.feedback.give',
  /** Declared; enforced nowhere, for the same reason as `review.read-own`. */
  feedbackReadAboutSelf: 'performance.feedback.read-about-self',
  feedbackReadTeam: 'performance.feedback.read-team',

  summaryRead: 'performance.summary.read',
  /** What reconciliation found. A list of what is wrong is itself worth restricting. */
  reconcile: 'performance.reconcile',
} as const;

export type PerformancePermission =
  (typeof PerformancePermissions)[keyof typeof PerformancePermissions];

export const ALL_PERFORMANCE_PERMISSIONS: readonly string[] = Object.values(PerformancePermissions);

/**
 * The permissions that are declared but reach nothing, named once rather than remembered.
 *
 * The administration screen still offers them, because the contract is real and a tenant may want
 * to grant it in advance. Nothing routes on them, and the checkpoint report lists them as
 * `NOT VERIFIED` rather than as features.
 */
export const UNROUTED_PERFORMANCE_PERMISSIONS: readonly string[] = [
  PerformancePermissions.reviewReadOwn,
  PerformancePermissions.feedbackReadAboutSelf,
];
