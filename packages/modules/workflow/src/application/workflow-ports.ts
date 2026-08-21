import type { Transaction } from '@work/kernel';

import type { ApprovalGroupMemberState, ApprovalGroupState } from '../domain/approval-group.js';
import type { WorkflowDecisionState } from '../domain/decision.js';
import type {
  WorkflowDefinitionState,
  WorkflowStepTemplateState,
  WorkflowVersionState,
} from '../domain/definition.js';
import type { WorkflowHistoryState } from '../domain/history.js';
import type { WorkflowInstanceState, WorkflowStepState } from '../domain/instance.js';

/**
 * The persistence and the one external read this module needs, as interfaces the domain never sees.
 *
 * **Two stores are deliberately narrower than the rest.** `DecisionStore` and `HistoryStore` offer
 * inserts and reads and **no update, no remove**. A decision an approver made and a record of how an
 * approval was routed are the two things somebody asks about a year later, and the cheapest guarantee
 * that nobody rewrote one is to have no method that could. The database refuses it too, with a
 * trigger; this is the same rule expressed where a developer meets it first. A correction is a new
 * approval, never a rewritten decision.
 *
 * Every read is tenant-scoped by the transaction's `app.tenant_id`, and every collection read takes a
 * bound. There is no unbounded query in this module.
 *
 * **What is absent is as deliberate as what is here.** There is no `JobPort` — nothing in Workflow
 * runs when nobody is asking, so escalation and SLA stay deferred. There is no notification port —
 * the specification's own Non Goals exclude it. There is no role directory, no manager resolution
 * and no external approver port. Each would be a port with no use case behind it, which is how a
 * deferred capability acquires an implementation path.
 *
 * `ApprovalGroupStore` is **not** the exception to that. A directory answers "who holds role X" by
 * evaluating a question about people against facts somebody else owns; this store reads a list a
 * tenant wrote down, in Workflow's own tables, with no query behind it and no membership resolved
 * through Identity. That distinction is the whole reason a group is allowed to exist at all.
 */

export interface Paged {
  readonly limit: number;
  readonly offset: number;
}

export interface Page<TItem> {
  readonly items: readonly TItem[];
  readonly total: number;
}

/**
 * The instant a decision, a start or a delegation check happens at.
 *
 * A port rather than `new Date()` so a suite can ask "was this delegation in force *then*" against a
 * stated instant. It schedules nothing: there is no adapter that could make time pass on its own.
 */
export interface Clock {
  now(): Date;
}

// ------------------------------------------------------------------------------------------------
// Definitions and versions
// ------------------------------------------------------------------------------------------------

export interface DefinitionFilters {
  readonly status?: string;
  readonly subjectType?: string;
}

export interface DefinitionStore {
  byId(transaction: Transaction, id: string): Promise<WorkflowDefinitionState | undefined>;
  byCode(transaction: Transaction, code: string): Promise<WorkflowDefinitionState | undefined>;
  search(
    transaction: Transaction,
    filters: DefinitionFilters,
    paged: Paged,
  ): Promise<Page<WorkflowDefinitionState>>;
  insert(transaction: Transaction, state: WorkflowDefinitionState): Promise<void>;
  /**
   * Optimistic. `expected` is the version the caller read; a mismatch is the refusal that settles
   * two administrators retiring the same definition at the same moment.
   */
  update(transaction: Transaction, state: WorkflowDefinitionState, expected: number): Promise<void>;
}

export interface VersionStore {
  byId(transaction: Transaction, id: string): Promise<WorkflowVersionState | undefined>;
  forDefinition(
    transaction: Transaction,
    definitionId: string,
    paged: Paged,
  ): Promise<Page<WorkflowVersionState>>;
  /** The published version a new instance follows: the highest-numbered one, or nothing. */
  currentPublished(
    transaction: Transaction,
    definitionId: string,
  ): Promise<WorkflowVersionState | undefined>;
  /** The next number for a definition, counted by the database rather than by a page's length. */
  nextNumberFor(transaction: Transaction, definitionId: string): Promise<number>;
  insert(transaction: Transaction, state: WorkflowVersionState): Promise<void>;
  update(transaction: Transaction, state: WorkflowVersionState, expected: number): Promise<void>;
  templatesFor(
    transaction: Transaction,
    workflowVersionId: string,
  ): Promise<readonly WorkflowStepTemplateState[]>;
  insertTemplate(transaction: Transaction, state: WorkflowStepTemplateState): Promise<void>;
}

