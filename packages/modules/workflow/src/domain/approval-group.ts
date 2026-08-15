import { isCode, isLocalizedName, type LocalizedName } from './workflow-vocabulary.js';
import { accept, refuse, type WorkflowResult } from './workflow-rejection.js';

/**
 * A named list of memberships a tenant maintains, and nothing more than that.
 *
 * **This is not a directory, and the distinction is the whole reason it is allowed to exist.** A
 * directory answers "who holds role X" — a question about people, evaluated whenever it is asked,
 * against facts somebody else owns. `PlatformPermissionChecker` states this product will never build
 * one, and Phase 16A refused to. A group here is the opposite: **a list somebody wrote down**, kept
 * by Workflow, with no query behind it, no inheritance, no nesting, no role semantics and no
 * relationship to Identity's memberships beyond naming their identifiers.
 *
 * That is what makes it safe, and it is also what makes it useful: "the four people who approve
 * capital expenditure" is a list an organization can maintain, and it does not require this product
 * to learn what a role is.
 *
 * **A group is resolved once, when an instance starts.** Its members are copied onto the instance's
 * steps and the running approval never looks at the group again — so editing a group, or removing
 * somebody from it, changes nothing about an approval already under way. This is the same rule as
 * 16A's step copying (AD-003, ADR-0048): a process that changes under the people running it is not
 * auditable, and "why was I asked?" must have an answer that does not depend on what a list says
 * today.
 *
 * **Membership in a group is not authority.** Being in a group means being *asked*; whether somebody
 * may actually decide is still checked against the step they were assigned and their delegations at
 * the instant they act. And managing a group is its own permission — `workflow.group.manage` — which
 * is deliberately not implied by `workflow.definition.manage`, because whoever may edit a group may
 * change who approves.
 *
 * **No cross-tenant member.** A group and its members are tenant-scoped rows under the same forced
 * row-level security as everything else in the module; a membership from another tenant is not
 * visible to insert against in the first place.
 */

export interface ApprovalGroupState {
  readonly approvalGroupId: string;
  /** A stable, human-authored code, unique within the tenant. The shape six modules already use. */
  readonly code: string;
  readonly name: LocalizedName;
  readonly version: number;
}

/**
 * One membership's place in a group.
 *
 * A row rather than an array on the group, because membership is added and removed individually and
 * each change is an ordinary audited write. `addedAt` records when somebody was put on the list,
 * which is the question asked after an approval went to a person nobody expected.
 */
export interface ApprovalGroupMemberState {
  readonly approvalGroupMemberId: string;
  readonly approvalGroupId: string;
  readonly membershipId: string;
  readonly addedAt: Date;
  readonly version: number;
}

export interface CreateApprovalGroupRequest {
  readonly approvalGroupId: string;
  readonly code: string;
  readonly name: LocalizedName;
}

/**
 * Creating a group.
 *
 * A group starts **empty** and is deliberately allowed to: a tenant names the list before filling
 * it, exactly as a definition exists before its steps do. What is refused is *using* an empty group
 * — a version naming one cannot be published (see `definition.ts`), because a branch with nobody in
 * it would complete instantly while looking like a process.
 *
 * There is no status and no lifecycle. A group is a list; a list that is no longer wanted has its
 * members removed or is deleted through the ordinary soft-delete every table in this repository has.
 * Inventing `active | archived` would add a vocabulary, a check constraint and a transition table to
 * express something nobody asked for.
 */
export const createApprovalGroup = (
  request: CreateApprovalGroupRequest,
): WorkflowResult<ApprovalGroupState> => {
  if (!isCode(request.code)) return refuse('group-code-invalid');
  if (!isLocalizedName(request.name)) return refuse('group-name-required');

  return accept({
    approvalGroupId: request.approvalGroupId,
    code: request.code,
    name: request.name,
    version: 1,
  });
};

export interface AddApprovalGroupMemberRequest {
  readonly approvalGroupMemberId: string;
  readonly membershipId: string;
  readonly at: Date;
}

/**
 * Putting somebody on the list.
 *
 * **Duplicate membership is not checked here.** One row per membership per group is a fact about a
 * set of rows and is arbitrated by a partial unique index, because two administrators can add the
 * same person in the same instant and a pre-check would let both through. Career took the same
 * position on duplicate nominations, and 16A took it on step ordinals.
 */
export const addApprovalGroupMember = (
  group: ApprovalGroupState,
  request: AddApprovalGroupMemberRequest,
): WorkflowResult<ApprovalGroupMemberState> => {
  if (request.membershipId.trim().length === 0) return refuse('group-member-required');

  return accept({
    approvalGroupMemberId: request.approvalGroupMemberId,
    approvalGroupId: group.approvalGroupId,
    membershipId: request.membershipId,
    addedAt: request.at,
    version: 1,
  });
};

/**
 * The memberships a group names, in a deterministic order.
 *
 * Ordered by membership identifier rather than by when somebody was added, so that two instances
 * started from the same group produce their steps in the same order — which is what makes a branch's
 * step identifiers comparable between runs and a test reproducible. The order carries no meaning
 * about precedence: a branch is unordered by construction, and every member of it is asked at once.
 *
 * **Duplicates are collapsed.** The index makes them unreachable in practice; collapsing them here
 * means that if one ever did exist, a person would be asked once and counted once rather than
 * silently given two votes.
 */
export const membersOf = (members: readonly ApprovalGroupMemberState[]): readonly string[] =>
  [...new Set(members.map((member) => member.membershipId))].sort((left, right) =>
    left.localeCompare(right),
  );
