import type { ReactNode } from 'react';
import type { WorkflowInstanceDetailView, WorkflowInstanceView } from '@work/workflow/contracts';

import { count, instant, member, short } from './exact';
import { StepServiceLevel } from './service-level';
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
 * One approval's own chain, in the order the API returned it, with each step's own status.
 *
 * **Every step names a person, whatever the version named.** A template may name a group; a running
 * step never does, because the list was resolved into its members before these rows existed. What
 * `sourceGroup` records is which list somebody came from — provenance for "why was I asked?", and
 * nothing that routes reads it. A group emptied since keeps its rows: an approval asks the people it
 * started with.
 *
 * **A step whose template named a manager names a person here, like every other step.** The manager
 * was worked out once, when this approval started, and the membership below is that answer written
 * down. Nothing on this screen calls it a manager: the API says `membership` and a person, and
 * inferring more from an identifier would be guessing at the one fact an auditor needs to be certain
 * of. What is behind that resolution — an employment, a reporting line — is not published here and
 * is not shown.
 *
 * **A status here is the server's own and is never inferred from position.** Several steps may share
 * an ordinal and be awaiting at once, so "the first undecided one" is not a question with an answer;
 * a step that has been decided shows its decision, and a step nothing reached shows as not yet
 * reached rather than as skipped.
 */
export const InstanceStepsSection = ({
  t,
  language,
  detail,
}: SectionProps & { readonly detail: WorkflowInstanceDetailView | undefined }): ReactNode => (
  <Section t={t} title="instanceSteps" note="workflow.notice.detailIsFirstRow">
    {detail === undefined || detail.steps.length === 0 ? (
      <Empty t={t} />
    ) : (
      <Table
        t={t}
        headers={[
          'ordinal',
          'approver',
          'approverOrigin',
          'status',
          'sourceGroup',
          'branchRule',
          'serviceLevel',
          'stepId',
          'version',
        ]}
      >
        {detail.steps.map((step) => (
          <tr key={step.stepId}>
            <td>{count(step.ordinal)}</td>
            <td>{member(step.approverMembershipId)}</td>
            {/* **The published boolean, read and nothing else** (D-16D-09). Not the row count, not
                `sourceGroupId`, and not a join against the timeline: an approver added to a running
                approval is marked by the server, and this cell prints the mark. A screen that
                inferred it would call the fourth row of a branch escalated whenever a branch had
                four rows, which is exactly what the snapshotted denominator makes possible. */}
            <td>
              <Term
                t={t}
                group="approverOrigin"
                value={step.escalated ? 'escalated' : 'assigned'}
              />
            </td>
            <td>
              <Term t={t} group="stepStatus" value={step.status} />
            </td>
            <td>{short(step.sourceGroupId)}</td>
            <td>
              <Term t={t} group="branchRule" value={step.branchRule} />
            </td>
            {/* Target, state, due instant and overdue minutes — four published fields, four cells,
                and no arithmetic between them. */}
            <td>
              <StepServiceLevel t={t} language={language} level={step.serviceLevel} />
            </td>
            <td>{short(step.stepId)}</td>
            <td>{count(step.version)}</td>
          </tr>
        ))}
      </Table>
    )}
    <p className="text-xs opacity-60">{t('workflow.notice.managerIsSnapshotted')}</p>
    <p className="text-xs opacity-60">{t('workflow.notice.serviceLevelIsObserved')}</p>
  </Section>
);
