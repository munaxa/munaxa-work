import type {
  ApplicableActionView,
  CaseHistoryView,
  DisciplinaryActionView,
  EscalationContextView,
  InvestigationView,
  ViolationCategoryView,
  ViolationView,
} from '@work/relations/contracts';

import type { CaseContext, EmploymentRelations, Listing } from './api';
import { anEmployment } from '../employment/record.fixture';

/**
 * One employment's disciplinary record, shaped by the module's own published contracts.
 *
 * Every value here is a value the module could return: no field appears that a contract does not
 * carry, states come from the module's closed vocabulary, the severity is a tenant's own word, and
 * the server totals deliberately exceed the row counts so a screen counting `items.length` fails.
 */

export const EMPLOYMENT_A = '01900000-0000-7000-8000-00000000e001';
export const VIOLATION_A = '01900000-0000-7000-8000-00000000v001';
export const VIOLATION_B = '01900000-0000-7000-8000-00000000v002';
/** A prior matter inside the repeat window — a case of its own, reachable from the repeat section. */
export const VIOLATION_PRIOR = '01900000-0000-7000-8000-00000000v003';
export const CATEGORY_LATENESS = '01900000-0000-7000-8000-00000000z001';
export const CATEGORY_CONDUCT = '01900000-0000-7000-8000-00000000z002';
export const INVESTIGATOR = 'membership-hr-041';

export const aCatalogue = (): readonly ViolationCategoryView[] => [
  {
    violationCategoryId: CATEGORY_LATENESS,
    code: 'LATENESS',
    name: { en: 'Repeated lateness', ar: 'التأخر المتكرر' },
    severity: 'minor',
    sequence: 1,
    repeatWindowDays: 180,
    source: 'tenant',
    active: true,
    version: 2,
  },
  {
    violationCategoryId: CATEGORY_CONDUCT,
    code: 'CONDUCT',
    name: { en: 'Misconduct', ar: 'سوء السلوك' },
    severity: 'serious',
    sequence: 2,
    repeatWindowDays: 365,
    source: 'tenant',
    active: true,
    version: 1,
  },
];

export const aViolation = (): ViolationView => ({
  violationId: VIOLATION_A,
  employmentId: EMPLOYMENT_A,
  violationCategoryId: CATEGORY_LATENESS,
  categoryCode: 'LATENESS',
  severity: 'minor',
  occurredOn: '2026-05-04',
  description: 'Arrived ninety minutes after the shift started, third time this quarter.',
  state: 'under_investigation',
  recordedOn: '2026-05-04T09:12:00.000Z',
  occurrence: 3,
  version: 1,
});

/**
 * Two rows, seven violations: the server counted more than it returned, so a ratio derived from
 * `items.length` renders `2 / 2` and fails the totals assertion.
 */
export const aViolationPage = (): Listing<ViolationView> => ({
  items: [
    aViolation(),
    {
      violationId: VIOLATION_B,
      employmentId: EMPLOYMENT_A,
      violationCategoryId: CATEGORY_CONDUCT,
      categoryCode: 'CONDUCT',
      severity: 'serious',
      occurredOn: '2026-02-11',
      description: 'Refused a documented safety instruction.',
      state: 'action_issued',
      recordedOn: '2026-02-11T14:03:00.000Z',
      version: 1,
    },
  ],
  total: 7,
});

export const anEmploymentRelations = (): EmploymentRelations => ({
  employment: { kind: 'ok', value: anEmployment() },
  violations: aViolationPage(),
  categories: aCatalogue(),
});

/** The caller may not read disciplinary records at all — nothing about this person may render. */
export const aRefusedEmploymentRelations = (): EmploymentRelations => ({
  employment: { kind: 'ok', value: anEmployment() },
  violations: undefined,
  categories: aCatalogue(),
});

export const anEmptyEmploymentRelations = (): EmploymentRelations => ({
  employment: { kind: 'ok', value: anEmployment() },
  violations: { items: [], total: 0 },
  categories: aCatalogue(),
});

