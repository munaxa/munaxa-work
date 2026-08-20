/**
 * The words this module uses, and the ones it refuses to.
 *
 * Every list here is a **closed vocabulary Workflow owns** and therefore translates. A tenant's own
 * values — a definition code, a step's name, the subject type a business module routes on — are
 * never in this file: those are strings the customer or another module wrote, and a product that
 * interpreted them would be interpreting somebody else's business (00B).
 *
 * Eight refusals are worth stating before the lists, because each is a word that would have been
 * easy to reach for and wrong. Every one of them is a Phase 16A boundary, not an oversight:
 *
 * **No `role`, no `permission_holder`.** There is no role or permission directory in this repository
 * and `PlatformPermissionChecker` states there never will be: *"Munaxa Work will never implement a
 * role engine or a permission engine."* `holds(permission)` answers about the current caller and
 * about nobody else, so "everybody who may approve leave" is a question nothing here can ask.
 *
 * **`group` is here, and it is not a directory.** Phase 16B added it under explicit authorization as
 * a **Workflow-owned, explicit, static list of memberships** — no query, no inheritance, no nesting,
 * no role semantics, and nothing Identity owns. It is a list a tenant writes down, and it earns its
 * place by being resolved **once**, at instance start, into the individual memberships it named. An
 * approver of a running approval is therefore still a membership, exactly as it was in 16A.
 *
 * **No `manager`, no `reports_to`, no `employment_id`.** A manager is a reporting line in Employment
 * keyed by an employment, and no principal in this repository resolves to an employment (ADR-0032,
 * D-14). A caller-supplied manager identifier is a filter and never a credential, so routing to one
 * would be an IDOR wearing a permission's name. Manager routing is `NOT VERIFIED`.
 *
 * **No `sla_hours`, no `due_at`, no `breached`, no `escalation_level`.** `JobPort` has no adapter
 * anywhere in this repository, so nothing runs when nobody is asking. A stored breach flag would
 * need something to move it overnight, and there is nothing (D-11, D-12). SLA and escalation are
 * Phase 16B, and 16A has no column any of it could hide in.
 *
 * **`quorum`, `threshold` and parallel branches are here, and every parameter of them was approved
 * rather than chosen.** 16A refused this arithmetic because its denominator, its ties, its
 * abstentions and its delegated votes were unspecified (D-6), and Phase 13 settled what to do with
 * unspecified arithmetic: refuse it. Phase 16B was handed each parameter explicitly — the
 * denominator is the **assigned** approvers and never the respondents, a majority is **strictly**
 * more than half, a tie is not an approval, a non-response never shrinks the denominator, and a
 * delegated decision is **one** vote for the delegator. Every threshold is an integer count: there
 * is no weight, no percentage and no `numeric` column anywhere in this module.
 *
 * **`condition` is here, and it is closed rather than a language.** AD-008 asks for conditional
 * branching and defines no operator set, no type system, no evaluation order and no missing-key
 * behaviour (D-7); 16A refused to invent one, and 16B was given all four. A condition is a triple
 * over the instance's own `context`, five operators, values that are strings or whole numbers,
 * combined only by `all-of`, and **a missing key is a refusal and never a false**. There is no `or`,
 * no nesting, no arithmetic, no date, no cross-step reference and no cross-module read — because
 * ADR-0049 named this exact pressure: *"What a graph buys beyond that is branching and joining,
 * which is a workflow engine."*
 *
 * **No `notified_at`, no `reminder`, no `recipient`.** The specification's own Non Goals exclude
 * notification, and `RecordingNotificationPort` records rather than delivers. A column here would be
 * a "sent" state waiting to be misread.
 *
 * **No business word at all.** No `leave`, no `requisition`, no `amount`, no `employee`. Workflow
 * routes a decision about a subject it identifies by an opaque `subjectType` and `subjectId` and
 * knows nothing else about (AD-001). "No source-specific logic inside Workflow" is enforced by there
 * being no vocabulary in which to write any.
 *
 * **No `expired`.** It is one of the five states `ApprovalPort` declares, and 16A never produces it:
 * expiry is an SLA outcome and SLA is 16B. It appears below because the port's contract is the
 * port's, and it is marked as what it is — a state this phase maps and never writes.
 */

const member = <TValue extends string>(values: readonly TValue[], value: string): value is TValue =>
  (values as readonly string[]).includes(value);

// ------------------------------------------------------------------------------------------------
// Definitions and versions
// ------------------------------------------------------------------------------------------------

/**
 * A definition's own lifecycle — the reusable process, not its content.
 *
 * `retired` and not `deleted`: an instance started in 2024 must still name what it was following,
 * and removing the definition would make the instance unexplainable. Retirement is terminal, and a
 * definition is superseded by publishing a new **version** rather than by un-retiring an old one.
 *
 * The split between a definition and its versions is Onboarding's (ADR-0048), which had the same
 * problem: a template that must be editable, and instances that must not change underneath the
 * people running them.
 */
