import { success, uuidV7, type Command, type CommandHandler, type Transaction } from '@work/kernel';

import { assign } from '../domain/assignment.js';
import {
  currentOccurrenceKey,
  occurrenceDueOn,
  type MandatoryRuleState,
} from '../domain/mandatory-rule.js';
import type { ReconciliationView } from '../contracts/views.js';
import { civilDateOf, currentActor, notFound, refuseWith } from './learning-context.js';
import { LearningPermissions } from './learning-permissions.js';
import type { Audience, EmploymentFacts } from './learning-ports.js';
import type { LearningDependencies } from './learning-dependencies.js';

/**
 * Turning a recurring requirement into the assignments it currently implies (ADR-0071).
 *
 * **Nothing fires this.** `JobPort` has no adapter anywhere in this repository, so an administrator
 * runs it, an Admin screen says so, and **scheduled execution is `NOT VERIFIED`**. A future
 * scheduler is a call site rather than a redesign: it would invoke this command on an interval and
 * every guarantee below would already hold.
 *
 * Three properties make that true, and each is tested.
 *
 * **Idempotent by database constraint.** Each assignment is written with `insert ... on conflict do
 * nothing` over a partial unique index on `(tenant_id, employment_id, mandatory_rule_id,
 * occurrence_key)`. A second run creates nothing because the index says so — not because a prior
 * read found something, which two administrators pressing the button at the same instant would both
 * fail to find.
 *
 * **The current occurrence only, never a calendar of future ones.** Rows for occurrences nobody has
 * reached would be state nothing owns: change the interval and they are wrong, change the audience
 * and they are for the wrong people, retire the rule and they are for nothing.
 *
 * **Bounded.** The command takes a page and reports whether more remain. It cannot walk a hundred
 * thousand employments in one transaction, and it says so in the result rather than truncating
 * quietly.
 *
 * **A dependency that cannot answer is a refusal, never a zero.** If Employment does not resolve the
 * audience, this refuses. Reporting "0 generated, 0 already present" for an organization it never
 * looked at would be a compliance report claiming everybody is up to date.
 */

export interface ReconcileRequirementsCommand extends Command {
  readonly commandName: 'learning.reconcile-requirements';
  readonly mandatoryRuleId: string;
  /** How many employments to examine. Clamped; the caller pages through with `offset`. */
  readonly limit?: number;
  readonly offset?: number;
}

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

export const reconcileRequirementsHandler = (
  dependencies: LearningDependencies,
): CommandHandler<ReconcileRequirementsCommand, ReconciliationView> => ({
  commandName: 'learning.reconcile-requirements',
  permission: LearningPermissions.reconcile,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const rule = await dependencies.stores.rules.byId(transaction, command.mandatoryRuleId);

      if (rule === undefined) return notFound<ReconciliationView>('learning_mandatory_rule');
      // A retired rule implies nothing new. What it already asked of people stays exactly as it is.
      if (!rule.active) return refuseWith<ReconciliationView>('reconcile-rule-retired');

      const limit = Math.min(MAX_LIMIT, Math.max(1, command.limit ?? DEFAULT_LIMIT));
      const offset = Math.max(0, command.offset ?? 0);
      const audience = await audienceOf(dependencies, rule, limit, offset);

      // Undefined is "Employment could not answer", and it is deliberately not an empty audience.
      if (audience === undefined) return refuseWith<ReconciliationView>('employment-unavailable');

      return success(await generateFor(dependencies, transaction, rule, audience, limit));
    }),
});

/** Who the rule applies to, resolved from Employment at this moment rather than from a stored list. */
const audienceOf = (
  dependencies: LearningDependencies,
  rule: MandatoryRuleState,
  limit: number,
  offset: number,
): Promise<Audience> => {
  const asOf = dependencies.clock.now();

  if (rule.audience === 'organization_unit' && rule.organizationUnitId !== undefined) {
    return dependencies.employment.inUnit(rule.organizationUnitId, asOf, limit, offset);
  }
  if (rule.audience === 'position' && rule.positionId !== undefined) {
    return dependencies.employment.inPosition(rule.positionId, asOf, limit, offset);
  }
  return dependencies.employment.activeEmployments(asOf, limit, offset);
};

/** What one employment's occurrence turned into. Counted by the caller; nothing is mutated. */
type Outcome = 'generated' | 'alreadyPresent' | 'notDue';

/**
 * Walks the page, computing each employment's current occurrence and writing what is missing.
 *
 * The completions are read for the whole page in one query rather than per employment — a
 * reconciliation that fetched a completion per person is the N+1 this repository forbids, and it is
 * the easiest one here to write by accident.
 */
const generateFor = async (
  dependencies: LearningDependencies,
  transaction: Transaction,
  rule: MandatoryRuleState,
  audience: readonly EmploymentFacts[],
  limit: number,
): Promise<ReconciliationView> => {
  const today = civilDateOf(dependencies.clock.now());
  const active = audience.filter((facts) => facts.active);
  const completions = await dependencies.stores.enrolments.lastCompletionsOf(
    transaction,
    active.map((facts) => facts.employmentId),
    rule.courseId,
  );
  const outcomes: Outcome[] = [];

  for (const facts of active) {
    const key = currentOccurrenceKey(rule, completions.get(facts.employmentId), today);

    outcomes.push(
      key === undefined
        ? 'notDue'
        : await writeOccurrence(dependencies, transaction, rule, {
            employmentId: facts.employmentId,
            occurrenceKey: key,
          }),
    );
  }

  const counted = (outcome: Outcome): number => outcomes.filter((held) => held === outcome).length;

  return {
    mandatoryRuleId: rule.mandatoryRuleId,
    asOf: today,
    examined: audience.length,
    generated: counted('generated'),
    alreadyPresent: counted('alreadyPresent'),
    notDue: counted('notDue') + (audience.length - active.length),
    more: audience.length === limit,
  };
};

/**
 * One occurrence, written unless the database already holds it.
 *
 * The domain builds the row so the same provenance rules apply as to a hand-made assignment; a
 * refusal here would mean the rule itself is malformed, and it is counted as not-due rather than
 * silently dropped.
 */
const writeOccurrence = async (
  dependencies: LearningDependencies,
  transaction: Transaction,
  rule: MandatoryRuleState,
  occurrence: { readonly employmentId: string; readonly occurrenceKey: string },
): Promise<Outcome> => {
  const created = assign({
    assignmentId: uuidV7(),
    employmentId: occurrence.employmentId,
    courseId: rule.courseId,
    source: 'mandatory_rule',
    mandatoryRuleId: rule.mandatoryRuleId,
    occurrenceKey: occurrence.occurrenceKey,
    dueOn: occurrenceDueOn(rule, occurrence.occurrenceKey),
    at: dependencies.clock.now(),
    by: currentActor(),
  });

  if (!created.ok) return 'notDue';

  const written = await dependencies.stores.assignments.insertIfAbsent(transaction, created.value);

  return written ? 'generated' : 'alreadyPresent';
};
