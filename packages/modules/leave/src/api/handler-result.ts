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
 * matters most is between 400 and 422: a malformed request is the client's mistake and it can fix
 * it by sending different bytes, whereas a refused business rule is a well-formed request the
 * domain declined — resending it unchanged will always fail, and a client that saw 400 would retry
 * with a different payload forever.
 *
 * A record in another tenant is **404, not 403**. "Forbidden" on a leave request identifier would
 * confirm that somebody in this system asked for leave — and on a sick-leave request that is close
 * to a health disclosure.
 *
 * **A conflict here is never a bounded run's idempotency.** Re-running accrual for a period it has
 * already covered returns its counts with `entriesSkipped`, not 409: a run is meant to be safe to
 * retry, and an idempotent operation whose retry fails is not idempotent. What reaches this branch
 * is a genuine conflict — a leave-type code already taken, a policy assignment overlapping another,
 * a leave year already closed.
 *
 * The global Problem Details filter turns whichever exception this throws into RFC 9457, so nothing
 * internal leaks with it.
 */
export const unwrapOrThrow = <TValue>(result: Result<TValue, HandlerFailure>): TValue => {
  if (result.ok) return result.value;

  switch (result.error.kind) {
    case 'validation':
      throw new BadRequestException(
        result.error.failures.map((failure) => `${failure.field}: ${failure.message}`).join('; '),
      );
    case 'forbidden':
      // The permission is named because the caller is authenticated and an administrator can act
      // on "you need leave.approve"; it reveals nothing about the data.
      throw new ForbiddenException(`Requires ${result.error.permission}.`);
    case 'not_found':
      throw new NotFoundException(`No such ${result.error.resource}.`);
    case 'conflict':
      throw new ConflictException(result.error.reason);
    case 'rejected':
      // The reason is a catalogue key, so the portal renders it in the reader's language.
      throw new UnprocessableEntityException(result.error.reason);
  }
};
