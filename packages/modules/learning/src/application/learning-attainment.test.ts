import { beforeEach, describe, expect, it } from 'vitest';

import type { AssessmentResultView, CertificationView } from '../contracts/views.js';
import {
  HR,
  TODAY,
  ask,
  attempt,
  harnessFor,
  knownDocuments,
  reasonOf,
  send,
  withoutDocuments,
  type Harness,
} from './learning-test-harness.js';
import { EMPLOYMENT, aPublishedCourse, withWorkforce } from './learning-scenarios.js';

/**
 * Certification validity, assessment results, and the record a reader sees.
 *
 * The expiry cases are ADR-0070's boundaries, and one of them is a **regression**: a zero notice
 * window must never produce `expiring_soon`, including on the certificate's final valid day. That was
 * a real defect, found by a domain test during this phase, and it stays tested at the application
 * boundary because that is where a compliance count would have been wrong.
 */

describe('certification validity, derived on read', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = harnessFor();
    withWorkforce(harness);
  });

  const issued = async (validUntil?: string): Promise<void> => {
    await send(harness, {
      commandName: 'learning.issue-certification',
      employmentId: EMPLOYMENT,
      title: 'Forklift licence',
      source: 'external',
      issuedOn: '2026-01-15',
      ...(validUntil === undefined ? {} : { validUntil }),
    });
  };

  const validityOn = async (asOf: string, noticeDays?: number): Promise<string | undefined> => {
    const found = await ask<{ readonly items: readonly CertificationView[] }>(harness, {
      queryName: 'learning.search-certifications',
      employmentId: EMPLOYMENT,
      asOf,
      ...(noticeDays === undefined ? {} : { noticeDays }),
    });

    return found.items[0]?.validity;
  };

  it('is valid well before the date, and on the final valid day', async () => {
    await harness.as(HR, async () => {
      await issued('2027-03-01');

      expect(await validityOn('2026-08-12')).toBe('valid');
      expect(await validityOn('2027-03-01')).toBe('valid');
    });
  });

  it('is expired the day after it lapses', async () => {
    await harness.as(HR, async () => {
      await issued('2027-03-01');

      expect(await validityOn('2027-03-02')).toBe('expired');
    });
  });

  it('never says expiring soon when no notice window was asked for — the regression', async () => {
    await harness.as(HR, async () => {
      await issued('2027-03-01');

      // The final valid day with a zero window is a plain yes: a compliance count expecting two
      // answers and getting three is how this defect first showed up.
      expect(await validityOn('2027-03-01', 0)).toBe('valid');
      expect(await validityOn('2027-02-28', 0)).toBe('valid');
    });
  });

  it('says expiring soon only inside the window the caller asked for', async () => {
    await harness.as(HR, async () => {
      await issued('2027-03-01');

      expect(await validityOn('2027-02-01', 30)).toBe('expiring_soon');
      expect(await validityOn('2027-01-01', 30)).toBe('valid');
    });
  });

  it('says no expiry rather than valid where there is no date at all', async () => {
    await harness.as(HR, async () => {
      await issued();

      expect(await validityOn('2099-01-01')).toBe('no_expiry');
    });
  });

  it('never calls a revoked certification valid, whatever its date says', async () => {
    await harness.as(HR, async () => {
      const { certificationId } = await send<{ certificationId: string }>(harness, {
        commandName: 'learning.issue-certification',
        employmentId: EMPLOYMENT,
        title: 'Forklift licence',
        source: 'external',
        issuedOn: '2026-01-15',
        validUntil: '2099-01-15',
      });

      await send(harness, {
        commandName: 'learning.revoke-certification',
        certificationId,
        expectedVersion: 1,
        reason: 'Licence withdrawn by the issuer',
      });

      expect(await validityOn('2026-08-12')).toBe('expired');
    });
  });

  it('keeps the superseded predecessor readable when a recertification replaces it', async () => {
    await harness.as(HR, async () => {
      const first = await send<{ certificationId: string }>(harness, {
        commandName: 'learning.issue-certification',
        employmentId: EMPLOYMENT,
        title: 'Forklift licence',
        source: 'external',
        issuedOn: '2023-01-15',
        validUntil: '2026-01-15',
      });

      await send(harness, {
        commandName: 'learning.issue-certification',
        employmentId: EMPLOYMENT,
        title: 'Forklift licence',
        source: 'external',
        issuedOn: '2026-01-16',
        validUntil: '2029-01-16',
        supersedesCertificationId: first.certificationId,
      });

      const held = harness.stores.tables.certifications.get(first.certificationId);

      // The old row stays and says what happened to it. History is not deleted.
      expect(held?.status).toBe('superseded');
      expect(harness.stores.tables.certifications.size).toBe(2);
    });
  });

  it('holds an evidence document as a reference, and refuses one that cannot be confirmed', async () => {
    const documents = knownDocuments();

    documents.add('document-9');

    const withEvidence = harnessFor({ documents });

    withWorkforce(withEvidence);

    await withEvidence.as(HR, async () => {
      await send(withEvidence, {
        commandName: 'learning.issue-certification',
        employmentId: EMPLOYMENT,
        title: 'Forklift licence',
        source: 'external',
        issuedOn: '2026-01-15',
        evidenceDocumentId: 'document-9',
      });

      const refused = await attempt(withEvidence, {
        commandName: 'learning.issue-certification',
        employmentId: EMPLOYMENT,
        title: 'Another licence',
        source: 'external',
        issuedOn: '2026-01-15',
        evidenceDocumentId: 'document-404',
      });

      expect(reasonOf(refused)).toBe('learning.rejection.certification-evidence-unknown');
    });
  });

  it('refuses evidence entirely where Documents has no adapter, which is what production has', async () => {
    const bare = harnessFor({ documents: withoutDocuments });

    withWorkforce(bare);

    const refused = await bare.as(HR, () =>
      attempt(bare, {
        commandName: 'learning.issue-certification',
        employmentId: EMPLOYMENT,
        title: 'Forklift licence',
        source: 'external',
        issuedOn: '2026-01-15',
        evidenceDocumentId: 'document-9',
      }),
    );

    // It does not fabricate availability, and it does not quietly drop the reference.
    expect(reasonOf(refused)).toBe('learning.rejection.certification-evidence-unknown');
  });

  it('refuses a certification against an enrolment that has not been completed', async () => {
    await harness.as(HR, async () => {
      const course = await aPublishedCourse(harness);
      const { enrolmentId } = await send<{ enrolmentId: string }>(harness, {
        commandName: 'learning.enrol',
        employmentId: EMPLOYMENT,
        courseId: course.courseId,
      });

      const refused = await attempt(harness, {
        commandName: 'learning.issue-certification',
        employmentId: EMPLOYMENT,
        enrolmentId,
        title: 'Fire safety',
        source: 'learning_completion',
        issuedOn: TODAY,
      });

      expect(reasonOf(refused)).toBe('learning.rejection.certification-enrolment-not-completed');
    });
  });
});

