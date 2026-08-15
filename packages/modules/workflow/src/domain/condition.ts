import { isConditionOperator, type ConditionOperator } from './workflow-vocabulary.js';
import { accept, refuse, type WorkflowResult } from './workflow-rejection.js';

/**
 * Conditional branching, as a closed form rather than a language.
 *
 * A condition is a triple — `(key, operator, value)` — read against the instance's own `context`,
 * and several of them are combined only by `all-of`. That is the entire grammar. There is no `or`,
 * no nesting, no arithmetic, no date, no cross-step reference, no cross-module read, no scripting
 * and no evaluation of anything a caller wrote. ADR-0049 named the pressure that produces those:
 * *"What a graph buys beyond that is branching and joining, which is a workflow engine."*
 *
 * **A missing key is a refusal and never a false**, and this is the single most important rule in
 * the file. A condition that silently evaluated an absent operand as false would route an approval
 * *somewhere* — quietly skipping the finance director because the requesting module spelled a key
 * differently. The refusal fails the whole operation closed instead: nothing is written, and
 * somebody is told the condition could not be evaluated.
 *
 * **A type mismatch is a refusal too**, for the same reason. Comparing the string `"50000"` to the
 * number `50000` has an answer in JavaScript and no answer in a business rule, and picking one would
 * be inventing a coercion rule nobody approved. `greater-than` and `less-than` require whole numbers
 * on both sides; `equals` and `not-equals` require both operands to be the same kind.
 *
 * **The condition is stored on the version and copied onto the instance's steps**, so a running
 * approval is evaluated against the condition it received when it started. Editing a definition
 * cannot retroactively re-route an approval half way through, which is AD-003 applied to routing
 * rather than to steps.
 *
 * **Only `workflow_instance.context` is read.** That payload is what the requesting module supplied
 * through `ApprovalPort`, stored since 16A and — until now — read by nothing. Reading a business
 * module during routing would put a cross-module call on the hot path of every step transition and
 * would mean Workflow knew what a requisition was (AD-001).
 */

/** A value a condition may compare against. Strings and whole numbers, and nothing else. */
export type ConditionValue = string | number;

export interface BranchCondition {
  /** A top-level key of the instance's `context`. Not a path: there is no traversal. */
  readonly key: string;
  readonly operator: ConditionOperator;
  /** A list only for `in`; a single value for the other four. */
  readonly value: ConditionValue | readonly ConditionValue[];
}

const isWhole = (value: unknown): value is number => Number.isInteger(value);
const isText = (value: unknown): value is string => typeof value === 'string';
const isValue = (value: unknown): value is ConditionValue => isText(value) || isWhole(value);

/**
 * Whether a condition is one this module can evaluate at all — checked when a version is published.
 *
 * Validation is separate from evaluation because they fail at different moments and for different
 * people. A malformed condition is an administrator's configuration mistake, caught while they are
 * still editing; an unevaluable one is a requesting module's payload mistake, caught when an
 * approval is raised. Conflating them would tell an administrator that somebody else's request was
 * wrong.
 */
export const conditionIsWellFormed = (
  condition: BranchCondition,
): WorkflowResult<BranchCondition> => {
  if (condition.key.trim().length === 0) return refuse('condition-key-required');
  if (!isConditionOperator(condition.operator)) return refuse('condition-operator-invalid');

  const value =
    condition.operator === 'in' ? listIsWellFormed(condition.value) : boundIsWellFormed(condition);

  if (!value.ok) return refuse(value.error.reason);
  return accept(condition);
};

/** `in` takes a non-empty list of one kind. A mixed list would make membership depend on coercion. */
const listIsWellFormed = (value: BranchCondition['value']): WorkflowResult<true> => {
  if (!Array.isArray(value) || value.length === 0) return refuse('condition-in-requires-a-list');
  if (!value.every(isValue)) return refuse('condition-value-invalid');

  const [head] = value;

  if (!value.every((entry) => typeof entry === typeof head)) {
    return refuse('condition-value-invalid');
  }
  return accept(true);
};

