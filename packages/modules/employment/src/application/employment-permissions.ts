/**
 * Every permission this module registers.
 *
 * Declared here and referenced by handlers, never spelled out at a call site, because a permission
 * string that exists in two places will eventually differ in one — and the difference fails open
 * exactly once, on the endpoint whose spelling nobody checked.
 *
 * **Three separations here are deliberate, and each protects a different thing.**
 *
 * *Changing status* is not *managing* an employment. Suspending somebody stops their access and
 * their pay; correcting their employment category does not. An HR administrator who maintains
 * records is not automatically the person who may stand somebody down.
 *
 * *Ending* is not *changing status*. It is the single most consequential act in this domain: it is
 * terminal by design, it is what final settlement and end-of-service calculations read, and it is
 * the one operation no amount of subsequent editing can undo — a returning employee is a new
 * employment, not a reopened one.
 *
 * *Exporting* is not *reading*. A workforce export is the whole register in one file, and the
 * people who need to read an employment are many more than the people who should be able to carry
 * every employment out of the product.
 *
 * Registration is automatic — the module registry derives the list from the handlers — so a
 * permission cannot exist in code and be missing from the administration screen. Platform decides
 * who holds them; this module only says what they are and what they guard.
 */
export const EmploymentPermissions = {
  employmentRead: 'employment.employment.read',
  employmentManage: 'employment.employment.manage',
  /** Draft, submit, activate, suspend, reinstate. Not ending — see below. */
  employmentStatusChange: 'employment.employment.status.change',
  /** Terminal, and what payroll's final settlement reads. Held by fewer people than the rest. */
  employmentEnd: 'employment.employment.end',

  assignmentRead: 'employment.assignment.read',
  assignmentManage: 'employment.assignment.manage',

  reportingLineRead: 'employment.reporting-line.read',
  reportingLineManage: 'employment.reporting-line.manage',

  contractRead: 'employment.contract.read',
  contractManage: 'employment.contract.manage',

  /** The status, assignment, manager and contract timelines — how it got to be this way. */
  historyRead: 'employment.history.read',

  importEmployments: 'employment.import',
  /** Taking the workforce out of the product. Separate, and held by fewer people than reading. */
  exportEmployments: 'employment.export',
} as const;

export type EmploymentPermission =
  (typeof EmploymentPermissions)[keyof typeof EmploymentPermissions];

export const ALL_EMPLOYMENT_PERMISSIONS: readonly EmploymentPermission[] =
  Object.values(EmploymentPermissions);
