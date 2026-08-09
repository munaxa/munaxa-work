import { uuidV7, type EventOrigin } from '@work/kernel';

import {
  RecruitmentAggregate,
  checkedCode,
  checkedMetadata,
  checkedOptionalCivilDate,
  checkedOptionalCode,
  type Metadata,
} from './recruitment-aggregate.js';
import { RecruitmentEvents } from './recruitment-events.js';
import { accept, refuse, type RecruitmentResult } from './recruitment-rejection.js';
import {
  REQUISITION_TRANSITIONS,
  isRequisitionOpen,
  type RequisitionStatus,
} from './recruitment-vocabulary.js';

/**
 * A Job Requisition: the internal authority to hire.
 *
 * It is the control this whole domain hangs from. A vacancy cannot exist without an approved
 * requisition, and a hire cannot be recorded beyond the headcount one authorized — which is what
 * makes "approval authorises hiring" a rule the system enforces rather than a sentence in a policy
 * document.
 *
 * **The approval is real** (ADR-0045). A decision is made by a named human, taken from the
 * authenticated context, recorded in a row that is never amended, and reversible only by another
 * row that says so. Nothing here is auto-approved: the shipped `AutoApprovingPort` records
 * `system:auto-approval` honestly, and an approval nobody made is not an approval of a control that
 * authorizes spending.
 *
 * **What this aggregate deliberately has no field for**: a position title, a unit name, a country, a
 * currency, a salary band. The first two are Organization's and would go stale; the third and fourth
 * resolve from the unit's legal entity (ADR-0035); the fifth is Compensation's.
 */

export interface RequisitionState {
  readonly id: string;
  readonly tenantId: string;
  readonly requisitionNumber: string;
  readonly status: RequisitionStatus;
  /** `organization`'s, by identifier. No cached title. */
  readonly positionId: string;
  readonly unitId: string;
  readonly costCenterId?: string;
  readonly headcountRequested: number;
  /** Maintained from this module's own hires. Organization owns the *budgeted* number, not this. */
  readonly headcountFilled: number;
  readonly reasonCode: string;
  readonly priorityCode?: string;
  readonly targetStartDate?: string;
  readonly requestedByEmploymentId: string;
  readonly hiringManagerEmploymentId?: string;
  /** Set when Workflow routes the decision. Null while Recruitment decides it directly. */
  readonly approvalId?: string;
  readonly metadata: Metadata;
  readonly version: number;
}

export interface CreateRequisition {
  readonly tenantId: string;
  readonly requisitionNumber: string;
  readonly positionId: string;
  readonly unitId: string;
  readonly costCenterId?: string;
  readonly headcountRequested: number;
  readonly reasonCode: string;
  readonly priorityCode?: string;
  readonly targetStartDate?: string;
  readonly requestedByEmploymentId: string;
  readonly hiringManagerEmploymentId?: string;
  readonly metadata?: Metadata;
}

const MAX_HEADCOUNT = 10_000;

export class Requisition extends RecruitmentAggregate {
  private constructor(private state: RequisitionState) {
    super(state.id, state.tenantId, state.version, 'Requisition');
  }

  public static create(
    request: CreateRequisition,
    origin: EventOrigin,
    occurredAt: Date,
  ): RecruitmentResult<Requisition> {
    const checked = checkedRequisition(request);

    if (!checked.ok) return checked;

    const requisition = new Requisition({
      id: uuidV7(occurredAt.getTime()),
      tenantId: request.tenantId,
      requisitionNumber: request.requisitionNumber,
      status: 'draft',
      positionId: request.positionId,
      unitId: request.unitId,
      headcountFilled: 0,
      requestedByEmploymentId: request.requestedByEmploymentId,
      ...checked.value,
      version: 0,
    });

    requisition.raise(
      RecruitmentEvents.requisitionCreated,
      {
        requisitionId: requisition.id,
        positionId: request.positionId,
        unitId: request.unitId,
        headcountRequested: request.headcountRequested,
      },
      origin,
      occurredAt,
    );
    return accept(requisition);
  }

  public static rehydrate(state: RequisitionState): Requisition {
    return new Requisition(state);
  }

  public get status(): RequisitionStatus {
    return this.state.status;
  }

  public get positionId(): string {
    return this.state.positionId;
  }

