import { currentCaseState, type CaseEventState } from '../domain/case-event.js';
import type { InvestigationRecord } from '../domain/investigation.js';
import type { ViolationCategoryState } from '../domain/violation-category.js';
import type { ViolationRecord } from '../domain/violation.js';
import type {
  CaseEventView,
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

export const violationView = (state: ViolationRecord): ViolationView => ({
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
});

export const investigationView = (state: InvestigationRecord): InvestigationView => ({
  investigationId: state.investigationId,
  violationId: state.violationId,
  investigatorMembershipId: state.investigatorMembershipId,
  openedOn: state.openedOn,
  subject: state.subject,
  state: state.state,
  version: state.version,
  ...(state.findings === undefined ? {} : { findings: state.findings }),
  ...(state.recommendation === undefined ? {} : { recommendation: state.recommendation }),
  ...(state.concludedOn === undefined ? {} : { concludedOn: state.concludedOn }),
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
