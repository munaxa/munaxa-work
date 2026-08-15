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
 * **No `role`, no `group`, no `permission_holder`.** There is no role or permission directory in
 * this repository and `PlatformPermissionChecker` states there never will be: *"Munaxa Work will
 * never implement a role engine or a permission engine."* `holds(permission)` answers about the
 * current caller and about nobody else, so "everybody who may approve leave" is a question nothing
 * here can ask. An approver is a **membership** — a person a tenant admitted, named individually
 * (D-3, D-4). Groups arrive in Phase 16B if a directory ever can.
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
 * **No `quorum`, no `threshold`, no `vote_count`, no `parallel`.** Majority, unanimous and
 * first-response tallies are unspecified in their denominator, their ties, their abstentions and
 * their delegated votes (D-6). Phase 13 settled what to do with unspecified arithmetic: refuse it.
 * 16A approves **one step at a time, in order**, which is the whole of the mechanism.
 *
 * **No `condition`, no `expression`, no `branch`, no `rule`.** AD-008 asks for conditional
 * branching and defines no operator set, no type system, no evaluation order and no
 * missing-key behaviour (D-7). ADR-0049 already named this exact pressure: *"What a graph buys
 * beyond that is branching and joining, which is a workflow engine."* A version's steps are a
 * sequence, and a sequence is not a graph.
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
 * What an approver is, in Phase 16A.
 *
 * One kind, and the list is a list rather than a bare constant so that adding `group` in 16B is a
 * vocabulary change reviewed on its own merits — the same reason Onboarding closed its task kinds at
 * five and said a sixth is deliberately a schema change (ADR-0049).
 */
export const APPROVER_KINDS = ['membership'] as const;
export type ApproverKind = (typeof APPROVER_KINDS)[number];

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
 */
export const WORKFLOW_HISTORY_EVENTS = [
  'instance-started',
  'step-awaiting',
  'step-approved',
  'step-rejected',
  'step-skipped',
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
export const isApprovalDecision = (value: string): value is ApprovalDecisionKind =>
  member(APPROVAL_DECISIONS, value);
export const isDecisionAuthority = (value: string): value is DecisionAuthority =>
  member(DECISION_AUTHORITIES, value);
