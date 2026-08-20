/**
 * The third cross-module read: whether the person somebody wants to add may act at all.
 *
 * **One method, one question, one bit.** Not "who is in this tenant", not "tell me about this
 * member", not "find somebody matching" — one membership identifier in, one predicate out. That
 * narrowness is the whole authorization for this port's existence (D-16D-11, D-16D-12): a member
 * directory is precisely the capability this product has committed never to build, and a port that
 * could enumerate or search would be its first implementation.
 *
 * **Workflow does not know what Identity stores.** There is no `TenantMembership` here, no status, no
 * lifecycle and no vocabulary of suspension — those are Identity's, and `isActingMembership` is
 * Identity's rule for reading them. What crosses the boundary is the rule's *answer*. A port that
 * carried the status would have made this module decide whether `suspended` counts, which is a second
 * definition of "active" in a module that owns neither the field nor the rule.
 *
 * **A failure is not an answer.** If Identity cannot be asked, the adapter raises rather than
 * returning `false`: reporting an outage as "this person may not act" would refuse every escalation
 * in the tenant while telling each administrator to go and look at a membership that is perfectly
 * fine, and nothing would record that a dependency was down. `WorkflowDelegations` and
 * `WorkflowReportingLine` both draw this line, and it is the one that matters most here — of the four
 * things Identity can say, this is the only one where guessing fails **open** in one direction and
 * silently in the other.
 *
 * **`false` already means two things, and that is approved rather than accidental.** Identity
 * distinguishes a membership that exists and may not act from an identifier that names nobody; D-16D-17
 * (option A) decided Workflow publishes one refusal for both, so the collapse happens in the adapter
 * — at Workflow's edge, where the decision was made — and never inside Identity's contract.
 */
export interface MembershipStanding {
  /** Whether this membership may act now. Identity's `isActingMembership`, already applied. */
  readonly active: boolean;
}

export interface MembershipStandingPort {
  /**
   * Whether the membership may be asked to decide something, in the caller's own tenant.
   *
   * **Raises** when Identity cannot answer. Never returns `false` to mean "I could not tell".
   */
  standing(membershipId: string): Promise<MembershipStanding>;
}