export const WORKFLOW_DEFINITION_STATUSES = ['active', 'retired'] as const;
export type WorkflowDefinitionStatus = (typeof WORKFLOW_DEFINITION_STATUSES)[number];

export const WORKFLOW_DEFINITION_TRANSITIONS: Readonly<
  Record<WorkflowDefinitionStatus, readonly WorkflowDefinitionStatus[]>
> = {
  active: ['retired'],
  retired: [],
};

/**
 * A version's lifecycle, and the transition that deliberately does not exist.
 *
 * **There is no `published → draft`.** A published version is immutable (AD-003, ADR-0048): running
 * instances continue on the version that started them, and un-publishing would rewrite what a
 * half-finished approval is following. A correction is a new version, exactly as a correction to a
 * Career readiness assessment is a new assessment and a correction to a Recruitment decision is a
 * reversal rather than an edit (ADR-0045).
 *
 * `archived` stops a version being chosen for new instances and changes nothing about the instances
 * already on it — which is AD-003 stated as a state rather than as an intention.
 */
export const WORKFLOW_VERSION_STATUSES = ['draft', 'published', 'archived'] as const;
export type WorkflowVersionStatus = (typeof WORKFLOW_VERSION_STATUSES)[number];

export const WORKFLOW_VERSION_TRANSITIONS: Readonly<
  Record<WorkflowVersionStatus, readonly WorkflowVersionStatus[]>
> = {
  draft: ['published', 'archived'],
  published: ['archived'],
  archived: [],
};

/**
 * What a **step template** may name as its approver.
 *
 * Three kinds, and each is deliberately narrow. A `membership` is one person a tenant admitted. A
 * `group` is a list of them Workflow itself keeps — not a role, not a query, not a directory, and
 * not anything Identity owns. A `manager` is **the requester's immediate manager**, and every word
 * of that is a parameter somebody approved rather than a reading this module chose (P-1 to P-4).
 *
 * **`manager` names nobody, and that is what makes it different from the other two.** A membership
 * and a group both carry an identifier on the template; a manager carries none, because whose
 * manager it means is fixed — the person who raised the approval. There is no target field to
 * configure, no previous-approver chain, and no depth: one level, the immediate manager, resolved as
 * at the instant the approval started.
 *
 * **This vocabulary belongs to the template and not to a running step.** A group is resolved into
 * its members and a manager into one membership when an instance starts, so every step of a running
 * approval names a membership and `approverKind` on a step is always `membership`. That is why the
 * step's own check constraint did not change in 16B and does not change in 16C: at the moment
 * somebody is actually asked, there is only ever a person.
 *
 * `role` and `external` remain `NOT VERIFIED`. Each needs something this repository does not have —
 * a role directory, and an identity model for a party outside the tenant — and the first was refused
 * by decision rather than deferred.
 */
export const APPROVER_KINDS = ['membership', 'group', 'manager'] as const;
export type ApproverKind = (typeof APPROVER_KINDS)[number];

/**
 * How a **branch** — the set of steps sharing one ordinal — reaches an outcome.
 *
 * Three rules, and the arithmetic of each was approved parameter by parameter rather than chosen
 * here (D-5). They agree completely when a branch has one approver, which is why every 16A chain is
 * expressible as a sequence of one-approver branches under any of them, and why `unanimous` is the
 * value a single-approver step carries.
 *
 * `quorum` is **not** in this list, and that is the substantive point: a quorum does not decide
 * anything. It is a minimum number of responses that must arrive before the rule below is evaluated
 * at all, so it is a separate optional integer rather than a fourth rule.
 */
export const BRANCH_RULES = ['unanimous', 'majority', 'first-response'] as const;
export type BranchRule = (typeof BRANCH_RULES)[number];

/**
 * What a branch's tally currently says.
 *
 * Computed, never stored: it is a function of the decisions that exist, and a column holding it
 * would be a second answer that goes stale the moment a decision commits. `awaiting` is the state a
 * branch is in while its outcome is still reachable both ways — not a fourth step status, and not
 * something anybody sees on a queue.
 */
export const BRANCH_OUTCOMES = ['awaiting', 'approved', 'rejected'] as const;
export type BranchOutcome = (typeof BRANCH_OUTCOMES)[number];

/**
 * The five comparisons a routing condition may make. There is no sixth, and no combinator but
 * `all-of`.
 *
 * Closed because the alternative is an expression language, which is a product with its own parser,
 * its own type system, its own injection surface and its own tests. `in` is the only operator taking
 * a list; the rest take a single string or whole number.
 */
