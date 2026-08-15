import type { ReactNode } from 'react';
import type { WorkflowInstanceDetailView, WorkflowInstanceView } from '@work/workflow/contracts';

import { count, instant, member, short } from './exact';
import { Empty, Section, Table, Term, type SectionProps } from './sections';

/**
 * The approvals themselves: what was raised, about what, and where each one got to.
 *
 * **The status is the server's.** `running`, `completed`, `rejected`, `cancelled` — each is a value
 * the domain transitioned into and the repository wrote down. Nothing here derives it from the
 * steps, which would be a second answer to a question the aggregate already decided, and a
 * disagreeing one the moment a decision commits between two reads.
 *
 * **The subject is printed and never followed.** A `recruitment.requisition` row shows the subject
 * type and identifier Workflow stored; this screen makes no request to Recruitment, holds no
 * Recruitment contract, and has no route of its own for one. What happened to the requisition is
 * Recruitment's to publish on Recruitment's own screen — and the seam that carried the decision
 * there lives in the API, inside the approver's request.
 */

export const InstancesSection = ({
  t,
  language,
  instances,
  total,
}: SectionProps & {
  readonly instances: readonly WorkflowInstanceView[];
  readonly total: number;
}): ReactNode => (
  <Section
    t={t}
    title="instances"
    total={total}
    shown={instances.length}
    note="workflow.notice.identifiersNotNames"
  >
    {instances.length === 0 ? (
      <Empty t={t} />
    ) : (
      <Table
        t={t}
        headers={[
          'instanceId',
          'subjectType',
          'subjectId',
          'status',
          'versionNumber',
          'requestedBy',
          'startedOn',
          'completedOn',
        ]}
      >
        {instances.map((instance) => (
          <tr key={instance.instanceId}>
            <td>{short(instance.instanceId)}</td>
            <td>{instance.subjectType}</td>
            <td>{short(instance.subjectId)}</td>
            <td>
              <Term t={t} group="instanceStatus" value={instance.status} />
            </td>
            {/* The version row this approval follows, by identifier: an approval already running
                keeps the chain it started on, whatever has been published since. */}
            <td>{short(instance.workflowVersionId)}</td>
            <td>{member(instance.requestedByMembershipId)}</td>
            <td>{instant(instance.startedOn, language)}</td>
            <td>{instant(instance.completedOn, language)}</td>
          </tr>
        ))}
      </Table>
    )}
  </Section>
);

/**
 * One approval's own chain, in ordinal order, with the step currently awaiting a decision named.
 *
 * `awaiting` is the API's answer rather than this screen's: exactly one step of a running approval
 * is awaiting, and the aggregate is what decides which. A screen that scanned the list for the first
 * undecided step would agree with the server most of the time, which is the worst kind of agreement.
 */
export const InstanceStepsSection = ({
  t,
  detail,
}: SectionProps & { readonly detail: WorkflowInstanceDetailView | undefined }): ReactNode => (
  <Section t={t} title="instanceSteps" note="workflow.notice.detailIsFirstRow">
    {detail === undefined || detail.steps.length === 0 ? (
      <Empty t={t} />
    ) : (
      <Table t={t} headers={['ordinal', 'approver', 'status', 'stepId', 'version']}>
        {detail.steps.map((step) => (
          <tr key={step.stepId}>
            <td>{count(step.ordinal)}</td>
            <td>{member(step.approverMembershipId)}</td>
            <td>
              <Term t={t} group="stepStatus" value={step.status} />
            </td>
            <td>{short(step.stepId)}</td>
            <td>{count(step.version)}</td>
          </tr>
        ))}
      </Table>
    )}
  </Section>
);
