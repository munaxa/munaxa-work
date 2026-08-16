import { loadPortalProcessEnvironment } from '@work/config';
import type {
  ApprovalGroupDetailView,
  ApprovalGroupView,
  ApprovalStatusView,
  PendingApprovalView,
  WorkflowDecisionView,
  WorkflowDefinitionDetailView,
  WorkflowDefinitionView,
  WorkflowHistoryView,
  WorkflowInstanceDetailView,
  WorkflowInstanceView,
} from '@work/workflow/contracts';

/**
 * Reading the approvals workspace from the API.
 *
 * The types come from the module's published *contracts*, never from its internals. **Nothing here
 * touches a repository, a store, a domain entity, Prisma or the Recruitment seam.** Every value on
 * the screen came down an HTTP response: Admin → API → dispatcher → application → repository →
 * PostgreSQL, in that order and no other.
 *
 * **The queue is read without naming anybody, and that is the security property of this file.**
 * `/approvals/pending` and `/approvals/decided` carry `page` and `size` and nothing else — no
 * `membershipId`, no `workforceUserId`, no `platformUserId`, no `approverMembershipId`, no `me=true`.
 * The API resolves the caller from the authenticated request, and a screen that supplied an
 * identifier would turn "the approvals waiting for me" into "the approvals waiting for anybody I can
 * name", which is an IDOR wearing a permission's name. There is no parameter here to get wrong
 * because there is no parameter here at all.
 *
 * **What this cannot do yet, and why.** Every business endpoint returns 401 until Platform's
 * authentication adapter is supplied; this repository authenticates nobody, by design (ADR-0032).
 * These calls are written against the real contract and fail closed — but *closed* is not *empty*:
 * `unavailable` says the service did not answer, and the screen distinguishes that from a tenant
 * with nothing in it. A refusal is never rendered as zero approvals.
 *
 * **Every read is bounded and the number of them is fixed.** No collection call omits `page` and
 * `size`, and the four detail reads are made **once, for the first row of their listing** — never
 * one per definition, per version, per instance, per approval or per history entry.
 *
 * The count is **ten at most and it does not grow with the size of a tenant**: five collection
 * reads, then five details about the first definition, the first approval and the first approval
 * group. A tenant with four thousand running approvals costs exactly the same ten requests as a
 * tenant with one. An empty tenant costs five, because there is no first row to read a detail for,
 * and a service that will not answer at all costs one.
 *
 * **A group's members are read for one group, never for each.** The group listing carries the code,
 * the name and the row version and no member count — so the screen shows the members of the first
 * row from its detail and says so, rather than issuing one request per group to fill a column. That
 * is the same rule the definition and the approval details have followed since Phase 16A.
 */

/** One page, the size every listing on this screen uses. Nothing asks for more. */
const PAGE = 'page=1&size=50';

const BASE = loadPortalProcessEnvironment().WORK_API_URL;

interface Page<TItem> {
  readonly items: readonly TItem[];
  readonly total: number;
}

export interface WorkflowForDisplay {
  readonly definitions: readonly WorkflowDefinitionView[];
  readonly definitionsTotal: number;
  /** One definition with its versions and its published chain. The first of the listing. */
  readonly definition: WorkflowDefinitionDetailView | undefined;
  readonly instances: readonly WorkflowInstanceView[];
  readonly instancesTotal: number;
  /** One approval with its steps and decisions. The first of the listing. */
  readonly instance: WorkflowInstanceDetailView | undefined;
  /** That same approval's timeline, oldest first, exactly as the API ordered it. */
  readonly history: readonly WorkflowHistoryView[];
  readonly historyTotal: number;
  /** That same approval in `ApprovalPort`'s vocabulary. */
  readonly approval: ApprovalStatusView | undefined;
  /** The lists this tenant keeps of who approves what. */
  readonly groups: readonly ApprovalGroupView[];
  readonly groupsTotal: number;
  /** One list with the memberships on it. The first of the listing. */
  readonly group: ApprovalGroupDetailView | undefined;
  /** The caller's own queue. Resolved from the request; never asked for by identifier. */
  readonly pending: readonly PendingApprovalView[];
  readonly pendingTotal: number;
  readonly decided: readonly WorkflowDecisionView[];
  readonly decidedTotal: number;
  /** True when the API could not be reached or refused the caller — the ordinary state today. */
  readonly unavailable: boolean;
}

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
 * A page's rows and the server's own total, with the absent case answered once.
 *
 * Written as one helper rather than an `?.items ?? []` and a `?.total ?? 0` at each call site,
 * because the pair must always travel together: a screen that fell back to an empty list while
 * keeping a stale total would print "0 of 4000", and one that fell back to a total of `items.length`
 * would report a page as an organization.
 */
