import type { ReactNode } from 'react';
import type { LeaveApprovalChainView } from '@work/leave/contracts';

import {
  Cell,
  Clear,
  Fact,
  Facts,
  Isolated,
  LeaveSection,
  Note,
  Reference,
  Refused,
  Row,
  Rows,
  Term,
  When,
  Wrote,
} from './frame';
import { DASH, count, instant, reference } from './exact';
import { DECISION_TONE } from './tones';
import type { RequestProps } from './request';

/**
 * Who answered a leave request.
 *
 * Apart from `request.tsx` because a screen file's budget is four hundred lines, and because this
 * is the one region of the page whose *absence* of content is the content: a policy requiring no
 * approval produces no steps at all, and the whole section exists to say that rather than to fill
 * the gap.
 */

/**
 * Who answered it, in the approval port's own vocabulary.
 *
 * **A policy requiring no approval has no steps at all**, and the screen says nobody had to decide
 * rather than naming a system approver. Recording `system:auto-approval` as though a human had made
 * a decision about paid absence is the fake completeness the module refuses (ADR-0045), and a
 * screen that filled the gap would put it back.
 *
 * **`approvalId` is not a link.** Leave records its own decisions and does not consume the approval
 * port, so the reference does not resolve to anything in the Approvals surface. It is shown as the
 * identifier it is, with a sentence saying why it goes nowhere.
 */
const Decisions = ({
  t,
  language,
  approvals,
}: RequestProps & { readonly approvals: LeaveApprovalChainView }): ReactNode =>
  approvals.steps.length === 0 ? (
    <Note t={t} message="leave.notice.nothingDecidedYet" />
  ) : (
    <Rows
      headings={[
        t('leave.label.approver'),
        t('leave.label.decision'),
        t('leave.label.decidedAt'),
        t('leave.label.comment'),
      ]}
    >
      {approvals.steps.map((step) => (
        <Row key={`${step.approver}-${String(step.decidedAt)}`}>
          <Cell>
            <Reference value={reference(step.approver)} />
          </Cell>
          <Cell>
            <Term
              t={t}
              group="decision"
              value={step.decision}
              tone={DECISION_TONE[step.decision]}
            />
          </Cell>
          <When>
            <Isolated>{instant(step.decidedAt, language)}</Isolated>
          </When>
          <Cell>
            <Wrote>{step.comment ?? DASH}</Wrote>
          </Cell>
        </Row>
      ))}
    </Rows>
  );

export const ApprovalSection = ({
  t,
  language,
  approvals,
}: RequestProps & { readonly approvals: LeaveApprovalChainView | undefined }): ReactNode => {
  const title = t('leave.label.approvalChain');

  if (approvals === undefined) return <Refused t={t} title={title} />;
  if (!approvals.approvalRequired) {
    return <Clear t={t} title={title} message="leave.notice.noApprovalRequired" />;
  }

  return (
    <LeaveSection
      title={title}
      description={
        <Isolated>{`${count(approvals.steps.length)} / ${count(approvals.approvalsRequired)}`}</Isolated>
      }
    >
      <Decisions t={t} language={language} approvals={approvals} />
      {approvals.approvalId === undefined ? undefined : (
        <Facts>
          <Fact
            label={t('leave.label.approvalIdentifier')}
            value={<Reference value={approvals.approvalId} />}
          />
        </Facts>
      )}
      <Note t={t} message="leave.notice.approvalNotWorkflow" />
    </LeaveSection>
  );
};
