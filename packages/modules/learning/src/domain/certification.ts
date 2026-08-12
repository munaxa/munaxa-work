import {
  CERTIFICATION_TRANSITIONS,
  isCivilDate,
  type CertificationSource,
  type CertificationStatus,
  type ValidityState,
} from './learning-vocabulary.js';
import { accept, refuse, type LearningResult } from './learning-rejection.js';
import { definedOf } from './defined.js';

/**
 * Evidence that somebody attained something, and for how long it stays true.
 *
 * **Learning owns this expiry** (ADR-0070). `person_history.expires_on` keeps what somebody arrived
 * with; `document.expiry_date` keeps the validity of a *scan*; this keeps the validity of the
 * qualification itself. Three different questions, three owners, and the boundary is drawn by what
 * the record is about rather than by which module got there first.
 *
 * **A certification may exist with no enrolment** (D-2). A tenant recording a forklift licence
 * somebody already held must be able to; manufacturing an enrolment to satisfy a foreign key would
 * state that they took a course they never took. `source` says which of the three it is, as a fact
 * on the row rather than an inference from which columns are null.
 *
 * **`evidenceDocumentId` is an identifier and nothing else.** No filename, no size, no hash, no URL
 * and no version — Documents owns every one of those, and copying any of them here would recreate
 * the duplication ADR-0070 exists to prevent.
 */

export interface CertificationState {
  readonly certificationId: string;
  readonly employmentId: string;
  /** Absent for an externally obtained or administratively recorded certification. */
  readonly enrolmentId?: string;
  /** Absent where the qualification did not come from this catalogue. */
  readonly courseId?: string;
  readonly title: string;
  readonly source: CertificationSource;
  readonly status: CertificationStatus;
  /** Civil dates: a certificate is valid on a date, not at an instant in somebody's time zone. */
  readonly issuedOn: string;
  readonly validUntil?: string;
  /** The certification this one replaced, where it was a recertification. */
  readonly supersedesCertificationId?: string;
  /** An opaque Documents identifier. This module resolves nothing and holds no bytes. */
  readonly evidenceDocumentId?: string;
  readonly revokedAt?: Date;
  readonly revokedBy?: string;
  readonly revocationReason?: string;
  readonly issuedBy: string;
  readonly version: number;
}

export interface IssueCertificationRequest {
  readonly certificationId: string;
  readonly employmentId: string;
  readonly enrolmentId?: string;
  readonly courseId?: string;
  readonly title: string;
  readonly source: CertificationSource;
  readonly issuedOn: string;
  readonly validUntil?: string;
  readonly supersedesCertificationId?: string;
  readonly evidenceDocumentId?: string;
  readonly issuedBy: string;
}

const AUTO_APPROVAL = 'system:auto-approval';

export const issueCertification = (
  request: IssueCertificationRequest,
): LearningResult<CertificationState> => {
  if (request.title.trim().length === 0) return refuse('certification-title-required');
  if (!isCivilDate(request.issuedOn)) return refuse('certification-issue-date-invalid');
  if (request.validUntil !== undefined && !isCivilDate(request.validUntil)) {
    return refuse('certification-validity-date-invalid');
  }
  // A certificate that expired before it was issued is a data-entry error, and accepting it would
  // put a permanently-expired row in a compliance report nobody could explain.
  if (request.validUntil !== undefined && request.validUntil <= request.issuedOn) {
    return refuse('certification-validity-before-issue', {
      issuedOn: request.issuedOn,
      validUntil: request.validUntil,
    });
  }
  if (request.issuedBy === AUTO_APPROVAL) return refuse('certification-not-human');
  // The source must agree with what is actually attached. A certification claiming to come from a
  // completed course with no enrolment behind it would be unverifiable by anybody reading it later.
  if (request.source === 'learning_completion' && request.enrolmentId === undefined) {
    return refuse('certification-completion-requires-enrolment');
  }

  return accept({
    certificationId: request.certificationId,
    employmentId: request.employmentId,
    title: request.title,
    source: request.source,
    status: 'active',
    issuedOn: request.issuedOn,
    issuedBy: request.issuedBy,
    version: 1,
    ...definedOf({
      enrolmentId: request.enrolmentId,
      courseId: request.courseId,
      validUntil: request.validUntil,
      supersedesCertificationId: request.supersedesCertificationId,
      evidenceDocumentId: request.evidenceDocumentId,
    }),
  });
};

