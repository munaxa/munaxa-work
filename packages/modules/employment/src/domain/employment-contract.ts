import { uuidV7, type EventOrigin } from '@work/kernel';

import {
  checkedCivilDate,
  checkedCode,
  checkedDocumentReference,
  checkedOptionalCivilDate,
} from './employment-aggregate.js';
import { EmploymentEvents } from './employment-events.js';
import { VersionedChild, type VersionedChildState } from './versioned-child.js';
import { accept, refuse, type EmploymentResult } from './employment-rejection.js';
import type { ProbationOutcome } from './employment-vocabulary.js';

/**
 * The contract behind an employment, and from when.
 *
 * **Terms as recorded, never as computed.** `noticePeriodDays` is what the parties agreed;
 * whether a statutory minimum overrides it is a country pack's question (Phase 11.1), and a rule
 * here that clamped it would be labour law hardcoded in a domain model. The same holds for
 * probation: this records the date it ends and how it concluded, and knows nothing about how long
 * a probation may lawfully be in any market (00B).
 *
 * **The document is a reference.** A contract PDF lives in the future Documents domain; this holds
 * the identifier that will resolve it and stores no bytes (§24).
 *
 * A renewal is a **new contract period**, not an edited one — the timeline is what makes "which
 * terms applied when that decision was taken" answerable, and an edited row destroys exactly that.
 */

export interface EmploymentContractState extends VersionedChildState {
  readonly contractNumber?: string;
  readonly contractTypeCode: string;
  readonly startDate: string;
  readonly endDate?: string;
  readonly probationEndDate?: string;
  readonly probationOutcome?: ProbationOutcome;
  readonly noticePeriodDays?: number;
  readonly workingHoursPerWeek?: number;
  readonly documentReference?: string;
}

export interface RecordContract {
  readonly tenantId: string;
  readonly employmentId: string;
  readonly contractNumber?: string;
  readonly contractTypeCode: string;
  readonly startDate: string;
  readonly endDate?: string;
  readonly probationEndDate?: string;
  readonly noticePeriodDays?: number;
  readonly workingHoursPerWeek?: number;
  readonly documentReference?: string;
  readonly effectiveFrom: Date;
}

const MAX_NOTICE_DAYS = 3650;
const MAX_HOURS_PER_WEEK = 168;

export class EmploymentContract extends VersionedChild<EmploymentContractState> {
  private constructor(state: EmploymentContractState) {
    super(state, 'EmploymentContract', EmploymentEvents.contractClosed);
  }

  public static record(
    request: RecordContract,
    origin: EventOrigin,
    occurredAt: Date,
  ): EmploymentResult<EmploymentContract> {
    const checked = checkedContract(request);

    if (!checked.ok) return checked;

    const contract = new EmploymentContract({
      id: uuidV7(occurredAt.getTime()),
      tenantId: request.tenantId,
      employmentId: request.employmentId,
      ...checked.value,
      // A probation that exists is pending until somebody concludes it. A contract with a
      // probation end date and no outcome would leave "did they pass" unanswerable.
      ...(checked.value.probationEndDate === undefined ? {} : { probationOutcome: 'pending' }),
      effectiveFrom: request.effectiveFrom,
      version: 0,
    });

    contract.raise(
      EmploymentEvents.contractRecorded,
      {
        contractId: contract.id,
        employmentId: request.employmentId,
        contractTypeCode: checked.value.contractTypeCode,
        startDate: checked.value.startDate,
        effectiveFrom: request.effectiveFrom,
      },
      origin,
      occurredAt,
    );
    return accept(contract);
  }

  public static rehydrate(state: EmploymentContractState): EmploymentContract {
    return new EmploymentContract(state);
  }

  public get probationEndDate(): string | undefined {
    return this.state.probationEndDate;
  }

  public get probationOutcome(): ProbationOutcome | undefined {
    return this.state.probationOutcome;
  }

