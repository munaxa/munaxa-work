import type { Metadata } from './onboarding-aggregate.js';
import type { OnboardingState } from './onboarding-vocabulary.js';

/**
 * The onboarding instance's state, apart from the aggregate that guards it.
 *
 * Separate for the reason Employment and Recruitment separated theirs: the completion rule is a pure
 * function over this shape and the instance's tasks, and a file that both declared the state and
 * imported the functions that read it would be a cycle.
 *
 * **What is not here is the design.** No employment status, no unit, no position, no manager, no
 * employee number, no person name. Those are Employment's, Organization's and People's, read as at a
 * date through their published services and never copied (ADR-0047). What this holds is the process:
 * which plan version it came from, when it is planned to start, where it has got to, and how it
 * ended.
 */
export interface OnboardingInstanceState {
  readonly id: string;
  readonly tenantId: string;
  /** Employment's, by identifier and by foreign key. Created by Recruitment's hire, never here. */
  readonly employmentId: string;
  readonly personId: string;
  /** Recruitment's, when the hire came from an application. Absent for a direct hire or migration. */
  readonly applicationId?: string;
  readonly planId?: string;
  readonly planVersionId?: string;
  readonly state: OnboardingState;
  /** Onboarding's own planning date, and the anchor for `plan_start` due dates. */
  readonly plannedStartOn: string;
  /** Employment's start date as it stood when the onboarding was created. Read, never written. */
  readonly employmentStartOn?: string;
  readonly completedOn?: string;
  readonly completedAt?: Date;
  readonly completedBy?: string;
  readonly cancelledAt?: Date;
  readonly cancelledBy?: string;
  readonly cancellationReasonCode?: string;
  readonly metadata: Metadata;
  readonly version: number;
}
