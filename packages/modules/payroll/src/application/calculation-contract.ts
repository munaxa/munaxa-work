import type { Command } from '@work/kernel';

import type { DeductionDefinitionState } from '../domain/deductions.js';
import type { PayrollGroupState } from '../domain/payroll-group.js';
import type { PayrollPeriodState } from '../domain/payroll-period.js';
import type { PayrollRunState } from '../domain/payroll-run.js';

/**
 * The command, its result, and the context a run is calculated in.
 *
 * Apart from both the handler and the batch driver because they each need these and neither should
 * import the other — the handler resolves what is being calculated, the driver grinds through it.
 */

export interface CalculateRunCommand extends Command {
  readonly commandName: 'payroll.calculate';
  readonly payrollPeriodId: string;
  /** Absent starts a new run; present resumes or recalculates an existing one. */
  readonly payrollRunId?: string;
  /** Present on a recalculation: only these employments are recomputed. */
  readonly employmentIds?: readonly string[];
  /** How many batches to run in this invocation. A long run is driven by repeated calls. */
  readonly maxBatches?: number;
}

export interface RunCalculated {
  readonly payrollRunId: string;
  readonly status: string;
  readonly resultCount: number;
  readonly exceptionCount: number;
  readonly complete: boolean;
}

export interface RunContext {
  readonly period: PayrollPeriodState;
  readonly group: PayrollGroupState;
  readonly definitions: readonly DeductionDefinitionState[];
  readonly run: PayrollRunState;
  readonly countryCode?: string;
}
