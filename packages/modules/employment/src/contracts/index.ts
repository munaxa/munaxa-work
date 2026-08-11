/**
 * The public contract of Employment.
 *
 * This is the entire surface other modules, the API and the SDK may depend on. Its repositories,
 * its tables and its aggregates are private and stay private — and in this module that matters
 * more than in any before it, because every later phase consumes Employment. Attendance, Leave,
 * Payroll, Benefits, Performance and Offboarding all resolve "is this person employed, where do
 * they sit and who do they report to" through here, and a consumer that reached past this file
 * would be a consumer this module can never change.
 *
 * Two entries carry more weight than the rest.
 *
 * `EmploymentView` carries its placement and its manager **as at a date**. A consumer that ignored
 * `asOf` would put this year's department on last year's payroll re-run, and the field is on the
 * view rather than implied so that ignoring it is a visible choice.
 *
 * `EmploymentSnapshot.statusOn` is reconstructed from the status history rather than read from the
 * employment row. The row answers "now" and the history answers "then"; publishing both is what
 * stops a consumer asking one and believing it answered the other.
 *
 * Contracts are versioned. A breaking change to anything exported here requires an ADR.
 */

export type {
  AssignmentType,
  EmploymentStatus,
  ProbationOutcome,
  ReportingLineType,
} from '../domain/employment-vocabulary.js';

/**
 * The statuses themselves, not just their type.
 *
 * A consumer narrowing an untyped string — a request parameter, a row — needs the set, and the
 * alternative is every consumer writing its own copy of the list.
 */
export { EMPLOYMENT_STATUSES, PERMITTED_TRANSITIONS } from '../domain/employment-vocabulary.js';

export type {
  AssignmentView,
  ContractView,
  EmploymentHistoryView,
  EmploymentSnapshot,
  EmploymentView,
  ReportingLineView,
  StatusRecordView,
  WorkforceSnapshot,
} from './views.js';
