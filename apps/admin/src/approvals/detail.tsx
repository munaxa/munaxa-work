import type { ReactNode } from 'react';
import type {
  BranchTallyView,
  WorkflowDecisionView,
  WorkflowInstanceDetailView,
  WorkflowStepView,
} from '@work/workflow/contracts';

import type { Language } from '../shell/locale';
import { count, instant, member, short } from '../workflow/exact';

import {
  ApprovalsSection,
  Cell,
  Clear,
  DASH,
  Fact,
  Facts,
  Identifier,
  Isolated,
  Plain,
  Row,
  Rows,
  Term,
  type ApprovalsProps,
  type Tone,
} from './frame';

/**
 * One approval: what it is about, where it stands, who has answered and what happened when.
 *
 * **Every number here was counted by the server.** A branch tally publishes `assigned`,
 * `approvals`, `rejections`, `responses`, `outstanding`, `threshold`, `quorum`, `quorumMet` and
 * `outcome` as nine separate fields, computed from the decisions at read time and stored nowhere.
 * A screen that added two of them, or worked out a majority, or drew a bar of one over another,
 * would be a second answer that disagrees with the first the day either changes — and the
 * denominator in particular is a locked domain rule (a branch of three that gains a fourth approver
 * still needs two approvals), not arithmetic a screen may reproduce.
 *
 * **The service level is three published fields and no subtraction.** `dueOn` is not `awaitingOn`
 * plus the target, and the state is not "is `dueOn` in the past": both are the application's own,
 * worked out against a reading instant this screen never sees. There is no countdown, no bar and no
 * colour that changes on its own.
 *
 * **`expired` can never appear.** It is declared in the approval vocabulary and this product
 * produces it nowhere, so no legend of the states is offered — a screen that listed the vocabulary
 * would show an operational state nothing here can reach.
 *
 * **Nobody is called a manager and no delegation is inferred.** A step's `approverKind` may be
 * `manager`, which is how the *template* routed it, and the running step still names a concrete
 * membership. Whether a decision was delegated is the API's `authority`, and whose authority it was
 * is `onBehalfOfMembershipId` — two fields that are never collapsed into one.
 */

const INSTANCE_TONE: Readonly<Record<string, Tone>> = {
  running: 'default',
  completed: 'success',
  rejected: 'danger',
  cancelled: 'muted',
};

const STEP_TONE: Readonly<Record<string, Tone>> = {
  awaiting: 'default',
  approved: 'success',
  rejected: 'danger',
  pending: 'muted',
  skipped: 'muted',
};

const DECISION_TONE: Readonly<Record<string, Tone>> = {
  approved: 'success',
  rejected: 'danger',
};

const OUTCOME_TONE: Readonly<Record<string, Tone>> = {
  awaiting: 'default',
  approved: 'success',
  rejected: 'danger',
};

const SERVICE_LEVEL_TONE: Readonly<Record<string, Tone>> = {
  overdue: 'danger',
  within: 'success',
  none: 'muted',
};

export const instanceTone = (status: string): Tone => INSTANCE_TONE[status] ?? 'muted';

/** What the approval is about and where it stands — the block directly under the heading. */
export const ApprovalSummary = ({
  t,
  language,
  detail,
}: ApprovalsProps & {
  readonly language: Language;
  readonly detail: WorkflowInstanceDetailView;
}): ReactNode => {
  const instance = detail.instance;

  return (
    <Facts>
      <Fact
        label={t('workflow.label.requestedBy')}
        value={<Isolated>{member(instance.requestedByMembershipId)}</Isolated>}
      />
      <Fact
        label={t('workflow.label.startedOn')}
        value={<Isolated>{instant(instance.startedOn, language)}</Isolated>}
      />
      <Fact
        label={t('workflow.label.completedOn')}
        value={<Isolated>{instant(instance.completedOn, language)}</Isolated>}
      />
      <Fact
        label={t('workflow.label.instanceId')}
        value={<Isolated>{short(instance.instanceId)}</Isolated>}
      />
      <Fact
        label={t('workflow.label.definitionId')}
        value={<Isolated>{short(instance.definitionId)}</Isolated>}
      />
      <Fact
        label={t('workflow.label.workflowVersionId')}
        value={<Isolated>{short(instance.workflowVersionId)}</Isolated>}
      />
    </Facts>
  );
};

/**
 * The chain: every step, in order, with the approver the step names.
 *
 * The service level is four cells rather than one here, because a detail screen has the room a queue
 * does not — and all four are published fields, never one derived from another.
 */
const StepRow = ({
  t,
  language,
  step,
}: ApprovalsProps & {
  readonly language: Language;
  readonly step: WorkflowStepView;
}): ReactNode => (
  <Row>
    <Cell numeric>{count(step.ordinal)}</Cell>
    <Identifier value={member(step.approverMembershipId)} />
    <Cell>
      <Plain t={t} group="approverKind" value={step.approverKind} />
    </Cell>
    <Cell>
      <Term t={t} group="stepStatus" value={step.status} tone={STEP_TONE[step.status]} />
    </Cell>
    <Cell>
      {step.escalated ? (
        <Plain t={t} group="approverOrigin" value="escalated" />
      ) : (
        <Plain t={t} group="approverOrigin" value="assigned" />
      )}
    </Cell>
    <Cell>
      <Term
        t={t}
        group="serviceLevelState"
        value={step.serviceLevel?.state}
        tone={SERVICE_LEVEL_TONE[step.serviceLevel?.state ?? 'none']}
      />
    </Cell>
    <Cell>
      <Isolated>{instant(step.serviceLevel?.dueOn, language)}</Isolated>
    </Cell>
    <Cell numeric>{count(step.serviceLevel?.overdueByMinutes)}</Cell>
  </Row>
);

