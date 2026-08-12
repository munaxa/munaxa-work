import {
  isCivilDate,
  isRecurrenceMonths,
  isWholeWithin,
  type AudienceKind,
  type MandatoryKind,
} from './learning-vocabulary.js';
import {
  accept,
  isLocalizedName,
  refuse,
  type LearningResult,
  type LocalizedName,
} from './learning-rejection.js';
import { addDays, addMonths } from './certification.js';
import { definedOf } from './defined.js';

/**
 * A tenant's statement that an audience must hold something, and how often.
 *
 * **It is configuration and it fires nothing** (ADR-0071). No scheduler exists in this repository —
 * `JobPort` has no adapter — so a rule that "runs annually" would be a rule that never ran. What the
 * rule does is define, deterministically, which occurrence an employment is currently in; the
 * bounded, idempotent `reconcile-requirements` command turns that into assignments when an
 * administrator invokes it, and a future scheduler is a call site rather than a redesign.
 *
 * **Every course is mandatory because a tenant said so** (AD-006). This product ships no rules, no
 * default compliance catalogue and no opinion about what safety training anybody needs. `kind` is
 * documentation of the tenant's own reason and no rule here branches on it.
 *
 * **The audience is resolved through Employment's published contract at reconciliation time**, never
 * from a list somebody typed. A rule targeting a unit therefore covers the person who transferred in
 * yesterday without anybody editing anything, which is the whole reason it is a rule and not a list.
 */

export interface MandatoryRuleState {
  readonly mandatoryRuleId: string;
  readonly courseId: string;
  readonly name: LocalizedName;
  readonly kind: MandatoryKind;
  readonly audience: AudienceKind;
  /** Present when the audience is `organization_unit`. Resolved by Employment, never stored as a list. */
  readonly organizationUnitId?: string;
  /** Present when the audience is `position`. */
  readonly positionId?: string;
  /** The civil date from which the requirement applies. The anchor of the first occurrence. */
  readonly effectiveFrom: string;
  /** Whole months between occurrences. `0` never repeats: once satisfied, always satisfied. */
  readonly recurrenceMonths: number;
  /** Days after an occurrence begins by which it must be done. `0` means due on the day it opens. */
  readonly dueWithinDays: number;
  readonly active: boolean;
  readonly retiredAt?: Date;
  readonly retiredBy?: string;
  readonly version: number;
}

export interface DefineRuleRequest {
  readonly mandatoryRuleId: string;
  readonly courseId: string;
  readonly name: LocalizedName;
  readonly kind: MandatoryKind;
  readonly audience: AudienceKind;
  readonly organizationUnitId?: string;
  readonly positionId?: string;
  readonly effectiveFrom: string;
  readonly recurrenceMonths: number;
  readonly dueWithinDays: number;
}

const MAX_DUE_WITHIN_DAYS = 3650;

export const defineRule = (request: DefineRuleRequest): LearningResult<MandatoryRuleState> => {
  if (!isLocalizedName(request.name)) return refuse('rule-name-required');
  if (!isCivilDate(request.effectiveFrom)) return refuse('rule-effective-date-invalid');
  if (!isRecurrenceMonths(request.recurrenceMonths)) return refuse('rule-recurrence-invalid');
  if (!isWholeWithin(request.dueWithinDays, 0, MAX_DUE_WITHIN_DAYS)) {
    return refuse('rule-due-window-invalid');
  }
  // An audience is a claim about who this applies to. A rule naming a unit with no unit behind it
  // would resolve to nobody, and a compliance rule that silently covers nobody is worse than none.
  if (request.audience === 'organization_unit' && request.organizationUnitId === undefined) {
    return refuse('rule-organization-unit-required');
  }
  if (request.audience === 'position' && request.positionId === undefined) {
    return refuse('rule-position-required');
  }

  return accept({
    mandatoryRuleId: request.mandatoryRuleId,
    courseId: request.courseId,
    name: request.name,
    kind: request.kind,
    audience: request.audience,
    effectiveFrom: request.effectiveFrom,
    recurrenceMonths: request.recurrenceMonths,
    dueWithinDays: request.dueWithinDays,
    active: true,
    version: 1,
    ...definedOf({
      organizationUnitId: request.organizationUnitId,
      positionId: request.positionId,
    }),
  });
};

