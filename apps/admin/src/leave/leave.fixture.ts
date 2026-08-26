import type { EmploymentView } from '@work/employment/contracts';
import type {
  AccrualRunView,
  EntitlementView,
  LeaveAdjustmentView,
  LeaveApprovalChainView,
  LeaveBalanceView,
  LeaveDashboardView,
  LeavePolicyView,
  LeaveRequestView,
  LeaveTypeView,
  LedgerEntryView,
  ProjectedBalanceView,
} from '@work/leave/contracts';

import type { LeaveRegister } from './api';

/**
 * The leave data the tests render, shaped by the module's published contracts.
 *
 * Every field is one the contract declares, so a fixture that drifts from the module fails to
 * compile rather than passing a test against a shape the API never produces. The values are chosen
 * to exercise the distinctions the slice exists to keep: a request in each interesting state, a
 * balance whose inputs moved after it was calculated, a ledger whose before-and-after figures are
 * the server's, and a leave type with a statutory source beside one without.
 *
 * **Three employments sharing a UUIDv7 prefix.** `e001`, `e002` and `e003` differ only in their
 * last characters, which is what a page of rows written in one transaction actually looks like —
 * and it is what makes the truncation the older screens use render three identical cells.
 */

export const EMPLOYMENT_A = '01900000-0000-7000-8000-00000000e001';
export const EMPLOYMENT_B = '01900000-0000-7000-8000-00000000e002';
export const EMPLOYMENT_C = '01900000-0000-7000-8000-00000000e003';
export const REQUEST_A = '01900000-0000-7000-8000-00000000r001';
export const REQUEST_B = '01900000-0000-7000-8000-00000000r002';
export const ANNUAL = '01900000-0000-7000-8000-00000000t001';
export const SICK = '01900000-0000-7000-8000-00000000t002';

const dashboard: LeaveDashboardView = {
  pendingApprovals: 14,
  onLeaveToday: 6,
  balancesAwaitingRecalculation: 3,
  leaveTypesConfigured: 9,
  publishedPolicies: 5,
};

const types: readonly LeaveTypeView[] = [
  {
    leaveTypeId: ANNUAL,
    code: 'ANNUAL',
    name: { en: 'Annual leave', ar: 'إجازة سنوية' },
    unit: 'days',
    paidTreatmentCode: 'paid',
    accrues: true,
    requiresAttachment: false,
    requiresReplacement: false,
    requiresContact: false,
    requiresAddress: false,
    status: 'published',
    versionNumber: 2,
    version: 2,
  },
  {
    leaveTypeId: SICK,
    code: 'SICK',
    name: { en: 'Sick leave', ar: 'إجازة مرضية' },
    unit: 'days',
    paidTreatmentCode: 'paid',
    accrues: true,
    requiresAttachment: true,
    requiresReplacement: false,
    requiresContact: true,
    requiresAddress: false,
    statutorySourceCode: 'sa-labour-117',
    status: 'draft',
    versionNumber: 1,
    version: 1,
  },
];

const policies: readonly LeavePolicyView[] = [
  {
    leavePolicyId: '01900000-0000-7000-8000-00000000p001',
    leaveTypeId: ANNUAL,
    code: 'ANNUAL-SA-2026',
    name: { en: 'Annual leave — Saudi Arabia 2026', ar: 'الإجازة السنوية — السعودية ٢٠٢٦' },
    versionNumber: 3,
    status: 'published',
    effectiveFrom: '2026-01-01',
    durationBasis: 'working_days',
    accrualMethod: 'monthly',
    carryOverMethod: 'capped_minutes',
    leaveYearCalendar: 'gregorian',
    approvalsRequired: 1,
    countryPackId: 'sa',
    version: 3,
    assignments: [
      {
        assignmentId: '01900000-0000-7000-8000-00000000a001',
        scope: 'tenant',
        effectiveFrom: '2026-01-01',
      },
    ],
  },
];

const accrualRuns: readonly AccrualRunView[] = [
  {
    accrualRunId: '01900000-0000-7000-8000-00000000c001',
    leavePolicyId: '01900000-0000-7000-8000-00000000p001',
    leaveTypeId: ANNUAL,
    periodStart: '2026-08-01',
    periodEnd: '2026-08-31',
    runBy: 'membership:scheduler',
    runAt: new Date('2026-09-01T02:00:00.000Z'),
    employmentsExamined: 412,
    entriesWritten: 401,
    entriesSkipped: 0,
    refusals: 11,
  },
];

