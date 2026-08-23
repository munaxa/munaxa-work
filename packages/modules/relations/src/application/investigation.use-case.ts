import {
  err,
  success,
  uuidV7,
  type Command,
  type CommandHandler,
  type HandlerFailure,
  type Result,
  type Transaction,
} from '@work/kernel';

import { recordTransition, type CaseEventState } from '../domain/case-event.js';
import { concludeInvestigation, openInvestigation } from '../domain/investigation.js';
import type { CaseState } from '../domain/relations-vocabulary.js';
import {
  conflicted,
  currentActor,
  currentCorrelationId,
  notFound,
  refusedBy,
} from './relations-context.js';
import { RelationsPermissions } from './relations-permissions.js';
import type { RelationsDependencies } from './relations-dependencies.js';

/**
 * Opening and concluding an inquiry — the two things Checkpoint 2 can do to a case.
 *
 * **The lifecycle moves here and nowhere else.** Each command writes an investigation row *and* a
 * case-event row, inside one transaction, so a case cannot end up with an inquiry that no transition
 * records or a transition no inquiry caused. D-5.2-17 asks for atomicity by name; this is it.
 *
 * **The current state is read from persisted history, never from the request** (D-5.2-16, D-5.2-17).
 * Neither command carries a `from` state. The handler reads the case's events, derives where the case
 * actually is, and validates the requested move against that — so a caller cannot name the state that
 * would make their transition legal.
 *
 * **`relation_violation` is never touched.** It stays immutable exactly as Checkpoint 1 left it
 * (D-5.2-03, not reopened): no update, no state column changed, no trigger weakened. The case moves;
 * the record of what was reported does not.
 *
 * **Nothing here is automatic.** No timer opens an investigation, no scheduler concludes one, no
 * expiry moves a case along. Every transition in this module is a named human doing something
 * (ADR-0045), and there is no machine actor that could do it instead.
 *
 * **Both commands use the permissions Checkpoint 1 already defined.** Opening and concluding an
 * inquiry are the disciplinary-handling capability `relations.violation.record` already names, and no
 * new permission was unavoidable — so none was created. The case for separating them is recorded as
 * an open decision rather than implemented (D-5.2-18).
 */

export interface OpenInvestigationCommand extends Command {
  readonly commandName: 'relations.open-investigation';
  readonly violationId: string;
  /** The membership conducting the inquiry. Verified against Identity; never resolved to a person. */
  readonly investigatorMembershipId: string;
  /** The civil date the inquiry opened, `YYYY-MM-DD`. */
  readonly openedOn: string;
  readonly subject: string;
  /** Why the case is moving. Required, and recorded on the transition. */
  readonly reason: string;
}

export interface InvestigationOpened {
  readonly investigationId: string;
}

export const openInvestigationHandler = (
  dependencies: RelationsDependencies,
): CommandHandler<OpenInvestigationCommand, InvestigationOpened> => ({
  commandName: 'relations.open-investigation',
  permission: RelationsPermissions.violationRecord,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const violation = await dependencies.stores.violations.byId(transaction, command.violationId);

      // Another tenant's violation answers exactly as one that never existed. See `relations-context`.
      if (violation === undefined) return notFound<InvestigationOpened>('violation');

      const investigator = await dependencies.memberships.canAct(command.investigatorMembershipId);

      if (!investigator) return notFound<InvestigationOpened>('membership');

      const already = await dependencies.stores.investigations.openFor(
        transaction,
        command.violationId,
      );

      // The refusal a caller normally meets. It is *not* what makes one-open-per-violation true —
      // the partial unique index is, because this read decides nothing under concurrency (ADR-0071).
      if (already !== undefined) {
        return conflicted<InvestigationOpened>('investigation_already_open');
      }

      const now = dependencies.clock.now();
      const opened = openInvestigation({
        investigationId: uuidV7(),
        violationId: command.violationId,
        investigatorMembershipId: command.investigatorMembershipId,
        openedOn: command.openedOn,
        subject: command.subject,
        today: civilDateOf(now),
      });

      if (!opened.ok) return refusedBy<InvestigationOpened>(opened.error);

      const moved = await moveCase(dependencies, transaction, {
        violationId: command.violationId,
        toState: 'under_investigation',
        reason: command.reason,
        occurredAt: now,
        investigationId: opened.value.investigationId,
      });

      // The transition's own refusal, re-typed for this command's result. Re-wrapped rather than
      // asserted, so the compiler keeps checking both sides.
      if (!moved.ok) return err<HandlerFailure, InvestigationOpened>(moved.error);

      await dependencies.stores.investigations.insert(transaction, opened.value);
      return success({ investigationId: opened.value.investigationId });
    }),
});

