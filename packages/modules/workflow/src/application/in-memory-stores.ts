import type { Transaction } from '@work/kernel';

import type { WorkflowDecisionState } from '../domain/decision.js';
import type {
  WorkflowDefinitionState,
  WorkflowStepTemplateState,
  WorkflowVersionState,
} from '../domain/definition.js';
import type { WorkflowHistoryState } from '../domain/history.js';
import type { WorkflowInstanceState, WorkflowStepState } from '../domain/instance.js';
import {
  byIdentifier,
  bumped,
  expectVersion,
  heldOr,
  paged,
  refuseDuplicate,
} from './in-memory-tables.js';
import { approvalGroupStore } from './in-memory-groups.js';
import type {
  DefinitionFilters,
  InstanceFilters,
  Page,
  Paged,
  WorkflowStores,
} from './workflow-ports.js';

/**
 * The stores the application suites run against.
 *
 * Every invariant Checkpoint 3 put in an index or a trigger is repeated here, and nothing else is.
 * The reasoning is in `in-memory-tables.ts`; what follows is the mapping, index by index, so a
 * reader can check the two against each other:
 *
 * | Index or trigger                          | Enforced by                              |
 * | ----------------------------------------- | ---------------------------------------- |
 * | `workflow_definition_code_idx`            | `insert` on definitions                  |
 * | `workflow_version_number_idx`             | `insert` on versions                     |
 * | `workflow_instance_open_subject_idx`      | `insert` on instances                    |
 * | `workflow_decision_step_idx`              | `insert` on decisions                    |
 * | `workflow_decision_no_mutation`           | no update, no remove on decisions        |
 * | `workflow_history_no_mutation`            | no update, no remove on history          |
 *
 * The two approval-group indexes are next door, in `in-memory-groups.ts`, with the store they
 * belong to.
 *
 * **Three rules left this table in Phase 16B and none of them was forgotten.**
 * `workflow_step_template_ordinal_idx`, `workflow_step_ordinal_idx` and
 * `workflow_step_awaiting_idx` stopped being unique when a branch became *the set of steps sharing
 * an ordinal*: several templates at one ordinal is how a parallel branch is configured, and several
 * awaiting steps is what it looks like while it runs. A fake that kept refusing them would be
 * stricter than PostgreSQL — which is exactly as wrong as one that is more permissive, and worse in
 * this case, because it would refuse the feature while every schema test said it was allowed.
 *
 * The tenant is not modelled: `InMemoryUnitOfWork` runs one tenant at a time, and row-level security
 * is the database's guarantee rather than a rule a Map can imitate. Cross-tenant isolation is
 * asserted against PostgreSQL, where it actually lives.
 */

const sorted = <TState>(
  rows: readonly TState[],
  keyOf: (state: TState) => string,
): readonly TState[] => [...rows].sort(byIdentifier(keyOf));

/**
 * One factory per table rather than one for all seven.
 *
 * Split because a single factory grew past the function-size budget, and the seam the budget forced
 * is the honest one: each of these mirrors exactly one table's indexes, so a reader checking the
 * mapping above against the code reads one function rather than scrolling through six others.
 */
export const inMemoryWorkflowStores = (): WorkflowStores => {
  const instances = new Map<string, WorkflowInstanceState>();
  const steps = new Map<string, WorkflowStepState>();

  return {
    definitions: definitionStore(),
    versions: versionStore(),
    instances: instanceStore(instances),
    steps: stepStore(steps),
    decisions: decisionStore(),
    history: historyStore(),
    groups: approvalGroupStore(),
  };
};

const definitionStore = (): WorkflowStores['definitions'] => {
  const definitions = new Map<string, WorkflowDefinitionState>();

  return {
    byId: (_transaction: Transaction, id: string) => Promise.resolve(definitions.get(id)),
    byCode: (_transaction: Transaction, code: string) =>
      Promise.resolve([...definitions.values()].find((held) => held.code === code)),
    search: (_transaction: Transaction, filters: DefinitionFilters, page: Paged) =>
      Promise.resolve(
        paged(
          sorted(
            [...definitions.values()].filter(
              (held) =>
                (filters.status === undefined || held.status === filters.status) &&
                (filters.subjectType === undefined || held.subjectType === filters.subjectType),
            ),
            (row) => row.definitionId,
          ),
          page,
        ),
      ),
    insert: (_transaction: Transaction, state: WorkflowDefinitionState) => {
      refuseDuplicate(
        'workflow_definition_code_idx',
        [...definitions.values()].some((held) => held.code === state.code),
      );
      definitions.set(state.definitionId, state);
      return Promise.resolve();
    },
    update: (_transaction: Transaction, state: WorkflowDefinitionState, expected: number) => {
      const held = heldOr('workflow_definition', definitions.get(state.definitionId));

      expectVersion('workflow_definition', held, expected);
      definitions.set(state.definitionId, bumped(state));
      return Promise.resolve();
    },
  };
};