// ------------------------------------------------------------------------------------------------
// Instances and steps
// ------------------------------------------------------------------------------------------------

export interface InstanceFilters {
  readonly status?: string;
  readonly definitionId?: string;
  readonly subjectType?: string;
  readonly subjectId?: string;
}

export interface InstanceStore {
  byId(transaction: Transaction, id: string): Promise<WorkflowInstanceState | undefined>;
  /** The open approval for a subject, if there is one. The read behind duplicate convergence. */
  openForSubject(
    transaction: Transaction,
    subjectType: string,
    subjectId: string,
  ): Promise<WorkflowInstanceState | undefined>;
  search(
    transaction: Transaction,
    filters: InstanceFilters,
    paged: Paged,
  ): Promise<Page<WorkflowInstanceState>>;
  insert(transaction: Transaction, state: WorkflowInstanceState): Promise<void>;
  update(transaction: Transaction, state: WorkflowInstanceState, expected: number): Promise<void>;
}

/** A step whose reminder is due: the two identifiers the reminder command takes, and nothing else. */
export interface DueReminder {
  readonly instanceId: string;
  readonly stepId: string;
}

export interface StepStore {
  byId(transaction: Transaction, id: string): Promise<WorkflowStepState | undefined>;
  forInstance(transaction: Transaction, instanceId: string): Promise<readonly WorkflowStepState[]>;
  /**
   * The steps awaiting a decision from one membership — the approval queue.
   *
   * Takes the membership as a parameter because a *store* cannot read an execution context; the
   * handler resolves it from the request and passes it, and there is no query in this module through
   * which a caller could name somebody else.
   */
  awaitingFor(
    transaction: Transaction,
    approverMembershipId: string,
    paged: Paged,
  ): Promise<Page<WorkflowStepState>>;
  /**
   * The steps whose automatic service-level reminder is due at `asAt`, after `cursor`.
   *
   * **The one read in this module that takes no identifier**, and the shape is what keeps that safe:
   * it is bounded by `limit`, ordered by the step's own identifier, and returns two identifiers per
   * row. There is no filter a caller could widen and no field through which a person could be named.
   *
   * **`asAt` is a parameter, never a clock the store reads**, exactly as every instant in this module
   * is. A store that consulted the time would give two different answers to one question asked twice.
   *
   * **It excludes steps already reminded**, which is an optimisation and *not* the guarantee. Two
   * runners may legitimately discover the same step; only one can claim the history row. Discovery
   * narrows the work, and the database decides the effect.
   */
  dueForReminder(
    transaction: Transaction,
    asAt: Date,
    limit: number,
    cursor?: string,
  ): Promise<readonly DueReminder[]>;
  insert(transaction: Transaction, state: WorkflowStepState): Promise<void>;
  update(transaction: Transaction, state: WorkflowStepState, expected: number): Promise<void>;
}

// ------------------------------------------------------------------------------------------------
// The two append-only stores
// ------------------------------------------------------------------------------------------------

export interface DecisionStore {
  forInstance(
    transaction: Transaction,
    instanceId: string,
  ): Promise<readonly WorkflowDecisionState[]>;
  /** What one membership decided — the other half of a queue, and the same identity rule. */
  decidedBy(
    transaction: Transaction,
    decidedByMembershipId: string,
    paged: Paged,
  ): Promise<Page<WorkflowDecisionState>>;
  insert(transaction: Transaction, state: WorkflowDecisionState): Promise<void>;
}

export interface HistoryStore {
  forInstance(
    transaction: Transaction,
    instanceId: string,
    paged: Paged,
  ): Promise<Page<WorkflowHistoryState>>;
  insert(transaction: Transaction, state: WorkflowHistoryState): Promise<void>;
}