export interface ConcludeInvestigationCommand extends Command {
  readonly commandName: 'relations.conclude-investigation';
  readonly investigationId: string;
  readonly findings: string;
  /** What the investigator suggests. **Text.** Nothing in this product acts on it. */
  readonly recommendation: string;
  readonly concludedOn: string;
  readonly reason: string;
}

export interface InvestigationConcluded {
  readonly investigationId: string;
}

export const concludeInvestigationHandler = (
  dependencies: RelationsDependencies,
): CommandHandler<ConcludeInvestigationCommand, InvestigationConcluded> => ({
  commandName: 'relations.conclude-investigation',
  permission: RelationsPermissions.violationRecord,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const held = await dependencies.stores.investigations.byId(
        transaction,
        command.investigationId,
      );

      if (held === undefined) return notFound<InvestigationConcluded>('investigation');

      const now = dependencies.clock.now();
      const concluded = concludeInvestigation({
        investigation: held,
        findings: command.findings,
        recommendation: command.recommendation,
        concludedOn: command.concludedOn,
        today: civilDateOf(now),
      });

      if (!concluded.ok) return refusedBy<InvestigationConcluded>(concluded.error);

      const moved = await moveCase(dependencies, transaction, {
        violationId: held.violationId,
        toState: 'findings',
        reason: command.reason,
        occurredAt: now,
        investigationId: held.investigationId,
      });

      if (!moved.ok) return err<HandlerFailure, InvestigationConcluded>(moved.error);

      // `held.version` rather than a number the command supplied: a caller cannot claim to have seen
      // a version they did not read. The trigger refuses this outright once the row has concluded.
      await dependencies.stores.investigations.update(transaction, concluded.value, held.version);
      return success({ investigationId: concluded.value.investigationId });
    }),
});

interface CaseMove {
  readonly violationId: string;
  readonly toState: CaseState;
  readonly reason: string;
  readonly occurredAt: Date;
  readonly investigationId: string;
}

/**
 * Move the case, or refuse — the one place a transition is decided.
 *
 * Both commands go through here so the derivation of "where is this case" and the validation of
 * "may it go there" exist once. The history comes from the store inside the caller's transaction, so
 * what is validated is what is committed against.
 */
const moveCase = async (
  dependencies: RelationsDependencies,
  transaction: Transaction,
  move: CaseMove,
): Promise<Result<CaseEventState, HandlerFailure>> => {
  const history = await dependencies.stores.caseEvents.forViolation(transaction, move.violationId);
  const transition = recordTransition({
    caseEventId: uuidV7(),
    violationId: move.violationId,
    history,
    toState: move.toState,
    reason: move.reason,
    // Never from the command. See `relations-context.ts`.
    actor: currentActor(),
    occurredAt: move.occurredAt,
    correlationId: currentCorrelationId(),
    investigationId: move.investigationId,
  });

  if (!transition.ok) return refusedBy<CaseEventState>(transition.error);

  await dependencies.stores.caseEvents.insert(transaction, transition.value);
  return success(transition.value);
};

/**
 * The civil date at an instant, in UTC — the same helper, and the same stated limitation, as
 * `violation.use-case.ts`. Near midnight far from UTC, "today" here may differ from "today" there by
 * a day. Reading a tenant's time zone is a cross-module contract no checkpoint has been authorized to
 * open; duplicating the limitation is honest, inventing a per-request offset would not be.
 */
const civilDateOf = (instant: Date): string => instant.toISOString().slice(0, 10);