/**
 * The version port covers two tables — `workflow_version` and `workflow_step_template` — so it is
 * assembled from two halves. The seam is the tables' own, not one invented to fit a budget.
 */
const versionStore = (): WorkflowStores['versions'] => ({
  ...versionRows(),
  ...templateRows(),
});

const versionRows = (): Omit<WorkflowStores['versions'], 'templatesFor' | 'insertTemplate'> => {
  const versions = new Map<string, WorkflowVersionState>();

  return {
    byId: (_transaction: Transaction, id: string) => Promise.resolve(versions.get(id)),
    forDefinition: (_transaction: Transaction, definitionId: string, page: Paged) =>
      Promise.resolve(
        paged(
          sorted(
            [...versions.values()].filter((held) => held.definitionId === definitionId),
            (row) => row.workflowVersionId,
          ),
          page,
        ),
      ),
    // The highest-numbered published version, which is what `workflow_version_published_idx` is
    // ordered `version_number desc` to answer in one row.
    currentPublished: (_transaction: Transaction, definitionId: string) =>
      Promise.resolve(
        [...versions.values()]
          .filter((held) => held.definitionId === definitionId && held.status === 'published')
          .sort((left, right) => right.versionNumber - left.versionNumber)[0],
      ),
    nextNumberFor: (_transaction: Transaction, definitionId: string) =>
      Promise.resolve(
        [...versions.values()]
          .filter((held) => held.definitionId === definitionId)
          .reduce((highest, held) => Math.max(highest, held.versionNumber), 0) + 1,
      ),
    insert: (_transaction: Transaction, state: WorkflowVersionState) => {
      refuseDuplicate(
        'workflow_version_number_idx',
        [...versions.values()].some(
          (held) =>
            held.definitionId === state.definitionId && held.versionNumber === state.versionNumber,
        ),
      );
      versions.set(state.workflowVersionId, state);
      return Promise.resolve();
    },
    update: (_transaction: Transaction, state: WorkflowVersionState, expected: number) => {
      const held = heldOr('workflow_version', versions.get(state.workflowVersionId));

      expectVersion('workflow_version', held, expected);
      versions.set(state.workflowVersionId, bumped(state));
      return Promise.resolve();
    },
  };
};

const templateRows = (): Pick<WorkflowStores['versions'], 'templatesFor' | 'insertTemplate'> => {
  const templates = new Map<string, WorkflowStepTemplateState>();

  return {
    templatesFor: (_transaction: Transaction, workflowVersionId: string) =>
      Promise.resolve(
        [...templates.values()]
          .filter((held) => held.workflowVersionId === workflowVersionId)
          .sort((left, right) => left.ordinal - right.ordinal),
      ),
    // No ordinal guard: since Phase 16B several templates may share one, and that is a branch.
    insertTemplate: (_transaction: Transaction, state: WorkflowStepTemplateState) => {
      templates.set(state.stepTemplateId, state);
      return Promise.resolve();
    },
  };
};

const instanceStore = (
  instances: Map<string, WorkflowInstanceState>,
): WorkflowStores['instances'] => ({
  byId: (_transaction: Transaction, id: string) => Promise.resolve(instances.get(id)),
  openForSubject: (_transaction: Transaction, subjectType: string, subjectId: string) =>
    Promise.resolve(
      [...instances.values()].find(
        (held) =>
          held.subjectType === subjectType &&
          held.subjectId === subjectId &&
          held.status === 'running',
      ),
    ),
  search: (_transaction: Transaction, filters: InstanceFilters, page: Paged) =>
    Promise.resolve(
      paged(
        sorted(
          [...instances.values()].filter(
            (held) =>
              (filters.status === undefined || held.status === filters.status) &&
              (filters.definitionId === undefined || held.definitionId === filters.definitionId) &&
              (filters.subjectType === undefined || held.subjectType === filters.subjectType) &&
              (filters.subjectId === undefined || held.subjectId === filters.subjectId),
          ),
          (row) => row.instanceId,
        ),
        page,
      ),
    ),
  insert: (_transaction: Transaction, state: WorkflowInstanceState) => {
    // Partial on `running`, exactly as the index is: a second approval after the first was
    // rejected or cancelled is an ordinary act, and a full unique constraint would refuse it.
    refuseDuplicate(
      'workflow_instance_open_subject_idx',
      state.status === 'running' &&
        [...instances.values()].some(
          (held) =>
            held.subjectType === state.subjectType &&
            held.subjectId === state.subjectId &&
            held.status === 'running',
        ),
    );
    instances.set(state.instanceId, state);
    return Promise.resolve();
  },
  update: (_transaction: Transaction, state: WorkflowInstanceState, expected: number) => {
    const held = heldOr('workflow_instance', instances.get(state.instanceId));

    expectVersion('workflow_instance', held, expected);
    instances.set(state.instanceId, bumped(state));
    return Promise.resolve();
  },
});

