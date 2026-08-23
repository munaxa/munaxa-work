import { success, uuidV7, type Command, type CommandHandler, type Transaction } from '@work/kernel';

import { applicableRule, type DisciplinaryRuleState } from '../domain/disciplinary-ladder.js';
import { issueDisciplinaryAction } from '../domain/disciplinary-action.js';
import { occurrenceOf, windowStart } from '../domain/escalation.js';
import { operativeConclusion } from '../domain/investigation.js';
import { recordTransition, type CaseEventState } from '../domain/case-event.js';
import type { RelationsResult } from '../domain/relations-rejection.js';
import {
  conflicted,
  currentActor,
  currentCorrelationId,
  notFound,
  refusedBy,
} from './relations-context.js';
import { RelationsPermissions } from './relations-permissions.js';
import type { ViolationRecord } from '../domain/violation.js';
import type { RelationsDependencies } from './relations-dependencies.js';

/**
 * Issuing a disciplinary action — a named human's decision, recorded.
 *
 * **Nothing is automatic.** No violation, no repeat count and no ladder rule causes this to run;
 * somebody holding `relations.action.issue` asks for it. The ladder prescribes and this records —
 * D-5.2-20's approved separation, expressed as two different operations with two different
 * permissions.
 *
 * **Nothing is executed.** This suspends no employment, ends none, deducts no pay, starts no
 * approval, sends no notification and writes to no other module. The two most serious rungs are
 * recommendations because Employment executes those through its own lifecycle (AD-005), and Payroll
 * is pull-oriented and untouched.
 *
 * **It requires a concluded inquiry.** The specification's lifecycle runs Findings → Action Issued,
 * and an action with no findings behind it is the decision a tribunal sets aside first. The case must
 * be at `findings`, which is derived from persisted history rather than claimed by the caller.
 *
 * **A corrected conclusion is the one that counts.** `operativeConclusion` returns the conclusion
 * nobody has corrected, so an action issued after a correction rests on the corrected findings — and
 * neither investigation is mutated by any of it (D-5.2-19).
 *
 * **The prescription is recomputed here, not trusted from the caller.** A request cannot name the
 * rule that justifies it: the server derives the occurrence, reads the tenant's ladder and freezes
 * what it found. A caller may still issue an action the ladder did not prescribe — recorded as such —
 * because a system that overrode a human's judgement would be the punishment engine this forbids.
 */

export interface IssueDisciplinaryActionCommand extends Command {
  readonly commandName: 'relations.issue-disciplinary-action';
  readonly violationId: string;
  /** What is being issued. Checked against the ladder, but never overridden by it. */
  readonly action: string;
  readonly issuedOn: string;
  readonly reason: string;
}

export interface DisciplinaryActionIssued {
  readonly disciplinaryActionId: string;
  readonly prescribedByRule: boolean;
}

export const issueDisciplinaryActionHandler = (
  dependencies: RelationsDependencies,
): CommandHandler<IssueDisciplinaryActionCommand, DisciplinaryActionIssued> => ({
  commandName: 'relations.issue-disciplinary-action',
  permission: RelationsPermissions.actionIssue,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const violation = await dependencies.stores.violations.byId(transaction, command.violationId);

      if (violation === undefined) return notFound<DisciplinaryActionIssued>('violation');

      const chain = await dependencies.stores.investigations.chainFor(
        transaction,
        command.violationId,
      );
      const conclusion = operativeConclusion(chain);

      // No concluded inquiry, no action. Refused as a business rule so the caller reads why.
      if (conclusion === undefined) {
        return conflicted<DisciplinaryActionIssued>('no_concluded_investigation');
      }

      const already = await dependencies.stores.disciplinaryActions.forViolation(
        transaction,
        command.violationId,
      );

      // One action per case. The unique index settles the race; this is the readable refusal.
      if (already !== undefined) {
        return conflicted<DisciplinaryActionIssued>('action_already_issued');
      }

      const now = dependencies.clock.now();
      const occurrence = await prescriptionFor(dependencies, transaction, violation);

      if (occurrence === undefined) return notFound<DisciplinaryActionIssued>('violation_category');

      const prescribing = occurrence.rule?.action === command.action ? occurrence.rule : undefined;
      const issued = issueDisciplinaryAction({
        disciplinaryActionId: uuidV7(),
        violationId: command.violationId,
        investigationId: conclusion.investigationId,
        action: command.action,
        // Recomputed from the tenant's configuration, never supplied — and attached **only when the
        // ladder prescribed the action actually being issued**. A rule that prescribes something
        // else did not prescribe this, so the record says `prescribedByRule: false` and links no
        // rule: a human departing from the ladder is judgement, not an error, and the row must not
        // claim a provenance it does not have. The domain refuses a mismatched pair as a backstop.
        ...(prescribing === undefined ? {} : { rule: prescribing }),
        occurrenceAtIssue: occurrence.occurrences,
        reason: command.reason,
        // Never from the command. See `relations-context.ts`.
        issuedBy: currentActor(),
        issuedOn: command.issuedOn,
        issuedAt: now,
        correlationId: currentCorrelationId(),
        today: civilDateOf(now),
      });

      if (!issued.ok) return refusedBy<DisciplinaryActionIssued>(issued.error);

      // Validated against the state the server derives — a case not at `findings` is refused here,
      // which is what makes "an action requires a conclusion" true of the lifecycle and not just of
      // the read above.
      const moved = await moveToActionIssued(dependencies, transaction, {
        violationId: command.violationId,
        reason: command.reason,
        occurredAt: now,
        investigationId: conclusion.investigationId,
      });

      if (!moved.ok) return refusedBy<DisciplinaryActionIssued>(moved.error);
      await dependencies.stores.disciplinaryActions.insert(transaction, issued.value);

      return success({
        disciplinaryActionId: issued.value.disciplinaryActionId,
        prescribedByRule: issued.value.prescribedByRule,
      });
    }),
});

