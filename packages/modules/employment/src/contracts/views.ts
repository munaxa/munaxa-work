import type {
  AssignmentType,
  EmploymentStatus,
  ProbationOutcome,
  ReportingLineType,
} from '../domain/employment-vocabulary.js';

/**
 * What Employment publishes.
 *
 * These are the shapes other modules, the API and the SDK depend on. The aggregates, the
 * repositories and the tables are private and stay private, because the moment Payroll reads
 * `employment_assignment` directly the boundary stops being a boundary — and Employment is the
 * module every later phase depends on, so its boundary is the one that has to hold longest.
 *
 * Three properties of these shapes are load-bearing.
 *
 * **`asOf` is on every view that carries effective-dated data**, rather than implied. An
 * employment's unit, position, cost centre and manager are all *as at a date*, and a consumer that
 * assumed "current" would put this year's department on last year's payroll re-run.
 *
 * **Organizational references are identifiers, never names.** `unitId`, not `unitName`. A name is
 * `organization`'s to resolve and changes when a department is renamed; a copy here would be a
 * second answer that is stale from the first rename.
 *
 * **A person's name is optional and its absence is meaningful.** It is resolved through People,
 * subject to People's own permissions, and a caller who may not read the person gets an employment
 * with no name rather than a blank one — the same distinction Phase 4 draws between "we do not
 * know" and "you may not see it".
 *
 * Contracts are versioned. A breaking change to anything in this file requires an ADR.
 */

export interface EmploymentView {
  readonly employmentId: string;
  readonly employmentNumber: string;
  readonly externalEmployeeNumber?: string;
  readonly personId: string;
  /** Present only when the caller may read the person. Absent is meaningful. */
  readonly personName?: Readonly<Record<string, string>>;
  readonly status: EmploymentStatus;
  readonly employmentTypeCode: string;
  readonly employmentCategoryCode?: string;
  readonly employmentClassCode?: string;
  readonly originalHireDate: string;
  readonly startDate: string;
  readonly endDate?: string;
  readonly endReasonCode?: string;
  /** The date the effective-dated parts of this view were resolved at. */
  readonly asOf: string;
  /** The placement in force on `asOf`. Absent when the employment has none on that date. */
  readonly assignment?: AssignmentView;
  /** The manager in force on `asOf`, by employment. Never by person (§16). */
  readonly managerEmploymentId?: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly version: number;
}

export interface AssignmentView {
  readonly assignmentId: string;
  readonly employmentId: string;
  readonly unitId: string;
  readonly positionId?: string;
  readonly costCenterId?: string;
  readonly assignmentType: AssignmentType;
  readonly fte: number;
  readonly reasonCode?: string;
  readonly effectiveFrom: Date;
  readonly effectiveTo?: Date;
  readonly version: number;
}

export interface ReportingLineView {
  readonly reportingLineId: string;
  readonly employmentId: string;
  readonly managerEmploymentId: string;
  readonly lineType: ReportingLineType;
  readonly effectiveFrom: Date;
  readonly effectiveTo?: Date;
  readonly version: number;
}

export interface ContractView {
  readonly contractId: string;
  readonly employmentId: string;
  readonly contractNumber?: string;
  readonly contractTypeCode: string;
  readonly startDate: string;
  readonly endDate?: string;
  readonly probationEndDate?: string;
  readonly probationOutcome?: ProbationOutcome;
  readonly noticePeriodDays?: number;
  readonly workingHoursPerWeek?: number;
  readonly documentReference?: string;
  readonly effectiveFrom: Date;
  readonly effectiveTo?: Date;
  readonly version: number;
}

export interface StatusRecordView {
  readonly recordId: string;
  readonly employmentId: string;
  readonly fromStatus?: EmploymentStatus;
  readonly toStatus: EmploymentStatus;
  readonly reasonCode?: string;
  readonly note?: string;
  readonly effectiveFrom: Date;
  readonly recordedBy: string;
  readonly recordedAt: Date;
}

/**
 * Everything about one employment, on one date and across its whole history.
 *
 * The three timelines are returned together because they are read together: "how did this
 * employment get to be the way it is" is one question, and answering it in three round trips is
 * three chances for a screen to render a manager from one date beside a department from another.
 */
export interface EmploymentHistoryView {
  readonly employmentId: string;
  readonly statusHistory: readonly StatusRecordView[];
  readonly assignments: readonly AssignmentView[];
  readonly reportingLines: readonly ReportingLineView[];
  readonly contracts: readonly ContractView[];
}

/** An employment as it stood on a date, with each timeline resolved to that date alone. */
export interface EmploymentSnapshot {
  readonly asOf: Date;
  readonly employment: EmploymentView;
  readonly assignments: readonly AssignmentView[];
  readonly reportingLine?: ReportingLineView;
  readonly contract?: ContractView;
  /** The status in force on `asOf`, reconstructed from the history rather than read from the row. */
  readonly statusOn?: EmploymentStatus;
}

/** The whole workforce, for export. Bounded by the same limit import is. */
export interface WorkforceSnapshot {
  readonly employments: readonly EmploymentView[];
  readonly assignments: readonly AssignmentView[];
  readonly reportingLines: readonly ReportingLineView[];
  readonly contracts: readonly ContractView[];
}
