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
 * way out. In this module that is not a style preference. A succession plan for a named position is
 * a list of people somebody thinks could replace its holder, and "you may not see this bench"
 * confirms the bench exists — which is most of the disclosure. The application decides it and
 * answers `not_found`; the wire says *No such career_succession_plan.*
 *
 * **No message this function produces carries a rationale, a note or a name.** A refusal names the
 * resource and the rule. A rejection's text ends up in logs and error trackers, and "not ready for a
 * director role" written about a colleague is as disclosing as any salary in this product.
 *
 * A **rejection's reason is a catalogue key**, not a sentence — `career.rejection.plan-not-active`
 * and the like — so the portal renders it in the reader's language and nothing here hard-codes
 * English at the edge.
 *
 * An **optimistic concurrency failure is a 409, never a 500.** `ConcurrencyException` is thrown from
 * the repository and travels to the shared `ProblemDetailsFilter`, which maps it — the fix Phase 13
 * made once, in the shared filter, so every module inherits it and no module needs a copy.
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
      // "you need career.successor.confirm"; it reveals nothing about the data.
      throw new ForbiddenException(`Requires ${result.error.permission}.`);
    case 'not_found':
      throw new NotFoundException(`No such ${result.error.resource}.`);
    case 'conflict':
      throw new ConflictException(result.error.reason);
    case 'rejected':
      throw new UnprocessableEntityException(result.error.reason);
  }
};
