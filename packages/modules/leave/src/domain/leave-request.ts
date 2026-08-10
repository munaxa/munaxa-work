import { uuidV7, type EventOrigin } from '@work/kernel';

import { LeaveEvents } from './leave-events.js';
import {
  LeaveAggregate,
  checkedCivilDate,
  checkedMetadata,
  checkedOptionalCode,
  checkedText,
  definedOnly,
  type Metadata,
} from './leave-aggregate.js';
import { accept, refuse, type LeaveResult } from './leave-rejection.js';
import { canTransition, isApproved, type Decision, type RequestState } from './leave-vocabulary.js';
import type { DurationBasis } from './leave-vocabulary.js';
import type { LeaveRequestState } from './leave-request-state.js';

/**
 * A request to be absent, and the state machine that governs what may happen to it.
 *
 * **The machine is data** (`PERMITTED_TRANSITIONS`), tested exhaustively over every ordered pair of
 * states. A switch statement is only tested where somebody thought to write a case; a table is
 * tested everywhere, which is the only way to know that a transition nobody considered is refused
 * rather than merely unimplemented.
 *
 * **Consumption is written at `approved`, not at `taken`.** An approved future absence is already
 * committed: the balance an employee sees must not include leave they have been granted, or they
 * will plan against it twice. `taken` is a clerical state that changes no figure.
 *
 * **An approved request is never edited.** Shortening it, lengthening it, moving it or changing its
 * type are all *amendments*: a new request superseding the original, decided by a named human, with
 * a reversal of the original consumption and a fresh consumption written in the transaction that
 * approves it (§14). The original keeps its rows and its ledger entries.
 *
 * **Cancellation reverses; it never deletes.** The consumption entry stays and a reversal is
 * written beside it, because "consumed and then given back" and "never consumed" are different
 * facts about somebody's year.
 */

export interface RaiseLeaveRequest {
  readonly tenantId: string;
  readonly employmentId: string;
  readonly leaveTypeId: string;
  readonly leavePolicyId: string;
  readonly fromDate: string;
  readonly toDate: string;
  readonly totalMinutes: number;
  readonly durationBasis: DurationBasis;
  readonly requestedBy: string;
  readonly balanceAtRequestMinutes: number;
  readonly approvalsRequired: number;
  readonly reasonCode?: string;
  readonly justification?: string;
  readonly contactDuringAbsence?: string;
  readonly addressDuringAbsence?: string;
  readonly replacementEmploymentId?: string;
  readonly delegationId?: string;
  readonly attachmentReference?: string;
  readonly supersedesRequestId?: string;
  readonly metadata?: Metadata;
}

const JUSTIFICATION_LIMIT = 1024;
const CONTACT_LIMIT = 255;
const ADDRESS_LIMIT = 512;
const REFERENCE_LIMIT = 512;

export class LeaveRequest extends LeaveAggregate {
  private constructor(private state: LeaveRequestState) {
    super(state.id, state.tenantId, state.version, 'LeaveRequest');
  }

  public static raise(request: RaiseLeaveRequest, occurredAt: Date): LeaveResult<LeaveRequest> {
    const period = checkedRequestPeriod(request);

    if (!period.ok) return period;

    const text = checkedNarrative(request);

    if (!text.ok) return text;

    const metadata = checkedMetadata(request.metadata);

    if (!metadata.ok) return metadata;

    return accept(
      new LeaveRequest({
        id: uuidV7(occurredAt.getTime()),
        tenantId: request.tenantId,
        employmentId: request.employmentId,
        leaveTypeId: request.leaveTypeId,
        leavePolicyId: request.leavePolicyId,
        ...period.value,
        totalMinutes: request.totalMinutes,
        durationBasis: request.durationBasis,
        state: 'draft',
        requestedBy: request.requestedBy,
        requestedAt: occurredAt,
        balanceAtRequestMinutes: request.balanceAtRequestMinutes,
        approvalsRequired: request.approvalsRequired,
        ...text.value,
        ...definedOnly({
          replacementEmploymentId: request.replacementEmploymentId,
          delegationId: request.delegationId,
          supersedesRequestId: request.supersedesRequestId,
        }),
        metadata: metadata.value,
        version: 0,
      }),
    );
  }

