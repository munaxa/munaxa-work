/**
 * Every permission this module registers.
 *
 * Declared here and referenced by handlers, never spelled out at a call site, because a permission
 * string that exists in two places will eventually differ in one — and the difference fails open
 * exactly once, on the endpoint whose spelling nobody checked.
 *
 * **Six separations are deliberate, and each protects a different thing.**
 *
 * *Requesting is not approving.* This is the separation of duties the whole approval model rests
 * on, and it holds even for somebody granted both: the domain refuses self-approval and a check
 * constraint refuses it in the database. A control that depends on nobody holding two roles is a
 * control that fails the first time somebody does.
 *
 * *Reading a balance is not reading the reasons behind it.* `leave.balance.read` sees numbers;
 * `leave.read` sees requests, and a leave request carries a justification that on a sick-leave
 * request is close to health data. A manager approving a rota needs the first and has no business
 * with the second (§30).
 *
 * *Drafting a policy is not publishing it.* A published policy version governs everybody it is
 * assigned to and cannot be edited afterwards; drafting next year's carry-over cap is ordinary work.
 *
 * *Adjusting a balance is its own permission.* It is the one movement in the ledger that no rule
 * produced and no request explains, which makes it the one an auditor looks at first.
 *
 * *Running accrual is not managing entitlement.* A run applies a policy to a page of employments; a
 * grant is a decision about one person.
 *
 * *Exporting is held by fewer people than reading.* An export is the highest-volume disclosure this
 * module can make, and leave data says who was away, when, and — through the type — sometimes why.
 */
export const LeavePermissions = {
  /** Leave requests, balances and calendars across the tenant. */
  read: 'leave.read',
  /** An employee's own leave. The portal's permission; Phase 18 wires it to a person. */
  readOwn: 'leave.read-own',
  /** Submitting on behalf of somebody else — an HR administrator acting for an employee. */
  request: 'leave.request',
  /** Submitting their own. Phase 18. */
  requestOwn: 'leave.request-own',

  /** Amending, withdrawing or moving a request administratively. */
  manage: 'leave.manage',
  /** **Deciding.** Never the same permission as requesting. */
  approve: 'leave.approve',
  /** Unmaking an approved request, which reverses a ledger consumption. */
  cancel: 'leave.cancel',
  /** Writing an adjustment to the ledger. The movement no rule produced. */
  adjust: 'leave.adjust',

  entitlementManage: 'leave.entitlement.manage',
  /** Running accrual, closing a leave year, expiring carry-over. */
  accrualRun: 'leave.accrual.run',

  policyManage: 'leave.policy.manage',
  /** Freezing a type or a policy version. Separate, because a published policy governs everybody. */
  policyPublish: 'leave.policy.publish',

  /** Reading a balance without reading the reasons. Narrower than `leave.read`, deliberately. */
  balanceRead: 'leave.balance.read',
  /** Taking the leave register out of the product. Held by fewer people than read. */
  export: 'leave.export',
} as const;

export type LeavePermission = (typeof LeavePermissions)[keyof typeof LeavePermissions];

export const ALL_LEAVE_PERMISSIONS: readonly LeavePermission[] = Object.values(LeavePermissions);
