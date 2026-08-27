import type { ReactNode } from 'react';
import type { PendingApprovalView, WorkflowDecisionView } from '@work/workflow/contracts';

import type { Language } from '../shell/locale';
import { count, instant, member, short } from '../workflow/exact';

import { Badge } from '@munaxa/ui';

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
  Refused,
  Row,
  Rows,
  Term,
  type ApprovalsProps,
  type Tone,
} from './frame';
import type { Queue } from './api';

/**
 * What is waiting on the caller, and what they have already answered.
 *
 * **Whose lists these are was decided by the request, not by this screen.** There is no picker, no
 * "viewing as" and no parameter to supply one; a queue endpoint that accepted an identifier would
 * let anybody holding the permission read anybody's queue.
 *
 * **A decision keeps two identities apart and this screen never collapses them.** The actor is who
 * answered; the authority is whose it was. Both come from the API's own `authority` and
 * `onBehalfOfMembershipId` fields, never inferred by comparing identifiers to a step's configured
 * approver — which would guess at exactly the fact an auditor needs to be certain of.
 *
 * **Nobody here is called a manager.** Workflow resolves no reporting line and holds no idea of one;
 * a delegate is somebody Identity says may act, for a period somebody agreed in advance.
 *
 * **A subject is two opaque strings.** Workflow never interprets what a `recruitment.requisition`
 * is, and neither does this screen: the type is the owning module's own word and the identifier is
 * an identifier. Describing a subject in business terms means asking the module that owns it, which
 * is a design question this slice deliberately leaves open.
 */

/** How Workflow's own service-level vocabulary reads at a glance. The meaning stays the module's. */
const SERVICE_LEVEL_TONE: Readonly<Record<string, Tone>> = {
  overdue: 'danger',
  within: 'success',
  none: 'muted',
};

const DECISION_TONE: Readonly<Record<string, Tone>> = {
  approved: 'success',
  rejected: 'danger',
};

/**
 * The three figures the queue opens with, each the server's own.
 *
 * `waiting` is the server's **total** and never the page length: a queue that counted its own rows
 * would tell somebody with three hundred approvals that they have twenty-five. `overdue` counts the
 * rows on this page whose *state the server already decided* — it is a tally of a published word,
 * not a comparison of two instants, and the page it counts is the page it is shown beside.
 */
const OverdueOnThisPage = ({ items }: { readonly items: readonly PendingApprovalView[] }): number =>
  items.filter((step) => step.serviceLevel?.state === 'overdue').length;

/**
 * How many of the rows on this page the server has already called overdue.
 *
 * The **figure** is the value and the badge is emphasis on it: a label that reads "Overdue" beside a
 * value that also reads "Overdue" tells a reader nothing they did not have. Absent when the queue
 * was refused, because a count of a queue nobody could read would be a number somebody might act on.
 */
const Overdue = ({ overdue }: { readonly overdue: number | undefined }): ReactNode => {
  if (overdue === undefined) return <span>{DASH}</span>;
  if (overdue === 0) return <span>{count(overdue)}</span>;

  return <Badge tone="danger">{count(overdue)}</Badge>;
};

const Summary = ({
  t,
  pending,
  decided,
}: ApprovalsProps & {
  readonly pending: Queue<PendingApprovalView> | undefined;
  readonly decided: Queue<WorkflowDecisionView> | undefined;
}): ReactNode => {
  const overdue = pending === undefined ? undefined : OverdueOnThisPage({ items: pending.items });

  return (
    <Facts>
      <Fact
        label={t('admin.approvals.waiting')}
        value={pending === undefined ? DASH : count(pending.total)}
      />
      <Fact
        label={t('workflow.vocabulary.serviceLevelState.overdue')}
        value={<Overdue overdue={overdue} />}
      />
      <Fact
        label={t('admin.approvals.decidedByYou')}
        value={decided === undefined ? DASH : count(decided.total)}
      />
    </Facts>
  );
};

/**
 * One row of the queue, and the cell that opens it.
 *
 * The workflow's code and the subject say what the person is being asked about; the ordinal says
 * where in the chain they are; the service-level cell is the server's own word about its own target
 * and is one cell rather than four, because a queue is scanned rather than read.
 */
