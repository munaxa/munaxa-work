import type { LeaveApprovalChainView, LeaveRequestView } from '@work/leave/contracts';

import type { RequestForDisplay, StandingForDisplay } from './api';
import { ANNUAL, EMPLOYMENT_A, PIECES, REQUEST_B, SICK } from './leave.fixture';

/**
 * The two detail pages' data, composed from the same pieces the register uses.
 *
 * Apart from `leave.fixture.ts` because a file's budget is four hundred lines, and because these
 * are compositions of that file's values rather than more values: keeping them together made it
 * hard to see that the request a detail page renders is one of the requests the register lists.
 */

const paged = <TItem>(items: readonly TItem[], total: number) => ({ items, total });

export const aRequestDetail = (extra: Partial<RequestForDisplay> = {}): RequestForDisplay => ({
  request: PIECES.request(REQUEST_B, EMPLOYMENT_A, 'approved', {
    approvedAt: new Date('2026-08-21T10:00:00.000Z'),
    justification: 'Family visit already booked.',
    reasonCode: 'family-visit',
  }),
  approvals: PIECES.approvals,
  types: PIECES.types,
  employment: PIECES.employment,
  ...extra,
});

/** A policy requiring no approval: no steps at all, and nobody named. */
export const anUnapprovedChain = (): LeaveApprovalChainView => ({
  state: 'approved',
  approvalRequired: false,
  approvalsRequired: 0,
  steps: [],
});

export const aFullStanding = (extra: Partial<StandingForDisplay> = {}): StandingForDisplay => ({
  balances: paged([PIECES.balance(EMPLOYMENT_A, ANNUAL), PIECES.balance(EMPLOYMENT_A, SICK)], 2),
  ledger: paged(PIECES.ledger, 1204),
  projection: { kind: 'ok', value: PIECES.projection },
  entitlements: paged(PIECES.entitlements, 4),
  adjustments: paged(PIECES.adjustments, 37),
  requests: paged([PIECES.requests[0] as LeaveRequestView], 12),
  types: PIECES.types,
  employment: PIECES.employment,
  ...extra,
});

export const anEmptyStanding = (): StandingForDisplay => ({
  balances: paged([], 0),
  ledger: paged([], 0),
  projection: undefined,
  entitlements: paged([], 0),
  adjustments: paged([], 0),
  requests: paged([], 0),
  types: PIECES.types,
  employment: PIECES.employment,
});

export const aRefusedStanding = (): StandingForDisplay => ({
  balances: undefined,
  ledger: undefined,
  projection: { kind: 'refused' },
  entitlements: undefined,
  adjustments: undefined,
  requests: undefined,
  types: undefined,
  employment: undefined,
});
