import type { WorkflowInstanceState, WorkflowStepState } from '../domain/instance.js';
import type { WorkflowHistoryState } from '../domain/history.js';
import { serviceLevelState } from '../domain/service-level.js';

import type { DueReminder } from './workflow-ports.js';

/**
 * The same question the SQL asks, asked the same way.
 *
 * Deliberately a faithful mirror rather than a convenience: `serviceLevelState` is the *domain's*
 * definition of due, so the fake calls it instead of restating the arithmetic — which is what stops
 * the fake and the database from drifting apart while both look right on their own.
 *
 * **It reads the history map for the anti-join**, which is why that map is hoisted out of the two
 * stores that own it: a fake where the reminder history and the discovery read could disagree would
 * prove nothing about the pair they are testing.
 */
export const dueForReminder = (
  tables: {
    readonly steps: Map<string, WorkflowStepState>;
    readonly instances: Map<string, WorkflowInstanceState>;
    readonly history: Map<string, WorkflowHistoryState>;
  },
  asAt: Date,
  limit: number,
  cursor?: string,
): readonly DueReminder[] => {
  const { steps, instances, history } = tables;
  const reminded = new Set(
    [...history.values()]
      .filter((entry) => entry.event === 'step-reminded' && entry.stepId !== undefined)
      .map((entry) => entry.stepId),
  );

  return [...steps.values()]
    .filter(
      (step) =>
        step.status === 'awaiting' &&
        instances.get(step.instanceId)?.status === 'running' &&
        serviceLevelState(step.serviceLevel, step.awaitingAt, asAt) === 'overdue' &&
        !reminded.has(step.stepId) &&
        (cursor === undefined || step.stepId > cursor),
    )
    .sort((left, right) => left.stepId.localeCompare(right.stepId))
    .slice(0, limit)
    .map((step) => ({ instanceId: step.instanceId, stepId: step.stepId }));
};
