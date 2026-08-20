import type { NotificationPort, NotificationRequest } from '@work/kernel';

import type { ReminderRecipient, ReminderRecipientPort } from './workflow-reminder-recipient.js';

/**
 * The two seams Phase 16E's automatic reminder reaches through, faked for the application suites.
 *
 * They live apart from the rest of the harness because both exist to be *made to fail*: an Identity
 * that cannot answer, and a Communications that is unreachable after the reminder has already been
 * claimed. Those failures are the whole of what the approved ordering leaves open, and a suite that
 * could not reproduce them could not prove the claim survives them.
 */

/**
 * Who a reminder is addressed to, for the application suites.
 *
 * `asked` is recorded so a suite can prove the lookup happened **once, for the membership the step
 * names** — and, just as usefully, that it did not happen at all when the reminder was refused, which
 * is what proves the recipient is resolved after the claim rather than before it.
 */
export class FakeReminderRecipient implements ReminderRecipientPort {
  public readonly asked: string[] = [];
  private failure: Error | undefined;

  public failsWith(error: Error): void {
    this.failure = error;
  }

  public recipient(membershipId: string): Promise<ReminderRecipient> {
    this.asked.push(membershipId);
    if (this.failure !== undefined) return Promise.reject(this.failure);
    return Promise.resolve({ workforceUserId: `user-for-${membershipId}` });
  }
}

/**
 * Where a reminder's intent goes, for the application suites.
 *
 * Records what was emitted, and can be made to fail — which the kernel's own recorder cannot, and
 * should not: the failure this models is Communications being unreachable *after* the reminder has
 * been claimed, which is the one window the approved ordering deliberately leaves open. A suite that
 * could not reproduce it could not prove the claim survives it.
 *
 * The duplicate suppression mirrors the real port's: an intent repeating an `idempotencyKey` already
 * seen is dropped rather than recorded twice.
 */
export class FakeNotifications implements NotificationPort {
  public readonly sent: NotificationRequest[] = [];
  private failure: Error | undefined;

  public failsWith(error: Error): void {
    this.failure = error;
  }

  public recovers(): void {
    this.failure = undefined;
  }

  public notify(request: NotificationRequest): Promise<void> {
    if (this.failure !== undefined) return Promise.reject(this.failure);

    const duplicate =
      request.idempotencyKey !== undefined &&
      this.sent.some((previous) => previous.idempotencyKey === request.idempotencyKey);

    if (!duplicate) this.sent.push(request);
    return Promise.resolve();
  }
}