export const ChainSection = ({
  t,
  language,
  steps,
}: ApprovalsProps & {
  readonly language: Language;
  readonly steps: readonly WorkflowStepView[];
}): ReactNode => (
  <ApprovalsSection title={t('workflow.label.steps')}>
    <Rows
      headings={[
        t('workflow.label.ordinal'),
        t('workflow.label.approver'),
        t('workflow.label.approverKind'),
        t('workflow.label.status'),
        t('workflow.label.approverOrigin'),
        t('workflow.label.serviceLevelState'),
        t('workflow.label.dueOn'),
        t('workflow.label.overdueByMinutes'),
      ]}
      numeric={[0, 7]}
    >
      {steps.map((step) => (
        <StepRow key={step.stepId} t={t} language={language} step={step} />
      ))}
    </Rows>
  </ApprovalsSection>
);

export const DecisionsSection = ({
  t,
  language,
  decisions,
}: ApprovalsProps & {
  readonly language: Language;
  readonly decisions: readonly WorkflowDecisionView[];
}): ReactNode =>
  decisions.length === 0 ? (
    <Clear
      t={t}
      title={t('admin.approvals.decisions')}
      message="admin.approvals.nothingDecidedYet"
    />
  ) : (
    <ApprovalsSection title={t('admin.approvals.decisions')}>
      <Rows
        headings={[
          t('workflow.label.decision'),
          t('workflow.label.decidedBy'),
          t('workflow.label.authority'),
          t('workflow.label.onBehalfOf'),
          t('workflow.label.decidedOn'),
          t('workflow.label.comment'),
        ]}
      >
        {decisions.map((decision) => (
          <Row key={decision.decisionId}>
            <Cell>
              <Term
                t={t}
                group="decision"
                value={decision.decision}
                tone={DECISION_TONE[decision.decision]}
              />
            </Cell>
            <Identifier value={member(decision.decidedByMembershipId)} />
            <Cell>
              <Plain t={t} group="authority" value={decision.authority} />
            </Cell>
            <Identifier value={member(decision.onBehalfOfMembershipId)} />
            <Cell>
              <Isolated>{instant(decision.decidedOn, language)}</Isolated>
            </Cell>
            <Cell>
              {decision.comment === undefined ? DASH : <Isolated>{decision.comment}</Isolated>}
            </Cell>
          </Row>
        ))}
      </Rows>
    </ApprovalsSection>
  );

/**
 * Where a parallel branch stands — nine published figures, and no tenth computed from them.
 *
 * `outstanding` is not `assigned` minus `responses`, `quorumMet` is not `responses >= quorum`, and
 * the outcome is not inferred from any of it. Every one is the server's, counted from the decisions
 * at read time.
 */
export const BranchesSection = ({
  t,
  tallies,
}: ApprovalsProps & { readonly tallies: readonly BranchTallyView[] }): ReactNode =>
  tallies.length === 0 ? null : (
    <ApprovalsSection title={t('workflow.label.branches')}>
      <Rows
        headings={[
          t('workflow.label.ordinal'),
          t('workflow.label.branchRule'),
          t('workflow.label.assigned'),
          t('workflow.label.approvals'),
          t('workflow.label.rejections'),
          t('workflow.label.outstanding'),
          t('workflow.label.threshold'),
          t('workflow.label.quorumMet'),
          t('workflow.label.outcome'),
        ]}
        numeric={[0, 2, 3, 4, 5, 6]}
      >
        {tallies.map((tally) => (
          <Row key={`${tally.ordinal}-${tally.rule}`}>
            <Cell numeric>{count(tally.ordinal)}</Cell>
            <Cell>
              <Plain t={t} group="branchRule" value={tally.rule} />
            </Cell>
            <Cell numeric>{count(tally.assigned)}</Cell>
            <Cell numeric>{count(tally.approvals)}</Cell>
            <Cell numeric>{count(tally.rejections)}</Cell>
            <Cell numeric>{count(tally.outstanding)}</Cell>
            <Cell numeric>{count(tally.threshold)}</Cell>
            <Cell>
              <Plain t={t} group="quorumMet" value={tally.quorumMet ? 'met' : 'not-met'} />
            </Cell>
            <Cell>
              <Term
                t={t}
                group="branchOutcome"
                value={tally.outcome}
                tone={OUTCOME_TONE[tally.outcome]}
              />
            </Cell>
          </Row>
        ))}
      </Rows>
    </ApprovalsSection>
  );

/** What this screen does not do, said quietly rather than left as an absence. */
const BOUNDARIES = [
  'admin.approvals.decidingIsApi',
  'admin.approvals.subjectIsOpaque',
  'admin.approvals.membershipsAreIdentifiers',
  'admin.approvals.nothingExpires',
  'admin.notice.readOnly',
] as const;

export const DetailBoundaries = ({ t }: ApprovalsProps): ReactNode => (
  <footer className="border-t border-border pt-4">
    <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {t('admin.approvals.boundaries')}
    </h2>
    <ul className="mt-2 flex list-disc flex-col gap-1 ps-5 text-xs text-muted-foreground">
      {BOUNDARIES.map((key) => (
        <li key={key}>{t(key)}</li>
      ))}
    </ul>
  </footer>
);
