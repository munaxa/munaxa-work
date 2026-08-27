import type { ReactNode } from 'react';
import type { ApprovalStatusView, WorkflowHistoryView } from '@work/workflow/contracts';

import type { Language } from '../shell/locale';
import { count, instant, member } from '../workflow/exact';

import {
  ApprovalsSection,
  Cell,
  Clear,
  Identifier,
  Isolated,
  Plain,
  Refused,
  Row,
  Rows,
  Term,
  type ApprovalsProps,
  type Tone,
} from './frame';
import type { Queue } from './api';

/**
 * What happened to this approval, and what a requesting module sees of it.
 *
 * Split from the chain and the tallies at the seam the two halves already had: everything there
 * describes the approval's **current shape** — who is asked, where the branch stands — and
 * everything here describes **what has happened** and **what the port reports**. They are read for
 * different reasons, and together the two halves had passed the file budget.
 *
 * **The timeline is refused or empty, never both.** A caller who may not read the instance's history
 * meets a withheld section; one who may, and finds nothing, is told there is nothing.
 */

const DECISION_TONE: Readonly<Record<string, Tone>> = {
  approved: 'success',
  rejected: 'danger',
};

export const TimelineSection = ({
  t,
  language,
  history,
}: ApprovalsProps & {
  readonly language: Language;
  readonly history: Queue<WorkflowHistoryView> | undefined;
}): ReactNode => {
  const title = t('workflow.label.history');

  if (history === undefined) return <Refused t={t} title={title} />;
  if (history.items.length === 0) {
    return <Clear t={t} title={title} message="workflow.notice.empty" />;
  }

  return (
    <ApprovalsSection
      title={title}
      description={
        <>
          {count(history.items.length)} / <Isolated>{count(history.total)}</Isolated>
        </>
      }
    >
      <Rows
        headings={[
          t('workflow.label.occurredOn'),
          t('workflow.label.event'),
          t('workflow.label.ordinal'),
          t('workflow.label.actor'),
          t('workflow.label.onBehalfOf'),
        ]}
        numeric={[2]}
      >
        {history.items.map((entry) => (
          <Row key={entry.historyId}>
            <Cell>
              <Isolated>{instant(entry.occurredOn, language)}</Isolated>
            </Cell>
            <Cell>
              <Plain t={t} group="historyEvent" value={entry.event} />
            </Cell>
            <Cell numeric>{count(entry.ordinal)}</Cell>
            <Identifier value={member(entry.actorMembershipId)} />
            <Identifier value={member(entry.onBehalfOfMembershipId)} />
          </Row>
        ))}
      </Rows>
    </ApprovalsSection>
  );
};

/**
 * The same approval in `ApprovalPort`'s own five-state vocabulary — what a consuming module sees.
 *
 * It is here rather than merged into the chain above because it is a *different answer to a
 * different question*: the chain is Workflow's own record, and this is the shape a business module
 * receives when it asks how its request is going. The approver named here is the membership the step
 * was assigned to; a delegate's identity belongs to the decision record.
 */
export const PortStatusSection = ({
  t,
  language,
  status,
}: ApprovalsProps & {
  readonly language: Language;
  readonly status: ApprovalStatusView | undefined;
}): ReactNode => {
  const title = t('workflow.label.approvalStatus');

  if (status === undefined) return <Refused t={t} title={title} />;

  return (
    <ApprovalsSection title={title}>
      <Rows
        headings={[
          t('workflow.label.approver'),
          t('workflow.label.decision'),
          t('workflow.label.decidedOn'),
        ]}
      >
        {status.steps.map((step) => (
          <Row key={`${status.approvalId}-${step.approver}`}>
            <Identifier value={member(step.approver)} />
            <Cell>
              <Term
                t={t}
                group="decision"
                value={step.decision}
                tone={step.decision === undefined ? undefined : DECISION_TONE[step.decision]}
              />
            </Cell>
            <Cell>
              <Isolated>{instant(step.decidedOn, language)}</Isolated>
            </Cell>
          </Row>
        ))}
      </Rows>

      <p className="text-xs text-muted-foreground">{t('admin.approvals.portVocabulary')}</p>
    </ApprovalsSection>
  );
};