export const CONDITION_OPERATORS = [
  'equals',
  'not-equals',
  'greater-than',
  'less-than',
  'in',
] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

// ------------------------------------------------------------------------------------------------
// Instances and steps
// ------------------------------------------------------------------------------------------------

/**
 * A running process, and the three ways it ends.
 *
 * All three endings are terminal and all three are kept apart. `completed` and `rejected` are the
 * two outcomes the requesting module acts on; `cancelled` is the requester or an administrator
 * stopping the process before it reached either, and collapsing it into `rejected` would tell a
 * business module that somebody refused when nobody did.
 *
 * **A rejected instance is not resubmitted.** Asking again is a new instance, for the reason
 * ADR-0045 gives for reversal-rather-than-amendment: an edited decision is not evidence.
 */
export const WORKFLOW_INSTANCE_STATUSES = [
  'running',
  'completed',
  'rejected',
  'cancelled',
] as const;
export type WorkflowInstanceStatus = (typeof WORKFLOW_INSTANCE_STATUSES)[number];

export const WORKFLOW_INSTANCE_TRANSITIONS: Readonly<
  Record<WorkflowInstanceStatus, readonly WorkflowInstanceStatus[]>
> = {
  running: ['completed', 'rejected', 'cancelled'],
  completed: [],
  rejected: [],
  cancelled: [],
};

/**
 * One step of a running instance.
 *
 * `pending` is a step the instance has not reached; `awaiting` is the one step a decision is being
 * asked for right now. Exactly one step of a running instance is `awaiting`, which is what makes
 * "sequential" a property of the data rather than of the code that walks it.
 *
 * `skipped` is what happens to the steps after a rejection or a cancellation. They are moved rather
 * than left `pending`, because a step that still reads "pending" on a finished instance is a queue
 * entry waiting to be misread as work somebody owes.
 */
export const WORKFLOW_STEP_STATUSES = [
  'pending',
  'awaiting',
  'approved',
  'rejected',
  'skipped',
] as const;
export type WorkflowStepStatus = (typeof WORKFLOW_STEP_STATUSES)[number];

export const WORKFLOW_STEP_TRANSITIONS: Readonly<
  Record<WorkflowStepStatus, readonly WorkflowStepStatus[]>
> = {
  pending: ['awaiting', 'skipped'],
  awaiting: ['approved', 'rejected', 'skipped'],
  approved: [],
  rejected: [],
  skipped: [],
};

/** What an approver may say. There is no third answer, and no way to abstain. */
export const APPROVAL_DECISIONS = ['approved', 'rejected'] as const;
export type ApprovalDecisionKind = (typeof APPROVAL_DECISIONS)[number];

/**
 * On whose authority a decision was made.
 *
 * `assigned` is the approver the step names. `delegated` is somebody Identity says may act for them
 * over a period agreed in advance (ADR-0043 territory, and Identity's aggregate, never a second one
 * here). Both are recorded — the person who acted and the person they acted for — because "who
 * approved this" and "whose authority was it" are different questions a year later, and a single
 * column would answer only one of them.
 *
 * **Nobody is impersonated.** A delegated decision records the delegate as the actor. It does not
 * write the delegator's name into the actor column and call it an approval they made.
 */
export const DECISION_AUTHORITIES = ['assigned', 'delegated'] as const;
export type DecisionAuthority = (typeof DECISION_AUTHORITIES)[number];

// ------------------------------------------------------------------------------------------------
// The port's vocabulary
// ------------------------------------------------------------------------------------------------

/**
 * `ApprovalPort.ApprovalState`, restated so the mapping is in one place and can be tested.
 *
 * Workflow does **not** invent a parallel state vocabulary at its own seam: five modules publish an
 * approval chain "in `ApprovalPort`'s shape", and a sixth vocabulary here would make the seam the
 * thing that needs translating.
 *
 * `expired` is declared by the port and **never produced by Phase 16A** — see the header. It is
 * listed so the mapping is total and so a reader can see the gap rather than infer it.
 */
export const APPROVAL_STATES = ['pending', 'approved', 'rejected', 'cancelled', 'expired'] as const;
export type ApprovalStateName = (typeof APPROVAL_STATES)[number];

/** The states 16A can actually reach. `expired` is absent because nothing expires anything. */
export const REACHABLE_APPROVAL_STATES = ['pending', 'approved', 'rejected', 'cancelled'] as const;

