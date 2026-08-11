import { uuidV7 } from '@work/kernel';

import {
  bilingualFrom,
  checkedCode,
  checkedMetadata,
  checkedOptionalCode,
  checkedPeriod,
  checkedText,
  definedOnly,
  type BilingualInput,
  type BilingualText,
  type EffectivePeriod,
  type Metadata,
} from './compensation-aggregate.js';
import { accept, refuse, type CompensationResult } from './compensation-rejection.js';
import { checkedMoney, sameCurrency, type MoneyAmount, type MoneyInput } from './money-amount.js';
import type { DefinitionStatus } from './compensation-vocabulary.js';

/**
 * The salary hierarchy: a structure, its grades, and each grade's scales.
 *
 * ```text
 * salary_structure          (optional)
 *         └── pay_grade     (optional)
 *                 └── pay_scale   (optional)
 *                         └── salary_step   (optional)
 * ```
 *
 * **Every level is optional and none implies another.** A compensation assignment may reference a
 * step, a scale, a grade, a structure, or none of them — carrying a bare amount instead. That is
 * the difference between a model that fits a forty-person company and one that only fits a
 * ministry, and the five shapes the specification names are all expressible without a level being
 * mandatory anywhere.
 *
 * **A referenced level constrains; it never computes.** Where an assignment names a grade, the
 * amount is checked against the grade's range and refused outside it by name. A grade never
 * *supplies* a midpoint silently: a system that filled one in would be deciding somebody's salary.
 */

/** A minimum, a midpoint and a maximum in one currency. Ordered by construction. */
export interface PayRange {
  readonly minimum: MoneyAmount;
  readonly midpoint: MoneyAmount;
  readonly maximum: MoneyAmount;
}

export interface PayRangeInput {
  readonly minimum: MoneyInput;
  readonly midpoint: MoneyInput;
  readonly maximum: MoneyInput;
}

/**
 * A checked pay range.
 *
 * Three currencies must agree — a grade whose minimum is in one currency and maximum in another is
 * not a range, and nothing in this module converts (§20.4). The ordering is checked here **and** by
 * a database check constraint: the constraint is the guarantee, this is the refusal a caller can
 * read.
 */
export const checkedRange = (input: PayRangeInput, field: string): CompensationResult<PayRange> => {
  const minimum = checkedMoney(input.minimum, `${field}.minimum`);

  if (!minimum.ok) return minimum;

  const midpoint = checkedMoney(input.midpoint, `${field}.midpoint`);

  if (!midpoint.ok) return midpoint;

  const maximum = checkedMoney(input.maximum, `${field}.maximum`);

  if (!maximum.ok) return maximum;

  if (!sameCurrency(minimum.value, midpoint.value) || !sameCurrency(minimum.value, maximum.value)) {
    return refuse('range_currencies_differ', { field });
  }
  if (
    minimum.value.amountMinor > midpoint.value.amountMinor ||
    midpoint.value.amountMinor > maximum.value.amountMinor
  ) {
    return refuse('range_out_of_order', { field });
  }
  return accept({ minimum: minimum.value, midpoint: midpoint.value, maximum: maximum.value });
};

export interface SalaryStructureState extends EffectivePeriod {
  readonly id: string;
  readonly tenantId: string;
  readonly code: string;
  readonly name: BilingualText;
  readonly description?: string;
  readonly status: DefinitionStatus;
  readonly metadata: Metadata;
  readonly version: number;
}

export interface DefineSalaryStructure {
  readonly tenantId: string;
  readonly code: string;
  readonly name: BilingualInput;
  readonly description?: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly metadata?: Metadata;
}

const DESCRIPTION_LIMIT = 1024;

export const salaryStructure = (
  request: DefineSalaryStructure,
  occurredAt: Date,
): CompensationResult<SalaryStructureState> => {
  const code = checkedCode(request.code, 'code');

  if (!code.ok) return code;

  const name = bilingualFrom(request.name, 'name');

  if (!name.ok) return name;

  const description = checkedText(request.description, 'description', DESCRIPTION_LIMIT);

  if (!description.ok) return description;

  const period = checkedPeriod(request.effectiveFrom, request.effectiveTo, 'structure');

  if (!period.ok) return period;

  const metadata = checkedMetadata(request.metadata);

  if (!metadata.ok) return metadata;

  return accept({
    id: uuidV7(occurredAt.getTime()),
    tenantId: request.tenantId,
    code: code.value,
    name: name.value,
    ...definedOnly({ description: description.value }),
    status: 'draft',
    ...period.value,
    metadata: metadata.value,
    version: 0,
  });
};

/**
 * A pay range that positions may be paid within, effective-dated.
 *
 * `positionGradeLabel` is the whole of its relationship with Organization's `position.grade`, and
 * it is a **label rather than a foreign key** (D-8). Organization's grade is an opaque
 * job-architecture band a tenant authors; this is a monetary range. They are related in practice,
 * and the relationship is configuration: a screen can say "positions in band C map to pay grade C"
 * without either module owning the other's concept. Nothing in this module branches on it, and a
 * tenant using one and not the other is unaffected.
 */
export interface PayGradeState extends EffectivePeriod {
  readonly id: string;
  readonly tenantId: string;
  readonly salaryStructureId?: string;
  readonly code: string;
  readonly name: BilingualText;
  readonly description?: string;
  readonly range: PayRange;
  readonly positionGradeLabel?: string;
  readonly status: DefinitionStatus;
  readonly metadata: Metadata;
  readonly version: number;
}

export interface DefinePayGrade {
  readonly tenantId: string;
  readonly salaryStructureId?: string;
  readonly code: string;
  readonly name: BilingualInput;
  readonly description?: string;
  readonly range: PayRangeInput;
  readonly positionGradeLabel?: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly metadata?: Metadata;
}

export const payGrade = (
  request: DefinePayGrade,
  occurredAt: Date,
): CompensationResult<PayGradeState> => {
  const code = checkedCode(request.code, 'code');

  if (!code.ok) return code;

  const name = bilingualFrom(request.name, 'name');

  if (!name.ok) return name;

  const range = checkedRange(request.range, 'range');

  if (!range.ok) return range;

  const rest = checkedGradeRest(request);

  if (!rest.ok) return rest;

  return accept({
    id: uuidV7(occurredAt.getTime()),
    tenantId: request.tenantId,
    code: code.value,
    name: name.value,
    range: range.value,
    status: 'draft',
    ...definedOnly({ salaryStructureId: request.salaryStructureId }),
    ...rest.value,
    version: 0,
  });
};

const checkedGradeRest = (
  request: DefinePayGrade,
): CompensationResult<{
  readonly description?: string;
  readonly positionGradeLabel?: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly metadata: Metadata;
}> => {
  const description = checkedText(request.description, 'description', DESCRIPTION_LIMIT);

  if (!description.ok) return description;

  const label = checkedOptionalCode(request.positionGradeLabel, 'positionGradeLabel');

  if (!label.ok) return label;

  const period = checkedPeriod(request.effectiveFrom, request.effectiveTo, 'grade');

  if (!period.ok) return period;

  const metadata = checkedMetadata(request.metadata);

  if (!metadata.ok) return metadata;

  return accept({
    ...definedOnly({ description: description.value, positionGradeLabel: label.value }),
    ...period.value,
    metadata: metadata.value,
  });
};
