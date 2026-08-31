import type { AssetClearanceView } from '@work/assets/contracts';
import type { AttendanceDayView } from '@work/attendance/contracts';
import type { CareerSummaryView } from '@work/career/contracts';
import type { DocumentView } from '@work/documents/contracts';
import type {
  AssignmentView,
  ContractView,
  EmploymentHistoryView,
  EmploymentView,
  ReportingLineView,
} from '@work/employment/contracts';
import type { LearningHistoryView } from '@work/learning/contracts';
import type { LeaveBalanceView, LeaveTypeView } from '@work/leave/contracts';
import type { IssuedLetterView } from '@work/letters/contracts';
import type { PersonProfileView } from '@work/people/contracts';
import type { ViolationView } from '@work/relations/contracts';

import type { EmployeeRecord } from './record-api';

/**
 * A whole employee, as eleven modules would answer.
 *
 * Every value here is shaped by the module's own published contract, so a change to one that this
 * screen has not followed fails to compile rather than rendering something wrong. Nothing is
 * invented: no field appears that a contract does not carry.
 */

const EMPLOYMENT_ID = '01900000-0000-7000-8000-00000000e001';
const PERSON_ID = '01900000-0000-7000-8000-00000000p001';

export const anEmployment = (): EmploymentView => ({
  employmentId: EMPLOYMENT_ID,
  employmentNumber: 'EMP-000417',
  personId: PERSON_ID,
  personName: { en: 'Layla Haddad', ar: 'ليلى حداد' },
  status: 'active',
  employmentTypeCode: 'FULL_TIME',
  originalHireDate: '2021-03-01',
  startDate: '2021-03-01',
  asOf: '2026-08-24',
  metadata: {},
  version: 4,
});

export const aProfile = (): PersonProfileView => ({
  person: {
    personId: PERSON_ID,
    personNumber: 'PER-000417',
    legalName: { en: 'Layla Haddad', ar: 'ليلى حداد' },
    status: 'active',
    asOf: '2026-08-24',
    metadata: {},
    version: 7,
    sensitiveWithheld: true,
  },
  names: [],
  nationalities: [],
  withheld: ['dateOfBirth'],
});

export const anAssignment = (): AssignmentView => ({
  assignmentId: '01900000-0000-7000-8000-00000000a001',
  employmentId: EMPLOYMENT_ID,
  unitId: '01900000-0000-7000-8000-00000000u001',
  positionId: '01900000-0000-7000-8000-00000000j001',
  assignmentType: 'primary',
  fte: 1,
  effectiveFrom: new Date('2021-03-01T00:00:00.000Z'),
  version: 1,
});

export const aReportingLine = (): ReportingLineView => ({
  reportingLineId: '01900000-0000-7000-8000-00000000r001',
  employmentId: EMPLOYMENT_ID,
  managerEmploymentId: '01900000-0000-7000-8000-00000000e002',
  lineType: 'primary',
  effectiveFrom: new Date('2021-03-01T00:00:00.000Z'),
  version: 1,
});

export const aContract = (): ContractView => ({
  contractId: '01900000-0000-7000-8000-00000000c001',
  employmentId: EMPLOYMENT_ID,
  contractTypeCode: 'UNLIMITED',
  startDate: '2021-03-01',
  probationEndDate: '2021-06-01',
  probationOutcome: 'passed',
  effectiveFrom: new Date('2021-03-01T00:00:00.000Z'),
  version: 1,
});

export const aDocument = (): DocumentView => ({
  documentId: '01900000-0000-7000-8000-00000000d001',
  documentTypeId: '01900000-0000-7000-8000-00000000t001',
  ownerType: 'employment',
  ownerId: EMPLOYMENT_ID,
  title: { en: 'Signed contract', ar: 'العقد الموقّع' },
  status: 'active',
  confidentiality: 'normal',
  expiryDate: { gregorian: '2027-03-01', hijri: '1448-09-22' },
  expiryState: 'valid',
  expiryOwnedByPeople: false,
  verificationState: 'verified',
  versionCount: 2,
  source: 'direct',
  legalHold: false,
  version: 3,
});

