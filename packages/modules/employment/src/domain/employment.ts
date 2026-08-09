import type { EventOrigin } from '@work/kernel';

import {
  EmploymentAggregate,
  checkedCivilDate,
  checkedCode,
  checkedMetadata,
  checkedOptionalCode,
  checkedText,
  type Metadata,
} from './employment-aggregate.js';
import { checkedAmendment, checkedCreate } from './employment-checks.js';
import type {
  AmendEmployment,
  CreateEmployment,
  EmploymentState,
  EndEmployment,
} from './employment-state.js';
import { EmploymentEvents } from './employment-events.js';
import { accept, refuse, type EmploymentResult } from './employment-rejection.js';
import { acceptsAmendment, canTransition, type EmploymentStatus } from './employment-vocabulary.js';

/**
 * An Employment: the relationship between one Person and this tenant's workforce.
 *
 * Person is permanent and employment is temporary. The same human being may be hired, leave, and
 * return four years later — and that is *two* employments with two numbers and one Person
 * (AD-001, AD-004). Everything in this product that asks "are they employed" asks this aggregate;
 * everything that asks "who are they" asks People.
 *
 * **What this aggregate deliberately has no field for.** No unit, department, branch, position,
 * cost centre or manager: where an employment sits in the organization changes, and where it sat
 * when a decision was taken must stay answerable, so placement lives entirely in
 * `EmploymentAssignment` on a timeline (AD-005). No attendance (AD-006), no leave balance
 * (AD-007), no salary and no payroll figure (AD-008). No leave *status*: an employee on annual
 * leave is employed, and their leave is Leave's.
 *
 * **What is here is what does not have a placement's history**: which person this is, the number
 * they are known by, how the relationship is classified, when it began, when it ended and why.
 */

const NOTE_LIMIT = 1024;

export type {
  AmendEmployment,
  CreateEmployment,
  EmploymentState,
  EndEmployment,
} from './employment-state.js';

export class Employment extends EmploymentAggregate {
  private constructor(private state: EmploymentState) {
    super(state.id, state.tenantId, state.version, 'Employment');
  }

  /**
   * Every check runs and the first failure returns, in sequence rather than nested.
   *
   * An employment is created as a **draft**. It is not in force until somebody activates it, which
   * is what makes a prepared hire, a half-finished import and an approved-but-not-started
   * employment three distinguishable things rather than one ambiguous row.
   */
  public static create(
    request: CreateEmployment,
    origin: EventOrigin,
    occurredAt: Date,
  ): EmploymentResult<Employment> {
    const checked = checkedCreate(request, occurredAt);

    if (!checked.ok) return checked;

    const employment = new Employment({ ...checked.value, status: 'draft', version: 0 });

    employment.raise(
      EmploymentEvents.employmentCreated,
      {
        employmentId: employment.id,
        personId: request.personId,
        startDate: checked.value.startDate,
      },
      origin,
      occurredAt,
    );
    return accept(employment);
  }

  public static rehydrate(state: EmploymentState): Employment {
    return new Employment(state);
  }

  public get personId(): string {
    return this.state.personId;
  }

  public get employmentNumber(): string {
    return this.state.employmentNumber;
  }

  public get status(): EmploymentStatus {
    return this.state.status;
  }

  public get startDate(): string {
    return this.state.startDate;
  }

  public get originalHireDate(): string {
    return this.state.originalHireDate;
  }

  /**
   * Moves the employment to another state, or refuses.
   *
   * The machine is data (`PERMITTED_TRANSITIONS`) rather than a chain of conditionals, so every
   * pair is testable and the refused ones are as visible as the permitted ones. Ending is not
   * reachable here: it carries a date and a reason, and a transition that could reach `ended`
   * without them would produce an employment nobody can settle.
   */
  public transitionTo(
    status: EmploymentStatus,
    reasonCode: string | undefined,
    origin: EventOrigin,
    occurredAt: Date,
  ): EmploymentResult<EmploymentStatus> {
    if (status === 'ended') return refuse('ending_needs_a_date_and_a_reason');
    if (status === this.state.status) {
      return refuse('employment_already_in_status', { status });
    }
    if (!canTransition(this.state.status, status)) {
      return refuse('transition_not_permitted', { from: this.state.status, to: status });
    }

    const code = checkedOptionalCode(reasonCode, 'reasonCode');

    if (!code.ok) return code;

    const from = this.state.status;

    this.state = { ...this.state, status };
    this.raiseTransition(from, status, reasonCode, origin, occurredAt);

    if (status === 'active') {
      this.raise(
        EmploymentEvents.employmentActivated,
        { employmentId: this.id, personId: this.state.personId, startDate: this.state.startDate },
        origin,
        occurredAt,
      );
    }
    return accept(status);
  }

