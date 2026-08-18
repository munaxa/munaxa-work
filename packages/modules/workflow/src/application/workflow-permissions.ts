/**
 * What a caller must hold, and the separations that matter.
 *
 * **An approval queue is more sensitive than it looks.** The list of approvals waiting on a named
 * director tells a reader what that organization is deciding this week, and a rejection comment is
 * one person's written opinion of another's request. So a record the caller may not see answers
 * *not found* rather than *forbidden*, exactly as Career reasoned about a succession bench.
 *
 * Two separations are deliberate, and each mirrors a precedent:
 *
 * **`instance.cancel` is not implied by `instance.start`.** Raising an approval and stopping one
 * that is already running are different acts, and the second is the one that ends somebody else's
 * request without anybody deciding it. Recruitment separates `requisition.approve` from
 * `requisition.manage` for the same reason (ADR-0045).
 *
 * **`approval.decide` is not implied by `instance.read`.** Reading who has been asked and answering
 * on their behalf are different capabilities. Holding every other Workflow permission does not open
 * `decide`, which the authorization suite asserts one permission at a time.
 *
 * **`group.manage` is not implied by `definition.manage`**, and that separation is a security
 * position rather than tidiness. Whoever may edit an approval group can change who approves — a
 * group named on a published version routes every approval started from it — so the capability to
 * write the *process* and the capability to write the *people* are two grants. It mirrors
 * `instance.cancel` standing apart from `instance.start`.
 *
 * **A group is a list, not a directory**, which is why `group.read` is a Workflow permission at all.
 * It reads rows this module owns; it resolves nothing through Identity and answers no question about
 * who holds a role.
 *
 * **`approval.read-own` is routed and enforced**, which makes it the first `read-own` in this
 * repository that is not `NOT VERIFIED`. Career, Learning, Performance, Leave, Payroll, Attendance,
 * Compensation and Documents all declare one and route it nowhere, because a plan or a payslip is
 * about an *employment* and no principal resolves to one (ADR-0032). An approval is addressed to a
 * **membership**, and a membership is what the request already resolved — so "the approvals waiting
 * for me" is answerable here without accepting a single identifier from the caller.
 *
 * There is deliberately **no `approval.read-team` and no manager permission**. Resolving "my team"
 * needs to know which *employment* the caller is, and a caller-supplied manager identifier is a
 * filter, never a credential (D-14).
 */
export const WorkflowPermissions = {
  /** Workflow definitions and the versions of them. Configuration. */
  definitionRead: 'workflow.definition.read',
  definitionManage: 'workflow.definition.manage',

  /** Reading approvals across the tenant — an administrator's view, not an approver's. */
  instanceRead: 'workflow.instance.read',
  /** Raising an approval. Phase 16A's `ApprovalPort` seam will hold this one (Checkpoint 7). */
  instanceStart: 'workflow.instance.start',
  /** Stopping one that nobody decided. Never implied by starting one. */
  instanceCancel: 'workflow.instance.cancel',

  /** Answering a step you were asked to answer, or that somebody delegated to you. */
  approvalDecide: 'workflow.approval.decide',
  /** The caller's own queue, resolved from the membership on the request and from nothing else. */
  approvalReadOwn: 'workflow.approval.read-own',
  /**
   * Adding an approver to a branch that is stuck. The tenth, and it is implied by nothing.
   *
   * **It is the most powerful thing an administrator can do to a running approval short of ending
   * one**, which is why it stands on its own rather than riding on a grant somebody already holds.
   * `group.manage` changes who approves *the next* approval; this changes who approves *the one
   * already under way*, after people have started answering it — and `instance.cancel` is the only
   * other permission that reaches an approval in flight. That pair is the precedent, and the
   * separation is the same one AD-0045 draws for Recruitment.
   *
   * **The actor's, never the added approver's.** The membership in the request is the person being
   * brought in; whoever issues the command is resolved from the request context, and there is no
   * field through which a caller could name themselves or anybody else as the actor.
   *
   * It is deliberately **not** in `DELEGABLE_SCOPES`. A delegation lets somebody decide in your
   * place, and nobody approved letting somebody widen an approval in your place.
   */
  approvalEscalate: 'workflow.approval.escalate',

  /** Reading the approval groups a tenant keeps, and who is on them. */
  groupRead: 'workflow.group.read',
  /** Naming a list, and changing who is on it. Never implied by `definition.manage`. */
  groupManage: 'workflow.group.manage',
} as const;

export type WorkflowPermission = (typeof WorkflowPermissions)[keyof typeof WorkflowPermissions];

export const ALL_WORKFLOW_PERMISSIONS: readonly string[] = Object.values(WorkflowPermissions);

/**
 * The delegation scope Workflow agrees to honour.
 *
 * Identity stores `scope` as an opaque string and says so: *"it is not interpreted here: this module
 * would have to know what every future domain's operations are to interpret it."* The consuming
 * domain agrees the key, so Workflow's key is **its own permission name** — a delegation granted for
 * `leave.approve` does not let somebody decide a workflow step, and `*` does.
 *
 * Reusing the permission name rather than minting a vocabulary is the point: there is nothing here
 * for a tenant to learn beyond what they already grant.
 */
export const DELEGABLE_SCOPES: readonly string[] = [WorkflowPermissions.approvalDecide, '*'];
