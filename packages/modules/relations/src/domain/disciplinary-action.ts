import { accept, refuse, type RelationsResult } from './relations-rejection.js';
import type { DisciplinaryRuleState } from './disciplinary-ladder.js';
import { isDisciplinaryAction, type DisciplinaryAction } from './relations-vocabulary.js';

/**
 * A disciplinary action a named human issued — the most consequential record this module holds.
 *
 * **Issued, not executed.** This row says somebody decided; it does not carry the decision out.
 * Nothing here suspends an employment, ends one, deducts pay, starts an approval or notifies
 * anybody: Employment owns its own lifecycle (AD-005), Payroll is pull-oriented, and Workflow is
 * untouched. The two most serious rungs are named `*_recommendation` so the row cannot be misread as
 * having done something it did not.
 *
 * **Frozen at issue, for the reason Checkpoint 1 froze a category code** (AD-003). A tenant may
 * re-grade its ladder next year; this record must still mean what it meant when somebody was
 * disciplined on it. So `action`, `occurrenceAtIssue` and whether a rule prescribed it are all
 * copied here, while `disciplinaryRuleId` keeps the link so both questions — *which rule* and *what
 * did it say then* — can be asked.
 *
 * **`occurrenceAtIssue` is not a counter.** Nothing increments it and nothing reads it to count
 * anything; it is the derived escalation context as it stood at one instant, frozen because a later
 * violation would otherwise change what this record appears to have been based on.
 *
 * **A human may issue an action the ladder did not prescribe**, and `prescribedByRule` records
 * which happened. A system that refused a human's judgement because no rule matched would be the
 * automatic punishment engine D-5.2-20 forbade, in the opposite direction.
 *
 * The row is immutable at the database. Somebody may be dismissed on the strength of it.
 */

export interface DisciplinaryActionState {
  readonly disciplinaryActionId: string;
  readonly violationId: string;
  /** The concluded inquiry this rests on. Required — an action with no findings behind it is the one a tribunal sets aside. */
  readonly investigationId: string;
  readonly action: DisciplinaryAction;
  /** The rule that prescribed it, where one did. */
  readonly disciplinaryRuleId?: string;
  readonly prescribedByRule: boolean;
  /** The derived occurrence at the moment of issue. Frozen; never recomputed, never incremented. */
  readonly occurrenceAtIssue: number;
  readonly reason: string;
  /** The authenticated caller. Never supplied by one. */
  readonly issuedBy: string;
  readonly issuedOn: string;
  readonly issuedAt: Date;
  readonly correlationId: string;
  readonly version: number;
}

export const ACTION_REASON_LIMIT = 2000;

const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface IssueDisciplinaryActionRequest {
  readonly disciplinaryActionId: string;
  readonly violationId: string;
  readonly investigationId: string;
  readonly action: string;
  /** The rule the evaluation selected, if any. Determined by the server, never supplied. */
  readonly rule?: DisciplinaryRuleState;
  readonly occurrenceAtIssue: number;
  readonly reason: string;
  readonly issuedBy: string;
  readonly issuedOn: string;
  readonly issuedAt: Date;
  readonly correlationId: string;
  readonly today: string;
}

export const issueDisciplinaryAction = (
  request: IssueDisciplinaryActionRequest,
): RelationsResult<DisciplinaryActionState> => {
  if (!isDisciplinaryAction(request.action)) {
    return refuse('action_unknown', { field: 'action' });
  }

  const dates = validateIssueDates(request);

  if (!dates.ok) return dates;

  const checked = validateIssueContent(request);

  if (!checked.ok) return checked;

  return accept({
    disciplinaryActionId: request.disciplinaryActionId,
    violationId: request.violationId,
    investigationId: request.investigationId,
    action: request.action,
    prescribedByRule: request.rule !== undefined,
    occurrenceAtIssue: request.occurrenceAtIssue,
    reason: request.reason.trim(),
    issuedBy: request.issuedBy,
    issuedOn: request.issuedOn,
    issuedAt: request.issuedAt,
    correlationId: request.correlationId,
    version: 1,
    ...(request.rule === undefined ? {} : { disciplinaryRuleId: request.rule.disciplinaryRuleId }),
  });
};

/**
 * The content rules, split from the date rules when the function passed the complexity budget.
 *
 * Split rather than exempted, and split where the seam already was: one function asks whether the
 * dates make sense, the other whether the record is attributable and internally consistent.
 */
const validateIssueContent = (request: IssueDisciplinaryActionRequest): RelationsResult<true> => {
  const reason = request.reason.trim();

  if (reason === '') return refuse('action_reason_missing', { field: 'reason' });
  if (reason.length > ACTION_REASON_LIMIT) {
    return refuse('action_reason_too_long', { field: 'reason' });
  }
  if (request.issuedBy.trim() === '') {
    // Unreachable from the pipeline, which always has an actor. Refused rather than assumed: an
    // unattributed disciplinary action is the one record this domain must never hold.
    return refuse('action_issuer_unknown', { field: 'issuedBy' });
  }
  if (!Number.isInteger(request.occurrenceAtIssue) || request.occurrenceAtIssue < 1) {
    return refuse('action_occurrence_invalid', { field: 'occurrenceAtIssue' });
  }
  if (request.rule !== undefined && request.rule.action !== request.action) {
    // The frozen action and the rule that supposedly prescribed it must agree, or the record claims
    // a provenance it does not have.
    return refuse('action_rule_mismatch', { field: 'action' });
  }
  return accept(true);
};

const validateIssueDates = (request: IssueDisciplinaryActionRequest): RelationsResult<true> => {
  if (!CIVIL_DATE.test(request.issuedOn)) {
    return refuse('issued_on_malformed', { field: 'issuedOn' });
  }
  if (request.issuedOn > request.today) {
    // A disciplinary action cannot be dated into the future; backdating is refused by the clock,
    // which the caller never supplies.
    return refuse('issued_on_in_future', { field: 'issuedOn' });
  }
  return accept(true);
};
