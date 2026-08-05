import { DomainException } from '../errors/domain-exception.js';
import { err, ok, type Result } from '../result/result.js';

/**
 * The one rule engine (Phase 1). Leave accrual, attendance exceptions, compensation and benefit
 * eligibility, payroll formulas, loan limits, compliance checks and every statutory country
 * pack evaluate through it.
 *
 * One engine rather than one per domain, because a tenant configuring "eligible after 90 days"
 * in three modules should not meet three dialects, and because the properties below are worth
 * building once and worth nothing if any module opts out:
 *
 * - **Deterministic.** No clock, no randomness, no I/O. Same facts and same rule version give
 *   the same answer forever, which is what makes a payroll re-run reproduce its original result.
 * - **Total.** A missing fact is an explicit outcome, never `undefined` silently failing a
 *   comparison and quietly denying someone their entitlement.
 * - **Self-explaining.** Every evaluation returns the rule, its version, the facts it read and
 *   the intermediate values. A statutory figure that cannot explain itself is a defect.
 * - **Sandboxed.** Rules are data, not code. Nothing a tenant configures can execute.
 */

export type FactValue = string | number | boolean | null;
export type Facts = Readonly<Record<string, FactValue>>;

export type ComparisonOperator =
  | 'equals'
  | 'notEquals'
  | 'greaterThan'
  | 'greaterThanOrEqual'
  | 'lessThan'
  | 'lessThanOrEqual'
  | 'in'
  | 'notIn'
  | 'isNull'
  | 'isNotNull';

export interface Condition {
  readonly fact: string;
  readonly operator: ComparisonOperator;
  readonly value?: FactValue | readonly FactValue[];
}

export interface ConditionGroup {
  readonly all?: readonly (Condition | ConditionGroup)[];
  readonly any?: readonly (Condition | ConditionGroup)[];
  readonly none?: readonly (Condition | ConditionGroup)[];
}

export interface RuleDefinition<TOutcome = unknown> {
  readonly ruleId: string;
  readonly version: number;
  /** When this version applies. Historical evaluation selects by the date being calculated. */
  readonly effectiveFrom: Date;
  readonly effectiveTo?: Date;
  readonly when: ConditionGroup;
  readonly outcome: TOutcome;
  /** The published source this encodes — a labor law article, a policy document. */
  readonly source?: string;
}

export interface EvaluationTrace {
  readonly fact: string;
  readonly operator: ComparisonOperator;
  readonly expected: FactValue | readonly FactValue[] | undefined;
  readonly actual: FactValue | undefined;
  readonly satisfied: boolean;
}

export interface Evaluation<TOutcome> {
  readonly ruleId: string;
  readonly version: number;
  readonly matched: boolean;
  readonly outcome?: TOutcome;
  /** Every comparison performed, in order. This is what makes a figure answerable. */
  readonly trace: readonly EvaluationTrace[];
  readonly source?: string;
}

export type EvaluationError =
  | { readonly kind: 'missing_fact'; readonly fact: string }
  | { readonly kind: 'incomparable'; readonly fact: string; readonly reason: string };

const isGroup = (node: Condition | ConditionGroup): node is ConditionGroup =>
  'all' in node || 'any' in node || 'none' in node;

const compareOrdered = (
  actual: FactValue,
  expected: FactValue | readonly FactValue[] | undefined,
  fact: string,
): Result<number, EvaluationError> => {
  if (typeof actual === 'boolean' || actual === null || Array.isArray(expected)) {
    return err({ kind: 'incomparable', fact, reason: 'ordering requires a number or a string' });
  }
  if (expected === null || expected === undefined) {
    return err({ kind: 'incomparable', fact, reason: 'ordering against no value' });
  }
  if (typeof expected !== typeof actual) {
    return err({
      kind: 'incomparable',
      fact,
      reason: `cannot order ${typeof actual} against ${typeof expected}`,
    });
  }
  return ok(actual === expected ? 0 : actual < expected ? -1 : 1);
};

/** Membership operators, which need a list rather than a scalar. */
const evaluateMembership = (
  condition: Condition,
  actual: FactValue,
): Result<boolean, EvaluationError> => {
  if (!Array.isArray(condition.value)) {
    return err({ kind: 'incomparable', fact: condition.fact, reason: 'expects a list' });
  }
  const contained = condition.value.includes(actual);
  return ok(condition.operator === 'in' ? contained : !contained);
};

/** Ordering operators, once the values are known to be comparable. */
const evaluateOrdering = (
  condition: Condition,
  actual: FactValue,
): Result<boolean, EvaluationError> => {
  const comparison = compareOrdered(actual, condition.value, condition.fact);
  if (!comparison.ok) return comparison;

  const ordering: Partial<Record<ComparisonOperator, boolean>> = {
    greaterThan: comparison.value > 0,
    greaterThanOrEqual: comparison.value >= 0,
    lessThan: comparison.value < 0,
    lessThanOrEqual: comparison.value <= 0,
  };
  return ok(ordering[condition.operator] ?? false);
};