  public get unitId(): string {
    return this.state.unitId;
  }

  public get headcountRemaining(): number {
    return this.state.headcountRequested - this.state.headcountFilled;
  }

  /** Submitting for a decision. Separate from deciding, and by a different person. */
  public submit(origin: EventOrigin, occurredAt: Date): RecruitmentResult<RequisitionStatus> {
    const moved = this.moveTo('pending_approval');

    if (!moved.ok) return moved;

    this.raise(
      RecruitmentEvents.requisitionSubmitted,
      { requisitionId: this.id, headcountRequested: this.state.headcountRequested },
      origin,
      occurredAt,
    );
    return accept(this.state.status);
  }

  /**
   * Records a decision.
   *
   * The aggregate moves; the *evidence* is a separate, immutable row written by the use case in the
   * same transaction. Keeping them apart is deliberate: the status answers "where is this now" and
   * the decision row answers "who decided, when, and did anybody undo it" — and the second question
   * is the one a headcount audit asks.
   */
  public decide(
    decision: 'approved' | 'rejected',
    origin: EventOrigin,
    occurredAt: Date,
  ): RecruitmentResult<RequisitionStatus> {
    if (this.state.status !== 'pending_approval') {
      return refuse('requisition_not_awaiting_decision', { status: this.state.status });
    }

    const moved = this.moveTo(decision);

    if (!moved.ok) return moved;

    this.raise(
      RecruitmentEvents.requisitionDecided,
      { requisitionId: this.id, decision },
      origin,
      occurredAt,
    );
    return accept(this.state.status);
  }

  /**
   * Reverses an approval, returning the requisition for a fresh decision.
   *
   * The correction mechanism A-3 requires. It does not edit the decision that was made — that row
   * stands — and it cannot be used once hiring has begun, because unmaking the authority for a hire
   * that already happened would leave the hire unauthorized rather than undone.
   */
  public reverseDecision(
    origin: EventOrigin,
    occurredAt: Date,
  ): RecruitmentResult<RequisitionStatus> {
    if (this.state.status !== 'approved' && this.state.status !== 'rejected') {
      return refuse('requisition_has_no_decision_to_reverse', { status: this.state.status });
    }
    if (this.state.headcountFilled > 0) return refuse('requisition_already_filled');

    const moved = this.moveTo('pending_approval');

    if (!moved.ok) return moved;

    this.raise(
      RecruitmentEvents.requisitionDecided,
      { requisitionId: this.id, decision: 'reversed' },
      origin,
      occurredAt,
    );
    return accept(this.state.status);
  }

  /** Opening for recruiting. Approval and recruiting are different acts, often weeks apart. */
  public open(origin: EventOrigin, occurredAt: Date): RecruitmentResult<RequisitionStatus> {
    const moved = this.moveTo('open');

    if (!moved.ok) return moved;

    this.raise(
      RecruitmentEvents.requisitionCreated,
      { requisitionId: this.id },
      origin,
      occurredAt,
    );
    return accept(this.state.status);
  }

  public close(
    reasonCode: string | undefined,
    origin: EventOrigin,
    occurredAt: Date,
  ): RecruitmentResult<RequisitionStatus> {
    const code = checkedOptionalCode(reasonCode, 'reasonCode');

    if (!code.ok) return code;

    const moved = this.moveTo('closed');

    if (!moved.ok) return moved;

    this.raise(
      RecruitmentEvents.requisitionClosed,
      {
        requisitionId: this.id,
        filled: this.state.headcountFilled,
        requested: this.state.headcountRequested,
        ...(code.value === undefined ? {} : { reasonCode: code.value }),
      },
      origin,
      occurredAt,
    );
    return accept(this.state.status);
  }

  public cancel(origin: EventOrigin, occurredAt: Date): RecruitmentResult<RequisitionStatus> {
    if (this.state.headcountFilled > 0) return refuse('requisition_already_filled');

    const moved = this.moveTo('cancelled');

    if (!moved.ok) return moved;

    this.raise(RecruitmentEvents.requisitionClosed, { requisitionId: this.id }, origin, occurredAt);
    return accept(this.state.status);
  }