// ------------------------------------------------------------------------------------------------
// Approval groups
// ------------------------------------------------------------------------------------------------

/**
 * A named list of memberships, and the members on it.
 *
 * **`membersOfAll` takes every group at once, and that is the point of its existence.** Starting an
 * approval must resolve every group the version names, and a per-group read would make the cost of
 * raising one grow with how many groups a process happens to use. One read, whatever the shape of
 * the process — the same rule every other bounded read in this module keeps.
 *
 * There is no `search` over members and no "which groups is this person in": neither has a use case,
 * and the second is the first question a directory answers.
 */
export interface ApprovalGroupStore {
  byId(transaction: Transaction, id: string): Promise<ApprovalGroupState | undefined>;
  byCode(transaction: Transaction, code: string): Promise<ApprovalGroupState | undefined>;
  search(transaction: Transaction, paged: Paged): Promise<Page<ApprovalGroupState>>;
  insert(transaction: Transaction, state: ApprovalGroupState): Promise<void>;
  membersOf(
    transaction: Transaction,
    approvalGroupId: string,
  ): Promise<readonly ApprovalGroupMemberState[]>;
  /** Every member of every named group, in one read. See above. */
  membersOfAll(
    transaction: Transaction,
    approvalGroupIds: readonly string[],
  ): Promise<readonly ApprovalGroupMemberState[]>;
  insertMember(transaction: Transaction, state: ApprovalGroupMemberState): Promise<void>;
  memberById(
    transaction: Transaction,
    approvalGroupMemberId: string,
  ): Promise<ApprovalGroupMemberState | undefined>;
  /**
   * Taking somebody off a list.
   *
   * A group is **not** an append-only fact — unlike a decision and a history entry, which have no
   * removal here at all — because a list of who approves is a thing an organization edits. What it
   * cannot do is reach an approval already running: those steps were snapshotted at the start.
   */
  removeMember(transaction: Transaction, approvalGroupMemberId: string): Promise<void>;
}

export interface WorkflowStores {
  readonly definitions: DefinitionStore;
  readonly versions: VersionStore;
  readonly instances: InstanceStore;
  readonly steps: StepStore;
  readonly decisions: DecisionStore;
  readonly history: HistoryStore;
  readonly groups: ApprovalGroupStore;
}

// ------------------------------------------------------------------------------------------------
// The one outbound write
// ------------------------------------------------------------------------------------------------

/**
 * A terminal Workflow approval, as the module that asked for it needs to hear about it.
 *
 * Four fields and no fifth. The subject is the opaque pair the requesting module supplied and
 * Workflow never interpreted; `approvalId` is the Workflow instance's own identifier, because the
 * approval **is** the instance and inventing a second identifier would create a fact nobody owns;
 * and the outcome is the one thing Workflow actually decided.
 *
 * **No step, no approver, no comment, no chain.** Who was asked and who answered is Workflow's
 * record, and handing it across the seam would let a business module start reasoning about approval
 * chains it does not own — which is the second source of truth AD-001 exists to prevent.
 */
export interface TerminalApproval {
  readonly subjectType: string;
  readonly subjectId: string;
  /** The Workflow instance. An opaque value on the other side — never a foreign key (ADR-0042). */
  readonly approvalId: string;
  readonly outcome: 'approved' | 'rejected';
}

/**
 * What the adopting module did with it.
 *
 * `applied` — the module accepted the decision and moved.
 * `converged` — this same approval had already been applied; nothing changed and nothing needed to.
 * `not-adopted` — no module here routes this subject type, which is the ordinary case for the ten
 * modules that have not adopted Workflow. Not a failure.
 * `refused` — the module's own rules said no.
 *
 * **`reason` is a Workflow rejection key, not the module's own**, and that is a real limitation
 * stated rather than hidden: a refusal crossing this seam lands in Workflow's catalogue namespace, so
 * Recruitment's `requisition_not_awaiting_decision` cannot be re-rendered here without Workflow
 * publishing another module's message keys. The adapter therefore picks from the closed set in
 * `WORKFLOW_REFUSALS_FROM_A_SUBJECT` — which distinguishes the four outcomes that mean different
 * things to a person reading the refusal — and the module's own wording stays where it is owned.
 */