  public static rehydrate(state: LeaveRequestState): LeaveRequest {
    return new LeaveRequest(state);
  }

  public get currentState(): RequestState {
    return this.state.state;
  }

  public get employmentId(): string {
    return this.state.employmentId;
  }

  public get requestedBy(): string {
    return this.state.requestedBy;
  }

  public get approvalsRequired(): number {
    return this.state.approvalsRequired;
  }

  /**
   * Asserted, and from here on it blocks a date and holds balance.
   *
   * A policy requiring no approval sends it straight to `approved` **with no decision row**. The
   * absence of the row is itself the record: writing `system:auto-approval` into a decision would
   * be recording an approval nobody made, which is the fake completeness this phase refuses
   * (ADR-0045).
   */
  public submit(origin: EventOrigin, at: Date): LeaveResult<LeaveRequestState> {
    const moved = this.moveTo('submitted');

    if (!moved.ok) return moved;

    this.state = { ...this.state, submittedAt: at };
    this.raise(
      LeaveEvents.requestSubmitted,
      { employmentId: this.state.employmentId, fromDate: this.state.fromDate },
      origin,
      at,
    );

    if (this.state.approvalsRequired === 0) return this.approve(origin, at);

    return this.moveTo('pending_approval');
  }

  /**
   * A decision recorded against the request.
   *
   * The decision *row* is written by the use case — it is a child table, not aggregate state — but
   * the transition is decided here, and it depends on how many decisions have already been made.
   * The request stays `pending_approval` until the policy's count of **distinct approvers** is met;
   * there is no escalation, no timeout and no conditional path, because those are Workflow's and
   * building them here would be the second workflow engine the instruction forbids (§12.2).
   */
  public decide(
    outcome: { readonly decision: Decision; readonly decisionsSoFar: number },
    origin: EventOrigin,
    at: Date,
  ): LeaveResult<LeaveRequestState> {
    if (outcome.decision === 'rejected') {
      const rejected = this.moveTo('rejected');

      if (!rejected.ok) return rejected;

      this.state = { ...this.state, rejectedAt: at };
      this.raise(LeaveEvents.requestRejected, { requestId: this.id }, origin, at);
      return accept(this.state);
    }

    if (outcome.decisionsSoFar < this.state.approvalsRequired) return accept(this.state);

    return this.approve(origin, at);
  }

  /** Withdrawal: taking back an undecided request. No ledger effect, and refused after a decision. */
  public withdraw(at: Date): LeaveResult<LeaveRequestState> {
    const moved = this.moveTo('withdrawn');

    if (!moved.ok) return moved;

    this.state = { ...this.state, withdrawnAt: at };
    return accept(this.state);
  }

  /**
   * Cancellation: unmaking an *approved* request.
   *
   * Names who did it and why, because the reversal it writes to the ledger has to be explainable
   * years later. The reversal itself is the use case's work; what the aggregate guarantees is that
   * a cancellation without an actor and a reason cannot be recorded.
   */
  public cancel(
    by: { readonly actor: string; readonly reasonCode?: string },
    origin: EventOrigin,
    at: Date,
  ): LeaveResult<LeaveRequestState> {
    const reason = checkedOptionalCode(by.reasonCode, 'cancellationReasonCode');

    if (!reason.ok) return reason;

    const moved = this.moveTo('cancelled');

    if (!moved.ok) return moved;

    this.state = {
      ...this.state,
      cancelledAt: at,
      cancelledBy: by.actor,
      ...(reason.value === undefined ? {} : { cancellationReasonCode: reason.value }),
    };
    this.raise(
      LeaveEvents.requestCancelled,
      { requestId: this.id, employmentId: this.state.employmentId },
      origin,
      at,
    );
    return accept(this.state);
  }

