/**
 * Every permission this module registers.
 *
 * Declared here and referenced by handlers, never spelled out at a call site, because a permission
 * string that exists in two places will eventually differ in one — and the difference fails open
 * exactly once, on the endpoint whose spelling nobody checked.
 *
 * **Five separations are deliberate, and each protects a different thing.**
 *
 * *Publishing* a plan version is not editing one. A published version is what a hundred joiners are
 * measured against and what an auditor reads; drafting the next one is ordinary work.
 *
 * *Starting* an onboarding is not managing one. Starting creates a record against a real employment
 * and is the operation reconciliation performs in bulk.
 *
 * *Completing* is its own permission, and so is *cancelling*. Completion is a statement that
 * everything required was done; cancellation says somebody will not be joining after all. Neither is
 * a side effect of managing a task list.
 *
 * *Waiving* a required task is not completing it. "We did it" and "it did not apply to this person"
 * are different answers, and the second is the one an auditor asks about.
 *
 * *Completing one's own task* is separate from completing anybody's. It is the permission Employee
 * Self-Service (Phase 18) will grant every employee, and it must never be able to close somebody
 * else's task — which is why it is a different string rather than a flag on the same one.
 */
export const OnboardingPermissions = {
  planRead: 'onboarding.plan.read',
  planManage: 'onboarding.plan.manage',
  /** Freezing a version. Separate from drafting it. */
  planPublish: 'onboarding.plan.publish',

  read: 'onboarding.read',
  manage: 'onboarding.manage',
  /** Creating an onboarding against a real employment; also what reconciliation performs. */
  start: 'onboarding.start',
  complete: 'onboarding.complete',
  cancel: 'onboarding.cancel',

  taskRead: 'onboarding.task.read',
  taskManage: 'onboarding.task.manage',
  taskComplete: 'onboarding.task.complete',
  /** What an employee holds for their *own* tasks. Never anybody else's (Phase 18). */
  taskCompleteOwn: 'onboarding.task.complete-own',
  taskWaive: 'onboarding.task.waive',
  taskReassign: 'onboarding.task.reassign',

  /** Taking the onboarding register out of the product. Held by fewer people than read. */
  export: 'onboarding.export',
} as const;

export type OnboardingPermission =
  (typeof OnboardingPermissions)[keyof typeof OnboardingPermissions];

export const ALL_ONBOARDING_PERMISSIONS: readonly OnboardingPermission[] =
  Object.values(OnboardingPermissions);
