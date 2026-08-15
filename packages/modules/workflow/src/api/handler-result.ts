import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { HandlerFailure, Result } from '@work/kernel';

/**
 * One translation from a handler failure to an HTTP status, used by every controller in the module.
 *
 * Written once because the mapping is a contract, not a per-endpoint decision. The distinction that
 * matters most is between 400 and 422: a malformed request is the client's mistake and it can fix it
 * by sending different bytes, whereas a refused business rule is a well-formed request the domain
 * declined — resending it unchanged will always fail, and a client that saw 400 would retry with a
 * different payload forever.
 *
 * **A record the caller may not see is 404, not 403**, and this function must not soften it on the
 * way out. In this module that is not a style preference. The list of approvals waiting on a named
 * director tells a reader what that organization is deciding this week, and answering *forbidden* on
 * an instance identifier confirms that an approval exists for that subject — which is most of the
 * disclosure. The application decides it and answers `not_found`; the wire says *No such
 * workflow-instance.*
 *
 * **No message this function produces carries a comment, a rationale or an approver's name.** A
 * rejection's text reaches logs, error trackers and a screen somebody left open, and "rejected by
 * the finance director" is a disclosure about a colleague's decision that the person refused was
 * never entitled to.
 *
 * A **rejection's reason is a catalogue key**, not a sentence — `workflow.rejection.step-not-awaiting-a-decision`
 * and the like — so the portal renders it in the reader's language and nothing here hard-codes
 * English at the edge.
 *
 * An **optimistic concurrency failure is a 409, never a 500.** `ConcurrencyException` is thrown from
 * the repository and travels to the shared `ProblemDetailsFilter`, which maps it — the fix Phase 13
 * made once, in the shared filter, so every module inherits it and no module needs a copy. This one
 * does not add a filter of its own.
 *
 * The global Problem Details filter turns whichever exception this throws into RFC 9457, so nothing
 * internal leaves with it — no stack trace, no SQL, no table name.
 */
export const unwrapOrThrow = <TValue>(result: Result<TValue, HandlerFailure>): TValue => {
  if (result.ok) return result.value;

  switch (result.error.kind) {
    case 'validation':
      throw new BadRequestException(
        result.error.failures.map((failure) => `${failure.field}: ${failure.message}`).join('; '),
      );
    case 'forbidden':
      // The permission is named because the caller is authenticated and an administrator can act on
      // "you need workflow.approval.decide"; it reveals nothing about the data.
      throw new ForbiddenException(`Requires ${result.error.permission}.`);
    case 'not_found':
      throw new NotFoundException(`No such ${result.error.resource}.`);
    case 'conflict':
      throw new ConflictException(result.error.reason);
    case 'rejected':
      throw new UnprocessableEntityException(result.error.reason);
  }
};
