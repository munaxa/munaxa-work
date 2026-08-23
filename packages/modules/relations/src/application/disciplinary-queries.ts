import { success, type Query, type QueryHandler } from '@work/kernel';

import { applicableRule } from '../domain/disciplinary-ladder.js';
import { occurrenceOf, windowStart } from '../domain/escalation.js';
import { recordAccessFor } from './access-recording.js';
import { notFound } from './relations-context.js';
import { RelationsPermissions } from './relations-permissions.js';
import { disciplinaryActionView, disciplinaryRuleView } from './relations-views.js';
import type {
  ApplicableActionView,
  DisciplinaryActionView,
  DisciplinaryRuleView,
} from '../contracts/views.js';
import type { RelationsDependencies } from './relations-dependencies.js';

/**
 * Reading the ladder, evaluating it, and reading what was issued.
 *
 * **The evaluation mutates nothing.** It reads a violation, derives its occurrence, reads the
 * tenant's rules and reports which one applies. It writes no rule, issues no action, moves no case
 * and stores no count — asking what the policy says is not doing it.
 *
 * **The ladder read is configuration and is not audited**, exactly as the catalogue read is not: a
 * list of thresholds names nobody. Evaluating for a *specific violation* is a disciplinary
 * disclosure and is audited, because it says something about a named employment's record.
 */

/** The tenant's configured ladder for one category. Configuration; names nobody. */
export interface ListDisciplinaryRules extends Query {
  readonly queryName: 'relations.disciplinary-rules';
  readonly violationCategoryId: string;
  readonly includeInactive?: boolean;
}

export const listDisciplinaryRulesHandler = (
  dependencies: RelationsDependencies,
): QueryHandler<ListDisciplinaryRules, readonly DisciplinaryRuleView[]> => ({
  queryName: 'relations.disciplinary-rules',
  permission: RelationsPermissions.ladderRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const rules = await dependencies.stores.disciplinaryRules.forCategory(
        transaction,
        query.violationCategoryId,
        query.includeInactive ?? false,
      );

      // No access event: a ladder is a list of thresholds and names nobody.
      return success(rules.map(disciplinaryRuleView));
    }),
});

/**
 * What the tenant's ladder prescribes for one case — decision support, and only that.
 *
 * **An absent `action` is a real answer**: this tenant has configured no rule for this occurrence,
 * and nothing is invented to fill the gap (D-5.2-20). A caller receiving no action has learned that
 * the policy is silent, which is exactly what it is.
 *
 * Audited, because it discloses a named employment's repeat position.
 */
export interface ReadApplicableAction extends Query {
  readonly queryName: 'relations.applicable-action';
  readonly violationId: string;
}

export const applicableActionHandler = (
  dependencies: RelationsDependencies,
): QueryHandler<ReadApplicableAction, ApplicableActionView> => ({
  queryName: 'relations.applicable-action',
  // The case's own read permission. The prescription is about this violation, and a caller who may
  // read the case may learn what the tenant's published policy says about it.
  permission: RelationsPermissions.violationRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const violation = await dependencies.stores.violations.byId(transaction, query.violationId);

      if (violation === undefined) return notFound<ApplicableActionView>('violation');

      const category = await dependencies.stores.categories.byId(
        transaction,
        violation.violationCategoryId,
      );

      if (category === undefined) return notFound<ApplicableActionView>('violation_category');

      const from = windowStart(violation.occurredOn, category.repeatWindowDays);
      const violations = await dependencies.stores.violations.inCategoryWindow(
        transaction,
        violation.employmentId,
        violation.violationCategoryId,
        { from, to: violation.occurredOn },
      );
      const occurrence = occurrenceOf(violation, category.repeatWindowDays, violations);

      if (occurrence === undefined) return notFound<ApplicableActionView>('violation');

      const rules = await dependencies.stores.disciplinaryRules.forCategory(
        transaction,
        violation.violationCategoryId,
        false,
      );
      const rule = applicableRule(rules, occurrence);

      await recordAccessFor(dependencies, transaction, {
        violationId: violation.violationId,
        action: 'escalation_read',
      });

      return success({
        violationId: violation.violationId,
        violationCategoryId: violation.violationCategoryId,
        occurrence,
        windowDays: category.repeatWindowDays,
        ...(rule === undefined
          ? {}
          : {
              action: rule.action,
              disciplinaryRuleId: rule.disciplinaryRuleId,
              minOccurrence: rule.minOccurrence,
            }),
      });
    }),
});

/** The action issued on one case, if one was. Audited — it is the module's most consequential record. */
export interface ReadDisciplinaryAction extends Query {
  readonly queryName: 'relations.disciplinary-action';
  readonly violationId: string;
}

export const disciplinaryActionHandler = (
  dependencies: RelationsDependencies,
): QueryHandler<ReadDisciplinaryAction, DisciplinaryActionView> => ({
  queryName: 'relations.disciplinary-action',
  permission: RelationsPermissions.violationRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const issued = await dependencies.stores.disciplinaryActions.forViolation(
        transaction,
        query.violationId,
      );

      // Nothing issued reads as nothing found — the same answer another tenant's case gives, so an
      // identifier discloses nothing by being asked about.
      if (issued === undefined) return notFound<DisciplinaryActionView>('disciplinary_action');

      await recordAccessFor(dependencies, transaction, {
        violationId: issued.violationId,
        action: 'disciplinary_action_read',
      });

      return success(disciplinaryActionView(issued));
    }),
});