/**
 * The other four take one value, and the two ordering operators take a whole number.
 *
 * An ordering comparison against text has no defined answer here: `'b' > 'a'` is a collation
 * question, and collation is the tenant's language rather than this module's business.
 */
const boundIsWellFormed = (condition: BranchCondition): WorkflowResult<true> => {
  if (Array.isArray(condition.value)) return refuse('condition-value-invalid');
  if (!isValue(condition.value)) return refuse('condition-value-invalid');
  if (
    (condition.operator === 'greater-than' || condition.operator === 'less-than') &&
    !isWhole(condition.value)
  ) {
    return refuse('condition-comparison-requires-a-number');
  }
  return accept(true);
};

/** Every condition on a branch, checked together. Used at publication. */
export const conditionsAreWellFormed = (
  conditions: readonly BranchCondition[],
): WorkflowResult<readonly BranchCondition[]> => {
  for (const condition of conditions) {
    const checked = conditionIsWellFormed(condition);

    if (!checked.ok) return refuse(checked.error.reason, checked.error.detail);
  }
  return accept(conditions);
};

/**
 * One condition, against one context.
 *
 * Returns a **result** rather than a boolean, because "I cannot answer" is a third outcome and
 * collapsing it into `false` is how an approval gets routed past somebody.
 */
export const evaluateCondition = (
  condition: BranchCondition,
  context: Readonly<Record<string, unknown>>,
): WorkflowResult<boolean> => {
  if (!Object.hasOwn(context, condition.key)) {
    return refuse('condition-key-missing', { key: condition.key });
  }
  const actual: unknown = context[condition.key];

  if (!isValue(actual)) return refuse('condition-operand-unsupported', { key: condition.key });

  return condition.operator === 'in'
    ? membership(condition, actual)
    : comparison(condition, actual);
};

/** `in`: the list and the value must be the same kind, or the answer would depend on coercion. */
const membership = (
  condition: BranchCondition,
  actual: ConditionValue,
): WorkflowResult<boolean> => {
  const list = condition.value as readonly ConditionValue[];

  if (list.some((entry) => typeof entry !== typeof actual)) {
    return refuse('condition-operand-mismatched', { key: condition.key });
  }
  return accept(list.includes(actual));
};

/** The other four, against a single value of the same kind. */
const comparison = (
  condition: BranchCondition,
  actual: ConditionValue,
): WorkflowResult<boolean> => {
  const expected = condition.value as ConditionValue;

  if (typeof expected !== typeof actual) {
    return refuse('condition-operand-mismatched', { key: condition.key });
  }
  if (condition.operator === 'equals') return accept(actual === expected);
  if (condition.operator === 'not-equals') return accept(actual !== expected);
  // Ordering. Both sides are whole numbers: the form check refused a text bound, and the guard in
  // `evaluateCondition` refused a context value of a different kind.
  if (!isWhole(actual) || !isWhole(expected)) {
    return refuse('condition-comparison-requires-a-number', { key: condition.key });
  }
  return accept(condition.operator === 'greater-than' ? actual > expected : actual < expected);
};

/**
 * `all-of`: every condition must hold, and any one that cannot be evaluated refuses the lot.
 *
 * **No short-circuit on a refusal.** Evaluation stops at the first refusal rather than continuing,
 * which is deliberate: the caller is told the first thing that was wrong, and there is no partial
 * answer to misread. An empty list is `true` — a branch with no condition always runs, which is what
 * every 16A step was.
 */
export const evaluateAllOf = (
  conditions: readonly BranchCondition[],
  context: Readonly<Record<string, unknown>>,
): WorkflowResult<boolean> => {
  for (const condition of conditions) {
    const held = evaluateCondition(condition, context);

    if (!held.ok) return refuse(held.error.reason, held.error.detail);
    if (!held.value) return accept(false);
  }
  return accept(true);
};
