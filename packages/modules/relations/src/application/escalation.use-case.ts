import { success, type Query, type QueryHandler } from '@work/kernel';

import { escalationContext, windowStart } from '../domain/escalation.js';
import { recordAccessFor } from './access-recording.js';
import { notFound, refusedBy } from './relations-context.js';
import { RelationsPermissions } from './relations-permissions.js';
import type { EscalationContextView } from '../contracts/views.js';
import type { RelationsDependencies } from './relations-dependencies.js';

/**
 * How many times before — Checkpoint 3's whole capability, and it is a query.
 *
 * **It makes `repeat_window_days` operational.** The setting has been tenant-configurable since
 * Checkpoint 1 and no logic has ever read it; this is the code that does. A customer who configures
 * 180 days now gets an answer measured over 180 days.
 *
 * **It persists nothing.** No occurrence counter, no repeat flag, no escalation level, no cached
 * result. The number is arithmetic over violations that already exist, computed at read time, and a
 * stored copy would be correct only until the next violation was recorded (ADR-0070).
 *
 * **It decides nothing.** It reports how many and over what window. It does not say what that means,
 * does not select a penalty, does not issue a warning, does not move the case and does not touch
 * Payroll. What a repeat *should produce* is D-5.2-20, deliberately still OPEN — and no disciplinary
 * action vocabulary exists in this module for it to reach for.
 *
 * **The window comes from the category, and the reference date from the server.** `asAt` is optional
 * and moves the window a caller is asking about; it moves no record, because nothing is written.
 *
 * **Audited, because it is a disciplinary disclosure** (AD-007). Asking how many times an employment
 * has done something is asking about their record, so each violation the count discloses is recorded
 * on the existing trail — one event per contributing violation, exactly as a listed read does.
 */

export interface ReadEscalationContext extends Query {
  readonly queryName: 'relations.escalation-context';
  readonly employmentId: string;
  readonly violationCategoryId: string;
  /** Optional reference civil date, `YYYY-MM-DD`. Defaults to the server's today. */
  readonly asAt?: string;
}

const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const escalationContextHandler = (
  dependencies: RelationsDependencies,
): QueryHandler<ReadEscalationContext, EscalationContextView> => ({
  queryName: 'relations.escalation-context',
  // The violation read. The count is an aggregate over violations this caller may already read one
  // at a time, so a separate grant would guard a fact the existing grant discloses.
  permission: RelationsPermissions.violationRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const category = await dependencies.stores.categories.byId(
        transaction,
        query.violationCategoryId,
      );

      if (category === undefined) return notFound<EscalationContextView>('violation_category');

      const asAt = referenceDate(query.asAt, dependencies.clock.now());

      if (asAt === undefined) {
        // A refusal, not a miss: the caller asked a malformed question rather than one with no
        // answer, and `not_found` here would suggest the employment had no record.
        return refusedBy<EscalationContextView>({
          reason: 'as_at_malformed',
          messageKey: 'relations.rejection.as_at_malformed',
          detail: { field: 'asAt' },
        });
      }

      // The same function the domain uses, imported rather than restated. Two implementations of one
      // boundary rule is how a query and its own derivation come to disagree about a date.
      const windowFrom = windowStart(asAt, category.repeatWindowDays);
      const violations = await dependencies.stores.violations.inCategoryWindow(
        transaction,
        query.employmentId,
        query.violationCategoryId,
        { from: windowFrom, to: asAt },
      );
      const context = escalationContext({
        employmentId: query.employmentId,
        violationCategoryId: query.violationCategoryId,
        windowDays: category.repeatWindowDays,
        asAt,
        violations,
      });

      // One event per violation the count disclosed, and none when it disclosed none — so a caller
      // cannot write into the trail by asking about employments that have no record.
      for (const violationId of context.violationIds) {
        await recordAccessFor(dependencies, transaction, {
          violationId,
          action: 'escalation_read',
        });
      }

      return success(context);
    }),
});

/**
 * The reference date: the caller's if they gave a well-formed one, otherwise the server's today.
 *
 * `undefined` means the caller supplied something malformed, which is refused rather than quietly
 * replaced with today — a silently substituted date would answer a different question than the one
 * asked, and the caller would have no way to tell.
 */
const referenceDate = (supplied: string | undefined, now: Date): string | undefined => {
  const today = now.toISOString().slice(0, 10);

  if (supplied === undefined) return today;
  return CIVIL_DATE.test(supplied) ? supplied : undefined;
};
