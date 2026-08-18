import { success, type Query, type QueryHandler, type Transaction } from '@work/kernel';

import { awaitingSteps, type WorkflowStepState } from '../domain/instance.js';
import { branchAt, branchOf, branchOrdinals, tallyOf, type BranchVote } from '../domain/branch.js';
import type { WorkflowDecisionState } from '../domain/decision.js';
import type {
  BranchTallyView,
  WorkflowDefinitionDetailView,
  WorkflowDefinitionView,
  WorkflowInstanceDetailView,
  WorkflowInstanceView,
} from '../contracts/views.js';
import { notFound } from './workflow-context.js';
import { pageOf } from './workflow-paging.js';
import { WorkflowPermissions } from './workflow-permissions.js';
import {
  asDecisionView,
  asDefinitionView,
  asInstanceView,
  asStepView,
  asTallyView,
  asTemplateView,
  asVersionView,
} from './workflow-views.js';
import type { Page } from './workflow-ports.js';
import type { WorkflowDependencies } from './workflow-dependencies.js';

/**
 * The administrative reads: what a tenant has configured, and what is running.
 *
 * **Every collection read is bounded and every one reports its own total.** The total is counted
 * over the same predicate as the page — a count that ignored the filter would tell an administrator
 * there are four hundred approvals waiting when the filter they applied matches six.
 *
 * **Ordering is deterministic and ends in the identifier.** Two instances started in the same
 * millisecond would otherwise page non-deterministically, which is how a row appears on two pages
 * and another on none.
 *
 * **A detail read is a fixed number of store reads**, never one per row. `readInstanceHandler` makes
 * four regardless of how many steps or decisions an approval has, which is what keeps the screen it
 * serves from becoming an N+1 as a tenant's processes grow longer.
 *
 * These carry `instance.read` — an administrator's view of the tenant. The caller's *own* queue is a
 * different permission and a different file, because it answers a different question.
 */

export interface SearchDefinitions extends Query {
  readonly queryName: 'workflow.search-definitions';
  readonly status?: string;
  readonly subjectType?: string;
  readonly page?: number;
  readonly size?: number;
}

export const searchDefinitionsHandler = (
  dependencies: WorkflowDependencies,
): QueryHandler<SearchDefinitions, Page<WorkflowDefinitionView>> => ({
  queryName: 'workflow.search-definitions',
  permission: WorkflowPermissions.definitionRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const found = await dependencies.stores.definitions.search(
        transaction,
        {
          ...(query.status === undefined ? {} : { status: query.status }),
          ...(query.subjectType === undefined ? {} : { subjectType: query.subjectType }),
        },
        pageOf(query),
      );

      return success({ items: found.items.map(asDefinitionView), total: found.total });
    }),
});

export interface ReadDefinition extends Query {
  readonly queryName: 'workflow.read-definition';
  readonly definitionId: string;
  readonly page?: number;
  readonly size?: number;
}

/**
 * One definition, its versions, and the steps of whichever version is currently published.
 *
 * The steps come from the **published** version rather than the newest draft, because that is the
 * one an approval started now would follow. A screen showing a draft's steps beside a definition
 * that is already in use would describe a process nobody is running.
 */
export const readDefinitionHandler = (
  dependencies: WorkflowDependencies,
): QueryHandler<ReadDefinition, WorkflowDefinitionDetailView> => ({
  queryName: 'workflow.read-definition',
  permission: WorkflowPermissions.definitionRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const definition = await dependencies.stores.definitions.byId(
        transaction,
        query.definitionId,
      );

      if (definition === undefined) return notFound('workflow-definition');

      const versions = await dependencies.stores.versions.forDefinition(
        transaction,
        query.definitionId,
        pageOf(query),
      );
      const published = await dependencies.stores.versions.currentPublished(
        transaction,
        query.definitionId,
      );
      const counted = await countedVersions(dependencies, transaction, versions.items);

      return success({
        definition: asDefinitionView(definition),
        versions: counted,
        ...(published === undefined
          ? {}
          : {
              publishedSteps: (
                await dependencies.stores.versions.templatesFor(
                  transaction,
                  published.workflowVersionId,
                )
              )
                .map(asTemplateView)
                .sort((left, right) => left.ordinal - right.ordinal),
            }),
      });
    }),
});

/** A step count per version, read once per version on a page that is already bounded. */
const countedVersions = async (
  dependencies: WorkflowDependencies,
  transaction: Transaction,
  versions: readonly { readonly workflowVersionId: string }[],
): Promise<WorkflowDefinitionDetailView['versions']> => {
  const counted = [];

  for (const version of versions) {
    const templates = await dependencies.stores.versions.templatesFor(
      transaction,
      version.workflowVersionId,
    );

    counted.push(asVersionView(version as Parameters<typeof asVersionView>[0], templates.length));
  }
  return counted;
};

