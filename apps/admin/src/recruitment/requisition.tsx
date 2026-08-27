import type { ReactNode } from 'react';
import { KpiGrid, StatCard } from '@munaxa/ui';
import type { RequisitionDecisionView, RequisitionView } from '@work/recruitment/contracts';

import {
  Boundaries,
  Cell,
  Clear,
  Fact,
  Facts,
  HiringSection,
  Identifier,
  Isolated,
  Reference,
  Row,
  Rows,
  Term,
  type HiringProps,
  type Tone,
} from './frame';
import { DASH, count, day, instant, reference } from './exact';
import { nameIn, type Language } from './locale';
import { REQUISITION_TONE } from './tones';
import type { RequisitionForDisplay } from './api';

/**
 * One requisition: what was authorized, who authorized it, and what is being recruited against it.
 *
 * **The requisition is the subject, and headcount is the control the whole module turns on.**
 * Hiring is authorized in advance and what is *left* is the number somebody acts on, so the three
 * figures are the server's `headcountRequested`, `headcountFilled` and `headcountRemaining` — three
 * published fields, never two of them subtracted to produce the third.
 *
 * **Who decided is two different answers and this screen keeps them apart.** A requisition carries
 * `approvalId` when a routed approval decided it and nothing when Recruitment decided it directly,
 * and the module publishes the field precisely so a consumer can tell the two apart: an approval
 * nobody can trace back to a named authority is not a control. The identifier is shown and **no
 * link is offered**, because `workflowApprovalPortFor` is composed nowhere in this deployment, so
 * the approvals screen holds no instance this identifier would open. A link to an approval that
 * does not exist is a control that does not do what it appears to.
 *
 * **A decision is appended, never edited.** A reversal is another row carrying `reversesId`, so the
 * table shows the history rather than the current answer — which is what a headcount audit asks for.
 */

export const requisitionTone = (status: string): Tone => REQUISITION_TONE[status] ?? 'muted';

interface RequisitionProps extends HiringProps {
  readonly language: Language;
}

/** The three figures the requisition authorizes, each one published rather than derived. */
export const Headcount = ({
  t,
  requisition,
}: HiringProps & { readonly requisition: RequisitionView }): ReactNode => (
  <KpiGrid cols={{ base: 3 }}>
    <StatCard
      label={t('recruitment.label.headcount')}
      value={count(requisition.headcountRequested)}
    />
    <StatCard label={t('recruitment.label.filled')} value={count(requisition.headcountFilled)} />
    <StatCard
      label={t('recruitment.label.remaining')}
      value={count(requisition.headcountRemaining)}
    />
  </KpiGrid>
);

/**
 * A named employment: the person's name when Employment answered, the identifier when it did not.
 *
 * The one cross-module identifier these screens resolve, because it is the only one a bounded read
 * answers — the same single read the Employee Record makes for a manager.
 */
const Named = ({
  name,
  employmentId,
}: {
  readonly name: string | undefined;
  readonly employmentId: string | undefined;
}): ReactNode => {
  if (name !== undefined) return <span>{name}</span>;
  if (employmentId === undefined) return <span>{DASH}</span>;

  return <Reference value={employmentId} />;
};

/** Whether a routed approval decided this, or Recruitment did. Never guessed from anything else. */
const DecidedBy = ({
  t,
  requisition,
}: HiringProps & { readonly requisition: RequisitionView }): ReactNode =>
  requisition.approvalId === undefined ? (
    <span>{t('recruitment.label.decidedInRecruitment')}</span>
  ) : (
    <Reference value={requisition.approvalId} />
  );

export const RequisitionSummary = ({
  t,
  language,
  detail,
}: RequisitionProps & { readonly detail: RequisitionForDisplay }): ReactNode => {
  const requisition = detail.snapshot.requisition;

  return (
    <Facts>
      <Fact
        label={t('recruitment.label.requestedBy')}
        value={
          <Named
            name={nameIn(detail.requestedByName, language)}
            employmentId={requisition.requestedByEmploymentId}
          />
        }
      />
      <Fact
        label={t('recruitment.label.hiringManager')}
        value={
          <Named
            name={nameIn(detail.hiringManagerName, language)}
            employmentId={requisition.hiringManagerEmploymentId}
          />
        }
      />
      <Fact
        label={t('recruitment.label.decidedBy')}
        value={<DecidedBy t={t} requisition={requisition} />}
      />
      <Fact
        label={t('recruitment.label.reason')}
        value={<Isolated>{requisition.reasonCode}</Isolated>}
      />
      <Fact
        label={t('recruitment.label.priority')}
        value={<Isolated>{requisition.priorityCode ?? DASH}</Isolated>}
      />
      <Fact
        label={t('recruitment.label.targetStartDate')}
        value={<Isolated>{day(requisition.targetStartDate)}</Isolated>}
      />
      <Fact
        label={t('recruitment.label.position')}
        value={<Reference value={reference(requisition.positionId)} />}
      />
      <Fact
        label={t('recruitment.label.unit')}
        value={<Reference value={reference(requisition.unitId)} />}
      />
      <Fact
        label={t('recruitment.label.costCenter')}
        value={<Reference value={reference(requisition.costCenterId)} />}
      />
    </Facts>
  );
};

const DECISION_TONE: Readonly<Record<string, Tone>> = {
  approved: 'success',
  rejected: 'danger',
  reversed: 'warning',
};

const DecisionRow = ({
  t,
  language,
  decision,
}: RequisitionProps & { readonly decision: RequisitionDecisionView }): ReactNode => (
  <Row>
    <Cell>
      <Term
        t={t}
        group="decisionOutcome"
        value={decision.decision}
        tone={DECISION_TONE[decision.decision]}
      />
    </Cell>
    <Cell>
      <Isolated>{decision.reasonCode ?? DASH}</Isolated>
    </Cell>
    <Cell>{decision.note === undefined ? DASH : <Isolated>{decision.note}</Isolated>}</Cell>
    <Identifier value={decision.decidedBy} />
    <Cell>
      <Isolated>{instant(decision.decidedAt, language)}</Isolated>
    </Cell>
    <Identifier value={reference(decision.reversesId)} />
  </Row>
);

export const DecisionsSection = ({
  t,
  language,
  decisions,
}: RequisitionProps & { readonly decisions: readonly RequisitionDecisionView[] }): ReactNode => {
  const title = t('recruitment.label.decisions');

  if (decisions.length === 0) {
    return <Clear t={t} title={title} message="recruitment.label.noDecisions" />;
  }

  return (
    <HiringSection title={title}>
      <Rows
        headings={[
          t('recruitment.label.decision'),
          t('recruitment.label.reason'),
          t('recruitment.label.note'),
          t('recruitment.label.decidedBy'),
          t('recruitment.label.decidedAt'),
          t('recruitment.label.reverses'),
        ]}
      >
        {decisions.map((decision) => (
          <DecisionRow key={decision.decisionId} t={t} language={language} decision={decision} />
        ))}
      </Rows>
      <p className="text-xs text-muted-foreground">{t('recruitment.label.decisionsAreAppended')}</p>
    </HiringSection>
  );
};

/** What the requisition record does not do. */
const REQUISITION_BOUNDARIES = [
  'recruitment.label.boundaryWrites',
  'recruitment.label.boundaryApproval',
  'recruitment.label.boundaryOrganization',
  'recruitment.label.boundaryHeadcount',
  'admin.notice.readOnly',
] as const;

export const RequisitionBoundaries = ({ t }: HiringProps): ReactNode => (
  <Boundaries t={t} keys={REQUISITION_BOUNDARIES} />
);
