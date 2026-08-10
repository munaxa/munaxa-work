import { definedOnly } from '../domain/compensation-aggregate.js';
import { moneyView } from '../domain/money-amount.js';
import { effectiveDecisions, stateFromChain } from '../domain/approval.js';
import type { AdjustmentState } from '../domain/adjustment.js';
import type { ApprovalDecisionState } from '../domain/approval.js';
import type { CompensationChangeState } from '../domain/change-log.js';
import type { CompensationComponentState } from '../domain/compensation-component.js';
import type { CompensationPlanState, PlanComponentTerms } from '../domain/compensation-plan.js';
import type { ImportBatchState } from '../domain/import-batch.js';
import type { OneTimeState } from '../domain/one-time.js';
import type { PlanAssignmentState } from '../domain/plan-assignment.js';
import type { RecurringState } from '../domain/recurring.js';
import type { PayGradeState, PayRange, SalaryStructureState } from '../domain/salary-structure.js';
import type { PayScaleState, SalaryStepState } from '../domain/pay-scale.js';
import type {
  CompensationAdjustmentView,
  CompensationApprovalChainView,
  CompensationChangeView,
  CompensationComponentView,
  CompensationPlanView,
  ImportBatchView,
  OneTimeCompensationView,
  PayGradeView,
  PayRangeView,
  PayScaleView,
  PercentageResolutionView,
  PlanAssignmentView,
  PlanComponentView,
  RecurringCompensationView,
  SalaryStepView,
  SalaryStructureView,
} from '../contracts/views.js';

/**
 * State to published view, in one place.
 *
 * Two rules hold across every mapper here.
 *
 * **Every monetary figure goes through `moneyView`**, which produces exact minor units as a decimal
 * *string* plus the currency's code and exponent. No mapper anywhere converts an amount to a
 * `number`, and there is no code path that could.
 *
 * **A view is never the row.** Column names, the plan's internal identifiers and the audit columns
 * do not cross the boundary, so a rename is not a contract change.
 */

export const rangeView = (range: PayRange): PayRangeView => ({
  minimum: moneyView(range.minimum),
  midpoint: moneyView(range.midpoint),
  maximum: moneyView(range.maximum),
});

export const planAssignmentView = (state: PlanAssignmentState): PlanAssignmentView => ({
  planAssignmentId: state.id,
  scope: state.scope,
  effectiveFrom: state.effectiveFrom,
  ...definedOnly({
    scopeId: state.scopeId,
    effectiveTo: state.effectiveTo,
    reasonCode: state.reasonCode,
  }),
});

export const planComponentView = (terms: PlanComponentTerms): PlanComponentView => ({
  componentId: terms.componentId,
  mandatory: terms.mandatory,
  ...definedOnly({
    minimum: terms.minimum === undefined ? undefined : moneyView(terms.minimum),
    maximum: terms.maximum === undefined ? undefined : moneyView(terms.maximum),
  }),
});

export const planView = (
  state: CompensationPlanState,
  assignments: readonly PlanAssignmentState[],
  components: readonly PlanComponentTerms[],
): CompensationPlanView => ({
  compensationPlanId: state.id,
  code: state.code,
  name: state.name,
  versionNumber: state.versionNumber,
  status: state.status,
  defaultCurrencyCode: state.defaultCurrencyCode,
  defaultCurrencyExponent: state.defaultCurrencyExponent,
  approvalRequired: state.approvalRequired,
  approvalsRequired: state.approvalsRequired,
  selfApprovalPermitted: state.selfApprovalPermitted,
  assignments: assignments.map(planAssignmentView),
  components: components.map(planComponentView),
  ...definedOnly({
    salaryStructureId: state.salaryStructureId,
    maximumIncreaseBasisPoints: state.maximumIncreaseBasisPoints,
    maximumDecreaseBasisPoints: state.maximumDecreaseBasisPoints,
    countryPackId: state.countryPackId,
    countryPackVersion: state.countryPackVersion,
    publishedAt: state.publishedAt,
  }),
});

export const structureView = (state: SalaryStructureState): SalaryStructureView => ({
  salaryStructureId: state.id,
  code: state.code,
  name: state.name,
  status: state.status,
  effectiveFrom: state.effectiveFrom,
  ...definedOnly({ description: state.description, effectiveTo: state.effectiveTo }),
});

export const gradeView = (state: PayGradeState): PayGradeView => ({
  payGradeId: state.id,
  code: state.code,
  name: state.name,
  range: rangeView(state.range),
  status: state.status,
  effectiveFrom: state.effectiveFrom,
  ...definedOnly({
    salaryStructureId: state.salaryStructureId,
    description: state.description,
    positionGradeLabel: state.positionGradeLabel,
    effectiveTo: state.effectiveTo,
  }),
});

export const scaleView = (state: PayScaleState): PayScaleView => ({
  payScaleId: state.id,
  payGradeId: state.payGradeId,
  code: state.code,
  name: state.name,
  range: rangeView(state.range),
  progressionModel: state.progressionModel,
  status: state.status,
  effectiveFrom: state.effectiveFrom,
  ...definedOnly({ effectiveTo: state.effectiveTo }),
});

export const stepView = (state: SalaryStepState): SalaryStepView => ({
  salaryStepId: state.id,
  stepNumber: state.stepNumber,
  amount: moneyView(state.amount),
  effectiveFrom: state.effectiveFrom,
  ...definedOnly({
    payScaleId: state.payScaleId,
    payGradeId: state.payGradeId,
    code: state.code,
    effectiveTo: state.effectiveTo,
  }),
});