  /**
   * Records how a probation concluded.
   *
   * There is no `failed` outcome. A probation somebody did not pass **ends the employment**, which
   * is a status transition carrying its own date, its own reason and its own events — recording it
   * here instead would leave the employment reading `active` while the business believed it was
   * over, and payroll would keep paying.
   */
  public concludeProbation(
    outcome: ProbationOutcome,
    origin: EventOrigin,
    occurredAt: Date,
  ): EmploymentResult<ProbationOutcome> {
    if (this.state.probationEndDate === undefined) return refuse('contract_has_no_probation');
    if (this.state.probationOutcome !== undefined && this.state.probationOutcome !== 'pending') {
      return refuse('probation_already_concluded');
    }

    this.state = { ...this.state, probationOutcome: outcome };
    this.raise(
      EmploymentEvents.probationConcluded,
      { contractId: this.id, employmentId: this.state.employmentId, outcome },
      origin,
      occurredAt,
    );
    return accept(outcome);
  }
}

/** The contract checks, hoisted so `record` stays inside the function budget. */
const checkedContract = (
  request: RecordContract,
): EmploymentResult<Omit<EmploymentContractState, keyof VersionedChildState>> => {
  const contractTypeCode = checkedCode(request.contractTypeCode, 'contractTypeCode');

  if (!contractTypeCode.ok) return contractTypeCode;

  const dates = checkedContractDates(request);

  if (!dates.ok) return dates;

  const terms = checkedTerms(request);

  if (!terms.ok) return terms;

  const documentReference = checkedDocumentReference(request.documentReference);

  if (!documentReference.ok) return documentReference;

  const contractNumber =
    request.contractNumber === undefined
      ? accept(undefined)
      : checkedCode(request.contractNumber, 'contractNumber');

  if (!contractNumber.ok) return contractNumber;

  return accept({
    ...(contractNumber.value === undefined ? {} : { contractNumber: contractNumber.value }),
    contractTypeCode: contractTypeCode.value,
    ...dates.value,
    ...terms.value,
    ...(documentReference.value === undefined
      ? {}
      : { documentReference: documentReference.value }),
  });
};

const checkedContractDates = (
  request: RecordContract,
): EmploymentResult<{
  readonly startDate: string;
  readonly endDate?: string;
  readonly probationEndDate?: string;
}> => {
  const startDate = checkedCivilDate(request.startDate, 'startDate');

  if (!startDate.ok) return startDate;

  const endDate = checkedNotBefore(
    request.endDate,
    'endDate',
    startDate.value,
    'contract_ends_before_it_begins',
  );

  if (!endDate.ok) return endDate;

  const probationEndDate = checkedNotBefore(
    request.probationEndDate,
    'probationEndDate',
    startDate.value,
    'probation_ends_before_contract_begins',
  );

  if (!probationEndDate.ok) return probationEndDate;

  return accept({
    startDate: startDate.value,
    ...(endDate.value === undefined ? {} : { endDate: endDate.value }),
    ...(probationEndDate.value === undefined ? {} : { probationEndDate: probationEndDate.value }),
  });
};

/** An optional date that, when present, must not fall before the contract's own start. */
const checkedNotBefore = (
  value: string | undefined,
  field: string,
  startDate: string,
  reason: string,
): EmploymentResult<string | undefined> => {
  const checked = checkedOptionalCivilDate(value, field);

  if (!checked.ok) return checked;
  if (checked.value !== undefined && checked.value < startDate) return refuse(reason);
  return checked;
};

/**
 * Notice and working hours, bounded against typing mistakes rather than against law.
 *
 * The bounds refuse what cannot be true anywhere — a negative notice period, a week longer than a
 * week — and say nothing about what is lawful in any market. That distinction is the whole of 00B:
 * the architecture holds the shape, the country pack holds the rule.
 */
const checkedTerms = (
  request: RecordContract,
): EmploymentResult<{
  readonly noticePeriodDays?: number;
  readonly workingHoursPerWeek?: number;
}> => {
  const notice = request.noticePeriodDays;
  const hours = request.workingHoursPerWeek;

  if (!plausibleWholeDays(notice)) return refuse('notice_period_out_of_range');
  if (!plausibleWeeklyHours(hours)) return refuse('working_hours_out_of_range');

  return accept({
    ...(notice === undefined ? {} : { noticePeriodDays: notice }),
    ...(hours === undefined ? {} : { workingHoursPerWeek: Number(hours.toFixed(2)) }),
  });
};

const plausibleWholeDays = (value: number | undefined): boolean =>
  value === undefined || (Number.isInteger(value) && value >= 0 && value <= MAX_NOTICE_DAYS);

const plausibleWeeklyHours = (value: number | undefined): boolean =>
  value === undefined || (Number.isFinite(value) && value > 0 && value <= MAX_HOURS_PER_WEEK);
