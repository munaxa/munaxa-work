import { uuidV7 } from '@work/kernel';

import {
  bilingualFrom,
  checkedCode,
  checkedMetadata,
  checkedOptionalCode,
  checkedPeriod,
  definedOnly,
  type BilingualInput,
  type BilingualText,
  type EffectivePeriod,
  type Metadata,
} from './compensation-aggregate.js';
import { accept, refuse, type CompensationResult } from './compensation-rejection.js';
import { checkedMoney, type MoneyAmount, type MoneyInput } from './money-amount.js';
import { checkedRange, type PayRange, type PayRangeInput } from './salary-structure.js';
import type { DefinitionStatus } from './compensation-vocabulary.js';

/**
 * The two lower levels of the hierarchy: a band within a grade, and a step within either.
 *
 * Apart from `salary-structure.ts` because that file holds the root and the grade and the shared
 * range checking, and one file for all four ran past its budget. The split follows the reading
 * order: a structure and a grade are *ranges*, a scale and a step are what an assignment actually
 * names.
 */

/**
 * A band within a grade.
 *
 * `progressionModel` is a **code** — `manual`, `annual`, `performance`, or anything a tenant or a
 * country pack names. Compensation stores it and **never acts on it**: nothing in this module moves
 * an employment between steps by itself, because automatic progression is a contractual or
 * statutory rule and this module ships neither.
 */
export interface PayScaleState extends EffectivePeriod {
  readonly id: string;
  readonly tenantId: string;
  readonly payGradeId: string;
  readonly code: string;
  readonly name: BilingualText;
  readonly range: PayRange;
  readonly progressionModel: string;
  readonly status: DefinitionStatus;
  readonly metadata: Metadata;
  readonly version: number;
}

export interface DefinePayScale {
  readonly tenantId: string;
  readonly payGradeId: string;
  readonly code: string;
  readonly name: BilingualInput;
  readonly range: PayRangeInput;
  readonly progressionModel: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly metadata?: Metadata;
}

export const payScale = (
  request: DefinePayScale,
  occurredAt: Date,
): CompensationResult<PayScaleState> => {
  const code = checkedCode(request.code, 'code');

  if (!code.ok) return code;

  const name = bilingualFrom(request.name, 'name');

  if (!name.ok) return name;

  const progression = checkedCode(request.progressionModel, 'progressionModel');

  if (!progression.ok) return progression;

  const range = checkedRange(request.range, 'range');

  if (!range.ok) return range;

  const period = checkedPeriod(request.effectiveFrom, request.effectiveTo, 'scale');

  if (!period.ok) return period;

  const metadata = checkedMetadata(request.metadata);

  if (!metadata.ok) return metadata;

  return accept({
    id: uuidV7(occurredAt.getTime()),
    tenantId: request.tenantId,
    payGradeId: request.payGradeId,
    code: code.value,
    name: name.value,
    range: range.value,
    progressionModel: progression.value,
    status: 'draft',
    ...period.value,
    metadata: metadata.value,
    version: 0,
  });
};

/**
 * A step, under a scale **or** under a grade — exactly one.
 *
 * **A step supplies an amount; it does not lock one.** An assignment referencing a step takes the
 * step's amount at the effective date and **stores it on the assignment**. That copy is the single
 * most important storage decision in this hierarchy: when the step's amount is revised next year,
 * last year's payroll re-run must still produce last year's figure, and a join to a mutable
 * reference table would silently rewrite history.
 */
export interface SalaryStepState extends EffectivePeriod {
  readonly id: string;
  readonly tenantId: string;
  readonly payScaleId?: string;
  readonly payGradeId?: string;
  readonly stepNumber: number;
  readonly code?: string;
  readonly amount: MoneyAmount;
  readonly metadata: Metadata;
  readonly version: number;
}

export interface DefineSalaryStep {
  readonly tenantId: string;
  readonly payScaleId?: string;
  readonly payGradeId?: string;
  readonly stepNumber: number;
  readonly code?: string;
  readonly amount: MoneyInput;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly metadata?: Metadata;
}

const MAX_STEP_NUMBER = 999;

export const salaryStep = (
  request: DefineSalaryStep,
  occurredAt: Date,
): CompensationResult<SalaryStepState> => {
  // Exactly one parent. A step under both would belong to two ladders; a step under neither would
  // belong to none, and both are refused by a check constraint as well as here.
  if ((request.payScaleId === undefined) === (request.payGradeId === undefined)) {
    return refuse('step_requires_exactly_one_parent');
  }
  if (!Number.isInteger(request.stepNumber) || request.stepNumber < 1) {
    return refuse('step_number_out_of_range', { field: 'stepNumber' });
  }
  if (request.stepNumber > MAX_STEP_NUMBER) {
    return refuse('step_number_out_of_range', { field: 'stepNumber' });
  }

  const code = checkedOptionalCode(request.code, 'code');

  if (!code.ok) return code;

  const amount = checkedMoney(request.amount, 'amount');

  if (!amount.ok) return amount;

  const period = checkedPeriod(request.effectiveFrom, request.effectiveTo, 'step');

  if (!period.ok) return period;

  const metadata = checkedMetadata(request.metadata);

  if (!metadata.ok) return metadata;

  return accept({
    id: uuidV7(occurredAt.getTime()),
    tenantId: request.tenantId,
    stepNumber: request.stepNumber,
    amount: amount.value,
    ...definedOnly({
      payScaleId: request.payScaleId,
      payGradeId: request.payGradeId,
      code: code.value,
    }),
    ...period.value,
    metadata: metadata.value,
    version: 0,
  });
};