interface CaseMove {
  readonly violationId: string;
  readonly reason: string;
  readonly occurredAt: Date;
  readonly investigationId: string;
}

/**
 * The one transition this checkpoint adds, `findings → action_issued`.
 *
 * Extracted when the handler passed the 60-line function budget — split, not exempted. It uses the
 * existing validated-transition mechanism rather than anything new: the from-state is derived from
 * persisted history, and a case not at `findings` is refused by name.
 */
const moveToActionIssued = async (
  dependencies: RelationsDependencies,
  transaction: Transaction,
  move: CaseMove,
): Promise<RelationsResult<CaseEventState>> => {
  const history = await dependencies.stores.caseEvents.forViolation(transaction, move.violationId);
  const moved = recordTransition({
    caseEventId: uuidV7(),
    violationId: move.violationId,
    history,
    toState: 'action_issued',
    reason: move.reason,
    // Never from the command. See `relations-context.ts`.
    actor: currentActor(),
    occurredAt: move.occurredAt,
    correlationId: currentCorrelationId(),
    investigationId: move.investigationId,
  });

  if (!moved.ok) return moved;

  await dependencies.stores.caseEvents.insert(transaction, moved.value);
  return moved;
};

interface Prescription {
  readonly occurrences: number;
  readonly rule?: DisciplinaryRuleState;
}

/**
 * The derived repeat context and what the tenant's ladder makes of it — **read, never stored**.
 *
 * **Measured from the violation's own conduct date**, using Checkpoint 3's `occurrenceOf` rather
 * than a second count. That matters here more than it does on a screen: an action issued today for
 * conduct eighteen months ago must record the ordinal that conduct *had*, not the ordinal it would
 * have if counted from today — which, for an old violation, is often zero, because it has fallen out
 * of its own window. An earlier draft clamped that to 1 with `Math.max`, which would have written a
 * plausible number nobody could justify. This asks the right question instead.
 *
 * `undefined` when the category cannot be read or the violation is somehow not among its own
 * window's violations; both are refused rather than guessed.
 */
const prescriptionFor = async (
  dependencies: RelationsDependencies,
  transaction: Transaction,
  violation: ViolationRecord,
): Promise<Prescription | undefined> => {
  const category = await dependencies.stores.categories.byId(
    transaction,
    violation.violationCategoryId,
  );

  if (category === undefined) return undefined;

  const from = windowStart(violation.occurredOn, category.repeatWindowDays);
  const violations = await dependencies.stores.violations.inCategoryWindow(
    transaction,
    violation.employmentId,
    violation.violationCategoryId,
    { from, to: violation.occurredOn },
  );
  const occurrences = occurrenceOf(violation, category.repeatWindowDays, violations);

  if (occurrences === undefined) return undefined;

  const rules = await dependencies.stores.disciplinaryRules.forCategory(
    transaction,
    violation.violationCategoryId,
    false,
  );
  const rule = applicableRule(rules, occurrences);

  return { occurrences, ...(rule === undefined ? {} : { rule }) };
};

/** The civil date at an instant, in UTC — the same helper and stated limitation as its siblings. */
const civilDateOf = (instant: Date): string => instant.toISOString().slice(0, 10);
