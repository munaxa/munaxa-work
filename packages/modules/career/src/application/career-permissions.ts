/**
 * What a caller must hold, and the separations that matter.
 *
 * **Succession data is more sensitive than most of this product.** A list of named successors for a
 * director's post, or a "not ready" assessment, is material somebody can act on against a
 * colleague — and the person it describes is not in the room. So `read` here is a permission
 * granted deliberately, and a record the caller may not see answers *not found* rather than
 * *forbidden*: confirming that a bench for a named position exists is itself the disclosure.
 *
 * Three separations are deliberate, and each mirrors a precedent:
 *
 * **`successor.confirm` is not implied by `successor.nominate`.** Suggesting somebody could succeed
 * a director is not the same act as recording that the organization agrees, and the second is the
 * one an auditor asks about a year later. Learning separates `assignment.waive` from `manage` for
 * exactly this reason.
 *
 * **`pool.assign` is not implied by `pool.manage`.** Creating a "high potential" pool is
 * configuration; putting a named person in it is a judgement about them.
 *
 * **`readiness.record` is separate from `readiness.read`.** Reading who is ready and stating that
 * somebody is not are different capabilities, and the second is the one that decides who gets put
 * forward.
 *
 * **`plan.read-own` and `development.read-own` are declared and enforced nowhere**, exactly as
 * `read-own` is in Attendance, Compensation, Documents, Leave, Payroll, Performance and Learning.
 * There is no authenticated-principal-to-employment resolution in this repository (ADR-0032), so
 * these name a capability the platform cannot grant. They exist so the contract does; self-service
 * routing is `NOT VERIFIED`, and accepting an employment identifier from the client instead would
 * let anybody read anybody's succession standing by changing a number in a URL.
 *
 * **`plan.read-team` is the same case.** Resolving "my team" needs to know which employment the
 * caller *is*, and a caller-supplied `managerEmploymentId` is a filter, never a credential.
 */
export const CareerPermissions = {
  /** Career paths and the stages along them. Configuration. */
  pathRead: 'career.path.read',
  pathManage: 'career.path.manage',

  planRead: 'career.plan.read',
  /** Declared; enforced nowhere. Self-service routing does not exist (ADR-0032). */
  planReadOwn: 'career.plan.read-own',
  /** Declared; enforced nowhere. A supplied manager identifier is not proof of identity. */
  planReadTeam: 'career.plan.read-team',
  planManage: 'career.plan.manage',

  /** Creating and closing a pool. Configuration. */
  poolRead: 'career.pool.read',
  poolManage: 'career.pool.manage',
  /** Putting a named person in a pool. A judgement about them; never implied by `manage`. */
  poolAssign: 'career.pool.assign',

  successionRead: 'career.succession.read',
  successionManage: 'career.succession.manage',
  /** Putting somebody forward. */
  successorNominate: 'career.successor.nominate',
  /** Recording that the organization agrees. The act an auditor asks about; separate deliberately. */
  successorConfirm: 'career.successor.confirm',

  readinessRead: 'career.readiness.read',
  /** Stating that somebody is at a level. This product computes none (ADR-0074). */
  readinessRecord: 'career.readiness.record',

  developmentRead: 'career.development.read',
  /** Declared; enforced nowhere, for the same reason as `plan.read-own`. */
  developmentReadOwn: 'career.development.read-own',
  developmentManage: 'career.development.manage',

  mobilityRead: 'career.mobility.read',
  /** Making a suggestion. It moves nobody (ADR-0072). */
  mobilityRecommend: 'career.mobility.recommend',
  /** Agreeing or disagreeing with a suggestion. Still moves nobody. */
  mobilityDecide: 'career.mobility.decide',
} as const;

export type CareerPermission = (typeof CareerPermissions)[keyof typeof CareerPermissions];

export const ALL_CAREER_PERMISSIONS: readonly string[] = Object.values(CareerPermissions);

/**
 * The permissions that are declared but reach nothing, named once rather than remembered.
 *
 * The administration screen still offers them, because the contract is real and a tenant may want
 * to grant it in advance. Nothing routes on them, and the checkpoint report lists them as
 * `NOT VERIFIED` rather than as features.
 */
export const UNROUTED_CAREER_PERMISSIONS: readonly string[] = [
  CareerPermissions.planReadOwn,
  CareerPermissions.planReadTeam,
  CareerPermissions.developmentReadOwn,
];
