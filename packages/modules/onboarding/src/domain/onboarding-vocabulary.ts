/**
 * The ubiquitous language of Onboarding, in one file so the API, the contracts and the aggregates
 * cannot drift into three spellings of the same idea.
 *
 * Several words are deliberately absent, and their absence is a boundary being kept rather than
 * described. *Employee number*, *employment status*, *assignment*, *position*, *unit* and *manager*
 * appear nowhere as owned state: each is Employment's or Organization's, referenced by identifier
 * and read as at a date. Neither does *candidate*, *offer* or *person name* — Recruitment and People
 * own those, and Onboarding begins after the hire they conclude (ADR-0047).
 *
 * The pattern is the one every module before this uses. A **state** is product behaviour and is
 * checked in the database. A **code** — a reason, a document type, a role queue — is tenant or
 * country-pack data, validated by shape and never against a list this product ships (00B).
 */

/**
 * The onboarding instance's lifecycle.
 *
 * `preboarding` and `in_progress` are distinct because the work before somebody's first day and the
 * work after it are answerable questions with different audiences: a preboarding task is chased by
 * HR before there is anybody to chase, and an in-progress one is chased with the joiner. Neither
 * state says anything about the *employment* — a person is not an employee because preboarding
 * began, and Employment's status is Employment's alone.
 */
export const ONBOARDING_STATES = [
  'draft',
  'preboarding',
  'in_progress',
  'completed',
  'cancelled',
] as const;
export type OnboardingState = (typeof ONBOARDING_STATES)[number];

/**
 * Forward, and out at any point. Nothing returns from a terminal state.
 *
 * Reopening a completed or cancelled onboarding is refused rather than modelled: what a rehire
 * needs is a *new* employment and a new onboarding, and what a mistaken completion needs is a
 * correction somebody can see. An edit that quietly reverted a completion would erase the record
 * that it ever happened.
 */
export const ONBOARDING_TRANSITIONS: Readonly<Record<OnboardingState, readonly OnboardingState[]>> =
  {
    draft: ['preboarding', 'in_progress', 'cancelled'],
    preboarding: ['in_progress', 'completed', 'cancelled'],
    in_progress: ['completed', 'cancelled'],
    completed: [],
    cancelled: [],
  };

/** An onboarding that is still running. The predicate the partial unique index is built on. */
export const isOnboardingLive = (state: OnboardingState): boolean =>
  state === 'draft' || state === 'preboarding' || state === 'in_progress';

export const isOnboardingTerminal = (state: OnboardingState): boolean => !isOnboardingLive(state);

/**
 * What a task *is*, which decides how it completes.
 *
 * Closed at five, and a sixth is a schema change rather than a configuration change — deliberately,
 * because "add a kind" is how a checklist becomes a workflow engine one release at a time. What a
 * tenant configures is which tasks exist, who owns them and when they are due; not what kinds of
 * thing the product understands.
 *
 * `approval` records a decision made by a named human **here**, today. Phase 16 routes it through
 * `ApprovalPort` without changing this set or the table (ADR-0049).
 */
export const TASK_KINDS = [
  'checklist',
  'acknowledgement',
  'document',
  'approval',
  'external',
] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

/**
 * Who a task belongs to.
 *
 * `employee` and `manager` are resolved from the onboarding itself — the joiner's employment, and
 * the manager on their reporting line at the moment tasks are generated. `employment` names
 * somebody specific. `role` and `unit` are **queues**: anybody holding the matching permission may
 * complete them, which is what makes "the IT onboarding queue" work without this module inventing a
 * team or a group entity.
 */
export const OWNER_KINDS = ['employee', 'manager', 'employment', 'role', 'unit'] as const;
export type OwnerKind = (typeof OWNER_KINDS)[number];

/**
 * A task's status.
 *
 * `overdue` is **not here**, and its absence is the design: overdue is `dueOn < today` on a task
 * that has not concluded, computed by the query that asks. A stored flag would need something to
 * sweep it, and between sweeps it would be wrong — which is worse than not having it, because a
 * screen would show it with confidence.
 */
export const TASK_STATUSES = [
  'pending',
  'blocked',
  'in_progress',
  'done',
  'waived',
  'cancelled',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  pending: ['in_progress', 'done', 'waived', 'blocked', 'cancelled'],
  blocked: ['pending', 'in_progress', 'done', 'waived', 'cancelled'],
  in_progress: ['done', 'waived', 'pending', 'cancelled'],
  done: [],
  waived: [],
  cancelled: [],
};

/** A task nothing further happens to. What completion counts, and what cancellation skips. */
export const isTaskTerminal = (status: TaskStatus): boolean =>
  status === 'done' || status === 'waived' || status === 'cancelled';

/** A task that satisfies a *requirement*. A cancelled required task does not. */
export const isTaskSatisfied = (status: TaskStatus): boolean =>
  status === 'done' || status === 'waived';

/** What a plan's version is: editable, in force, or replaced. */
export const PLAN_STATUSES = ['draft', 'active', 'retired'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const PLAN_VERSION_STATUSES = ['draft', 'published', 'superseded'] as const;
export type PlanVersionStatus = (typeof PLAN_VERSION_STATUSES)[number];

/**
 * What a task's due date is measured from.
 *
 * `employment_start` with a negative offset is how a template says "three days before they start"
 * without knowing when that is. `plan_start` measures from the day the onboarding was created,
 * which is what a task like "send the welcome pack" actually depends on.
 */
export const DUE_ANCHORS = ['plan_start', 'employment_start'] as const;
export type DueAnchor = (typeof DUE_ANCHORS)[number];

/** What a task-history row records. Appended, never amended. */
export const TASK_EVENT_KINDS = [
  'created',
  'assigned',
  'rescheduled',
  'status-changed',
  'completed',
  'waived',
] as const;
export type TaskEventKind = (typeof TASK_EVENT_KINDS)[number];

/**
 * A stable, human-authored code, unique within its tenant and its kind.
 *
 * ASCII by design, for the same reason every other module's codes are: a code travels into an export
 * a customer opens in a spreadsheet and into an integration's payload.
 */
export const isEntityCode = (value: string): boolean =>
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);

/** A civil date as `YYYY-MM-DD`. A due date is the same date in every time zone. */
export const isCivilDate = (value: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

/** A reference into the document store. Onboarding stores no bytes and owns no documents. */
export const isDocumentReference = (value: string): boolean =>
  /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,127}$/.test(value);

/**
 * Adds whole days to a civil date, in UTC, and returns a civil date.
 *
 * UTC on purpose: a due date is a calendar day, and adding days in the server's local zone would
 * move it by one for half the world. **Calendar days, not working days** — which week-end a tenant
 * keeps is country data a country pack owns (00B), and Organization publishes no calendar read for
 * this module to ask. Recorded as a limitation rather than approximated here.
 */
export const addDays = (civilDate: string, days: number): string => {
  const at = new Date(`${civilDate}T00:00:00Z`);

  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
};

/** Today, as a civil date in UTC. The comparison an overdue query makes. */
export const civilDateOf = (instant: Date): string => instant.toISOString().slice(0, 10);