  /**
   * Ends the employment: dated, explained and terminal.
   *
   * All three at once, because an ended employment missing any of them is a record nobody can act
   * on. Payroll's final settlement reads the date, the future Offboarding domain reads the reason,
   * and both read the fact that nothing follows — a returning employee is a *new* employment
   * (AD-004), which is why there is no path back out of this state.
   *
   * The reason is a **code the tenant or a country pack supplies**. Resignation, dismissal,
   * redundancy and end-of-contract carry different statutory consequences in every market this
   * product sells into, and a list shipped here would be labour law hardcoded in a domain model.
   */
  public end(
    request: EndEmployment,
    origin: EventOrigin,
    occurredAt: Date,
  ): EmploymentResult<string> {
    if (this.state.status === 'ended') return refuse('employment_already_ended');

    const endDate = checkedCivilDate(request.endDate, 'endDate');

    if (!endDate.ok) return endDate;
    if (endDate.value < this.state.startDate) return refuse('end_before_start');

    const reasonCode = checkedCode(request.endReasonCode, 'endReasonCode');

    if (!reasonCode.ok) return reasonCode;

    const note = checkedText(request.note, 'note', NOTE_LIMIT);

    if (!note.ok) return note;

    const from = this.state.status;

    this.state = {
      ...this.state,
      status: 'ended',
      endDate: endDate.value,
      endReasonCode: reasonCode.value,
    };
    this.raiseTransition(from, 'ended', reasonCode.value, origin, occurredAt);
    this.raise(
      EmploymentEvents.employmentEnded,
      {
        employmentId: this.id,
        personId: this.state.personId,
        endDate: endDate.value,
        endReasonCode: reasonCode.value,
      },
      origin,
      occurredAt,
    );
    return accept(endDate.value);
  }

  /**
   * Amends how the employment is classified, and — only while it is not yet in force — its start
   * date.
   *
   * The date rule is the one worth defending. A draft is a preparation, and correcting a typed
   * start date in one is ordinary. An *active* employment's start date is a fact other records
   * already depend on: a probation end computed from it, a service length, an accrual. Changing it
   * afterwards would silently restate all three, so it is refused and the correction becomes a
   * deliberate, visible act rather than an edit (§12).
   */
  public amend(
    request: AmendEmployment,
    origin: EventOrigin,
    occurredAt: Date,
  ): EmploymentResult<EmploymentState> {
    if (!acceptsAmendment(this.state.status)) return refuse('employment_ended');

    const checked = checkedAmendment(request, this.state);

    if (!checked.ok) return checked;

    this.state = { ...this.state, ...checked.value };
    this.raise(
      EmploymentEvents.employmentAmended,
      { employmentId: this.id, fields: Object.keys(checked.value) },
      origin,
      occurredAt,
    );
    return accept(this.state);
  }

  public reviseMetadata(
    metadata: Metadata,
    origin: EventOrigin,
    occurredAt: Date,
  ): EmploymentResult<Metadata> {
    if (!acceptsAmendment(this.state.status)) return refuse('employment_ended');

    const checked = checkedMetadata(metadata);

    if (!checked.ok) return checked;

    this.state = { ...this.state, metadata: checked.value };
    this.raise(
      EmploymentEvents.employmentMetadataChanged,
      { employmentId: this.id, keys: Object.keys(checked.value) },
      origin,
      occurredAt,
    );
    return accept(checked.value);
  }

  public snapshot(): EmploymentState {
    return { ...this.state, version: this.version };
  }

  private raiseTransition(
    from: EmploymentStatus,
    to: EmploymentStatus,
    reasonCode: string | undefined,
    origin: EventOrigin,
    occurredAt: Date,
  ): void {
    this.raise(
      EmploymentEvents.employmentStatusChanged,
      {
        employmentId: this.id,
        personId: this.state.personId,
        from,
        to,
        ...(reasonCode === undefined ? {} : { reasonCode }),
      },
      origin,
      occurredAt,
    );
  }
}
