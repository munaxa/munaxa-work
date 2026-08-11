import { success, uuidV7, type Command, type CommandHandler, type Transaction } from '@work/kernel';

import { moveRequestTo, requestLetter } from '../domain/letter-generation.js';
import type { LetterRequestState } from '../domain/letter-generation.js';
import { approvalState, recordDecision } from '../domain/letter-approval.js';
import type { ApprovalDecisionState } from '../domain/letter-approval.js';
import type { LettersRejection } from '../domain/letters-rejection.js';
import type { LetterStatus } from '../domain/letters-vocabulary.js';
import { conflicted, currentActor, notFound, refusedBy } from './letters-context.js';
import { LettersPermissions } from './letters-permissions.js';
import type { LettersDependencies } from './letters-dependencies.js';

/**
 * Asking for a letter, and deciding whether it may be issued.
 *
 * **The template decides whether approval is needed, not the caller.** A request against a template
 * that requires approval starts in `pending_approval`; one against a template that does not starts
 * in `requested`. A requester cannot skip a control by asking differently.
 *
 * **Workflow is Phase 16 and does not exist.** This follows Compensation and Payroll exactly rather
 * than building a second workflow engine: the decision is recorded in this module's own table,
 * `decidedBy` comes from the authenticated context, self-approval is refused here and again by a
 * check constraint, and a wrong decision is *reversed* rather than edited (D-14).
 *
 * `system:auto-approval` appears nowhere. A salary certificate is a document a bank acts on, and one
 * approved by nobody is one nobody accepted responsibility for.
 */

export interface RequestLetterCommand extends Command {
  readonly commandName: 'letters.request';
  readonly letterTemplateId: string;
  readonly employmentId: string;
  readonly personId: string;
  readonly locale: string;
  readonly purpose?: string;
  readonly addressee?: string;
}

export interface LetterRequested {
  readonly letterRequestId: string;
  readonly status: string;
}

export const requestLetterHandler = (
  dependencies: LettersDependencies,
): CommandHandler<RequestLetterCommand, LetterRequested> => ({
  commandName: 'letters.request',
  permission: LettersPermissions.request,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const template = await dependencies.stores.templates.byId(
        transaction,
        command.letterTemplateId,
      );

      if (template === undefined) return notFound<LetterRequested>('letter_template');
      if (!template.active) return conflicted<LetterRequested>('letter_template_inactive');
      if (template.currentVersionId === undefined) {
        // A template nobody has published a version of has nothing to say.
        return conflicted<LetterRequested>('letter_template_has_no_published_version');
      }

      const version = await dependencies.stores.templateVersions.byId(
        transaction,
        template.currentVersionId,
      );

      if (version === undefined) return notFound<LetterRequested>('letter_template_version');

      const requested = requestLetter({
        letterRequestId: uuidV7(),
        template,
        templateVersion: version,
        employmentId: command.employmentId,
        personId: command.personId,
        locale: command.locale,
        requestedBy: currentActor(),
        requestedAt: dependencies.clock.now(),
        ...(command.purpose === undefined ? {} : { purpose: command.purpose }),
        ...(command.addressee === undefined ? {} : { addressee: command.addressee }),
      });

      if (!requested.ok) return refusedBy<LetterRequested>(requested.error);

      await dependencies.stores.requests.insert(transaction, requested.value);
      return success({
        letterRequestId: requested.value.letterRequestId,
        status: requested.value.status,
      });
    }),
});

export interface DecideLetterCommand extends Command {
  readonly commandName: 'letters.decide';
  readonly letterRequestId: string;
  readonly decision: string;
  readonly comment?: string;
  readonly reversesId?: string;
}

export interface LetterDecided {
  readonly letterRequestId: string;
  readonly decision: string;
  readonly status: string;
}

export const decideLetterHandler = (
  dependencies: LettersDependencies,
): CommandHandler<DecideLetterCommand, LetterDecided> => ({
  commandName: 'letters.decide',
  permission: LettersPermissions.approve,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const request = await dependencies.stores.requests.byId(transaction, command.letterRequestId);

      if (request === undefined) return notFound<LetterDecided>('letter_request');

      const held = await dependencies.stores.decisions.forRequest(
        transaction,
        request.letterRequestId,
      );
      const decision = recordDecision({
        approvalDecisionId: uuidV7(),
        letterRequestId: request.letterRequestId,
        sequence: held.length + 1,
        decision: command.decision,
        // Copied onto the row so the check constraint can compare them: a constraint cannot reach
        // another table, which is why Compensation and Payroll both carry it the same way.
        requestedBy: request.requestedBy,
        decidedBy: currentActor(),
        decidedAt: dependencies.clock.now(),
        ...(command.comment === undefined ? {} : { comment: command.comment }),
        ...(command.reversesId === undefined ? {} : { reversesId: command.reversesId }),
      });

      if (!decision.ok) return refusedBy<LetterDecided>(decision.error);

      await dependencies.stores.decisions.insert(transaction, decision.value);

      const moved = await applyChain(dependencies, transaction, request, [...held, decision.value]);

      if (!moved.ok) return refusedBy<LetterDecided>(moved.error);

      return success({
        letterRequestId: request.letterRequestId,
        decision: decision.value.decision,
        status: moved.value,
      });
    }),
});

/**
 * The request's status, re-derived from the whole chain rather than from the decision just made.
 *
 * A reversal does not erase what it reverses — the record keeps both — so "what does the chain say
 * now" is a question about every row, not about the latest one. Reading it any other way would let
 * a reversal of a rejection leave a request stuck in `rejected`.
 */
type ChainOutcome =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: LettersRejection };

const applyChain = async (
  dependencies: LettersDependencies,
  transaction: Transaction,
  request: LetterRequestState,
  decisions: readonly ApprovalDecisionState[],
): Promise<ChainOutcome> => {
  const standing = approvalState(decisions);
  const target: LetterStatus | undefined =
    standing === 'approved' ? 'approved' : standing === 'rejected' ? 'rejected' : undefined;

  if (target === undefined || request.status === target) {
    return { ok: true, value: request.status };
  }

  const moved = moveRequestTo(request, target);

  if (!moved.ok) return moved;
  await dependencies.stores.requests.update(transaction, moved.value, request.version);
  return { ok: true, value: moved.value.status };
};

export interface CancelLetterCommand extends Command {
  readonly commandName: 'letters.cancel';
  readonly letterRequestId: string;
  readonly expectedVersion: number;
}

/** Cancelling a request. An issued letter is terminal and is not reachable from here. */
export const cancelLetterHandler = (
  dependencies: LettersDependencies,
): CommandHandler<CancelLetterCommand, LetterRequested> => ({
  commandName: 'letters.cancel',
  permission: LettersPermissions.request,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const request = await dependencies.stores.requests.byId(transaction, command.letterRequestId);

      if (request === undefined) return notFound<LetterRequested>('letter_request');

      const moved = moveRequestTo(request, 'cancelled');

      if (!moved.ok) return refusedBy<LetterRequested>(moved.error);

      await dependencies.stores.requests.update(transaction, moved.value, command.expectedVersion);
      return success({
        letterRequestId: request.letterRequestId,
        status: moved.value.status,
      });
    }),
});