/**
 * The step store.
 *
 * **It enforces nothing about ordinals or awaiting steps, and that is the 16B change.** Both of
 * those were partial unique indexes in 16A and both were widened in Checkpoint 3: an ordinal is a
 * branch, so several steps share one, and every step of the open branch is `awaiting` at once. What
 * remains a fact about a *set* — one decision per step — is enforced by the decision store, where
 * the index actually is.
 */
const stepStore = (steps: Map<string, WorkflowStepState>): WorkflowStores['steps'] => {
  const stepsOf = (instanceId: string): readonly WorkflowStepState[] =>
    [...steps.values()].filter((step) => step.instanceId === instanceId);

  return {
    byId: (_transaction: Transaction, id: string) => Promise.resolve(steps.get(id)),
    forInstance: (_transaction: Transaction, instanceId: string) =>
      Promise.resolve([...stepsOf(instanceId)].sort((left, right) => left.ordinal - right.ordinal)),
    awaitingFor: (
      _transaction: Transaction,
      approverMembershipId: string,
      page: Paged,
    ): Promise<Page<WorkflowStepState>> =>
      Promise.resolve(
        paged(
          sorted(
            [...steps.values()].filter(
              (step) =>
                step.status === 'awaiting' && step.approverMembershipId === approverMembershipId,
            ),
            (row) => row.stepId,
          ),
          page,
        ),
      ),
    insert: (_transaction: Transaction, state: WorkflowStepState) => {
      steps.set(state.stepId, state);
      return Promise.resolve();
    },
    update: (_transaction: Transaction, state: WorkflowStepState, expected: number) => {
      const held = heldOr('workflow_step', steps.get(state.stepId));

      expectVersion('workflow_step', held, expected);
      steps.set(state.stepId, bumped(state));
      return Promise.resolve();
    },
  };
};

const decisionStore = (): WorkflowStores['decisions'] => {
  const decisions = new Map<string, WorkflowDecisionState>();

  return {
    forInstance: (_transaction: Transaction, instanceId: string) =>
      Promise.resolve(
        sorted(
          [...decisions.values()].filter((held) => held.instanceId === instanceId),
          (row) => row.decisionId,
        ),
      ),
    decidedBy: (_transaction: Transaction, decidedByMembershipId: string, page: Paged) =>
      Promise.resolve(
        paged(
          sorted(
            [...decisions.values()].filter(
              (held) => held.decidedByMembershipId === decidedByMembershipId,
            ),
            (row) => row.decisionId,
          ),
          page,
        ),
      ),
    insert: (_transaction: Transaction, state: WorkflowDecisionState) => {
      refuseDuplicate(
        'workflow_decision_step_idx',
        [...decisions.values()].some((held) => held.stepId === state.stepId),
      );
      decisions.set(state.decisionId, state);
      return Promise.resolve();
    },
    // No update and no remove: the trigger refuses both, and so does this.
  };
};

const historyStore = (): WorkflowStores['history'] => {
  const history = new Map<string, WorkflowHistoryState>();

  return {
    forInstance: (_transaction: Transaction, instanceId: string, page: Paged) =>
      Promise.resolve(
        paged(
          [...history.values()]
            .filter((held) => held.instanceId === instanceId)
            .sort(
              (left, right) =>
                left.occurredAt.getTime() - right.occurredAt.getTime() ||
                left.historyId.localeCompare(right.historyId),
            ),
          page,
        ),
      ),
    insert: (_transaction: Transaction, state: WorkflowHistoryState) => {
      history.set(state.historyId, state);
      return Promise.resolve();
    },
    // No update and no remove, for the same reason.
  };
};