  /**
   * Records a hire against this requisition.
   *
   * The invariant that makes a requisition a control rather than a label: hiring more people than
   * were authorized is refused, in the domain and again by a check constraint. Both, because the
   * domain gives the recruiter a reason and the constraint holds when two hires race.
   */
  public recordHire(): RecruitmentResult<number> {
    if (!isRequisitionOpen(this.state.status)) {
      return refuse('requisition_not_open', { status: this.state.status });
    }
    if (this.headcountRemaining <= 0) return refuse('requisition_headcount_exhausted');

    this.state = { ...this.state, headcountFilled: this.state.headcountFilled + 1 };
    return accept(this.state.headcountFilled);
  }

  public snapshot(): RequisitionState {
    return { ...this.state, version: this.version };
  }

  private moveTo(status: RequisitionStatus): RecruitmentResult<RequisitionStatus> {
    if (!REQUISITION_TRANSITIONS[this.state.status].includes(status)) {
      return refuse('requisition_transition_not_permitted', {
        from: this.state.status,
        to: status,
      });
    }
    this.state = { ...this.state, status };
    return accept(status);
  }
}

/** The creation checks, hoisted so `create` stays inside the function budget. */
const checkedRequisition = (
  request: CreateRequisition,
): RecruitmentResult<{
  readonly costCenterId?: string;
  readonly headcountRequested: number;
  readonly reasonCode: string;
  readonly priorityCode?: string;
  readonly targetStartDate?: string;
  readonly hiringManagerEmploymentId?: string;
  readonly metadata: Metadata;
}> => {
  const codes = checkedRequisitionCodes(request);

  if (!codes.ok) return codes;

  const headcount = request.headcountRequested;

  // Bounded against a typing mistake rather than against a policy. A requisition for ten thousand
  // people is a keystroke, not a hiring plan.
  if (!Number.isInteger(headcount) || headcount < 1 || headcount > MAX_HEADCOUNT) {
    return refuse('headcount_out_of_range');
  }

  const metadata = checkedMetadata(request.metadata);

  if (!metadata.ok) return metadata;

  return accept({
    ...(request.costCenterId === undefined ? {} : { costCenterId: request.costCenterId }),
    headcountRequested: headcount,
    ...codes.value,
    ...(request.hiringManagerEmploymentId === undefined
      ? {}
      : { hiringManagerEmploymentId: request.hiringManagerEmploymentId }),
    metadata: metadata.value,
  });
};

/** Why the role is being filled, how urgently, and when it is wanted. All tenant data (00B). */
const checkedRequisitionCodes = (
  request: CreateRequisition,
): RecruitmentResult<{
  readonly reasonCode: string;
  readonly priorityCode?: string;
  readonly targetStartDate?: string;
}> => {
  const reasonCode = checkedCode(request.reasonCode, 'reasonCode');

  if (!reasonCode.ok) return reasonCode;

  const priorityCode = checkedOptionalCode(request.priorityCode, 'priorityCode');

  if (!priorityCode.ok) return priorityCode;

  const targetStartDate = checkedOptionalCivilDate(request.targetStartDate, 'targetStartDate');

  if (!targetStartDate.ok) return targetStartDate;

  return accept({
    reasonCode: reasonCode.value,
    ...(priorityCode.value === undefined ? {} : { priorityCode: priorityCode.value }),
    ...(targetStartDate.value === undefined ? {} : { targetStartDate: targetStartDate.value }),
  });
};

/**
 * The evidence of a decision: who decided, what they decided, when, and what it reverses.
 *
 * A plain shape rather than an aggregate, because nothing about a recorded decision can
 * subsequently change — there is nothing for an aggregate to protect. Modelling it as one would
 * suggest otherwise.
 */
export interface RequisitionDecisionState {
  readonly id: string;
  readonly tenantId: string;
  readonly requisitionId: string;
  readonly decision: 'approved' | 'rejected' | 'reversed';
  readonly reasonCode?: string;
  readonly note?: string;
  /** Taken from the authenticated context. A caller cannot supply it. */
  readonly decidedBy: string;
  readonly decidedAt: Date;
  /** The decision this one reverses. Set only on a reversal. */
  readonly reversesId?: string;
  readonly version: number;
}

export const requisitionDecision = (
  request: Omit<RequisitionDecisionState, 'id' | 'version'>,
  recordedAt: Date,
): RequisitionDecisionState => ({
  id: uuidV7(recordedAt.getTime()),
  ...request,
  version: 0,
});