/**
 * What history records.
 *
 * A closed list, because history is Workflow's own audit of **routing** and must never restate a
 * business fact. "The requisition was approved" belongs to Recruitment; "step 2 of instance X was
 * approved by membership Y acting for membership Z" belongs here.
 *
 * **This list and `workflow_history_event_check` are one vocabulary in two places**, and the parity
 * suite fails the moment they disagree. `step-escalated` was named by the Phase 16D domain a
 * checkpoint before the constraint could carry it, and deliberately left out of this list until the
 * migration widened the constraint — so the two moved together rather than the code claiming a value
 * the database would refuse.
 *
 * **An escalation is not a decision.** `step-escalated` says an approver was added to a branch, and
 * it is deliberately none of `step-approved`, `step-rejected` or `step-skipped`: recording it as one
 * of those would put an answer in the timeline that nobody gave.
 *
 * **A reminder is not an escalation, and it is not a state.** `step-reminded` says the system told an
 * approver their step had passed its service level: nobody was added, nothing was decided, and no
 * step became overdue *as a stored fact*. It records the action, never the condition.
 */
export const WORKFLOW_HISTORY_EVENTS = [
  'instance-started',
  'step-awaiting',
  'step-approved',
  'step-rejected',
  'step-skipped',
  'step-escalated',
  'step-reminded',
  'instance-completed',
  'instance-rejected',
  'instance-cancelled',
] as const;
export type WorkflowHistoryEvent = (typeof WORKFLOW_HISTORY_EVENTS)[number];

// ------------------------------------------------------------------------------------------------
// Shapes
// ------------------------------------------------------------------------------------------------

/** A stable, human-authored code, unique within its tenant. The shape six modules already use. */
export const isCode = (value: string): boolean =>
  /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/.test(value);

/**
 * What a business module calls the thing being decided — `recruitment.requisition`.
 *
 * `ApprovalRequest.subjectType` is the field, and the port's own comment says Workflow routes on it.
 * It is validated for **shape only**: a dotted lowercase identifier. Workflow does not hold a list of
 * legal subject types, because a list here would be a list of business modules, and this module is
 * required to know about none of them (AD-001).
 *
 * Every segment takes hyphens, including the first. The rule has to be uniform precisely because
 * this module does not get to know which segment is a module name: a first draft of it allowed
 * hyphens only after the dot, which would have refused `a-module-nobody-has-written.a-subject` for
 * no reason other than the order the segments happened to be written in.
 */
const SEGMENT = String.raw`[a-z0-9]+(-[a-z0-9]+)*`;

export const isSubjectType = (value: string): boolean =>
  new RegExp(`^${SEGMENT}(\\.${SEGMENT})+$`).test(value);

/**
 * A step's position in a version, bounded below and **deliberately not above**.
 *
 * AD-004: *"Workflow supports unlimited approval steps. No approval limit may be hardcoded."* So
 * unlike every ordered value in Career — a stage sequence capped at 500, a rank at 50, an ordinal at
 * 100 — this one carries no maximum. The `integer` column it lands in has a range, which is a
 * property of the storage rather than a rule about approvals.
 */
export const isPositiveWhole = (value: number): boolean => Number.isInteger(value) && value >= 1;

/** A bilingual value a tenant authored. This product renders it and never translates it. */
export interface LocalizedName {
  readonly en: string;
  readonly ar: string;
}

/**
 * Whether a value really is bilingual text a tenant wrote.
 *
 * **The types of the two fields are checked, not assumed.** This guard's whole job is to be handed
 * something that may not be a `LocalizedName` — a JSON body reaching the edge, a caller still
 * sending the shape from before a field became localized — and `value.en.trim()` on an absent or
 * non-string `en` throws where a refusal belongs. A `TypeError` at the edge becomes a 500, which
 * tells an administrator the product is broken rather than that their input was.
 */
export const isLocalizedName = (value: LocalizedName | undefined): boolean =>
  value !== undefined &&
  typeof value.en === 'string' &&
  typeof value.ar === 'string' &&
  value.en.trim().length > 0 &&
  value.ar.trim().length > 0;

/**
 * The actor no decision in this module accepts.
 *
 * `AutoApprovingPort` is the only approval adapter that existed before this phase, and its own
 * comment says it pretends nothing. Nine modules already refuse this actor on the act that matters —
 * fourteen check constraints across Performance, Learning and Career — and Workflow refuses it on
 * every approval decision it records. A routed approval that nobody made is the exact failure the
 * whole seam exists to prevent (ADR-0045).
 */
export const AUTO_APPROVAL = 'system:auto-approval';

export const isApproverKind = (value: string): value is ApproverKind =>
  member(APPROVER_KINDS, value);
export const isBranchRule = (value: string): value is BranchRule => member(BRANCH_RULES, value);
export const isConditionOperator = (value: string): value is ConditionOperator =>
  member(CONDITION_OPERATORS, value);
export const isApprovalDecision = (value: string): value is ApprovalDecisionKind =>
  member(APPROVAL_DECISIONS, value);
export const isDecisionAuthority = (value: string): value is DecisionAuthority =>
  member(DECISION_AUTHORITIES, value);
