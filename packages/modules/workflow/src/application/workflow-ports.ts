import type { Transaction } from '@work/kernel';

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
 * runs when nobody is asking, so escalation and SLA are Phase 16B. There is no notification port —
 * the specification's own Non Goals exclude it. There is no role or group directory, no manager
 * resolution and no external approver port: an approver is a membership, named individually, and the
 * repository has promised never to build a role engine. Each would be a port with no use case behind
 * it, which is how a deferred capability acquires an implementation path.
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

export interface WorkflowStores {
  readonly definitions: DefinitionStore;
  readonly versions: VersionStore;
  readonly instances: InstanceStore;
  readonly steps: StepStore;
  readonly decisions: DecisionStore;
  readonly history: HistoryStore;
}

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
