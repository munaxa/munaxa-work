import { uuidV7 } from '@work/kernel';

import type { TaskEventKind, TaskStatus } from './onboarding-vocabulary.js';

/**
 * One movement of one task: assigned, rescheduled, completed, waived.
 *
 * The domain events are how a subscriber hears; this is how the database answers somebody who
 * arrived afterwards and asks who moved a deadline. A plain shape rather than an aggregate, because
 * nothing about a recorded movement can subsequently change — and it is append-only in code as well
 * as in intent: no repository here offers an update.
 *
 * `detail` carries what changed, never why somebody is on a checklist: a reassignment records the
 * two owners, a reschedule the two dates. It never carries a name.
 */
export interface TaskEventState {
  readonly id: string;
  readonly tenantId: string;
  readonly taskId: string;
  readonly onboardingId: string;
  readonly kind: TaskEventKind;
  readonly fromStatus?: TaskStatus;
  readonly toStatus?: TaskStatus;
  readonly detail?: string;
  readonly occurredAt: Date;
  /** Taken from the authenticated context. A caller cannot supply it. */
  readonly recordedBy: string;
  readonly version: number;
}

export const taskEvent = (
  request: Omit<TaskEventState, 'id' | 'version'>,
  recordedAt: Date,
): TaskEventState => ({
  id: uuidV7(recordedAt.getTime()),
  ...request,
  version: 0,
});
