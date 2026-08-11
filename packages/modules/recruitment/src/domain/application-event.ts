import { uuidV7 } from '@work/kernel';

import type { ApplicationStatus } from './recruitment-vocabulary.js';

/**
 * One movement through the pipeline: what it moved from, what to, when, why and who recorded it.
 *
 * The events are how a subscriber hears; this is how the database answers an auditor who arrived
 * afterwards. A plain shape rather than an aggregate, because nothing about a recorded movement can
 * subsequently change.
 */
export interface ApplicationEventState {
  readonly id: string;
  readonly tenantId: string;
  readonly applicationId: string;
  readonly fromStatus?: ApplicationStatus;
  readonly toStatus: ApplicationStatus;
  readonly stageCode?: string;
  readonly reasonCode?: string;
  readonly note?: string;
  readonly occurredAt: Date;
  /** Taken from the authenticated context. A caller cannot supply it. */
  readonly recordedBy: string;
  readonly version: number;
}

export const applicationEvent = (
  request: Omit<ApplicationEventState, 'id' | 'version'>,
  recordedAt: Date,
): ApplicationEventState => ({
  id: uuidV7(recordedAt.getTime()),
  ...request,
  version: 0,
});
