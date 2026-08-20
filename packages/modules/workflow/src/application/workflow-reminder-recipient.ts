/**
 * Who to address a reminder to, for a membership this module already holds.
 *
 * **Workflow addresses memberships; a notification is delivered to a workforce user.** An approval is
 * asked of a *member*, because a person may hold memberships in several tenants and an approval
 * belongs to one (AD-005). Channel preferences belong to the *person*, because somebody with three
 * memberships has one inbox (ADR-0033). Something has to cross that boundary, and it is Identity's to
 * cross: `identity.membership-recipient` answers exactly this and nothing else.
 *
 * **One method, one identifier, one answer.** Nothing enumerable, nothing paged, and none of a
 * member's profile, employment, delegation or channel preferences. Workflow learns who to name and
 * learns nothing else about them — the same shape `MembershipStandingPort` took, for the same reason.
 *
 * **It answers *who*, never *whether*.** Eligibility is `MembershipStandingPort`'s question. A
 * reminder goes to whoever the step names; that they may still act is a different question, and
 * folding the two here would make an addressing lookup take a position on it.
 */
export interface ReminderRecipient {
  /** The workforce user the membership belongs to — what `NotificationRecipient` requires. */
  readonly workforceUserId: string;
}

export interface ReminderRecipientPort {
  /**
   * The workforce user for a membership, in the caller's own tenant.
   *
   * **Raises when Identity cannot answer, and raises when nobody is named.** Both are deliberate and
   * both differ from the standing port, where "we could not tell" collapses to a refusal by an
   * approved decision. Here there is nothing to collapse to: a reminder with no recipient is not a
   * reminder, and inventing one — an empty string, the requester, the actor — would send somebody
   * else's mail. The caller aborts before anything is written.
   */
  recipient(membershipId: string): Promise<ReminderRecipient>;
}
