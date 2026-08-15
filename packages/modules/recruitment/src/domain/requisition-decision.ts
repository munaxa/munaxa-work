import { uuidV7 } from '@work/kernel';

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
