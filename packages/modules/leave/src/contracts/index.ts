/**
 * The public contract of Leave.
 *
 * This is the entire surface other modules, the API and the SDK may depend on. Its repositories,
 * its tables and its aggregates are private and stay private.
 *
 * Four absences carry more weight than anything present.
 *
 * **No money.** Not a rate, not a multiplier, not an amount. `paidTreatmentCode` is a code Leave
 * stores and never interprets, and `encashableMinutes` is eligibility rather than worth. What a
 * leave day costs is Compensation's and Payroll's (§21).
 *
 * **No employment fact.** No person, no employee number, no employment status. A consumer asking
 * whether somebody is employed is asking Employment, as at a date (ADR-0051) — and there is no
 * `on_leave` status anywhere in this product, because an absence is not a change of employment
 * status (ADR-0040).
 *
 * **No attendance.** No punch, no worked minutes, no schedule, no working-day engine. Leave asks
 * Attendance what a working day is; it does not decide, and it never writes an Attendance row.
 *
 * **No statutory content.** No leave type, no entitlement figure, no accrual formula and no
 * eligibility threshold ships in this module. Every one of them is configuration a tenant or a
 * country pack supplies (00B, §22).
 *
 * Contracts are versioned. A breaking change to anything exported here requires an ADR.
 */

export type {
  AccrualMethod,
  CarryOverMethod,
  DayPortion,
  Decision,
  DefinitionStatus,
  DurationBasis,
  EntitlementSource,
  LeaveUnit,
  LeaveYearCalendar,
  LedgerKind,
  LedgerSource,
  ProrationBasis,
  RequestEventKind,
  RequestState,
  Scope,
} from '../domain/leave-vocabulary.js';

/**
 * The state sets themselves, not just their types.
 *
 * A consumer narrowing an untyped string — a request parameter, a row — needs the set, and the
 * alternative is every consumer writing its own copy of the list.
 */
export {
  ACCRUAL_METHODS,
  APPROVED_REQUEST_STATES,
  CARRY_OVER_METHODS,
  DAY_PORTIONS,
  DECISIONS,
  DEFINITION_STATUSES,
  DURATION_BASES,
  ENTITLEMENT_SOURCES,
  LEAVE_UNITS,
  LEAVE_YEAR_CALENDARS,
  LEDGER_KINDS,
  LEDGER_SOURCES,
  LIVE_REQUEST_STATES,
  PERMITTED_TRANSITIONS,
  PRORATION_BASES,
  REQUEST_EVENT_KINDS,
  REQUEST_STATES,
  SCOPES,
  canTransition,
  isApproved,
  isLive,
  signAgreesWithKind,
} from '../domain/leave-vocabulary.js';

export type {
  AccrualRunView,
  EntitlementView,
  LeaveAdjustmentView,
  LeaveApprovalChainView,
  LeaveApprovalStepView,
  LeaveBalanceView,
  LeaveCalendarEntryView,
  LeaveDashboardView,
  LeavePayrollPeriodView,
  LeavePolicyView,
  LeaveRequestDayView,
  LeaveRequestView,
  LeaveTypeView,
  LedgerEntryView,
  PolicyAssignmentView,
  ProjectedBalanceView,
} from './views.js';