/**
 * Retiring a rule stops it implying anything new and leaves what it already implied alone.
 *
 * Assignments already generated are historical facts about what somebody was asked to do. Deleting
 * them because the policy changed would destroy the compliance trail this module exists to keep — the
 * question "was this person asked to do fire safety in 2024" has an answer, and it stays answered.
 */
export const retireRule = (
  state: MandatoryRuleState,
  at: Date,
  by: string,
): LearningResult<MandatoryRuleState> => {
  if (!state.active) return refuse('rule-already-retired');

  return accept({ ...state, active: false, retiredAt: at, retiredBy: by });
};

/**
 * Whole months elapsed between two civil dates, not counting a partial final month.
 *
 * The day-of-month comparison is what makes "a year after 15 March" become due on 15 March and not
 * on the 1st: a calendar-month difference alone would say twelve months had passed on 1 March.
 */
const monthsBetween = (from: string, to: string): number => {
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  const gross =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (end.getUTCMonth() - start.getUTCMonth());

  return end.getUTCDate() < start.getUTCDate() ? gross - 1 : gross;
};

/**
 * The occurrence an employment is currently in — **the key that makes reconciliation idempotent**.
 *
 * The value is the civil date on which the current occurrence began, derived from the rule's anchor
 * and the employment's last completion. It is deliberately **not a counter**: two runs on the same
 * day compute the same string with nothing kept in step between them, and the partial unique index on
 * `(tenant_id, employment_id, mandatory_rule_id, occurrence_key)` is what makes the second run create
 * nothing (ADR-0071). A `select` then `insert` would not survive two administrators pressing the
 * button at once; a unique index does.
 *
 * `undefined` means **nothing is due**: either the rule has not taken effect, or the person completed
 * it and the next occurrence has not opened yet. A rule that never repeats is satisfied forever by
 * one completion, which is what `recurrenceMonths = 0` means.
 */
export const currentOccurrenceKey = (
  rule: Pick<MandatoryRuleState, 'effectiveFrom' | 'recurrenceMonths'>,
  lastCompletedOn: string | undefined,
  today: string,
): string | undefined => {
  if (today < rule.effectiveFrom) return undefined;
  // Never completed: they are in the first occurrence, which opened when the rule took effect. That
  // it opened years ago is the point — the requirement is overdue, and the date says by how much.
  if (lastCompletedOn === undefined) return rule.effectiveFrom;
  if (rule.recurrenceMonths === 0) return undefined;

  const elapsed = monthsBetween(lastCompletedOn, today);

  if (elapsed < rule.recurrenceMonths) return undefined;

  return alignedOccurrence(lastCompletedOn, rule.recurrenceMonths, elapsed, today);
};

/**
 * The start of the latest occurrence that has opened on or before `today`.
 *
 * The estimate from whole months elapsed is exact except where `addMonths` clamps a 29th, 30th or
 * 31st into a shorter month, so it is corrected in both directions rather than trusted. The
 * correction is bounded by one step each way, because a clamp can never move the boundary by a whole
 * interval.
 */
const alignedOccurrence = (
  from: string,
  months: number,
  elapsed: number,
  today: string,
): string => {
  let steps = Math.floor(elapsed / months);

  if (addMonths(from, (steps + 1) * months) <= today) steps += 1;
  while (steps > 1 && addMonths(from, steps * months) > today) steps -= 1;

  return addMonths(from, steps * months);
};

/** When an occurrence must be done by: its start plus the rule's window. A civil date throughout. */
export const occurrenceDueOn = (
  rule: Pick<MandatoryRuleState, 'dueWithinDays'>,
  occurrenceKey: string,
): string => addDays(occurrenceKey, rule.dueWithinDays);