export type ApprovalDelivery =
  | { readonly kind: 'applied' }
  | { readonly kind: 'converged' }
  | { readonly kind: 'not-adopted' }
  | { readonly kind: 'refused'; readonly reason: string };

/**
 * The seam through which a terminal decision reaches the module that asked for it.
 *
 * **This is not the kernel's `ApprovalPort` and does not replace it.** That port is the inbound
 * direction — a business module asking Workflow to route a decision — and Workflow implements it
 * unchanged (D-8). This is the return path, and the kernel port has no method for it: its own answer
 * is an event, and D-9 refused event-carried correctness because delivery here is in-process and
 * at-most-once with no outbox. So the decision travels **synchronously, inside the approver's own
 * request**, and this one method is the whole of that path.
 *
 * **One method, and deliberately nothing else.** No `send`, no command name, no module name, no
 * query, no repository, no transaction and no entity. An adapter implements it for the subject types
 * its module owns and answers `not-adopted` for every other, so Workflow never learns which module
 * is on the other end — the property AD-001 turns on, and the reason there is no registry keyed by
 * module here.
 *
 * **The adapter decides nothing about the business.** It carries the decision to the owning module's
 * own published command and carries that module's answer back. Whether the transition is legal is
 * the owning module's question, asked and answered on its own side.
 */
export interface BusinessDecisionPort {
  apply(approval: TerminalApproval): Promise<ApprovalDelivery>;
}

/**
 * The refusals a subject's own module can produce, in Workflow's words.
 *
 * Four, and each is a different sentence to the person who pressed approve. *Its rules refused* is
 * the ordinary business outcome. *Another approval already decided it* and *it was decided outside
 * Workflow* are the two ways an approval arrives too late, and they are kept apart because the first
 * means a routed chain got there first and the second means a person did — which are different
 * questions for whoever investigates. *The subject is not there* is neither.
 */
export const WORKFLOW_REFUSALS_FROM_A_SUBJECT = [
  'subject-refused-the-decision',
  'subject-decided-by-another-approval',
  'subject-decided-outside-workflow',
  'subject-not-found',
] as const;

export type SubjectRefusal = (typeof WORKFLOW_REFUSALS_FROM_A_SUBJECT)[number];

// ------------------------------------------------------------------------------------------------
// The one cross-module read
// ------------------------------------------------------------------------------------------------

/**
 * One delegation, as Identity publishes it.
 *
 * Field for field `DelegationView` from `@work/identity`'s contracts, restated here so this module
 * depends on a shape rather than on that package — the same treatment Career gave Employment's and
 * Learning's answers. The production adapter (Checkpoint 6) maps one to the other and is the only
 * place the two files have to agree.
 */
export interface DelegationGrant {
  readonly delegatorMembershipId: string;
  readonly delegateMembershipId: string;
  /** Opaque to Identity, agreed by the consumer. Workflow honours its own permission name and `*`. */
  readonly scope: string;
}

/**
 * Who is currently acting for whom — **Identity's fact, never Workflow's**.
 *
 * Delegation lives in Identity because it is a statement about identity, and building a second
 * register inside the approvals engine would make four other domains depend on Workflow to find out
 * who somebody's deputy is (AD-010, D-2). This module stores no delegation row, keeps no expiry
 * state and runs no expiry job: it asks, at the instant of the decision, and Identity answers from a
 * period that was agreed in advance.
 *
 * The port mirrors `identity.active-delegations-for(delegateMembershipId, atInstant)` exactly.
 * Asking *at an instant* rather than reading a status is deliberate on Identity's side too — its own
 * comment says a status is only as fresh as the last job that updated it, and there is no such job.
 */
export interface DelegationPort {
  activeFor(delegateMembershipId: string, atInstant: Date): Promise<readonly DelegationGrant[]>;
}