const pageParts = <TItem>(
  page: Page<TItem> | undefined,
): { readonly items: readonly TItem[]; readonly total: number } => ({
  items: page?.items ?? [],
  total: page?.total ?? 0,
});

export const EMPTY: WorkflowForDisplay = {
  definitions: [],
  definitionsTotal: 0,
  definition: undefined,
  instances: [],
  instancesTotal: 0,
  instance: undefined,
  history: [],
  historyTotal: 0,
  approval: undefined,
  groups: [],
  groupsTotal: 0,
  group: undefined,
  pending: [],
  pendingTotal: 0,
  decided: [],
  decidedTotal: 0,
  unavailable: true,
};

/**
 * The reads the screen makes. **Ten at most, and never more with more data.**
 *
 * The definition listing is read first and its failure is the signal: if the service will not answer
 * the cheapest question, the rest is a page of empty tables and a wall of failed requests.
 */
export const loadWorkflow = async (): Promise<WorkflowForDisplay> => {
  const definitions = await read<Page<WorkflowDefinitionView>>(`/definitions?${PAGE}`);

  if (definitions === undefined) return EMPTY;

  const instances = await read<Page<WorkflowInstanceView>>(`/instances?${PAGE}`);
  const found = pageParts(instances);

  return {
    ...EMPTY,
    unavailable: false,
    definitions: definitions.items,
    definitionsTotal: definitions.total,
    instances: found.items,
    instancesTotal: found.total,
    ...(await forFirstDefinition(definitions.items[0])),
    ...(await forFirstInstance(found.items[0])),
    ...(await approvalGroups()),
    ...(await queues()),
  };
};

/**
 * The tenant's lists, and the members of the first of them.
 *
 * **Two requests for fifty groups.** The listing carries no member count, and the honest answer to
 * that is to read one group's members and say which group they belong to — not to issue a detail
 * request per row so a column can be filled. Fifty groups would be fifty requests to render one
 * number each, and the number would grow with every list a tenant adds.
 */
const approvalGroups = async (): Promise<Partial<WorkflowForDisplay>> => {
  const listing = pageParts(await read<Page<ApprovalGroupView>>(`/approval-groups?${PAGE}`));
  const first = listing.items[0];

  return {
    groups: listing.items,
    groupsTotal: listing.total,
    ...(first === undefined
      ? {}
      : {
          group: await read<ApprovalGroupDetailView>(`/approval-groups/${first.approvalGroupId}`),
        }),
  };
};

/**
 * One workflow in full: its versions, and the chain of whichever version is published.
 *
 * **The first of the listing, never each of it.** A workspace that read the versions of every
 * workflow in the page would issue fifty requests to render one table, and the number would grow
 * with the tenant's configuration — the amplification this screen is written to avoid.
 */
const forFirstDefinition = async (
  definition: WorkflowDefinitionView | undefined,
): Promise<Partial<WorkflowForDisplay>> =>
  definition === undefined
    ? {}
    : {
        definition: await read<WorkflowDefinitionDetailView>(
          `/definitions/${definition.definitionId}`,
        ),
      };

/**
 * One approval in full: its chain, its decisions, its timeline and its state in the port's words.
 *
 * Three reads about **one** approval — the first row of the listing — rather than one per row. The
 * timeline is paged like every other collection here: a chain that was reassigned many times has a
 * long one, and it is exactly the read somebody would otherwise ask for unbounded.
 */
const forFirstInstance = async (
  instance: WorkflowInstanceView | undefined,
): Promise<Partial<WorkflowForDisplay>> => {
  if (instance === undefined) return {};

  const detail = await read<WorkflowInstanceDetailView>(`/instances/${instance.instanceId}`);
  const timeline = await read<Page<WorkflowHistoryView>>(
    `/instances/${instance.instanceId}/history?${PAGE}`,
  );
  const approval = await read<ApprovalStatusView>(`/approvals/${instance.instanceId}/status`);
  const entries = pageParts(timeline);

  return {
    ...(detail === undefined ? {} : { instance: detail }),
    history: entries.items,
    historyTotal: entries.total,
    ...(approval === undefined ? {} : { approval }),
  };
};

/**
 * The caller's own two queues.
 *
 * **Neither request names anybody.** The page and the size are the only parameters either one
 * carries; whose queue this is was decided by the authenticated request before any handler ran. A
 * caller the request resolved no membership for gets an empty queue from the API rather than
 * everybody's, and this screen adds nothing to that answer.
 */
const queues = async (): Promise<Partial<WorkflowForDisplay>> => {
  const pending = pageParts(await read<Page<PendingApprovalView>>(`/approvals/pending?${PAGE}`));
  const decided = pageParts(await read<Page<WorkflowDecisionView>>(`/approvals/decided?${PAGE}`));

  return {
    pending: pending.items,
    pendingTotal: pending.total,
    decided: decided.items,
    decidedTotal: decided.total,
  };
};
