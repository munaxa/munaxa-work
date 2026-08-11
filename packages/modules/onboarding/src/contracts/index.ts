/**
 * The public contract of Onboarding.
 *
 * This is the entire surface other modules, the API and the SDK may depend on. Its repositories, its
 * tables and its aggregates are private and stay private.
 *
 * Three entries carry more weight than the rest.
 *
 * `OnboardingView` publishes **no employment fact**. There is no employment status, no unit, no
 * position, no manager and no employee number, and their absence is not an oversight to be filled in
 * later: a consumer asking whether somebody is employed is asking Employment, as at a date
 * (ADR-0047). What this view carries is the *process* — which plan version, where it has got to, and
 * how it ended.
 *
 * `TaskView.documentReference` is **a reference and nothing else**. This module stores no bytes and
 * has no document adapter wired in this repository; a consumer must not read it as evidence that a
 * file exists.
 *
 * `TaskView.approvalReference` is reserved for Workflow (Phase 16) and is null today. An
 * `approval`-kind task records a decision made by a named human here; a consumer that treats a null
 * reference as "not approved" will be wrong (ADR-0049).
 *
 * Contracts are versioned. A breaking change to anything exported here requires an ADR.
 */

export type {
  DueAnchor,
  OnboardingState,
  OwnerKind,
  PlanStatus,
  PlanVersionStatus,
  TaskEventKind,
  TaskKind,
  TaskStatus,
} from '../domain/onboarding-vocabulary.js';

/**
 * The state sets themselves, not just their types.
 *
 * A consumer narrowing an untyped string — a request parameter, a row — needs the set, and the
 * alternative is every consumer writing its own copy of the list.
 */
export {
  DUE_ANCHORS,
  ONBOARDING_STATES,
  ONBOARDING_TRANSITIONS,
  OWNER_KINDS,
  PLAN_STATUSES,
  PLAN_VERSION_STATUSES,
  TASK_EVENT_KINDS,
  TASK_KINDS,
  TASK_STATUSES,
  TASK_TRANSITIONS,
  isOnboardingLive,
  isOnboardingTerminal,
  isTaskSatisfied,
  isTaskTerminal,
} from '../domain/onboarding-vocabulary.js';

export type {
  OnboardingExport,
  OnboardingProgressView,
  OnboardingSnapshot,
  OnboardingView,
  PlanSnapshot,
  PlanVersionView,
  PlanView,
  TaskEventView,
  TaskTemplateView,
  TaskView,
} from './views.js';