export const componentView = (state: CompensationComponentState): CompensationComponentView => ({
  componentId: state.id,
  code: state.code,
  name: state.name,
  kind: state.kind,
  calculationBasis: state.calculationBasis,
  roundingMode: state.roundingMode,
  recurrence: state.recurrence,
  payrollTreatmentCode: state.payrollTreatmentCode,
  proratable: state.proratable,
  status: state.status,
  versionNumber: state.versionNumber,
  ...definedOnly({
    basisComponentId: state.basisComponentId,
    percentageBasisPoints: state.percentageBasisPoints,
    statutorySourceCode: state.statutorySourceCode,
  }),
});

/**
 * A recurring period, published with the rule that produced its amount where there was one.
 *
 * Both the figure and the rule travel, which is decision D-3 made visible: a screen and Payroll
 * cannot arrive at different housing allowances by rounding differently, because neither of them
 * resolves it — this module did, and it showed its working.
 */
export const recurringView = (
  state: RecurringState,
  componentCode: string,
  resolvedFrom?: PercentageResolutionView,
): RecurringCompensationView => ({
  recurringId: state.id,
  employmentId: state.employmentId,
  componentId: state.componentId,
  componentCode,
  compensationPlanId: state.compensationPlanId,
  amount: moneyView(state.amount),
  effectiveFrom: state.effectiveFrom,
  recordedAt: state.recordedAt,
  recordedBy: state.recordedBy,
  source: state.source,
  approvalState: state.approvalState,
  ...definedOnly({
    payGradeId: state.payGradeId,
    payScaleId: state.payScaleId,
    salaryStepId: state.salaryStepId,
    effectiveTo: state.effectiveTo,
    reasonCode: state.reasonCode,
    supersedesId: state.supersedesId,
    resolvedFrom,
  }),
});

export const oneTimeView = (
  state: OneTimeState,
  componentCode: string,
): OneTimeCompensationView => ({
  oneTimeId: state.id,
  employmentId: state.employmentId,
  componentId: state.componentId,
  componentCode,
  amount: moneyView(state.amount),
  payableOn: state.payableOn,
  reasonCode: state.reasonCode,
  source: state.source,
  recordedAt: state.recordedAt,
  approvalState: state.approvalState,
});

/**
 * An adjustment, with its reason and note included only for a caller entitled to them.
 *
 * The masking happens here rather than on the screen, because a screen that decided what to hide
 * would be a second, weaker answer to a question the permission model already settled. A caller
 * without `compensation.adjust` sees the movement and not the sentence somebody wrote about it.
 */
export const adjustmentView = (
  state: AdjustmentState,
  reasonsVisible: boolean,
): CompensationAdjustmentView => ({
  adjustmentId: state.id,
  employmentId: state.employmentId,
  adjustmentType: state.adjustmentType,
  effectiveFrom: state.effectiveFrom,
  requestedBy: state.requestedBy,
  recordedAt: state.recordedAt,
  approvalState: state.approvalState,
  ...definedOnly({
    componentId: state.componentId,
    previousAmount:
      state.previousAmount === undefined ? undefined : moneyView(state.previousAmount),
    newAmount: state.newAmount === undefined ? undefined : moneyView(state.newAmount),
    reasonCode: reasonsVisible ? state.reasonCode : undefined,
    note: reasonsVisible ? state.note : undefined,
  }),
});

export const changeView = (state: CompensationChangeState): CompensationChangeView => ({
  changeId: state.id,
  employmentId: state.employmentId,
  subjectKind: state.subjectKind,
  subjectId: state.subjectId,
  changeKind: state.changeKind,
  recordedAt: state.recordedAt,
  actor: state.actor,
  source: state.source,
  ...definedOnly({
    componentId: state.componentId,
    effectiveFrom: state.effectiveFrom,
    reasonCode: state.reasonCode,
  }),
});

/**
 * The approval chain, in `ApprovalPort`'s shape.
 *
 * `required: false` with no steps is how a plan needing no approval is published. There is no
 * fabricated `system:auto-approval` step, because nobody approved it and saying otherwise would be
 * recording something that did not happen (D-9).
 */
export const approvalChainView = (
  subject: { readonly kind: string; readonly id: string },
  decisions: readonly ApprovalDecisionState[],
  approvalsRequired: number,
): CompensationApprovalChainView => ({
  subjectKind: subject.kind,
  subjectId: subject.id,
  required: approvalsRequired > 0,
  approvalsRequired,
  state: stateFromChain(decisions, approvalsRequired),
  steps: [...decisions]
    .sort((left, right) => left.sequence - right.sequence)
    .map((decision) => ({
      sequence: decision.sequence,
      decision: decision.decision,
      decidedBy: decision.decidedBy,
      decidedAt: decision.decidedAt,
      ...definedOnly({
        comment: decision.comment,
        reversesDecisionId: decision.reversesDecisionId,
      }),
    })),
});

/** How many decisions still stand — the count a chain's state is derived from. */
export const standingDecisions = (
  decisions: readonly ApprovalDecisionState[],
): readonly ApprovalDecisionState[] => effectiveDecisions(decisions);

export const importBatchView = (state: ImportBatchState): ImportBatchView => ({
  importBatchId: state.id,
  source: state.source,
  submittedAt: state.submittedAt,
  submittedBy: state.submittedBy,
  rowsSubmitted: state.rowsSubmitted,
  rowsCreated: state.rowsCreated,
  rowsSkipped: state.rowsSkipped,
  rowsFailed: state.rowsFailed,
  ...definedOnly({ sourceLabel: state.sourceLabel }),
});