export const anIssuedLetter = (): IssuedLetterView => ({
  issuedLetterId: '01900000-0000-7000-8000-00000000l001',
  letterRequestId: '01900000-0000-7000-8000-00000000q001',
  letterTemplateId: '01900000-0000-7000-8000-00000000m001',
  letterTemplateVersionId: '01900000-0000-7000-8000-00000000v001',
  employmentId: EMPLOYMENT_ID,
  personId: PERSON_ID,
  referenceNumber: 'LTR-2026-000091',
  locale: 'ar',
  issuedAt: { gregorian: '2026-04-02', hijri: '1447-09-24' },
  issuedBy: '01900000-0000-7000-8000-00000000i001',
  signatureRequired: true,
  signatureState: 'declared_signed_externally',
  version: 1,
});

export const aBalance = (): LeaveBalanceView => ({
  employmentId: EMPLOYMENT_ID,
  leaveTypeId: '01900000-0000-7000-8000-00000000y001',
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
  entriesDigest: 'digest',
  entryCount: 12,
});

export const aLeaveType = (): LeaveTypeView => ({
  leaveTypeId: '01900000-0000-7000-8000-00000000y001',
  code: 'ANNUAL',
  name: { en: 'Annual leave', ar: 'إجازة سنوية' },
  unit: 'day',
  paidTreatmentCode: 'PAID',
  accrues: true,
  requiresAttachment: false,
  requiresReplacement: false,
  requiresContact: false,
  requiresAddress: false,
  status: 'published',
  versionNumber: 1,
  version: 1,
});

export const anAttendanceDay = (): AttendanceDayView => ({
  attendanceDayId: '01900000-0000-7000-8000-00000000w001',
  employmentId: EMPLOYMENT_ID,
  attendanceDate: '2026-08-20',
  zone: 'Asia/Riyadh',
  dayKind: 'working',
  state: 'approved',
  expectedMinutes: 480,
  workedMinutes: 465,
  breakMinutesTaken: 60,
  paidBreakMinutes: 0,
  regularCandidateMinutes: 465,
  overtimeCandidateMinutes: 0,
  unpaidMinutes: 0,
  absenceMinutes: 15,
  leaveState: 'none',
  leaveMinutes: 0,
  calculationVersion: 1,
  inputsDigest: 'digest',
  version: 2,
});

export const aCareerSummary = (): CareerSummaryView => ({
  employmentId: EMPLOYMENT_ID,
  openPoolMemberships: [],
  openNominations: [],
  openRecommendations: [],
  asOf: '2026-08-24',
});

export const aLearningHistory = (): LearningHistoryView => ({
  employmentId: EMPLOYMENT_ID,
  asOf: '2026-08-24',
  assignments: [],
  enrolments: [],
  certifications: [],
  openAssignments: 3,
  overdueAssignments: 1,
  completedCourses: 11,
  activeCertifications: 2,
  expiringCertifications: 1,
});

export const aViolation = (): ViolationView => ({
  violationId: '01900000-0000-7000-8000-00000000x001',
  employmentId: EMPLOYMENT_ID,
  violationCategoryId: '01900000-0000-7000-8000-00000000z001',
  categoryCode: 'LATENESS',
  severity: 'minor',
  occurredOn: '2026-05-04',
  description: 'Arrived after the core hours started.',
  state: 'reported',
  recordedOn: '2026-05-04T09:12:00.000Z',
  occurrence: 2,
  version: 1,
});

/**
 * A second, distinct employment — here so a test can prove whose history renders.
 *
 * The workforce directory used to show the *first page row's* history under a heading that named
 * nobody. A fixture with only one employment could never have caught that: with a single identifier
 * on both sides, "the requested employment's history" and "an arbitrary row's history" render the
 * same markup. Two distinct identifiers make the difference detectable.
 */
