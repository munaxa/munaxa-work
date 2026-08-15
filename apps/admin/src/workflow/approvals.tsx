import type { ReactNode } from 'react';
import type {
  ApprovalStatusView,
  PendingApprovalView,
  WorkflowDecisionView,
} from '@work/workflow/contracts';

import { count, instant, member, short } from './exact';
import { Empty, Figure, Section, Table, Term, type SectionProps } from './sections';

/**
 * The approver's own two lists, and one approval's state in the port's words.
 *
 * **Whose lists these are was decided by the request, not by this screen.** Neither read carries a
 * membership, a workforce user, a platform user, an approver or a `me`; the API resolves the caller
 * from the authenticated request and answers a request that resolved nobody with nothing. That is
 * why there is no picker here, no "viewing as", and no parameter to supply one — a queue endpoint
 * that accepted an identifier would let anybody holding the permission read anybody's queue.
 *
 * **A decision keeps two identities apart and this screen never collapses them.** The actor is who
 * answered; the authority is whose it was. On a delegated decision both are shown with their own
 * labels, taken from the API's own `authority` and `onBehalfOfMembershipId` fields — never inferred
 * by comparing identifiers to the step's configured approver, which would guess at exactly the fact
 * an auditor needs to be certain of.
 *
 * **Nobody here is called a manager.** Workflow does not resolve reporting lines and holds no idea
 * of one; a delegate is somebody Identity says may act, for a period somebody agreed in advance.
 */

/**
 * What is waiting on the caller.
 *
 * The row carries the workflow's code and the subject so the person can tell what they are being
 * asked about, and no approver column — the only approver a row of this list can have is the caller.
 * There is no due date and no age, because Workflow publishes neither.
 */
export const PendingSection = ({
  t,
  language,
  pending,
  total,
}: SectionProps & {
  readonly pending: readonly PendingApprovalView[];
  readonly total: number;
}): ReactNode => (
  <Section
    t={t}
    title="pending"
    total={total}
    shown={pending.length}
    note="workflow.notice.queueIsAmbient"
  >
    {pending.length === 0 ? (
      <Empty t={t} />
    ) : (
      <Table
        t={t}
        headers={[
          'definitionCode',
          'subjectType',
          'subjectId',
          'ordinal',
          'startedOn',
          'instanceId',
        ]}
      >
        {pending.map((step) => (
          <tr key={step.stepId}>
            <td>{step.definitionCode}</td>
            <td>{step.subjectType}</td>
            <td>{short(step.subjectId)}</td>
            <td>{count(step.ordinal)}</td>
            <td>{instant(step.startedOn, language)}</td>
            <td>{short(step.instanceId)}</td>
          </tr>
        ))}
      </Table>
    )}
  </Section>
);

/**
 * What the caller decided — the other half of a queue, on the same identity rule.
 *
 * A **delegated** decision appears here for the delegate, because they are the one who decided it.
 * It does not appear for the approver whose authority was used, who did not act. The comment stays
 * on this row rather than travelling into the timeline: it is one person's written opinion of
 * another's request, and the permission that decides who may read it belongs to the decision.
 */
export const DecidedSection = ({
  t,
  language,
  decided,
  total,
}: SectionProps & {
  readonly decided: readonly WorkflowDecisionView[];
  readonly total: number;
}): ReactNode => (
  <Section
    t={t}
    title="decided"
    total={total}
    shown={decided.length}
    note="workflow.notice.commentOnDecision"
  >
    {decided.length === 0 ? (
      <Empty t={t} />
    ) : (
      <Table
        t={t}
        headers={['decision', 'decidedBy', 'authority', 'onBehalfOf', 'decidedOn', 'comment']}
      >
        {decided.map((decision) => (
          <tr key={decision.decisionId}>
            <td>
              <Term t={t} group="decision" value={decision.decision} />
            </td>
            {/* Who acted. On a delegated decision this is the delegate, never the approver. */}
            <td>{member(decision.decidedByMembershipId)}</td>
            <td>
              <Term t={t} group="authority" value={decision.authority} />
            </td>
            {/* Whose authority. Absent on a direct decision, and rendered as absent rather than
                filled in from the actor — the two questions have two answers. */}
            <td>{member(decision.onBehalfOfMembershipId)}</td>
            <td>{instant(decision.decidedOn, language)}</td>
            <td>{decision.comment ?? '—'}</td>
          </tr>
        ))}
      </Table>
    )}
  </Section>
);

/**
 * One approval in `ApprovalPort`'s own vocabulary: its state, and the chain as the requester sees it.
 *
 * The state rendered is whichever one the server returned. **Nothing here offers a legend of the
 * states**, and that matters for one of them: `expired` is declared by the port and this phase never
 * produces it, so a screen that listed the vocabulary would show an operational-looking state that
 * nothing in this product can reach. The status section says so in words instead.
 *
 * The approver named in the chain is the **membership the step was assigned to**. A delegate's
 * identity belongs to the decision record, which is where the section above shows it.
 */
export const ApprovalStatusSection = ({
  t,
  language,
  approval,
}: SectionProps & { readonly approval: ApprovalStatusView | undefined }): ReactNode => (
  <Section t={t} title="approvalStatus" note="workflow.notice.detailIsFirstRow">
    {approval === undefined ? (
      <Empty t={t} />
    ) : (
      <>
        <dl className="grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
          <Figure t={t} label="approvalId" value={short(approval.approvalId)} />
          <Figure
            t={t}
            label="state"
            value={<Term t={t} group="approvalState" value={approval.state} />}
          />
          <Figure t={t} label="completedOn" value={instant(approval.completedOn, language)} />
        </dl>

        <Table t={t} headers={['approver', 'decision', 'decidedOn']}>
          {approval.steps.map((step) => (
            <tr key={`${approval.approvalId}-${step.approver}`}>
              <td>{member(step.approver)}</td>
              <td>
                <Term t={t} group="decision" value={step.decision} />
              </td>
              <td>{instant(step.decidedOn, language)}</td>
            </tr>
          ))}
        </Table>
      </>
    )}
  </Section>
);
