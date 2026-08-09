import { uuidV7 } from '@work/kernel';

import {
  checkedCivilDate,
  checkedCode,
  checkedMetadata,
  checkedOptionalCode,
} from './employment-aggregate.js';
import { accept, refuse, type EmploymentResult } from './employment-rejection.js';
import { checkedEmploymentNumber, checkedExternalNumber } from './employment-number.js';
import type { AmendEmployment, CreateEmployment, EmploymentState } from './employment-state.js';

/**
 * The checks a creation and an amendment run, apart from the aggregate.
 *
 * Not because they are a different concern — they are the aggregate's own rules — but because
 * fourteen sequential checks and a 400-line budget do not fit in one file, and the budget exists so
 * that a class which grew past it gets split deliberately rather than by whoever adds the fifteenth.
 *
 * Every function here returns on the first failure rather than nesting, which keeps each rule on
 * its own line — what somebody debugging a rejected import is actually looking for.
 */

/** The creation checks, hoisted so `create` stays inside the function budget. */
export const checkedCreate = (
  request: CreateEmployment,
  occurredAt: Date,
): EmploymentResult<Omit<EmploymentState, 'status' | 'version'>> => {
  const employmentNumber = checkedEmploymentNumber(request.employmentNumber);

  if (!employmentNumber.ok) return employmentNumber;

  const external = checkedExternalNumber(request.externalEmployeeNumber);

  if (!external.ok) return external;

  const typeCode = checkedCode(request.employmentTypeCode, 'employmentTypeCode');

  if (!typeCode.ok) return typeCode;

  const classification = checkedClassification(request);

  if (!classification.ok) return classification;

  const dates = checkedDates(request);

  if (!dates.ok) return dates;

  const metadata = checkedMetadata(request.metadata);

  if (!metadata.ok) return metadata;

  return accept({
    id: uuidV7(occurredAt.getTime()),
    tenantId: request.tenantId,
    personId: request.personId,
    employmentNumber: employmentNumber.value,
    ...(external.value === undefined ? {} : { externalEmployeeNumber: external.value }),
    employmentTypeCode: typeCode.value,
    ...classification.value,
    ...dates.value,
    metadata: metadata.value,
  });
};

const checkedClassification = (
  request: CreateEmployment,
): EmploymentResult<{
  readonly employmentCategoryCode?: string;
  readonly employmentClassCode?: string;
}> => {
  const category = checkedOptionalCode(request.employmentCategoryCode, 'employmentCategoryCode');

  if (!category.ok) return category;

  const employmentClass = checkedOptionalCode(request.employmentClassCode, 'employmentClassCode');

  if (!employmentClass.ok) return employmentClass;

  return accept({
    ...(category.value === undefined ? {} : { employmentCategoryCode: category.value }),
    ...(employmentClass.value === undefined ? {} : { employmentClassCode: employmentClass.value }),
  });
};

/**
 * The two dates a creation carries.
 *
 * `originalHireDate` defaults to the start date, which is right for a first employment and wrong
 * for a rehire — so a rehire supplies the earlier one explicitly, and the refusal below is what
 * catches the transposition that would otherwise date somebody's service from the future.
 */
const checkedDates = (
  request: CreateEmployment,
): EmploymentResult<{ readonly originalHireDate: string; readonly startDate: string }> => {
  const startDate = checkedCivilDate(request.startDate, 'startDate');

  if (!startDate.ok) return startDate;

  const hire =
    request.originalHireDate === undefined
      ? accept(startDate.value)
      : checkedCivilDate(request.originalHireDate, 'originalHireDate');

  if (!hire.ok) return hire;
  if (hire.value > startDate.value) return refuse('hire_after_start');

  return accept({ originalHireDate: hire.value, startDate: startDate.value });
};

/** The amendment checks, hoisted for the same reason the creation's are. */
export const checkedAmendment = (
  request: AmendEmployment,
  state: EmploymentState,
): EmploymentResult<Partial<EmploymentState>> => {
  const changes: Record<string, string> = {};
  const codes = [
    ['employmentTypeCode', request.employmentTypeCode],
    ['employmentCategoryCode', request.employmentCategoryCode],
    ['employmentClassCode', request.employmentClassCode],
  ] as const;

  for (const [field, value] of codes) {
    if (value === undefined) continue;

    const checked = checkedCode(value, field);

    if (!checked.ok) return checked;
    changes[field] = checked.value;
  }

  const external = checkedExternalNumber(request.externalEmployeeNumber);

  if (!external.ok) return external;
  if (external.value !== undefined) changes['externalEmployeeNumber'] = external.value;

  if (request.startDate !== undefined) {
    const start = checkedStartDateCorrection(request.startDate, state);

    if (!start.ok) return start;
    changes['startDate'] = start.value;
  }
  return accept(changes);
};

const checkedStartDateCorrection = (
  value: string,
  state: EmploymentState,
): EmploymentResult<string> => {
  if (state.status !== 'draft' && state.status !== 'pending_approval') {
    return refuse('start_date_is_in_force');
  }

  const startDate = checkedCivilDate(value, 'startDate');

  if (!startDate.ok) return startDate;
  if (state.originalHireDate > startDate.value) return refuse('hire_after_start');
  return accept(startDate.value);
};
