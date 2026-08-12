import { describe, expect, it } from 'vitest';

import {
  addDays,
  addMonths,
  issueCertification,
  revokeCertification,
  supersedeCertification,
  validityOf,
  type CertificationState,
} from './certification.js';

/**
 * What Learning issues, how long it stays true, and who owns that answer (ADR-0070).
 *
 * The approved resolution D-1 split one ambiguous question into three: `person_history.expires_on`
 * keeps what somebody arrived with, `document.expiry_date` keeps the validity of a scan, and this
 * keeps the validity of the qualification this employer issued. These cases pin the third of those,
 * and the derivation that means no scheduler is needed to make it true.
 */

const AT = new Date('2026-03-01T09:00:00.000Z');

const issued = (
  over: Partial<Parameters<typeof issueCertification>[0]> = {},
): CertificationState => {
  const result = issueCertification({
    certificationId: 'certification-1',
    employmentId: 'employment-1',
    enrolmentId: 'enrolment-1',
    courseId: 'course-1',
    title: 'Fire safety',
    source: 'learning_completion',
    issuedOn: '2026-03-01',
    validUntil: '2027-03-01',
    issuedBy: 'user-admin',
    ...over,
  });

  if (!result.ok) throw new Error(result.error.reason);
  return result.value;
};

describe('issuing a certification', () => {
  it('records a certification that never came from a course, without inventing an enrolment', () => {
    const external = issueCertification({
      certificationId: 'certification-2',
      employmentId: 'employment-1',
      title: 'Forklift licence',
      source: 'external',
      issuedOn: '2026-01-15',
      validUntil: '2029-01-15',
      issuedBy: 'user-admin',
    });

    expect(external.ok).toBe(true);
    if (!external.ok) return;
    expect(external.value.enrolmentId).toBeUndefined();
    expect(external.value.courseId).toBeUndefined();
    expect(external.value.source).toBe('external');
  });

  it('refuses to claim a course completion with no enrolment behind it', () => {
    const result = issueCertification({
      certificationId: 'certification-3',
      employmentId: 'employment-1',
      title: 'Fire safety',
      source: 'learning_completion',
      issuedOn: '2026-03-01',
      issuedBy: 'user-admin',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe('certification-completion-requires-enrolment');
  });

  it('refuses a certificate that expired before it was issued', () => {
    const backwards = issueCertification({
      certificationId: 'certification-4',
      employmentId: 'employment-1',
      title: 'Fire safety',
      source: 'external',
      issuedOn: '2026-03-01',
      validUntil: '2025-03-01',
      issuedBy: 'user-admin',
    });

    expect(backwards.ok).toBe(false);
    if (!backwards.ok) expect(backwards.error.reason).toBe('certification-validity-before-issue');
  });

  it('refuses issuance by the auto-approver', () => {
    const result = issueCertification({
      certificationId: 'certification-5',
      employmentId: 'employment-1',
      title: 'Fire safety',
      source: 'recorded',
      issuedOn: '2026-03-01',
      issuedBy: 'system:auto-approval',
    });

    expect(result.ok).toBe(false);
  });

  it('holds an evidence document as an identifier and copies nothing else from Documents', () => {
    const state = issued({ evidenceDocumentId: 'document-9' });

    expect(state.evidenceDocumentId).toBe('document-9');
    expect(Object.keys(state)).not.toContain('fileName');
    expect(Object.keys(state)).not.toContain('storageReference');
  });
});

describe('validity, derived rather than stored', () => {
  const active = { status: 'active' as const, validUntil: '2027-03-01' };

  it('is valid well before the date and expired the day after it', () => {
    expect(validityOf(active, '2026-03-01')).toBe('valid');
    expect(validityOf(active, '2027-03-01')).toBe('valid');
    expect(validityOf(active, '2027-03-02')).toBe('expired');
  });

  it('reports expiring soon only within the notice window asked for', () => {
    expect(validityOf(active, '2027-02-01', 30)).toBe('expiring_soon');
    expect(validityOf(active, '2027-01-01', 30)).toBe('valid');
  });

  it('says no expiry rather than valid where there is no date at all', () => {
    expect(validityOf({ status: 'active' }, '2099-01-01')).toBe('no_expiry');
  });

  it('never calls a revoked certification valid, whatever its date says', () => {
    expect(validityOf({ status: 'revoked', validUntil: '2099-01-01' }, '2026-03-01')).toBe(
      'expired',
    );
    expect(validityOf({ status: 'superseded', validUntil: '2099-01-01' }, '2026-03-01')).toBe(
      'expired',
    );
  });
});

describe('revoking and superseding', () => {
  it('demands a reason and a named human, because this is somebody losing a qualification', () => {
    expect(revokeCertification(issued(), AT, 'user-admin', '   ').ok).toBe(false);
    expect(revokeCertification(issued(), AT, 'system:auto-approval', 'Withdrawn').ok).toBe(false);

    const revoked = revokeCertification(issued(), AT, 'user-admin', 'Licence withdrawn by issuer');

    expect(revoked.ok).toBe(true);
    if (revoked.ok) expect(revoked.value.revocationReason).toBe('Licence withdrawn by issuer');
  });

  it('keeps revoked and superseded apart, and both are terminal', () => {
    const revoked = revokeCertification(issued(), AT, 'user-admin', 'Withdrawn');
    const superseded = supersedeCertification(issued());

    if (!revoked.ok || !superseded.ok) throw new Error('expected both to succeed');
    expect(revoked.value.status).toBe('revoked');
    expect(superseded.value.status).toBe('superseded');
    expect(supersedeCertification(revoked.value).ok).toBe(false);
    expect(revokeCertification(superseded.value, AT, 'user-admin', 'Withdrawn').ok).toBe(false);
  });
});

describe('civil date arithmetic', () => {
  it('adds days in UTC, so a horizon does not shift with the container that computed it', () => {
    expect(addDays('2026-02-27', 2)).toBe('2026-03-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('clamps a month addition to the end of the target month rather than overflowing it', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2028-02-29', 12)).toBe('2029-02-28');
    expect(addMonths('2026-03-15', 12)).toBe('2027-03-15');
  });
});
