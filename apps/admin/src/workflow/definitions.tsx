import type { ReactNode } from 'react';
import type {
  WorkflowDefinitionDetailView,
  WorkflowDefinitionView,
} from '@work/workflow/contracts';

import { count, instant, member, short } from './exact';
import { Clauses } from './branches';
import { Empty, named, Section, Table, Term, type SectionProps } from './sections';

/**
 * What a tenant configured: the workflows themselves, their versions, and the chain that is live.
 *
 * A **workflow** says what kind of record it decides and nothing about the record itself. The
 * subject type is printed as the owning module's own word — `recruitment.requisition` — and is never
 * translated, because it is that module's vocabulary rather than this one's, and never expanded into
 * a link, because Workflow has no route into another module and this screen makes no request to one.
 *
 * A **version** is how a chain changes without rewriting history: approvals already running follow
 * the version they started on. The listing here is one definition's, read once for the first row of
 * the workflows table.
 *
 * The **chain** is the published version's steps in their ordinal order, exactly as the API sorted
 * them. There is no branch in it, no condition on it and nothing parallel about it: a step is one
 * named member, asked after the step before them answers.
 */

export const DefinitionsSection = ({
  t,
  language,
  definitions,
  total,
}: SectionProps & {
  readonly definitions: readonly WorkflowDefinitionView[];
  readonly total: number;
}): ReactNode => (
  <Section
    t={t}
    title="definitions"
    total={total}
    shown={definitions.length}
    note="workflow.notice.subjectIsOpaque"
  >
    {definitions.length === 0 ? (
      <Empty t={t} />
    ) : (
      <Table t={t} headers={['code', 'name', 'subjectType', 'status', 'retiredOn', 'version']}>
        {definitions.map((definition) => (
          <tr key={definition.definitionId}>
            <td>{definition.code}</td>
            <td>{named(definition.name, language)}</td>
            {/* The owning module's own word, printed and not interpreted. */}
            <td>{definition.subjectType}</td>
            <td>
              <Term t={t} group="definitionStatus" value={definition.status} />
            </td>
            <td>{instant(definition.retiredOn, language)}</td>
            <td>{count(definition.version)}</td>
          </tr>
        ))}
      </Table>
    )}
  </Section>
);

/** One workflow's versions, newest state and all, for the first row of the listing above. */
export const VersionsSection = ({
  t,
  language,
  detail,
}: SectionProps & { readonly detail: WorkflowDefinitionDetailView | undefined }): ReactNode => (
  <Section t={t} title="versions" note="workflow.notice.detailIsFirstRow">
    {detail === undefined || detail.versions.length === 0 ? (
      <Empty t={t} />
    ) : (
      <Table t={t} headers={['versionNumber', 'status', 'stepCount', 'publishedOn', 'version']}>
        {detail.versions.map((version) => (
          <tr key={version.workflowVersionId}>
            <td>{count(version.versionNumber)}</td>
            <td>
              <Term t={t} group="versionStatus" value={version.status} />
            </td>
            <td>{count(version.stepCount)}</td>
            <td>{instant(version.publishedOn, language)}</td>
            <td>{count(version.version)}</td>
          </tr>
        ))}
      </Table>
    )}
  </Section>
);

/**
 * The published chain, in ordinal order — with the branch each step belongs to.
 *
 * The approver named on a step is the member or the **list** the tenant configured to be asked. It
 * is not the person reading this screen and it is not a role: a group here is an explicit list of
 * memberships somebody wrote down, and Workflow resolves no role, no position and no reporting line.
 * Whether somebody may act for an approver is Identity's answer at the moment of a decision rather
 * than a property of the configuration.
 *
 * **Several rows may share one position, and that is a branch rather than a mistake.** Everybody at
 * one ordinal is asked at the same moment, and the rule, the quorum and the condition beside them
 * say how that branch ends. A step configured before Phase 16B carries none of the three, and the
 * cells are rendered as absent rather than filled with the defaults the domain would apply — a
 * screen that printed `unanimous` on a step nobody configured that way would be reporting a decision
 * the tenant never made.
 */
export const StepsSection = ({
  t,
  language,
  detail,
}: SectionProps & { readonly detail: WorkflowDefinitionDetailView | undefined }): ReactNode => {
  const steps = detail?.publishedSteps ?? [];

  return (
    <Section t={t} title="steps" note="workflow.notice.approverIsConfigured">
      {steps.length === 0 ? (
        <Empty t={t} />
      ) : (
        <>
          <Table
            t={t}
            headers={[
              'ordinal',
              'name',
              'approverKind',
              'approver',
              'approverGroup',
              'branchRule',
              'quorum',
              'condition',
            ]}
          >
            {steps.map((step) => (
              <tr key={step.stepTemplateId}>
                <td>{count(step.ordinal)}</td>
                <td>{named(step.name, language)}</td>
                {/* Derived by the server from which identifier the step carries; this renders it. */}
                <td>
                  <Term t={t} group="approverKind" value={step.approverKind} />
                </td>
                <td>{member(step.approverMembershipId)}</td>
                <td>{short(step.approverGroupId)}</td>
                <td>
                  <Term t={t} group="branchRule" value={step.branchRule} />
                </td>
                <td>{count(step.quorum)}</td>
                <td>
                  <Clauses t={t} condition={step.condition} />
                </td>
              </tr>
            ))}
          </Table>
          <p className="text-xs opacity-60">{t('workflow.notice.conditionIsConfiguration')}</p>
        </>
      )}
    </Section>
  );
};