/** Operators that are meaningful when the fact is absent. Everything else requires it. */
const evaluatePresence = (condition: Condition, actual: FactValue | undefined): boolean =>
  condition.operator === 'isNull'
    ? actual === null || actual === undefined
    : actual !== null && actual !== undefined;

const evaluateOperator = (
  condition: Condition,
  actual: FactValue,
): Result<boolean, EvaluationError> => {
  switch (condition.operator) {
    case 'equals':
      return ok(actual === condition.value);
    case 'notEquals':
      return ok(actual !== condition.value);
    case 'in':
    case 'notIn':
      return evaluateMembership(condition, actual);
    default:
      return evaluateOrdering(condition, actual);
  }
};

const evaluateCondition = (
  condition: Condition,
  facts: Facts,
  trace: EvaluationTrace[],
): Result<boolean, EvaluationError> => {
  const actual = Object.hasOwn(facts, condition.fact) ? facts[condition.fact] : undefined;
  const record = (satisfied: boolean): Result<boolean, EvaluationError> => {
    trace.push({
      fact: condition.fact,
      operator: condition.operator,
      expected: condition.value,
      actual,
      satisfied,
    });
    return ok(satisfied);
  };

  if (condition.operator === 'isNull' || condition.operator === 'isNotNull') {
    return record(evaluatePresence(condition, actual));
  }

  // A missing fact is never quietly false: a rule that reads a fact nobody supplied is a
  // configuration error, and denying an entitlement because of one is the worst outcome.
  if (actual === undefined) return err({ kind: 'missing_fact', fact: condition.fact });

  const outcome = evaluateOperator(condition, actual);
  return outcome.ok ? record(outcome.value) : outcome;
};

const evaluateNodes = (
  nodes: readonly (Condition | ConditionGroup)[],
  facts: Facts,
  trace: EvaluationTrace[],
): Result<readonly boolean[], EvaluationError> => {
  const results: boolean[] = [];

  for (const node of nodes) {
    const result = isGroup(node)
      ? evaluateGroup(node, facts, trace)
      : evaluateCondition(node, facts, trace);

    if (!result.ok) return result;
    results.push(result.value);
  }
  return ok(results);
};

const evaluateGroup = (
  group: ConditionGroup,
  facts: Facts,
  trace: EvaluationTrace[],
): Result<boolean, EvaluationError> => {
  const all = evaluateNodes(group.all ?? [], facts, trace);
  if (!all.ok) return all;

  const any = evaluateNodes(group.any ?? [], facts, trace);
  if (!any.ok) return any;

  const none = evaluateNodes(group.none ?? [], facts, trace);
  if (!none.ok) return none;

  return ok(
    all.value.every(Boolean) &&
      (any.value.length === 0 || any.value.some(Boolean)) &&
      !none.value.some(Boolean),
  );
};

/** Evaluates one rule against facts, returning the outcome and the reasoning. */
export const evaluateRule = <TOutcome>(
  rule: RuleDefinition<TOutcome>,
  facts: Facts,
): Result<Evaluation<TOutcome>, EvaluationError> => {
  const trace: EvaluationTrace[] = [];
  const matched = evaluateGroup(rule.when, facts, trace);

  if (!matched.ok) return matched;

  return ok({
    ruleId: rule.ruleId,
    version: rule.version,
    matched: matched.value,
    ...(matched.value ? { outcome: rule.outcome } : {}),
    trace,
    ...(rule.source === undefined ? {} : { source: rule.source }),
  });
};

/**
 * Selects the version of a rule in force on a date. Historical calculations resolve against the
 * date being calculated, never against today — which is what lets a payroll re-run for March
 * reproduce March's answer after April's rates were published.
 */
export const versionInForce = <TOutcome>(
  versions: readonly RuleDefinition<TOutcome>[],
  on: Date,
): RuleDefinition<TOutcome> => {
  const applicable = versions.filter(
    (rule) =>
      rule.effectiveFrom.getTime() <= on.getTime() &&
      (rule.effectiveTo === undefined || on.getTime() < rule.effectiveTo.getTime()),
  );

  if (applicable.length === 0) {
    throw new DomainException(
      'rule_no_version_in_force',
      `No version of this rule is in force on ${on.toISOString()}.`,
    );
  }
  if (applicable.length > 1) {
    throw new DomainException(
      'rule_overlapping_versions',
      `${String(applicable.length)} versions of ${applicable[0]?.ruleId ?? 'a rule'} are in force at once.`,
    );
  }
  return applicable[0] as RuleDefinition<TOutcome>;
};
