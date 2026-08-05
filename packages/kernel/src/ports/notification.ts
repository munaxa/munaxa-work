/**
 * Notifications, as a port (ADR-0024).
 *
 * Communications is Phase 17. Every domain before it needs to tell someone something, and none
 * of them may own a channel, a template or a delivery guarantee.
 *
 * A domain says *what happened and to whom*. It never says "send an email": the channel is the
 * recipient's preference and the tenant's configuration, and a domain that names one has taken
 * a decision that is not its to take.
 */

export interface NotificationRecipient {
  /** A workforce user. Addresses and channel preferences are resolved by Communications. */
  readonly userId: string;
}

export interface NotificationRequest {
  /** The template to render — `leave.request.approved`. Content is not the domain's business. */
  readonly templateKey: string;
  readonly recipients: readonly NotificationRecipient[];
  /** Values the template may interpolate. Already permission-filtered by the caller. */
  readonly variables: Readonly<Record<string, string | number>>;
  readonly correlationId: string;
  /** Set when the same event may be raised twice; delivery is suppressed for a repeat. */
  readonly idempotencyKey?: string;
}

export interface NotificationPort {
  notify(request: NotificationRequest): Promise<void>;
}
