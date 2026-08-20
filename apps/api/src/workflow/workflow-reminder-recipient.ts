import { runWithServiceGrant, type HandlerFailure, type Query, type Result } from '@work/kernel';
import type { ReminderRecipient, ReminderRecipientPort } from '@work/workflow';
import type { MembershipRecipientView } from '@work/identity';

import type { Asking } from '../payroll/asking.js';

/**
 * Which workforce user to address an automatic reminder to.
 *
 * **One question, one query, one grant.** No chain, no loop, no enumeration and no second read: the
 * membership already named on the overdue step goes in, the workforce user it belongs to comes out.
 * `WorkflowMembershipStanding` beside it has exactly this shape, for exactly this reason — Identity
 * was asked to publish this one fact and nothing beside it.
 *
 * **`identity.membership.read`, and no permission was added for it.** Which user a membership belongs
 * to is the register's own field, so the register's read permission is the narrowest one that means
 * it, and `identity.membership-recipient` exists so that holding it returns one identifier rather
 * than a member's whole page. The user never holds it — and here there *is* no user: the grant is
 * entered inside a handler the pipeline authorized for `workflow.reminder.execute`, under a machine
 * execution identity. The elevation record names that identity rather than a person, which is what
 * makes "what did Workflow read inside Identity, and on whose authority" answerable for automatic
 * work at all.
 *
 * **Every failure raises, including `not_found`.** This is the one place that differs from the
 * standing adapter beside it, and the difference is deliberate. There, `not_found` collapses into a
 * refusal by an approved decision (D-16D-17) because "may not act" and "names nobody" lead to the same
 * outcome. Here they do not: a reminder with no recipient is not a reminder, and there is nothing safe
 * to fall back to — an empty identifier, the requester, the execution identity would each send
 * somebody else's mail. So the command aborts, the transaction has already committed its claim, and
 * the reminder is simply not delivered. That is the at-most-once guarantee doing what it says rather
 * than a failure being hidden.
 */

/** The one permission this adapter ever holds inside another module. */
const MEMBERSHIP_READ = 'identity.membership.read';

interface MembershipRecipientQuery extends Query {
  readonly queryName: 'identity.membership-recipient';
  readonly membershipId: string;
}

/** The dispatcher's `ask`, with the query's own shape kept for the compiler to check. */
const asking = <TResult, TQuery extends Query>(
  dispatcher: Asking,
  query: TQuery,
): Promise<Result<TResult, HandlerFailure>> => dispatcher.ask<TResult>(query);

export class WorkflowReminderRecipient implements ReminderRecipientPort {
  public constructor(private readonly dispatcher: Asking) {}

  public async recipient(membershipId: string): Promise<ReminderRecipient> {
    const answered: Result<MembershipRecipientView, HandlerFailure> = await runWithServiceGrant(
      {
        module: 'workflow',
        operation: 'read-membership-recipient',
        permits: [MEMBERSHIP_READ],
        reason:
          'An automatic reminder is addressed to the approver a step already names, and a ' +
          'notification is delivered to the workforce user that membership belongs to.',
      },
      () =>
        asking<MembershipRecipientView, MembershipRecipientQuery>(this.dispatcher, {
          queryName: 'identity.membership-recipient',
          membershipId,
        }),
    );

    if (answered.ok) return { workforceUserId: answered.value.workforceUserId };

    throw new Error(
      `Identity could not name the recipient of a workflow reminder: ${answered.error.kind}`,
    );
  }
}