const PendingRow = ({
  t,
  language,
  step,
}: ApprovalsProps & {
  readonly language: Language;
  readonly step: PendingApprovalView;
}): ReactNode => (
  <Row>
    <Cell>
      <a
        href={`/approvals/${step.instanceId}?lang=${language}`}
        className="underline underline-offset-4"
      >
        <Isolated>{step.definitionCode}</Isolated>
      </a>
    </Cell>
    <Cell>
      <Isolated>{step.subjectType}</Isolated>
    </Cell>
    <Identifier value={short(step.subjectId)} />
    <Cell numeric>{count(step.ordinal)}</Cell>
    <Cell>
      <Isolated>{instant(step.startedOn, language)}</Isolated>
    </Cell>
    <Cell>
      <Term
        t={t}
        group="serviceLevelState"
        value={step.serviceLevel?.state}
        tone={SERVICE_LEVEL_TONE[step.serviceLevel?.state ?? 'none']}
      />
    </Cell>
  </Row>
);

export const WaitingSection = ({
  t,
  language,
  pending,
}: ApprovalsProps & {
  readonly language: Language;
  readonly pending: Queue<PendingApprovalView> | undefined;
}): ReactNode => {
  const title = t('admin.approvals.waitingForYou');

  if (pending === undefined) return <Refused t={t} title={title} />;
  if (pending.items.length === 0) {
    return <Clear t={t} title={title} message="admin.approvals.nothingWaiting" />;
  }

  return (
    <ApprovalsSection
      title={title}
      description={
        <>
          {count(pending.items.length)} / <Isolated>{count(pending.total)}</Isolated>
        </>
      }
    >
      <Rows
        headings={[
          t('workflow.label.definitionCode'),
          t('workflow.label.subjectType'),
          t('workflow.label.subjectId'),
          t('workflow.label.ordinal'),
          t('workflow.label.startedOn'),
          t('workflow.label.serviceLevelState'),
        ]}
        numeric={[3]}
      >
        {pending.items.map((step) => (
          <PendingRow key={step.stepId} t={t} language={language} step={step} />
        ))}
      </Rows>

      <p className="text-xs text-muted-foreground">{t('workflow.notice.queueIsAmbient')}</p>
    </ApprovalsSection>
  );
};

/** One decision the caller made, with the actor and the authority kept apart. */
const DecidedRow = ({
  t,
  language,
  decision,
}: ApprovalsProps & {
  readonly language: Language;
  readonly decision: WorkflowDecisionView;
}): ReactNode => (
  <Row>
    <Cell>
      <Term
        t={t}
        group="decision"
        value={decision.decision}
        tone={DECISION_TONE[decision.decision]}
      />
    </Cell>
    {/* Who acted. On a delegated decision this is the delegate, never the approver. */}
    <Identifier value={member(decision.decidedByMembershipId)} />
    <Cell>
      <Plain t={t} group="authority" value={decision.authority} />
    </Cell>
    {/* Whose authority. Absent on a direct decision, and rendered as absent rather than filled in
        from the actor — the two questions have two answers. */}
    <Identifier value={member(decision.onBehalfOfMembershipId)} />
    <Cell>
      <Isolated>{instant(decision.decidedOn, language)}</Isolated>
    </Cell>
    <Cell>{decision.comment === undefined ? DASH : <Isolated>{decision.comment}</Isolated>}</Cell>
  </Row>
);

export const DecidedSection = ({
  t,
  language,
  decided,
}: ApprovalsProps & {
  readonly language: Language;
  readonly decided: Queue<WorkflowDecisionView> | undefined;
}): ReactNode => {
  const title = t('admin.approvals.decidedByYou');

  if (decided === undefined) return <Refused t={t} title={title} />;
  if (decided.items.length === 0) {
    return <Clear t={t} title={title} message="admin.approvals.nothingDecided" />;
  }

  return (
    <ApprovalsSection
      title={title}
      description={
        <>
          {count(decided.items.length)} / <Isolated>{count(decided.total)}</Isolated>
        </>
      }
    >
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
        {decided.items.map((decision) => (
          <DecidedRow key={decision.decisionId} t={t} language={language} decision={decision} />
        ))}
      </Rows>

      <p className="text-xs text-muted-foreground">{t('workflow.notice.commentOnDecision')}</p>
    </ApprovalsSection>
  );
};

export const QueueSummary = Summary;

/**
 * What this screen does not do, said rather than left as an absence.
 *
 * Every line is a boundary this repository holds today. A reader who cannot decide an approval here
 * needs to know that the capability exists and where it is, not to conclude the product forgot it.
 */
const BOUNDARIES = [
  'admin.approvals.decidingIsApi',
  'admin.approvals.subjectIsOpaque',
  'admin.approvals.membershipsAreIdentifiers',
  'admin.approvals.onlyRecruitmentRaises',
  'admin.notice.readOnly',
] as const;

export const BoundariesNote = ({ t }: ApprovalsProps): ReactNode => (
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