export interface SearchInstances extends Query {
  readonly queryName: 'workflow.search-instances';
  readonly status?: string;
  readonly definitionId?: string;
  readonly subjectType?: string;
  readonly subjectId?: string;
  readonly page?: number;
  readonly size?: number;
}

/**
 * Running and finished approvals.
 *
 * `subjectType` and `subjectId` together are the read an adopting module makes about its own
 * record — "what happened to this requisition" — and the pair is indexed for exactly that.
 */
export const searchInstancesHandler = (
  dependencies: WorkflowDependencies,
): QueryHandler<SearchInstances, Page<WorkflowInstanceView>> => ({
  queryName: 'workflow.search-instances',
  permission: WorkflowPermissions.instanceRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const found = await dependencies.stores.instances.search(
        transaction,
        {
          ...(query.status === undefined ? {} : { status: query.status }),
          ...(query.definitionId === undefined ? {} : { definitionId: query.definitionId }),
          ...(query.subjectType === undefined ? {} : { subjectType: query.subjectType }),
          ...(query.subjectId === undefined ? {} : { subjectId: query.subjectId }),
        },
        pageOf(query),
      );

      return success({ items: found.items.map(asInstanceView), total: found.total });
    }),
});

export interface ReadInstance extends Query {
  readonly queryName: 'workflow.read-instance';
  readonly instanceId: string;
}

/** One approval with its steps and decisions. Four store reads, whatever its length. */
export const readInstanceHandler = (
  dependencies: WorkflowDependencies,
): QueryHandler<ReadInstance, WorkflowInstanceDetailView> => ({
  queryName: 'workflow.read-instance',
  permission: WorkflowPermissions.instanceRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const instance = await dependencies.stores.instances.byId(transaction, query.instanceId);

      if (instance === undefined) return notFound('workflow-instance');

      const steps = await dependencies.stores.steps.forInstance(transaction, query.instanceId);
      const decisions = await dependencies.stores.decisions.forInstance(
        transaction,
        query.instanceId,
      );
      const open = awaitingSteps(steps);
      const [first] = open;
      // The instant this approval is being *read* at, and the only thing due-ness is answered
      // against. One reading for the whole response, so a step cannot be `within` in one field and
      // `overdue` in another because a millisecond passed between two mappings.
      const asAt = dependencies.clock.now();

      return success({
        instance: asInstanceView(instance),
        steps: [...steps]
          .sort((left, right) => left.ordinal - right.ordinal)
          .map((step) => asStepView(step, asAt)),
        decisions: decisions.map(asDecisionView),
        awaitingSteps: open.map((step) => asStepView(step, asAt)),
        tallies: talliesOf(steps, decisions),
        // The first of them, for the shape 16A published. A branch of four has four, and
        // `awaitingSteps` above is where a caller sees all of them.
        ...(first === undefined ? {} : { awaiting: asStepView(first, asAt) }),
      });
    }),
});

/**
 * How every branch of an approval stands, computed from the decisions that exist.
 *
 * **Nothing is stored and nothing is recomputed here.** The arithmetic is `tallyOf`'s — the same
 * function a decision is evaluated against — and this walks the branches and hands it the votes
 * belonging to each. A second implementation of the threshold, even one that agreed today, would be
 * the second place the rule lived, and this rule decides who is approved.
 *
 * The denominator is the branch's **assigned** approvers: every step of that ordinal, including the
 * people who have not answered. That is what makes a branch of five where one person replied read as
 * one of five rather than as one of one.
 */
const talliesOf = (
  steps: readonly WorkflowStepState[],
  decisions: readonly WorkflowDecisionState[],
): readonly BranchTallyView[] => {
  const voteOf = new Map(
    decisions.map((decision) => [
      decision.stepId,
      {
        stepId: decision.stepId,
        decision: decision.decision,
        decidedAt: decision.decidedAt,
      },
    ]),
  );

  return branchOrdinals(steps).map((ordinal) => {
    const branch = branchAt(steps, ordinal);
    const votes = branch
      .map((step) => voteOf.get(step.stepId))
      .filter((vote): vote is BranchVote => vote !== undefined);
    const [first] = branch;

    return asTallyView(
      ordinal,
      tallyOf(first === undefined ? { rule: 'unanimous' } : branchOf(first), branch, votes),
    );
  });
};