  /** The leave period has begun. A clerical state that changes no figure (§35.3). */
  public markTaken(): LeaveResult<LeaveRequestState> {
    return this.moveTo('taken');
  }

  /** The leave year is settled and the request is beyond amendment. */
  public close(): LeaveResult<LeaveRequestState> {
    return this.moveTo('closed');
  }

  /** Whether this request currently grants leave, and is therefore visible to Attendance. */
  public get grantsLeave(): boolean {
    return isApproved(this.state.state);
  }

  public snapshot(): LeaveRequestState {
    return this.state;
  }

  private approve(origin: EventOrigin, at: Date): LeaveResult<LeaveRequestState> {
    const moved = this.moveTo('approved');

    if (!moved.ok) return moved;

    this.state = { ...this.state, approvedAt: at };
    this.raise(
      LeaveEvents.requestApproved,
      {
        requestId: this.id,
        employmentId: this.state.employmentId,
        fromDate: this.state.fromDate,
        toDate: this.state.toDate,
      },
      origin,
      at,
    );
    return accept(this.state);
  }

  /**
   * The one place a state changes.
   *
   * Every transition goes through the table, including the ones a method "obviously" knows are
   * fine — because the method that knows is the method that gets a new caller.
   */
  private moveTo(next: RequestState): LeaveResult<LeaveRequestState> {
    if (!canTransition(this.state.state, next)) {
      return refuse('request_transition_not_permitted', { from: this.state.state, to: next });
    }
    this.state = { ...this.state, state: next };
    return accept(this.state);
  }
}

const checkedRequestPeriod = (
  request: RaiseLeaveRequest,
): LeaveResult<{ readonly fromDate: string; readonly toDate: string }> => {
  const from = checkedCivilDate(request.fromDate, 'fromDate');

  if (!from.ok) return from;

  const to = checkedCivilDate(request.toDate, 'toDate');

  if (!to.ok) return to;
  if (to.value < from.value) return refuse('period_ends_before_it_begins');
  if (!Number.isInteger(request.totalMinutes) || request.totalMinutes < 0) {
    return refuse('minutes_out_of_range', { field: 'totalMinutes' });
  }
  return accept({ fromDate: from.value, toDate: to.value });
};

/**
 * The free text and the references a request carries.
 *
 * The justification is the sensitive one: on a sick-leave request it is close to health data, which
 * is why `leave.balance.read` exists as a permission separate from `leave.read` and why no domain
 * event carries it (§30).
 */
const checkedNarrative = (
  request: RaiseLeaveRequest,
): LeaveResult<{
  readonly reasonCode?: string;
  readonly justification?: string;
  readonly contactDuringAbsence?: string;
  readonly addressDuringAbsence?: string;
  readonly attachmentReference?: string;
}> => {
  const reason = checkedOptionalCode(request.reasonCode, 'reasonCode');

  if (!reason.ok) return reason;

  const justification = checkedText(request.justification, 'justification', JUSTIFICATION_LIMIT);

  if (!justification.ok) return justification;

  const contact = checkedText(request.contactDuringAbsence, 'contactDuringAbsence', CONTACT_LIMIT);

  if (!contact.ok) return contact;

  const address = checkedText(request.addressDuringAbsence, 'addressDuringAbsence', ADDRESS_LIMIT);

  if (!address.ok) return address;

  const attachment = checkedText(
    request.attachmentReference,
    'attachmentReference',
    REFERENCE_LIMIT,
  );

  if (!attachment.ok) return attachment;

  return accept(
    definedOnly({
      reasonCode: reason.value,
      justification: justification.value,
      contactDuringAbsence: contact.value,
      addressDuringAbsence: address.value,
      attachmentReference: attachment.value,
    }),
  );
};
