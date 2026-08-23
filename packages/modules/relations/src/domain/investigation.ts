import { accept, refuse, type RelationsResult } from './relations-rejection.js';
import type { InvestigationState } from './relations-vocabulary.js';

/**
 * The inquiry into a recorded violation.
 *
 * **It names a membership and never a person** (AD-001). The investigator is held as a tenant
 * membership identifier, exactly as ADR-0032 resolves a principal, and Relations resolves it to
 * nobody: a disciplinary module that knew people's names would be a directory of accused people and
 * their accusers.
 *
 * **Open is a draft; concluded is evidence.** While open, an investigator is still writing, and the
 * row may be corrected. The moment it concludes it stops moving — the database refuses every update
 * and every delete on a concluded row, from any path including a direct `psql` session. That is the
 * same shape `letter_template_version` uses to freeze a version once issued, and the reason is the
 * same: something a tribunal may read must not be editable after the fact.
 *
 * **Findings, recommendation and conclusion date are all-or-nothing.** A conclusion without findings
 * is a case that closed for no stated reason, and the database constraint is what makes that true
 * rather than a convention this file states politely.
 *
 * **One open investigation per violation, settled by a partial unique index** rather than by a read
 * that precedes an insert (ADR-0071). Any number of concluded investigations may accumulate on one
 * violation; at most one may be in progress.
 *
 * **The recommendation is text and nothing more.** It is not an instruction, not a command to
 * Payroll, not a workflow trigger. A recommendation that automatically did something would be this
 * module deciding a disciplinary outcome, which is a decision named humans make (ADR-0045).
 */
export interface InvestigationRecord {
  readonly investigationId: string;
  readonly violationId: string;
  /** A tenant membership identifier, held as a value. Resolved to a person by nobody here. */
  readonly investigatorMembershipId: string;
  /** The civil date the inquiry opened, `YYYY-MM-DD`. Never a timestamp. */
  readonly openedOn: string;
  readonly subject: string;
  readonly state: InvestigationState;
  /** Null while open; required at conclusion, with the two below. */
  readonly findings?: string;
  readonly recommendation?: string;
  readonly concludedOn?: string;
  /**
   * The concluded investigation this one corrects, where it corrects one (D-5.2-19).
   *
   * **Backward, never forward.** The corrected row carries no pointer to its correction, so it is
   * never written to and its immutability trigger needs no exception — the difference from
   * `letter_issued`, which stamps the original and had to narrow its trigger to permit exactly one
   * write. Which conclusion is operative is derived from the chain, as case state is derived from
   * history (D-5.2-16), so there is no stored answer that could disagree with the records.
   */
  readonly correctsInvestigationId?: string;
  readonly version: number;
}

export const SUBJECT_LIMIT = 4000;
export const FINDINGS_LIMIT = 8000;
export const RECOMMENDATION_LIMIT = 4000;

const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface OpenInvestigationRequest {
  readonly investigationId: string;
  readonly violationId: string;
  readonly investigatorMembershipId: string;
  readonly openedOn: string;
  readonly subject: string;
  /** The civil date at the opening instant, for the not-in-the-future rule. */
  readonly today: string;
}

export const openInvestigation = (
  request: OpenInvestigationRequest,
): RelationsResult<InvestigationRecord> => {
  if (!CIVIL_DATE.test(request.openedOn)) {
    return refuse('opened_on_malformed', { field: 'openedOn' });
  }
  if (request.openedOn > request.today) {
    return refuse('opened_on_in_future', { field: 'openedOn' });
  }
  if (request.investigatorMembershipId.trim() === '') {
    return refuse('investigator_unknown', { field: 'investigatorMembershipId' });
  }

  const subject = request.subject.trim();

  if (subject === '') return refuse('subject_missing', { field: 'subject' });
  if (subject.length > SUBJECT_LIMIT) return refuse('subject_too_long', { field: 'subject' });

  return accept({
    investigationId: request.investigationId,
    violationId: request.violationId,
    investigatorMembershipId: request.investigatorMembershipId,
    openedOn: request.openedOn,
    subject,
    state: 'open',
    version: 1,
  });
};

export interface ConcludeInvestigationRequest {
  readonly investigation: InvestigationRecord;
  readonly findings: string;
  readonly recommendation: string;
  readonly concludedOn: string;
  readonly today: string;
}

export const concludeInvestigation = (
  request: ConcludeInvestigationRequest,
): RelationsResult<InvestigationRecord> => {
  const { investigation } = request;

  if (investigation.state === 'concluded') {
    // Refused here so the caller reads a business refusal rather than a database exception. The
    // trigger refuses it too — this is the same rule stated in both places somebody might try.
    return refuse('investigation_already_concluded', { field: 'state' });
  }

  const dates = validateConclusionDates(request);

  if (!dates.ok) return dates;

  const findings = request.findings.trim();
  const recommendation = request.recommendation.trim();

  if (findings === '') return refuse('findings_missing', { field: 'findings' });
  if (findings.length > FINDINGS_LIMIT) return refuse('findings_too_long', { field: 'findings' });
  if (recommendation === '') return refuse('recommendation_missing', { field: 'recommendation' });
  if (recommendation.length > RECOMMENDATION_LIMIT) {
    return refuse('recommendation_too_long', { field: 'recommendation' });
  }

  return accept({
    ...investigation,
    state: 'concluded',
    findings,
    recommendation,
    concludedOn: request.concludedOn,
    // `version` carries through unchanged. The repository appends `version = version + 1`, so a
    // domain that incremented it would write the number twice — the mistake Checkpoint 1's mapper
    // records, in the layer it belongs to.
    version: investigation.version,
  });
};

