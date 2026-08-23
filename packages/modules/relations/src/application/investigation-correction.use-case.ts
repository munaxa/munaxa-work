import { success, uuidV7, type Command, type CommandHandler } from '@work/kernel';

import { correctInvestigation } from '../domain/investigation.js';
import { conflicted, notFound, refusedBy } from './relations-context.js';
import { RelationsPermissions } from './relations-permissions.js';
import type { RelationsDependencies } from './relations-dependencies.js';

/**
 * Correcting a concluded investigation — D-5.2-19, approved 2026-08-23.
 *
 * **The corrected row is never written to.** Not updated, not soft-deleted, not stamped, not
 * re-pointed. A correction is a *new* investigation carrying `correctsInvestigationId`, and the
 * concluded one it names stays byte-for-byte what its investigator wrote. That is why the
 * Checkpoint 2 trigger needed no exception and D-5.2-17 is not reopened — the difference from
 * `letter_issued`, which stamps a forward pointer on the original and had to narrow its trigger to
 * permit exactly one write.
 *
 * **Which conclusion stands is derived, not stored.** `operativeConclusion` reads the chain and
 * returns the concluded investigation nobody has corrected. There is no `is_current` flag and no
 * `superseded_at`: a second copy is a second thing that can disagree, which is what ADR-0070 warns
 * about and what D-5.2-16 already settled for case state.
 *
 * **The chain is linear, and the database is what makes it so.**
 * `relation_investigation_corrects_idx` is unique on `(tenant_id, corrects_investigation_id)`, so two
 * administrators correcting one conclusion at the same moment do not both succeed — the index
 * arbitrates, because the read that precedes the insert decides nothing under concurrency
 * (ADR-0071). The refusal below is the readable answer for the ordinary case, not the guarantee.
 *
 * **No case transition.** A correction restates findings; it does not move the case, which is
 * already at `findings` and stays there. Inventing a transition would be inventing a business state,
 * and `PERMITTED_CASE_TRANSITIONS` is unchanged.
 *
 * **It is audited by being a record.** The correction row carries its own actor, its own timestamps
 * and its required reason, and it is as immutable as the conclusion it corrects the moment it is
 * written. No second audit system is created.
 */

export interface CorrectInvestigationCommand extends Command {
  readonly commandName: 'relations.correct-investigation';
  /** The concluded investigation being corrected. */
  readonly investigationId: string;
  readonly findings: string;
  readonly recommendation: string;
  readonly concludedOn: string;
  /** Why the earlier conclusion was wrong. Required. */
  readonly reason: string;
}

export interface InvestigationCorrected {
  readonly investigationId: string;
  /** The one it corrects, echoed so a caller can follow the chain without a second read. */
  readonly correctsInvestigationId: string;
}

export const correctInvestigationHandler = (
  dependencies: RelationsDependencies,
): CommandHandler<CorrectInvestigationCommand, InvestigationCorrected> => ({
  commandName: 'relations.correct-investigation',
  // Conducting an inquiry, not reading one. Correcting a conclusion is the same capability as
  // reaching it, and it deliberately does **not** imply `read-findings`.
  permission: RelationsPermissions.investigationConduct,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const corrected = await dependencies.stores.investigations.byId(
        transaction,
        command.investigationId,
      );

      // Another tenant's investigation answers exactly as one that never existed — row-level
      // security has already filtered it, so this is not a second check but the same one surfacing.
      if (corrected === undefined) return notFound<InvestigationCorrected>('investigation');

      const chain = await dependencies.stores.investigations.chainFor(
        transaction,
        corrected.violationId,
      );

      // The readable refusal for the ordinary case. `relation_investigation_corrects_idx` is what
      // actually settles two simultaneous corrections; this read settles none of them.
      if (chain.some((held) => held.correctsInvestigationId === corrected.investigationId)) {
        return conflicted<InvestigationCorrected>('investigation_already_corrected');
      }

      const now = dependencies.clock.now();
      const correction = correctInvestigation({
        investigationId: uuidV7(),
        corrected,
        findings: command.findings,
        recommendation: command.recommendation,
        concludedOn: command.concludedOn,
        reason: command.reason,
        today: civilDateOf(now),
      });

      if (!correction.ok) return refusedBy<InvestigationCorrected>(correction.error);

      // An insert, and only an insert. There is no `update` call anywhere on this path, which is the
      // whole of D-5.2-19 expressed as code rather than as a comment.
      await dependencies.stores.investigations.insert(transaction, correction.value);

      return success({
        investigationId: correction.value.investigationId,
        correctsInvestigationId: corrected.investigationId,
      });
    }),
});

/** The civil date at an instant, in UTC — the same helper and the same stated limitation as its two siblings. */
const civilDateOf = (instant: Date): string => instant.toISOString().slice(0, 10);