export const aCaseHistory = (): CaseHistoryView => ({
  violationId: VIOLATION_A,
  currentState: 'under_investigation',
  history: [
    {
      caseEventId: '01900000-0000-7000-8000-00000000c001',
      sequence: 1,
      fromState: 'reported',
      toState: 'under_investigation',
      reason: 'Opened an inquiry into the third occurrence.',
      actor: INVESTIGATOR,
      occurredAt: '2026-05-05T08:30:00.000Z',
      investigationId: '01900000-0000-7000-8000-00000000i001',
    },
  ],
});

export const anInvestigations = (): Listing<InvestigationView> => ({
  items: [
    {
      investigationId: '01900000-0000-7000-8000-00000000i002',
      violationId: VIOLATION_A,
      investigatorMembershipId: INVESTIGATOR,
      openedOn: '2026-05-20',
      subject: 'Correcting the shift record cited in the first conclusion.',
      state: 'concluded',
      findings: 'The badge log confirms the arrival time; the roster cited was superseded.',
      recommendation: 'Proceed on the corrected roster.',
      concludedOn: '2026-05-28',
      correctsInvestigationId: '01900000-0000-7000-8000-00000000i001',
      version: 2,
    },
    {
      investigationId: '01900000-0000-7000-8000-00000000i001',
      violationId: VIOLATION_A,
      investigatorMembershipId: INVESTIGATOR,
      openedOn: '2026-05-05',
      subject: 'Whether the recorded arrival time is disputed.',
      state: 'concluded',
      findings: 'The arrival time is not disputed.',
      recommendation: 'Apply the ladder.',
      concludedOn: '2026-05-12',
      version: 1,
    },
  ],
  total: 2,
});

/**
 * The same two inquiries as a caller without `relations.investigation.read-findings` receives
 * them: present, dated, attributed — and with nothing they concluded. The module omits the fields
 * rather than blanking them, exactly as it does for an inquiry still open.
 */
export const aRedactedInvestigations = (): Listing<InvestigationView> => ({
  items: anInvestigations().items.map(
    ({ findings: _findings, recommendation: _recommendation, ...kept }) => kept,
  ),
  total: 2,
});

export const anEscalation = (): EscalationContextView => ({
  employmentId: EMPLOYMENT_A,
  violationCategoryId: CATEGORY_LATENESS,
  asAt: '2026-05-04',
  windowDays: 180,
  windowFrom: '2025-11-05',
  occurrences: 3,
  violationIds: [VIOLATION_PRIOR, VIOLATION_B, VIOLATION_A],
});

export const anApplicable = (): ApplicableActionView => ({
  violationId: VIOLATION_A,
  violationCategoryId: CATEGORY_LATENESS,
  occurrence: 3,
  windowDays: 180,
  action: 'written_warning',
  disciplinaryRuleId: '01900000-0000-7000-8000-00000000d001',
  minOccurrence: 2,
});

/** The tenant configured no rule for this occurrence. A real answer, not a gap to fill. */
export const aSilentApplicable = (): ApplicableActionView => ({
  violationId: VIOLATION_A,
  violationCategoryId: CATEGORY_LATENESS,
  occurrence: 3,
  windowDays: 180,
});

export const anIssuedAction = (): DisciplinaryActionView => ({
  disciplinaryActionId: '01900000-0000-7000-8000-00000000a001',
  violationId: VIOLATION_A,
  investigationId: '01900000-0000-7000-8000-00000000i002',
  action: 'written_warning',
  disciplinaryRuleId: '01900000-0000-7000-8000-00000000d001',
  prescribedByRule: true,
  occurrenceAtIssue: 3,
  reason: 'Third occurrence inside the window, on the corrected conclusion.',
  issuedBy: 'membership-hr-007',
  issuedOn: '2026-06-02',
  version: 1,
});

export const aCaseContext = (): CaseContext => ({
  history: aCaseHistory(),
  investigations: anInvestigations(),
  escalation: anEscalation(),
  applicable: anApplicable(),
  action: { kind: 'ok', value: anIssuedAction() },
  categories: aCatalogue(),
});

/** No action issued yet: the module's own `not_found` on the action read, kept as the empty state. */
export const aCaseWithoutAction = (): CaseContext => ({
  ...aCaseContext(),
  action: { kind: 'missing' },
});

export const aWithheldCaseContext = (): CaseContext => ({
  history: undefined,
  investigations: undefined,
  escalation: undefined,
  applicable: undefined,
  action: { kind: 'refused' },
  categories: undefined,
});