describe('assessment results, recorded and never totalled', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = harnessFor();
    withWorkforce(harness);
  });

  it('keeps a raw mark exactly as it was typed and adds nothing up', async () => {
    await harness.as(HR, async () => {
      const course = await aPublishedCourse(harness, { requiresAssessment: true });
      const { assessmentId } = await send<{ assessmentId: string }>(harness, {
        commandName: 'learning.define-assessment',
        courseVersionId: course.courseVersionId,
        title: { en: 'Quiz', ar: 'اختبار' },
        kind: 'quiz',
        required: true,
      });
      const { enrolmentId } = await send<{ enrolmentId: string }>(harness, {
        commandName: 'learning.enrol',
        employmentId: EMPLOYMENT,
        courseId: course.courseId,
      });

      await send(harness, {
        commandName: 'learning.record-assessment-result',
        assessmentId,
        enrolmentId,
        outcome: 'passed',
        rawMark: '17.5',
        rawMarkScale: 'out of 20',
        assessedOn: TODAY,
      });

      const results = await ask<readonly AssessmentResultView[]>(harness, {
        queryName: 'learning.read-assessment-results',
        enrolmentId,
      });

      expect(results[0]?.rawMark).toBe('17.5');
      expect(results[0]?.outcome).toBe('passed');
      // No total, no average, no percentage, no verdict over the set. NOT VERIFIED, not invented.
      expect(Object.keys(results[0] ?? {})).not.toContain('score');
    });
  });

  it('records an observation without forcing it into a pass or a fail', async () => {
    await harness.as(HR, async () => {
      const course = await aPublishedCourse(harness);
      const { assessmentId } = await send<{ assessmentId: string }>(harness, {
        commandName: 'learning.define-assessment',
        courseVersionId: course.courseVersionId,
        title: { en: 'Observation', ar: 'ملاحظة' },
        kind: 'observation',
        required: false,
      });
      const { enrolmentId } = await send<{ enrolmentId: string }>(harness, {
        commandName: 'learning.enrol',
        employmentId: EMPLOYMENT,
        courseId: course.courseId,
      });

      await send(harness, {
        commandName: 'learning.record-assessment-result',
        assessmentId,
        enrolmentId,
        outcome: 'recorded',
        assessedOn: TODAY,
      });

      const results = await ask<readonly AssessmentResultView[]>(harness, {
        queryName: 'learning.read-assessment-results',
        enrolmentId,
      });

      expect(results[0]?.outcome).toBe('recorded');
    });
  });

  it('refuses a result for an assessment belonging to a different version of the course', async () => {
    await harness.as(HR, async () => {
      const course = await aPublishedCourse(harness);
      const { enrolmentId } = await send<{ enrolmentId: string }>(harness, {
        commandName: 'learning.enrol',
        employmentId: EMPLOYMENT,
        courseId: course.courseId,
      });
      const next = await send<{ courseVersionId: string }>(harness, {
        commandName: 'learning.publish-course-version',
        courseId: course.courseId,
        expectedVersion: 2,
        title: { en: 'v2', ar: '٢' },
        requiresAssessment: true,
      });
      const { assessmentId } = await send<{ assessmentId: string }>(harness, {
        commandName: 'learning.define-assessment',
        courseVersionId: next.courseVersionId,
        title: { en: 'New quiz', ar: 'اختبار جديد' },
        kind: 'quiz',
        required: true,
      });

      const refused = await attempt(harness, {
        commandName: 'learning.record-assessment-result',
        assessmentId,
        enrolmentId,
        outcome: 'passed',
        assessedOn: TODAY,
      });

      // A syllabus change must not silently decide whether an older enrolment can complete.
      expect(reasonOf(refused)).toBe('learning.rejection.assessment-version-mismatch');
    });
  });
});
