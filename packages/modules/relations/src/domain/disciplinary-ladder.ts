import { accept, refuse, type RelationsResult } from './relations-rejection.js';
import { isDisciplinaryAction, type DisciplinaryAction } from './relations-vocabulary.js';

/**
 * The ladder — what a tenant has decided a repeat attracts, and the rule that picks one.
 *
 * **Configuration, not business logic** (D-5.2-20, approved 2026-08-23). Nothing in this file knows
 * that a third absence deserves a final warning; a tenant wrote that down, and this reads it back.
 * Nothing infers a policy from severity, from an occurrence count on its own, from a country, from
 * an employment type or from a manager — and **where a tenant has configured no rule, the answer is
 * nothing**, never an invented action. That last property is the difference between decision support
 * and an automatic punishment engine.
 *
 * **It prescribes; it does not punish.** Evaluating this ladder writes nothing, moves no case,
 * suspends nobody and touches no other module. Issuing the action it names is a separate, explicitly
 * authorized act by a named human (ADR-0045).
 *
 * **Severity is not ranked here.** The catalogue owns severity as a tenant's own word (AD-002), and
 * this module still does not order by it. A rule applies to a *category*, and the category is the
 * source of identity and severity — restating either here would create a second answer to a question
 * the catalogue already answers.
 */

export interface DisciplinaryRuleState {
  readonly disciplinaryRuleId: string;
  readonly violationCategoryId: string;
  /** The occurrence at or above which this rule applies. A threshold, never a counter. */
  readonly minOccurrence: number;
  readonly action: DisciplinaryAction;
  /** Deterministic precedence, in the `(sequence, code)` shape D-5.2-07 established. */
  readonly sequence: number;
  readonly active: boolean;
  readonly version: number;
}

export interface DefineDisciplinaryRuleRequest {
  readonly disciplinaryRuleId: string;
  readonly violationCategoryId: string;
  readonly minOccurrence: number;
  readonly action: string;
  readonly sequence: number;
}

export const defineDisciplinaryRule = (
  request: DefineDisciplinaryRuleRequest,
): RelationsResult<DisciplinaryRuleState> => {
  if (!Number.isInteger(request.minOccurrence) || request.minOccurrence < 1) {
    // A threshold of zero would apply to a violation that has not happened.
    return refuse('rule_occurrence_invalid', { field: 'minOccurrence' });
  }
  if (!Number.isInteger(request.sequence) || request.sequence < 0) {
    return refuse('rule_sequence_invalid', { field: 'sequence' });
  }
  if (!isDisciplinaryAction(request.action)) {
    // A closed vocabulary, and an unknown value is refused rather than stored. A ladder that could
    // name any string would let a tenant configure an outcome nothing in this product can represent.
    return refuse('rule_action_unknown', { field: 'action' });
  }

  return accept({
    disciplinaryRuleId: request.disciplinaryRuleId,
    violationCategoryId: request.violationCategoryId,
    minOccurrence: request.minOccurrence,
    action: request.action,
    sequence: request.sequence,
    active: true,
    version: 1,
  });
};

export interface AmendDisciplinaryRuleRequest {
  readonly rule: DisciplinaryRuleState;
  readonly action?: string;
  readonly sequence?: number;
  readonly active?: boolean;
}

/**
 * An amendment. **`violationCategoryId` and `minOccurrence` are absent, and that is the contract.**
 *
 * Those two are the rule's identity — what it applies to, and when. Changing either would silently
 * turn a rule about third offences into a rule about first offences, and an action already issued
 * under it would point at a rule that no longer says what it said. A tenant who wants a different
 * threshold deactivates this rule and defines another; both remain readable.
 */
export const amendDisciplinaryRule = (
  request: AmendDisciplinaryRuleRequest,
): RelationsResult<DisciplinaryRuleState> => {
  const { rule } = request;

  if (
    request.sequence !== undefined &&
    (!Number.isInteger(request.sequence) || request.sequence < 0)
  ) {
    return refuse('rule_sequence_invalid', { field: 'sequence' });
  }
  if (request.action !== undefined && !isDisciplinaryAction(request.action)) {
    return refuse('rule_action_unknown', { field: 'action' });
  }

  return accept({
    ...rule,
    ...(request.action === undefined ? {} : { action: request.action }),
    ...(request.sequence === undefined ? {} : { sequence: request.sequence }),
    ...(request.active === undefined ? {} : { active: request.active }),
  });
};

/**
 * Which configured rule applies to a case at this occurrence — the whole evaluation.
 *
 * **The most specific rule wins**: the highest threshold at or below the actual occurrence. A ladder
 * of 1 → verbal, 3 → written, 5 → final gives a third occurrence the written warning, not the verbal
 * one, because a tenant who configured a rule for third offences meant it to apply to them.
 *
 * **Ties are broken by data, never by chance.** Two rules can only share a threshold if one is
 * inactive — the partial unique index forbids it otherwise — but the ordering is stated anyway, by
 * `sequence` then identifier, so the winner never depends on insertion order, on object key order,
 * or on what the planner happened to return first.
 *
 * **No rule means no action.** `undefined` is a real answer: this tenant has not decided what a third
 * absence attracts, and inventing one would be exactly the undocumented default D-5.2-20 forbade.
 *
 * Nothing here is written, cached or counted. `occurrence` arrives from
 * `relations.escalation-context`, which derives it; this function stores nothing and this module
 * holds no second counter.
 */
export const applicableRule = (
  rules: readonly DisciplinaryRuleState[],
  occurrence: number,
): DisciplinaryRuleState | undefined =>
  [...rules]
    .filter((rule) => rule.active && rule.minOccurrence <= occurrence)
    .sort(byMostSpecific)[0];

const byMostSpecific = (left: DisciplinaryRuleState, right: DisciplinaryRuleState): number =>
  right.minOccurrence - left.minOccurrence ||
  left.sequence - right.sequence ||
  left.disciplinaryRuleId.localeCompare(right.disciplinaryRuleId);
