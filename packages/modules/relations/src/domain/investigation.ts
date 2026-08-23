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
