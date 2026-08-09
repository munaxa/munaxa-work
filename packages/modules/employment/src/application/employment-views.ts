import { inForceOn } from '../domain/versioned-child.js';
import type { EmploymentAssignmentState } from '../domain/employment-assignment.js';
import type { EmploymentContractState } from '../domain/employment-contract.js';
import type { EmploymentState } from '../domain/employment.js';
import type { ReportingLineState } from '../domain/reporting-line.js';
import type { StatusRecordState } from '../domain/status-record.js';
import type {
  AssignmentView,
  ContractView,
  EmploymentView,
  ReportingLineView,
  StatusRecordView,
} from '../contracts/views.js';

/**
 * Domain state to published view.
 *
 * The conversion is in the application layer rather than the domain, because a view is an answer
 * to a consumer's question and the domain has no consumers — and because this is where the two
 * decisions that shape every read live:
 *
 * **The effective-dated parts are resolved at a date**, once, here. Every caller that wanted
 * "current" and every caller that wanted "as at last March" go through the same function, so the
 * two cannot drift into different notions of what is in force.
 *
 * **A person's name is attached only when the caller may read it.** The resolver is passed in
 * rather than reached for, so a view built without one simply has no name — which is what a caller
 * lacking `people.person.read` receives, rather than a 403 that would make the employment list
 * unusable for everybody who is not an HR administrator.
 */

export type NameResolver = (personId: string) => Readonly<Record<string, string>> | undefined;

export interface EmploymentTimelines {
  readonly assignments: readonly EmploymentAssignmentState[];
  readonly reportingLines: readonly ReportingLineState[];
}

export const employmentView = (
  state: EmploymentState,
  asOf: Date,
  timelines: EmploymentTimelines,
  nameOf?: NameResolver,
): EmploymentView => {
  const primary = inForceOn(
    timelines.assignments.filter((assignment) => assignment.assignmentType === 'primary'),
    asOf,
  )?.value;
  const line = inForceOn(
    timelines.reportingLines.filter((reporting) => reporting.lineType === 'primary'),
    asOf,
  )?.value;
  const personName = nameOf?.(state.personId);

  return {
    employmentId: state.id,
    employmentNumber: state.employmentNumber,
    personId: state.personId,
    ...(personName === undefined ? {} : { personName }),
    status: state.status,
    employmentTypeCode: state.employmentTypeCode,
    originalHireDate: state.originalHireDate,
    startDate: state.startDate,
    asOf: asOf.toISOString().slice(0, 10),
    ...optionalFieldsOf(state),
    ...(primary === undefined ? {} : { assignment: assignmentView(primary) }),
    ...(line === undefined ? {} : { managerEmploymentId: line.managerEmploymentId }),
    metadata: state.metadata,
    version: state.version,
  };
};

/**
 * The fields an employment may not carry, hoisted out of the view.
 *
 * Absent rather than null throughout: a consumer that received `endReasonCode: null` cannot tell
 * "still employed" from "we did not record why", and the two lead to different behaviour.
 */
const optionalFieldsOf = (state: EmploymentState): Partial<EmploymentView> => ({
  ...(state.externalEmployeeNumber === undefined
    ? {}
    : { externalEmployeeNumber: state.externalEmployeeNumber }),
  ...(state.employmentCategoryCode === undefined
    ? {}
    : { employmentCategoryCode: state.employmentCategoryCode }),
  ...(state.employmentClassCode === undefined
    ? {}
    : { employmentClassCode: state.employmentClassCode }),
  ...(state.endDate === undefined ? {} : { endDate: state.endDate }),
  ...(state.endReasonCode === undefined ? {} : { endReasonCode: state.endReasonCode }),
});

export const assignmentView = (state: EmploymentAssignmentState): AssignmentView => ({
  assignmentId: state.id,
  employmentId: state.employmentId,
  unitId: state.unitId,
  ...(state.positionId === undefined ? {} : { positionId: state.positionId }),
  ...(state.costCenterId === undefined ? {} : { costCenterId: state.costCenterId }),
  assignmentType: state.assignmentType,
  fte: state.fte,
  ...(state.reasonCode === undefined ? {} : { reasonCode: state.reasonCode }),
  effectiveFrom: state.effectiveFrom,
  ...(state.effectiveTo === undefined ? {} : { effectiveTo: state.effectiveTo }),
  version: state.version,
});

export const reportingLineView = (state: ReportingLineState): ReportingLineView => ({
  reportingLineId: state.id,
  employmentId: state.employmentId,
  managerEmploymentId: state.managerEmploymentId,
  lineType: state.lineType,
  effectiveFrom: state.effectiveFrom,
  ...(state.effectiveTo === undefined ? {} : { effectiveTo: state.effectiveTo }),
  version: state.version,
});

export const contractView = (state: EmploymentContractState): ContractView => ({
  contractId: state.id,
  employmentId: state.employmentId,
  ...(state.contractNumber === undefined ? {} : { contractNumber: state.contractNumber }),
  contractTypeCode: state.contractTypeCode,
  startDate: state.startDate,
  ...(state.endDate === undefined ? {} : { endDate: state.endDate }),
  ...(state.probationEndDate === undefined ? {} : { probationEndDate: state.probationEndDate }),
  ...(state.probationOutcome === undefined ? {} : { probationOutcome: state.probationOutcome }),
  ...(state.noticePeriodDays === undefined ? {} : { noticePeriodDays: state.noticePeriodDays }),
  ...(state.workingHoursPerWeek === undefined
    ? {}
    : { workingHoursPerWeek: state.workingHoursPerWeek }),
  ...(state.documentReference === undefined ? {} : { documentReference: state.documentReference }),
  effectiveFrom: state.effectiveFrom,
  ...(state.effectiveTo === undefined ? {} : { effectiveTo: state.effectiveTo }),
  version: state.version,
});

/**
 * The status history, oldest first.
 *
 * `recordedBy` is published because "who suspended this person" is the question a dispute asks, and
 * an audit trail that cannot name the actor answers none of the questions audit exists for. It is
 * the authenticated actor infrastructure wrote, never a value a caller supplied.
 */
export const statusRecordView = (state: StatusRecordState): StatusRecordView => ({
  recordId: state.id,
  employmentId: state.employmentId,
  ...(state.fromStatus === undefined ? {} : { fromStatus: state.fromStatus }),
  toStatus: state.toStatus,
  ...(state.reasonCode === undefined ? {} : { reasonCode: state.reasonCode }),
  ...(state.note === undefined ? {} : { note: state.note }),
  effectiveFrom: state.effectiveFrom,
  recordedBy: state.recordedBy,
  recordedAt: state.recordedAt,
});

/** Oldest first, which is how a history is read. */
export const byEffectiveFrom = <TState extends { readonly effectiveFrom: Date }>(
  left: TState,
  right: TState,
): number => left.effectiveFrom.getTime() - right.effectiveFrom.getTime();