export const ANOTHER_EMPLOYMENT_ID = '01900000-0000-7000-8000-00000000e002';

export const aHistory = (employmentId: string = EMPLOYMENT_ID): EmploymentHistoryView => ({
  employmentId,
  statusHistory: [
    {
      recordId: `${employmentId.slice(0, 30)}h1`,
      employmentId,
      toStatus: 'active',
      effectiveFrom: new Date('2021-03-01T00:00:00.000Z'),
      recordedBy: employmentId === EMPLOYMENT_ID ? 'membership-hr-041' : 'membership-hr-099',
      recordedAt: new Date('2021-03-01T08:00:00.000Z'),
    },
    {
      recordId: `${employmentId.slice(0, 30)}h2`,
      employmentId,
      fromStatus: 'active',
      toStatus: 'suspended',
      reasonCode: employmentId === EMPLOYMENT_ID ? 'SANCTION' : 'SECONDMENT',
      effectiveFrom: new Date('2024-06-15T00:00:00.000Z'),
      recordedBy: employmentId === EMPLOYMENT_ID ? 'membership-hr-041' : 'membership-hr-099',
      recordedAt: new Date('2024-06-15T08:00:00.000Z'),
    },
  ],
  assignments: [],
  reportingLines: [],
  contracts: [],
});

export const aClearance = (): AssetClearanceView => ({
  employmentId: EMPLOYMENT_ID,
  asAt: '2026-08-24',
  assetsClear: false,
  outstandingCount: 1,
  blockers: [
    {
      assetCustodyId: '01900000-0000-7000-8000-00000000k001',
      assetId: '01900000-0000-7000-8000-00000000s001',
      assetTag: 'LT-00841',
      assetCategoryId: '01900000-0000-7000-8000-00000000g001',
      issuedOn: '2026-02-11',
      daysOutstanding: 194,
    },
  ],
});

/** Everything answered. */
export const aFullRecord = (): EmployeeRecord => ({
  employment: anEmployment(),
  profile: aProfile(),
  assignments: [anAssignment()],
  reportingLines: [aReportingLine()],
  contracts: [aContract()],
  documents: [aDocument()],
  letters: [anIssuedLetter()],
  balances: [aBalance()],
  leaveTypes: [aLeaveType()],
  attendanceDays: [anAttendanceDay()],
  history: aHistory(),
  career: aCareerSummary(),
  learning: aLearningHistory(),
  violations: [aViolation()],
  clearance: aClearance(),
  managerName: { en: 'Omar Nasser', ar: 'عمر ناصر' },
});

/** Nothing answered — the ordinary state of this deployment, and the one every screen must survive. */
export const aWithheldRecord = (): EmployeeRecord => ({
  employment: anEmployment(),
  profile: undefined,
  assignments: undefined,
  reportingLines: undefined,
  contracts: undefined,
  documents: undefined,
  letters: undefined,
  balances: undefined,
  leaveTypes: undefined,
  attendanceDays: undefined,
  history: undefined,
  career: undefined,
  learning: undefined,
  violations: undefined,
  clearance: undefined,
  managerName: undefined,
});

/** Every module answered, and every answer was empty. Not the same thing as the above. */
export const anEmptyRecord = (): EmployeeRecord => ({
  employment: anEmployment(),
  profile: aProfile(),
  assignments: [],
  reportingLines: [],
  contracts: [],
  documents: [],
  letters: [],
  balances: [],
  leaveTypes: [],
  attendanceDays: [],
  history: {
    employmentId: EMPLOYMENT_ID,
    statusHistory: [],
    assignments: [],
    reportingLines: [],
    contracts: [],
  },
  career: aCareerSummary(),
  learning: aLearningHistory(),
  violations: [],
  clearance: { ...aClearance(), assetsClear: true, outstandingCount: 0, blockers: [] },
  managerName: undefined,
});