const day = (onDate: string): LeaveRequestView['days'][number] => ({
  onDate,
  portion: 'full_day',
  minutes: 480,
  zone: 'Asia/Riyadh',
  expectedMinutes: 480,
});

const request = (
  leaveRequestId: string,
  employmentId: string,
  state: string,
  extra: Partial<LeaveRequestView> = {},
): LeaveRequestView => ({
  leaveRequestId,
  employmentId,
  leaveTypeId: ANNUAL,
  leavePolicyId: '01900000-0000-7000-8000-00000000p001',
  fromDate: '2026-09-01',
  toDate: '2026-09-03',
  totalMinutes: 1440,
  durationBasis: 'working_days',
  state,
  requestedBy: 'membership:layla',
  requestedAt: new Date('2026-08-20T09:00:00.000Z'),
  balanceAtRequestMinutes: 7200,
  approvalsRequired: 1,
  version: 1,
  days: [day('2026-09-01'), day('2026-09-02'), day('2026-09-03')],
  ...extra,
});

const requests: readonly LeaveRequestView[] = [
  request(REQUEST_A, EMPLOYMENT_A, 'pending_approval'),
  request(REQUEST_B, EMPLOYMENT_B, 'approved', {
    approvedAt: new Date('2026-08-21T10:00:00.000Z'),
  }),
  request('01900000-0000-7000-8000-00000000r003', EMPLOYMENT_C, 'rejected'),
];

const balance = (
  employmentId: string,
  leaveTypeId: string,
  extra: Partial<LeaveBalanceView> = {},
): LeaveBalanceView => ({
  employmentId,
  leaveTypeId,
  leaveYearStart: '2026-01-01',
  leaveYearEnd: '2026-12-31',
  openingMinutes: 0,
  accruedMinutes: 9600,
  carriedInMinutes: 2400,
  consumedMinutes: 4800,
  adjustedMinutes: 0,
  expiredMinutes: 0,
  carriedOutMinutes: 0,
  availableMinutes: 7200,
  entriesDigest: 'sha256:41ab',
  entryCount: 12,
  calculatedAt: new Date('2026-08-24T02:00:00.000Z'),
  ...extra,
});

const balances: readonly LeaveBalanceView[] = [
  balance(EMPLOYMENT_A, ANNUAL),
  balance(EMPLOYMENT_B, SICK, {
    availableMinutes: -480,
    inputsChangedAt: new Date('2026-08-25T04:00:00.000Z'),
  }),
  balance(EMPLOYMENT_C, ANNUAL),
];

const ledger: readonly LedgerEntryView[] = [
  {
    entryId: '01900000-0000-7000-8000-00000000l001',
    employmentId: EMPLOYMENT_A,
    leaveTypeId: ANNUAL,
    leaveYearStart: '2026-01-01',
    kind: 'carry_in',
    minutes: 2400,
    effectiveOn: '2026-01-01',
    recordedAt: new Date('2026-01-01T00:00:00.000Z'),
    sourceKind: 'leave_year',
    sourceId: '01900000-0000-7000-8000-00000000y001',
    balanceBeforeMinutes: 0,
    balanceAfterMinutes: 2400,
  },
  {
    entryId: '01900000-0000-7000-8000-00000000l002',
    employmentId: EMPLOYMENT_A,
    leaveTypeId: ANNUAL,
    leaveYearStart: '2026-01-01',
    kind: 'accrual',
    minutes: 9600,
    effectiveOn: '2026-08-01',
    recordedAt: new Date('2026-08-01T02:00:00.000Z'),
    sourceKind: 'accrual_run',
    sourceId: '01900000-0000-7000-8000-00000000c001',
    balanceBeforeMinutes: 2400,
    balanceAfterMinutes: 12_000,
  },
  {
    entryId: '01900000-0000-7000-8000-00000000l003',
    employmentId: EMPLOYMENT_A,
    leaveTypeId: ANNUAL,
    leaveYearStart: '2026-01-01',
    kind: 'consumption',
    minutes: -4800,
    effectiveOn: '2026-08-10',
    recordedAt: new Date('2026-08-10T06:00:00.000Z'),
    sourceKind: 'request',
    sourceId: REQUEST_B,
    reversesEntryId: '01900000-0000-7000-8000-00000000l000',
    balanceBeforeMinutes: 12_000,
    balanceAfterMinutes: 7200,
  },
];

