import type { EmploymentAssignmentState } from '../domain/employment-assignment.js';
import type { EmploymentContractState } from '../domain/employment-contract.js';
import type { ReportingLineState } from '../domain/reporting-line.js';
import type {
  AssignmentType,
  ProbationOutcome,
  ReportingLineType,
} from '../domain/employment-vocabulary.js';

import type { ChildTable } from './child.repository.js';
import { asDecimal, asVersion, civilDateColumn, type RowValues } from './row-writer.js';

/**
 * The three child tables: their columns and the conversions to and from domain state.
 *
 * Together in one file because they are the same shape three times, and the thing worth comparing
 * is what differs. Apart from the repository because the repository's complexity budget is five
 * and a mapping with optional columns exceeds it — this is mapping rather than logic, and no rule
 * here decides anything.
 *
 * Every date column is selected as text (`to_char`). The driver would otherwise turn a `date` into
 * a JavaScript `Date` at the process's local midnight, and a contract start read on a server west
 * of UTC would come back as the previous day.
 */

export interface AssignmentRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly employment_id: string;
  readonly unit_id: string;
  readonly position_id: string | null;
  readonly cost_center_id: string | null;
  readonly assignment_type: string;
  readonly fte: string | number;
  readonly reason_code: string | null;
  readonly effective_from: Date;
  readonly effective_to: Date | null;
  readonly version: number | string;
}

export const ASSIGNMENT_TABLE: ChildTable<EmploymentAssignmentState, AssignmentRow> = {
  table: 'employment_assignment',
  columns:
    'id, tenant_id, employment_id, unit_id, position_id, cost_center_id, assignment_type, fte, reason_code, effective_from, effective_to, version',
  order: 'effective_from',

  toState: (row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    employmentId: row.employment_id,
    unitId: row.unit_id,
    ...(row.position_id === null ? {} : { positionId: row.position_id }),
    ...(row.cost_center_id === null ? {} : { costCenterId: row.cost_center_id }),
    assignmentType: row.assignment_type as AssignmentType,
    fte: asDecimal(row.fte) ?? 1,
    ...(row.reason_code === null ? {} : { reasonCode: row.reason_code }),
    effectiveFrom: row.effective_from,
    ...(row.effective_to === null ? {} : { effectiveTo: row.effective_to }),
    version: asVersion(row.version),
  }),

  toInsert: (state) => ({
    id: state.id,
    tenant_id: state.tenantId,
    employment_id: state.employmentId,
    ...assignmentValues(state),
  }),

  toUpdate: (state) => assignmentValues(state),
};

const assignmentValues = (state: EmploymentAssignmentState): RowValues => ({
  unit_id: state.unitId,
  position_id: state.positionId ?? null,
  cost_center_id: state.costCenterId ?? null,
  assignment_type: state.assignmentType,
  fte: state.fte,
  reason_code: state.reasonCode ?? null,
  effective_from: state.effectiveFrom,
  effective_to: state.effectiveTo ?? null,
});

export interface ReportingLineRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly employment_id: string;
  readonly manager_employment_id: string;
  readonly line_type: string;
  readonly effective_from: Date;
  readonly effective_to: Date | null;
  readonly version: number | string;
}

export const REPORTING_LINE_TABLE: ChildTable<ReportingLineState, ReportingLineRow> = {
  table: 'employment_reporting_line',
  columns:
    'id, tenant_id, employment_id, manager_employment_id, line_type, effective_from, effective_to, version',
  order: 'effective_from',

  toState: (row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    employmentId: row.employment_id,
    managerEmploymentId: row.manager_employment_id,
    lineType: row.line_type as ReportingLineType,
    effectiveFrom: row.effective_from,
    ...(row.effective_to === null ? {} : { effectiveTo: row.effective_to }),
    version: asVersion(row.version),
  }),

  toInsert: (state) => ({
    id: state.id,
    tenant_id: state.tenantId,
    employment_id: state.employmentId,
    ...reportingLineValues(state),
  }),

  toUpdate: (state) => reportingLineValues(state),
};

const reportingLineValues = (state: ReportingLineState): RowValues => ({
  manager_employment_id: state.managerEmploymentId,
  line_type: state.lineType,
  effective_from: state.effectiveFrom,
  effective_to: state.effectiveTo ?? null,
});

export interface ContractRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly employment_id: string;
  readonly contract_number: string | null;
  readonly contract_type_code: string;
  readonly start_date: string;
  readonly end_date: string | null;
  readonly probation_end_date: string | null;
  readonly probation_outcome: string | null;
  readonly notice_period_days: number | null;
  readonly working_hours_per_week: string | number | null;
  readonly document_reference: string | null;
  readonly effective_from: Date;
  readonly effective_to: Date | null;
  readonly version: number | string;
}

export const CONTRACT_TABLE: ChildTable<EmploymentContractState, ContractRow> = {
  table: 'employment_contract',
  columns: `id, tenant_id, employment_id, contract_number, contract_type_code, ${civilDateColumn('start_date')}, ${civilDateColumn('end_date')}, ${civilDateColumn('probation_end_date')}, probation_outcome, notice_period_days, working_hours_per_week, document_reference, effective_from, effective_to, version`,
  order: 'effective_from',

  toState: (row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    employmentId: row.employment_id,
    ...(row.contract_number === null ? {} : { contractNumber: row.contract_number }),
    contractTypeCode: row.contract_type_code,
    startDate: row.start_date,
    ...(row.end_date === null ? {} : { endDate: row.end_date }),
    ...(row.probation_end_date === null ? {} : { probationEndDate: row.probation_end_date }),
    ...(row.probation_outcome === null
      ? {}
      : { probationOutcome: row.probation_outcome as ProbationOutcome }),
    ...(row.notice_period_days === null ? {} : { noticePeriodDays: row.notice_period_days }),
    ...(row.working_hours_per_week === null
      ? {}
      : { workingHoursPerWeek: asDecimal(row.working_hours_per_week) ?? 0 }),
    ...(row.document_reference === null ? {} : { documentReference: row.document_reference }),
    effectiveFrom: row.effective_from,
    ...(row.effective_to === null ? {} : { effectiveTo: row.effective_to }),
    version: asVersion(row.version),
  }),

  toInsert: (state) => ({
    id: state.id,
    tenant_id: state.tenantId,
    employment_id: state.employmentId,
    ...contractValues(state),
  }),

  toUpdate: (state) => contractValues(state),
};

const contractValues = (state: EmploymentContractState): RowValues => ({
  contract_number: state.contractNumber ?? null,
  contract_type_code: state.contractTypeCode,
  start_date: state.startDate,
  end_date: state.endDate ?? null,
  probation_end_date: state.probationEndDate ?? null,
  probation_outcome: state.probationOutcome ?? null,
  notice_period_days: state.noticePeriodDays ?? null,
  working_hours_per_week: state.workingHoursPerWeek ?? null,
  document_reference: state.documentReference ?? null,
  effective_from: state.effectiveFrom,
  effective_to: state.effectiveTo ?? null,
});
