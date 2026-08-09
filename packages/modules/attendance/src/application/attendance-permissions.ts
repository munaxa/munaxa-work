/**
 * Every permission this module registers.
 *
 * Declared here and referenced by handlers, never spelled out at a call site, because a permission
 * string that exists in two places will eventually differ in one — and the difference fails open
 * exactly once, on the endpoint whose spelling nobody checked.
 *
 * **Six separations are deliberate, and each protects a different thing.**
 *
 * *Recording an event* is not managing attendance. A turnstile's service account needs one narrow
 * permission and must not be able to sign a day off. This is the permission a device integration
 * holds, and it is the smallest one in the module.
 *
 * *Reading a day* is not reading its raw events. The events carry device identifiers and, where a
 * tenant enables capture, coordinates; a supervisor reviewing worked hours needs neither.
 *
 * *Requesting a correction* is not approving one. The domain additionally refuses self-approval, so
 * this separation holds even for somebody granted both — a control that depends on nobody holding
 * two roles is a control that fails the first time somebody does.
 *
 * *Publishing a schedule* is not drafting one. A published schedule is what a hundred people are
 * measured against and what an auditor reads; drafting next quarter's rota is ordinary work.
 *
 * *Freezing a period* is its own permission, because it is the number Payroll pays.
 *
 * *Exporting* is held by fewer people than reading, because an export is the highest-volume
 * disclosure this module can make and attendance data says when a named person came and went.
 */
export const AttendancePermissions = {
  read: 'attendance.read',
  /** Raw events, with their device evidence. Narrower than reading a day, deliberately. */
  eventRead: 'attendance.event.read',
  /** Submitting a time event. Held by an integration principal, a clock, or an administrator. */
  eventRecord: 'attendance.event.record',
  /** What an employee holds for their *own* punch. Never anybody else's (Phase 18). */
  eventRecordOwn: 'attendance.event.record-own',
  /** What an employee holds to see their *own* attendance (Phase 18). */
  readOwn: 'attendance.read-own',

  manage: 'attendance.manage',
  recalculate: 'attendance.recalculate',
  approve: 'attendance.approve',

  correctionRequest: 'attendance.correct.request',
  /** Deciding one. Never the same permission as requesting it. */
  correctionApprove: 'attendance.correct.approve',
  exceptionResolve: 'attendance.exception.resolve',

  scheduleManage: 'attendance.schedule.manage',
  /** Freezing a shift or a schedule. Separate from drafting it. */
  schedulePublish: 'attendance.schedule.publish',
  rosterManage: 'attendance.roster.manage',
  policyManage: 'attendance.policy.manage',

  import: 'attendance.import',
  /** Producing the payable snapshot Payroll consumes. */
  periodFreeze: 'attendance.period.freeze',
  /** Taking the attendance register out of the product. Held by fewer people than read. */
  export: 'attendance.export',
} as const;

export type AttendancePermission =
  (typeof AttendancePermissions)[keyof typeof AttendancePermissions];

export const ALL_ATTENDANCE_PERMISSIONS: readonly AttendancePermission[] =
  Object.values(AttendancePermissions);