const permits = (from: CertificationStatus, to: CertificationStatus): boolean =>
  CERTIFICATION_TRANSITIONS[from].includes(to);

/**
 * Revoking is not deleting, and it is not expiring.
 *
 * Revoked says the issuer withdrew it — a licence pulled, a qualification found to be wrongly
 * issued. Expired says time passed. A report that could not tell them apart would describe two very
 * different situations identically, which is why one is a status and the other is derived.
 */
export const revokeCertification = (
  state: CertificationState,
  at: Date,
  by: string,
  reason: string,
): LearningResult<CertificationState> => {
  if (!permits(state.status, 'revoked')) {
    return refuse('certification-transition-refused', { from: state.status, to: 'revoked' });
  }
  if (reason.trim().length === 0) return refuse('certification-revocation-reason-required');
  if (by === AUTO_APPROVAL) return refuse('certification-not-human');

  return accept({
    ...state,
    status: 'revoked',
    revokedAt: at,
    revokedBy: by,
    revocationReason: reason,
  });
};

/** A recertification supersedes its predecessor. The old row stays, and says what replaced it. */
export const supersedeCertification = (
  state: CertificationState,
): LearningResult<CertificationState> => {
  if (!permits(state.status, 'superseded')) {
    return refuse('certification-transition-refused', { from: state.status, to: 'superseded' });
  }

  return accept({ ...state, status: 'superseded' });
};

/**
 * How a certification stands against its validity date — **derived, never stored**.
 *
 * `documents/src/domain/expiry.ts` states the reasoning and it holds here unchanged: a materialized
 * `expired` column needs something to move it from `valid` on the right morning, `JobPort` has no
 * adapter anywhere in this repository, and a stored flag nothing maintains is worse than no flag,
 * because a screen would show `valid` for a licence that lapsed in March and everybody would believe
 * it.
 *
 * So `validUntil` is the only fact, and the state is a function of it and today. The expiring queue
 * is then an indexed predicate over a date — correct at every instant, and the fastest thing this
 * module can do.
 *
 * A **revoked or superseded** certification is not `valid` whatever its date says: the status is
 * checked first, because a revoked licence with a date in the future is exactly the case a naive
 * date comparison gets wrong.
 */
export const validityOf = (
  state: Pick<CertificationState, 'status' | 'validUntil'>,
  today: string,
  noticeDays = 0,
): ValidityState => {
  if (state.status !== 'active') return 'expired';
  if (state.validUntil === undefined) return 'no_expiry';
  if (state.validUntil < today) return 'expired';
  // A caller asking for no notice window is asking a yes-or-no question, and answering
  // `expiring_soon` on the certificate's last day would put a warning in front of somebody who
  // asked for none — and, worse, in a compliance count that expected two values and got three.
  if (noticeDays === 0) return 'valid';
  return state.validUntil <= addDays(today, noticeDays) ? 'expiring_soon' : 'valid';
};

/**
 * A civil date `days` after another, in UTC.
 *
 * `Date.UTC` and never local time: a horizon computed at the process's local midnight is a different
 * day west of UTC, and an expiry queue that shifted by a day depending on where a container ran
 * would be wrong in exactly the way nobody notices.
 */
export const addDays = (date: string, days: number): string => {
  const at = new Date(`${date}T00:00:00.000Z`);

  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
};

/**
 * A civil date `months` after another, clamped to the end of the target month.
 *
 * Adding a month to 31 January must not silently become 3 March. `setUTCMonth` overflows, so the day
 * is clamped to the target month's length first — which is what a person means by "a year from the
 * 29th of February".
 */
export const addMonths = (date: string, months: number): string => {
  const at = new Date(`${date}T00:00:00.000Z`);
  const day = at.getUTCDate();
  const target = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + months, 1, 0, 0, 0, 0));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0, 0, 0, 0, 0),
  ).getUTCDate();

  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
};
