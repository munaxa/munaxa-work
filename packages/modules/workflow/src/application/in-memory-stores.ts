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
 * | `workflow_step_template_ordinal_idx`      | `insertTemplate`                         |
 * | `workflow_instance_open_subject_idx`      | `insert` on instances                    |
 * | `workflow_step_ordinal_idx`               | `insert` on steps                        |
 * | `workflow_step_awaiting_idx`              | `insert` and `update` on steps           |
 * | `workflow_decision_step_idx`              | `insert` on decisions                    |
 * | `workflow_decision_no_mutation`           | no update, no remove on decisions        |
 * | `workflow_history_no_mutation`            | no update, no remove on history          |
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
    insertTemplate: (_transaction: Transaction, state: WorkflowStepTemplateState) => {
      refuseDuplicate(
        'workflow_step_template_ordinal_idx',
        [...templates.values()].some(
          (held) =>
            held.workflowVersionId === state.workflowVersionId && held.ordinal === state.ordinal,
        ),
      );
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
 * The step store, which is the one that needs its instance's siblings.
 *
 * `workflow_step_awaiting_idx` is a fact about a *set* — at most one awaiting step per instance —
 * so both `insert` and `update` have to look at the other steps of the same approval. That is why
 * this factory takes the map rather than owning it privately.
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
      refuseDuplicate(
        'workflow_step_ordinal_idx',
        stepsOf(state.instanceId).some((held) => held.ordinal === state.ordinal),
      );
      refuseDuplicate(
        'workflow_step_awaiting_idx',
        state.status === 'awaiting' &&
          stepsOf(state.instanceId).some((held) => held.status === 'awaiting'),
      );
      steps.set(state.stepId, state);
      return Promise.resolve();
    },
    update: (_transaction: Transaction, state: WorkflowStepState, expected: number) => {
      const held = heldOr('workflow_step', steps.get(state.stepId));

      expectVersion('workflow_step', held, expected);
      // The same non-deferrable rule the index enforces: a step may only enter `awaiting` when no
      // other step of its instance is already there. This is what makes the write order in
      // `decision.use-case.ts` a requirement rather than a preference.
      refuseDuplicate(
        'workflow_step_awaiting_idx',
        state.status === 'awaiting' &&
          stepsOf(state.instanceId).some(
            (other) => other.stepId !== state.stepId && other.status === 'awaiting',
          ),
      );
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
