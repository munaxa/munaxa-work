import { currentCaseState, type CaseEventState } from '../domain/case-event.js';
import type { DisciplinaryActionState } from '../domain/disciplinary-action.js';
import type { DisciplinaryRuleState } from '../domain/disciplinary-ladder.js';
import type { InvestigationRecord } from '../domain/investigation.js';
import type { ViolationCategoryState } from '../domain/violation-category.js';
import type { ViolationRecord } from '../domain/violation.js';
import type {
  CaseEventView,
  DisciplinaryActionView,
  DisciplinaryRuleView,
  CaseHistoryView,
  InvestigationView,
  ViolationCategoryView,
  ViolationView,
} from '../contracts/views.js';

/**
 * Domain state into published view, in one direction only.
 *
 * Here rather than in the query handlers so there is exactly one place that decides what leaves this
 * module. A field added to an aggregate does not reach a consumer until somebody adds it here, which
 * is the point: in this domain an accidentally published field is an accidental disclosure about a
 * named person.
 *
 * **`reportedBy` is not published.** It names the member of staff who filed the allegation, and
 * putting it on a view would hand the accused a screen showing who reported them. It is recorded on
 * the row, where a permission decides who reads it, and Checkpoint 1 publishes no read of it.
 */

export const violationCategoryView = (state: ViolationCategoryState): ViolationCategoryView => ({
  violationCategoryId: state.violationCategoryId,
  code: state.code,
  name: state.name,
  severity: state.severity,
  sequence: state.sequence,
  repeatWindowDays: state.repeatWindowDays,
  source: state.source,
  active: state.active,
  version: state.version,
  ...(state.countryPackId === undefined ? {} : { countryPackId: state.countryPackId }),
  ...(state.countryPackVersion === undefined
    ? {}
    : { countryPackVersion: state.countryPackVersion }),
});

/**
 * A violation, optionally carrying where it sits in its own repeat window.
 *
 * `occurrence` is omitted rather than defaulted to 1 when it could not be derived — a category that
 * could not be read is not evidence of a first offence, and publishing 1 would be a guess presented
 * as a fact in the one place a guess must never appear.
 */
export const violationView = (state: ViolationRecord, occurrence?: number): ViolationView => ({
  violationId: state.violationId,
  employmentId: state.employmentId,
  violationCategoryId: state.violationCategoryId,
  categoryCode: state.categoryCode,
  severity: state.severity,
  occurredOn: state.occurredOn,
  description: state.description,
  state: state.state,
  recordedOn: state.recordedAt.toISOString(),
  version: state.version,
  ...(occurrence === undefined ? {} : { occurrence }),
});

/**
 * An inquiry, with its findings included only for a caller entitled to them (D-5.2-18).
 *
 * **`withFindings` is required rather than optional**, so a new call site cannot default into
 * disclosure by forgetting an argument. A `false` here produces exactly the payload an *open*
 * inquiry produces — the fields absent, not blanked and not marked redacted — because a field
 * saying "withheld" tells the reader that findings exist, and for a manager reading about their own
 * report that is most of the disclosure.
 *
 * `concludedOn` and `state` stay visible in both cases: that an inquiry finished is part of the
 * case's shape, which `relations.violation.read` already reaches. What is withheld is what it said.
 */
export const investigationView = (
  state: InvestigationRecord,
  withFindings: boolean,
): InvestigationView => ({
  investigationId: state.investigationId,
  violationId: state.violationId,
  investigatorMembershipId: state.investigatorMembershipId,
  openedOn: state.openedOn,
  subject: state.subject,
  state: state.state,
  version: state.version,
  ...(state.concludedOn === undefined ? {} : { concludedOn: state.concludedOn }),
  ...(state.correctsInvestigationId === undefined
    ? {}
    : { correctsInvestigationId: state.correctsInvestigationId }),
  ...(withFindings && state.findings !== undefined ? { findings: state.findings } : {}),
  ...(withFindings && state.recommendation !== undefined
    ? { recommendation: state.recommendation }
    : {}),
});

export const caseEventView = (state: CaseEventState): CaseEventView => ({
  caseEventId: state.caseEventId,
  sequence: state.sequence,
  fromState: state.fromState,
  toState: state.toState,
  reason: state.reason,
  actor: state.actor,
  occurredAt: state.occurredAt.toISOString(),
  ...(state.investigationId === undefined ? {} : { investigationId: state.investigationId }),
});

/**
 * The case, with its current state derived here rather than read from a column.
 *
 * The derivation is `currentCaseState` and nothing else — the same function the command handlers
 * validate transitions against, so what a screen shows and what the server enforces cannot drift.
 */
export const caseHistoryView = (
  violationId: string,
  history: readonly CaseEventState[],
): CaseHistoryView => ({
  violationId,
  currentState: currentCaseState(history),
  history: [...history].sort((a, b) => a.sequence - b.sequence).map(caseEventView),
});

export const disciplinaryRuleView = (state: DisciplinaryRuleState): DisciplinaryRuleView => ({
  disciplinaryRuleId: state.disciplinaryRuleId,
  violationCategoryId: state.violationCategoryId,
  minOccurrence: state.minOccurrence,
  action: state.action,
  sequence: state.sequence,
  active: state.active,
  version: state.version,
});

/**
 * An issued action, as published.
 *
 * `issuedBy` **is** published, unlike a violation's `reportedBy`. The distinction is deliberate: a
 * reporter is somebody whose identity the accused has no automatic right to, whereas the person who
 * disciplined you is a fact you are entitled to know — it is on the letter, and a decision nobody
 * will put their name to is not a decision.
 */
export const disciplinaryActionView = (state: DisciplinaryActionState): DisciplinaryActionView => ({
  disciplinaryActionId: state.disciplinaryActionId,
  violationId: state.violationId,
  investigationId: state.investigationId,
  action: state.action,
  prescribedByRule: state.prescribedByRule,
  occurrenceAtIssue: state.occurrenceAtIssue,
  reason: state.reason,
  issuedBy: state.issuedBy,
  issuedOn: state.issuedOn,
  version: state.version,
  ...(state.disciplinaryRuleId === undefined
    ? {}
    : { disciplinaryRuleId: state.disciplinaryRuleId }),
});
