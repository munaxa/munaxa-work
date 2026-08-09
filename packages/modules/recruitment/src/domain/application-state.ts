import type { ApplicationStatus, HireState, ScreeningOutcome } from './recruitment-vocabulary.js';
import type { Metadata } from './recruitment-aggregate.js';

/**
 * The application's state, apart from the aggregate that guards it.
 *
 * Separate because the hire saga's steps are pure functions over this shape, and a file that both
 * declared the state and imported the functions that transform it would be a cycle — the same split
 * Employment made for the same reason.
 */

export interface ApplicationState {
  readonly id: string;
  readonly tenantId: string;
  readonly applicationNumber: string;
  readonly candidateId: string;
  readonly vacancyId: string;
  readonly status: ApplicationStatus;
  /** A tenant-defined stage inside `interviewing`. The status set is closed; this is open (AD-005). */
  readonly stageCode?: string;
  readonly sourceCode: string;
  readonly appliedOn: string;
  readonly screeningOutcome?: ScreeningOutcome;
  readonly screeningNote?: string;
  readonly rejectionReasonCode?: string;
  readonly hireState?: HireState;
  readonly hireFailureReason?: string;
  /** Written once by the hire, through Employment's application service. */
  readonly employmentId?: string;
  readonly metadata: Metadata;
  readonly version: number;
}

export interface SubmitApplication {
  readonly tenantId: string;
  readonly applicationNumber: string;
  readonly candidateId: string;
  readonly vacancyId: string;
  readonly sourceCode: string;
  readonly appliedOn: string;
  readonly metadata?: Metadata;
}
