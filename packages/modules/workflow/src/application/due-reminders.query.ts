import {
  cursorResult,
  success,
  type CursorResult,
  type Query,
  type QueryHandler,
} from '@work/kernel';

import type { DueReminderView } from '../contracts/execution-views.js';

import { WorkflowPermissions } from './workflow-permissions.js';
import type { WorkflowDependencies } from './workflow-dependencies.js';

/**
 * Which steps are due an automatic service-level reminder — the read a job runner makes, and the only
 * read in this module that names nobody at all.
 *
 * **It exists because the reminder was executable and not discoverable** (D-16E-14).
 * `workflow.remind-step` takes an instance and a step; nothing published could answer which ones.
 * `workflow.pending-approvals` resolves from the *caller's membership* and a machine holds none by
 * design; `workflow.search-instances` declares an administrator's permission, returns instances
 * rather than steps, and cannot see a service level. So a runner could invoke the command and had
 * nothing to invoke it with.
 *
 * **It discovers work, never people** — which is what keeps D-16D-16 closed. Two identifiers come
 * back per row. Not the approver, not the requester, not a manager, not a workforce user, and no way
 * to ask for one: the recipient is resolved later, separately, by `identity.membership-recipient`,
 * from the step the *command* re-reads. A query that returned the approver would be a directory with
 * a schedule attached to it.
 *
 * **It is a narrowing, not an authority.** Two runners may discover the same step, and that is
 * correct rather than tolerated: the guarantee lives in `workflow_history_reminder_idx`, where the
 * database can arbitrate it, and a `select` followed by an `insert` is not idempotent under
 * concurrency (ADR-0071). Discovery reduces wasted work; it decides nothing. Every rule this query
 * applies is re-applied by the command, from rows read inside the command's own transaction — so a
 * candidate that went stale between the two is refused by name rather than acted on.
 *
 * **The tenant comes from the execution context and is not a field here.** There is no `tenantId`
 * parameter and none in the reply. A machine runs under a `MachineContext` whose tenant the platform
 * set; row-level security filters again beneath it. A caller cannot name a tenant, so a caller cannot
 * choose one.
 *
 * **Bounded, always.** `size` is clamped rather than trusted, and the continuation is a cursor over
 * the step's own identifier rather than an offset — an offset over a set that is being written to
 * repeats rows and skips others as it shifts, which is precisely what a discovery loop must not do.
 */
export interface DueReminders extends Query {
  readonly queryName: 'workflow.due-reminders';
  /** The instant to ask about. Supplied, never read from a clock — as everywhere else in this module. */
  readonly asAt: Date;
  /** Clamped to 1…`MAXIMUM_DISCOVERY_PAGE`. Absent means `DEFAULT_DISCOVERY_PAGE`. */
  readonly size?: number;
  /** The last step identifier of the previous page. Absent starts from the beginning. */
  readonly cursor?: string;
}

/**
 * How much work one call may hand out.
 *
 * The maximum is the kernel's own `MAXIMUM_PAGE_SIZE`, reused rather than re-decided so a reader
 * meets one page-size policy in this repository instead of two. The default is smaller than the
 * maximum on purpose: a runner that asks for nothing in particular should take a modest bite and come
 * back, because the cursor makes coming back cheap and a large first page makes a slow first call.
 */
export const MAXIMUM_DISCOVERY_PAGE = 200;
export const DEFAULT_DISCOVERY_PAGE = 100;

const boundedSize = (size: number | undefined): number => {
  if (size === undefined || !Number.isInteger(size) || size < 1) return DEFAULT_DISCOVERY_PAGE;
  return Math.min(size, MAXIMUM_DISCOVERY_PAGE);
};

export const dueRemindersHandler = (
  dependencies: WorkflowDependencies,
): QueryHandler<DueReminders, CursorResult<DueReminderView>> => ({
  queryName: 'workflow.due-reminders',
  // The permission the machine already holds to *run* a reminder, reused rather than joined by a
  // second one. Discovering the work and doing it are one capability held by one principal: a
  // separate `reminder.discover` would be a grant somebody could hold alone, and a runner that could
  // enumerate a tenant's overdue approvals without being able to act on them is a reporting
  // capability nobody approved. No human permission opens this, which the authorization suite asserts
  // one permission at a time.
  permission: WorkflowPermissions.reminderExecute,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const size = boundedSize(query.size);
      // One more than the page, so `cursorResult` can say whether another page exists without a
      // second query and without a count over a set that is changing underneath it.
      const found = await dependencies.stores.steps.dueForReminder(
        transaction,
        query.asAt,
        size + 1,
        query.cursor,
      );

      return success(
        cursorResult<DueReminderView>(
          found.map((due) => ({ instanceId: due.instanceId, stepId: due.stepId })),
          size,
          (item) => item.stepId,
        ),
      );
    }),
});