const entitlements: readonly EntitlementView[] = [
  {
    entitlementId: '01900000-0000-7000-8000-00000000n001',
    employmentId: EMPLOYMENT_A,
    leaveTypeId: ANNUAL,
    leaveYearStart: '2026-01-01',
    leaveYearEnd: '2026-12-31',
    grantedMinutes: 9600,
    source: 'accrual',
  },
];

const adjustments: readonly LeaveAdjustmentView[] = [
  {
    adjustmentId: '01900000-0000-7000-8000-00000000d001',
    employmentId: EMPLOYMENT_A,
    leaveTypeId: ANNUAL,
    leaveYearStart: '2026-01-01',
    minutes: 960,
    effectiveOn: '2026-06-01',
    reasonCode: 'goodwill',
    note: 'Two days granted for the relocation weekend.',
    adjustedBy: 'membership:ops',
    adjustedAt: new Date('2026-06-01T08:00:00.000Z'),
  },
];

const employment: EmploymentView = {
  employmentId: EMPLOYMENT_A,
  employmentNumber: 'EMP-000417',
  personId: '01900000-0000-7000-8000-00000000s001',
  personName: { en: 'Layla Haddad', ar: 'ليلى حداد' },
  status: 'active',
  employmentTypeCode: 'full-time',
  originalHireDate: '2021-03-01',
  startDate: '2021-03-01',
  asOf: '2026-08-25',
  metadata: {},
  version: 4,
};

export const PROJECTION: ProjectedBalanceView = {
  ...balance(EMPLOYMENT_A, ANNUAL),
  projectedAccrualMinutes: 3200,
  projectedAvailableMinutes: 10_400,
  projectionBasis: 'monthly',
  assumesContinuedEmployment: true,
};

const approvals: LeaveApprovalChainView = {
  state: 'approved',
  approvalRequired: true,
  approvalsRequired: 1,
  steps: [
    {
      approver: '01900000-0000-7000-8000-00000000m001',
      decidedAt: new Date('2026-08-21T10:00:00.000Z'),
      decision: 'approved',
      comment: 'Cover arranged with the duty roster.',
    },
  ],
  completedAt: new Date('2026-08-21T10:00:00.000Z'),
};

const paged = <TItem>(items: readonly TItem[], total: number) => ({ items, total });

export const aFullRegister = (): LeaveRegister => ({
  dashboard,
  requests: paged(requests, 268),
  balances: paged(balances, 823),
  reconciliation: {
    total: 3,
    balances: [
      {
        balanceId: '01900000-0000-7000-8000-00000000b001',
        employmentId: EMPLOYMENT_B,
        leaveTypeId: SICK,
        leaveYearStart: '2026-01-01',
        inputsChangedAt: new Date('2026-08-25T04:00:00.000Z'),
        calculatedAt: new Date('2026-08-24T02:00:00.000Z'),
      },
    ],
  },
  types,
  policies,
  accrualRuns,
});

export const anEmptyRegister = (): LeaveRegister => ({
  dashboard: { ...dashboard, pendingApprovals: 0, onLeaveToday: 0 },
  requests: paged([], 0),
  balances: paged([], 0),
  reconciliation: { total: 0, balances: [] },
  types: [],
  policies: [],
  accrualRuns: [],
});

export const aRefusedRegister = (): LeaveRegister => ({
  dashboard: undefined,
  requests: undefined,
  balances: undefined,
  reconciliation: undefined,
  types: undefined,
  policies: undefined,
  accrualRuns: undefined,
});

/** `leave.read` answered and `leave.balance.read` did not — the distinction the slice keeps. */
export const aBalanceWithheldRegister = (): LeaveRegister => ({
  ...aFullRegister(),
  balances: undefined,
  reconciliation: undefined,
});

export const TYPES = types;

export const PIECES = {
  approvals,
  balance,
  employment,
  entitlements,
  adjustments,
  ledger,
  projection: PROJECTION,
  request,
  requests,
  types,
} as const;
