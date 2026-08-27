import { loadPortalProcessEnvironment } from '@work/config';
import type {
  ApprovalStatusView,
  PendingApprovalView,
  WorkflowDecisionView,
  WorkflowHistoryView,
  WorkflowInstanceDetailView,
} from '@work/workflow/contracts';

/**
 * The approver's own work, read from Workflow and from nothing else.
 *
 * **Whose work it is was decided by the request, and this file could not name somebody else if it
 * tried.** Neither queue read carries a membership, a workforce user, a platform user, an approver
 * or a `me`: the API resolves the caller from the authenticated request, and a request that
 * resolved nobody is answered with nothing rather than with everybody's. There is no parameter here
 * to supply one, no picker on the screen, and no "viewing as".
 *
 * **A refusal and an empty queue are different answers, and this file keeps them apart.** The
 * pipeline checks the permission *before* the handler runs, so a caller who does not hold
 * `workflow.approval.read-own` is refused; a caller who holds it but resolved no membership receives
 * an empty page. Collapsing the two would tell an administrator their approvals are clear when in
 * fact nobody is signed in — which is the state of every deployment without Platform's
 * authentication adapter. `undefined` is a refusal; a `Page` with no items is an empty queue.
 *
 * **The total is the server's, always.** A screen that reported `items.length` would tell somebody
 * with three hundred approvals that they have fifty, which is the module's own warning about its
 * own read.
 *
 * **Nothing here computes.** No age, no due date, no elapsed time, no tally, no clock. Every one of
 * those is published by the application against a reading instant this screen never sees.
 */

const BASE = loadPortalProcessEnvironment().WORK_API_URL;

/** What one screen shows at once. The server clamps its own bound; this is the request. */
const PAGE = 'page=1&size=25';

interface Page<TItem> {
  readonly items: readonly TItem[];
  readonly total: number;
}

/**
 * One fetch, failing closed.
 *
 * `cache: 'no-store'` because a queue is a list of decisions somebody is personally being asked to
 * make, and a cached copy of it is one person's work sitting somewhere nobody chose.
 */
const read = async <TValue>(path: string): Promise<TValue | undefined> => {
  try {
    const response = await fetch(`${BASE}/api/v1/workflow${path}`, { cache: 'no-store' });

    if (!response.ok) return undefined;
    return (await response.json()) as TValue;
  } catch {
    return undefined;
  }
};

/**
 * A page, or the fact that there was not one.
 *
 * The rows and the server's total travel together or not at all: a screen that fell back to an empty
 * list while keeping a stale total would print "0 of 4000", and one that fell back to
 * `items.length` would report a page as an organization.
 */
export interface Queue<TItem> {
  readonly items: readonly TItem[];
  readonly total: number;
}

export interface ApprovalsForDisplay {
  /** Absent means refused. Present with no items means the queue is genuinely clear. */
  readonly pending: Queue<PendingApprovalView> | undefined;
  readonly decided: Queue<WorkflowDecisionView> | undefined;
}

const queueOf = <TItem>(page: Page<TItem> | undefined): Queue<TItem> | undefined =>
  page === undefined ? undefined : { items: page.items, total: page.total };

/**
 * Both halves of one person's approval work, asked together.
 *
 * Two requests rather than one, because they are two permissions' worth of answer in principle and
 * two independent refusals in practice: a caller may be shown what they decided while what is
 * waiting is refused, and the screen says which.
 */
export const loadApprovals = async (): Promise<ApprovalsForDisplay> => {
  const [pending, decided] = await Promise.all([
    read<Page<PendingApprovalView>>(`/approvals/pending?${PAGE}`),
    read<Page<WorkflowDecisionView>>(`/approvals/decided?${PAGE}`),
  ]);

  return { pending: queueOf(pending), decided: queueOf(decided) };
};

export interface ApprovalForDisplay {
  readonly detail: WorkflowInstanceDetailView;
  /** The timeline. Absent means refused; empty means nothing has happened yet. */
  readonly history: Queue<WorkflowHistoryView> | undefined;
  /** The same approval in `ApprovalPort`'s five-state vocabulary — what a consuming module sees. */
  readonly status: ApprovalStatusView | undefined;
}

/**
 * One approval, asked for first and on its own.
 *
 * An identifier the API will not resolve is a 404 rather than a page of refusals, and asking for a
 * timeline and a port status about an instance that did not resolve is two requests spent to render
 * nothing.
 */
export const loadInstance = async (
  instanceId: string,
): Promise<WorkflowInstanceDetailView | undefined> =>
  read<WorkflowInstanceDetailView>(`/instances/${instanceId}`);

/** Everything else about it, in one round. */
export const loadApproval = async (
  detail: WorkflowInstanceDetailView,
): Promise<ApprovalForDisplay> => {
  const id = detail.instance.instanceId;
  const [history, status] = await Promise.all([
    read<Page<WorkflowHistoryView>>(`/instances/${id}/history?${PAGE}`),
    read<ApprovalStatusView>(`/approvals/${id}/status`),
  ]);

  return { detail, history: queueOf(history), status };
};
