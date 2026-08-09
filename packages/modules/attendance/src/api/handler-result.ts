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
 * A record in another tenant is **404, not 403**. "Forbidden" on an attendance identifier would
 * confirm that a named person's attendance exists in this system, which is itself a disclosure.
 *
 * **A conflict here is never ingestion's idempotency.** Recording a punch that already exists
 * returns 200 with `alreadyRecorded: true`, not 409: a punch clock retries, and an idempotent
 * endpoint whose retry fails is not idempotent. What reaches this branch is a genuine conflict — a
 * shift code already taken, a published definition somebody tried to edit, a rota entry that
 * already exists on that date.
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
      // on "you need attendance.approve"; it reveals nothing about the data.
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