const validateConclusionDates = (request: ConcludeInvestigationRequest): RelationsResult<true> => {
  if (!CIVIL_DATE.test(request.concludedOn)) {
    return refuse('concluded_on_malformed', { field: 'concludedOn' });
  }
  if (request.concludedOn > request.today) {
    return refuse('concluded_on_in_future', { field: 'concludedOn' });
  }
  if (request.concludedOn < request.investigation.openedOn) {
    // An inquiry that concluded before it opened is a data-entry error, not a short investigation.
    return refuse('concluded_before_opened', { field: 'concludedOn' });
  }
  return accept(true);
};

export interface CorrectInvestigationRequest {
  readonly investigationId: string;
  /** The concluded investigation being corrected, as read from persisted data. */
  readonly corrected: InvestigationRecord;
  readonly findings: string;
  readonly recommendation: string;
  readonly concludedOn: string;
  /** Why the earlier conclusion was wrong. Required, and never defaulted. */
  readonly reason: string;
  readonly today: string;
}

export const CORRECTION_REASON_LIMIT = 2000;

/**
 * A correction: a **new** investigation that says what the earlier one should have said.
 *
 * The record it corrects is passed in and comes back untouched — this function returns a second
 * record and never a modified first. That is AD-003's *"a correction is a new, linked record with a
 * stated reason"*, and it is the shape Payroll's reversal, Attendance's correction and Letters'
 * supersession all take: nothing is deleted, and the chain reads as what actually happened.
 *
 * It is born `concluded`. There is no draft state for a correction, because the inquiry it corrects
 * has already been conducted; what is being corrected is the account of it, not the work.
 *
 * **It inherits the violation, the investigator and the opening date of what it corrects.** A
 * correction is the same inquiry restated, not a second inquiry — reassigning it to a different
 * investigator or a different violation would make it a new investigation wearing a correction's
 * name, and the caller has `open-investigation` for that.
 */
export const correctInvestigation = (
  request: CorrectInvestigationRequest,
): RelationsResult<InvestigationRecord> => {
  const { corrected } = request;

  if (corrected.state !== 'concluded') {
    // Only a conclusion can be wrong in the way a correction fixes. An open inquiry is still being
    // written and its own update path already handles it.
    return refuse('correction_target_not_concluded', { field: 'investigationId' });
  }
  // **Whether this conclusion has already been corrected is not knowable here**, and this function
  // deliberately does not guess. It sees one record; "has anything corrected it" is a question about
  // the chain, which the use case reads and `relation_investigation_corrects_idx` settles under
  // concurrency. An earlier draft refused any row that *was itself* a correction, which was the
  // wrong test entirely — a correction is the newest link and is exactly what a second correction
  // must attach to.
  const reason = request.reason.trim();

  if (reason === '') return refuse('correction_reason_missing', { field: 'reason' });
  if (reason.length > CORRECTION_REASON_LIMIT) {
    return refuse('correction_reason_too_long', { field: 'reason' });
  }

  const restated = concludeInvestigation({
    // Concluded as a fresh open record, so every rule a first conclusion must satisfy — the date
    // bounds, the all-or-nothing halves, the length limits — is applied to a correction identically
    // rather than approximately.
    investigation: {
      ...corrected,
      investigationId: request.investigationId,
      state: 'open',
      version: 1,
    },
    findings: request.findings,
    recommendation: request.recommendation,
    concludedOn: request.concludedOn,
    today: request.today,
  });

  if (!restated.ok) return restated;

  return accept({ ...restated.value, correctsInvestigationId: corrected.investigationId });
};

/**
 * The conclusion that stands, from a violation's investigations alone.
 *
 * A conclusion is superseded when some other investigation names it as corrected; the operative one
 * is the concluded investigation nobody has corrected. **Derived, never stored** — the same rule as
 * current case state, for the same reason.
 *
 * Returns `undefined` while no inquiry has concluded, which is a real answer rather than an absence:
 * a case under investigation has no findings yet.
 */
export const operativeConclusion = (
  investigations: readonly InvestigationRecord[],
): InvestigationRecord | undefined => {
  const corrected = new Set(
    investigations
      .map((investigation) => investigation.correctsInvestigationId)
      .filter((id): id is string => id !== undefined),
  );

  return investigations.find(
    (investigation) =>
      investigation.state === 'concluded' && !corrected.has(investigation.investigationId),
  );
};
