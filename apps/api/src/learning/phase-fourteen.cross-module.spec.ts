import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type {
  AssignmentView,
  CertificationView,
  LearningHistoryView,
  ReconciliationView,
} from '@work/learning';

import {
  CONNECTION,
  DOCUMENT_ID,
  EMPLOYEE_ID,
  TENANT,
  TODAY,
  UNIT_ID,
  ask,
  harnessFor,
  requireDatabaseInCi,
  send,
  type CrossModuleHarness,
} from './phase-fourteen-harness.js';

/**
 * Learning end to end: one real dispatcher, the real handlers, the real PostgreSQL repositories and
 * the **production** cross-module adapters, each reaching Employment, Organization and Documents
 * through their published queries under bounded service grants.
 *
 * Nothing in this file is faked at the boundary being verified. The upstream modules are stub
 * *handlers on the same dispatcher* declaring the same permissions the real handlers declare, so an
 * adapter whose grant named the wrong permission is refused here exactly as in production.
 */

/**
 * The first element, or a failure that names the step rather than the next one.
 *
 * `?? ''` at each call site would keep the test compiling and fail three assertions later with an
 * empty identifier, which reads as a mystery. It also costs a branch per use, and a scenario with a
 * dozen of them exceeds the complexity budget for no benefit to anybody reading it.
 */
const only = <TItem>(items: readonly TItem[], step: string): TItem => {
  const [first] = items;

  if (first === undefined) throw new Error(`Expected ${step} to have produced something.`);
  return first;
};

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Phase 14A cross-module suite');

suite('Phase 14A — Learning across modules', () => {
  let harness: CrossModuleHarness;

  beforeAll(() => {
    harness = harnessFor();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.truncate();
  });

  const aPublishedCourse = async (code = 'fire-safety'): Promise<string> => {
    const { courseId } = await send<{ courseId: string }>(harness, {
      commandName: 'learning.create-course',
      code,
      name: { en: 'Fire safety', ar: 'السلامة من الحرائق' },
      delivery: 'classroom',
    });

    await send(harness, {
      commandName: 'learning.publish-course-version',
      courseId,
      expectedVersion: 1,
      title: { en: 'Fire safety v1', ar: 'السلامة ١' },
      requiresAssessment: true,
      certificationValidMonths: 12,
    });

    return courseId;
  };

  describe('the mandatory journey', () => {
    it('runs the whole flow through the real stack, from catalogue to derived validity', async () => {
      const courseId = await aPublishedCourse();
      const versions = await ask<{ readonly versions: readonly { courseVersionId: string }[] }>(
        harness,
        { queryName: 'learning.read-course', courseId },
      );
      const courseVersionId = only(versions.versions, 'the course').courseVersionId;

      // 1–2. The catalogue, and the requirement built on it. The unit is confirmed through
      // Organization's published `unit-ancestry` under a bounded grant before the rule is stored.
      const { assessmentId } = await send<{ assessmentId: string }>(harness, {
        commandName: 'learning.define-assessment',
        courseVersionId,
        title: { en: 'Practical check', ar: 'الفحص العملي' },
        kind: 'practical',
        required: true,
      });
      const { mandatoryRuleId } = await send<{ mandatoryRuleId: string }>(harness, {
        commandName: 'learning.define-mandatory-rule',
        courseId,
        name: { en: 'Annual fire safety', ar: 'السلامة السنوية' },
        kind: 'safety',
        audience: 'organization_unit',
        organizationUnitId: UNIT_ID,
        effectiveFrom: '2024-01-01',
        recurrenceMonths: 12,
        dueWithinDays: 30,
      });

      // 3–4. The audience is resolved through Employment's real `search` contract, and the ended
      // employment is not obliged: Employment says `ended`, and the adapter maps that to inactive.
      const run = await send<ReconciliationView>(harness, {
        commandName: 'learning.reconcile-requirements',
        mandatoryRuleId,
      });

      expect(run.generated).toBe(3);
      expect(run.examined).toBe(3);

      const queue = await ask<{ readonly items: readonly AssignmentView[] }>(harness, {
        queryName: 'learning.search-assignments',
        employmentId: EMPLOYEE_ID,
      });
      const generated = only(queue.items, 'reconciliation');
      const assignmentId = generated.assignmentId;

      expect(generated.source).toBe('mandatory_rule');
      expect(generated.occurrenceKey).toBe('2024-01-01');
      // Derived from the due date and today, not read from a column.
      expect(generated.overdue).toBe(true);

      // 5–6. Enrol and progress. The employment is confirmed again through Employment's contract.
      const { enrolmentId } = await send<{ enrolmentId: string }>(harness, {
        commandName: 'learning.enrol',
        employmentId: EMPLOYEE_ID,
        courseId,
        assignmentId,
      });

      await send(harness, {
        commandName: 'learning.start-enrolment',
        enrolmentId,
        expectedVersion: 1,
      });

      // 7. The assessment, recorded as an outcome. Nothing totals it.
      await send(harness, {
        commandName: 'learning.record-assessment-result',
        assessmentId,
        enrolmentId,
        outcome: 'passed',
        rawMark: '18.5',
        rawMarkScale: 'out of 20',
        assessedOn: TODAY,
      });
      await send(harness, {
        commandName: 'learning.complete-enrolment',
        enrolmentId,
        expectedVersion: 2,
        completedOn: TODAY,
      });

      // The completion closed the requirement it came from, in the same transaction.
      const closed = await ask<{ readonly items: readonly AssignmentView[] }>(harness, {
        queryName: 'learning.search-assignments',
        employmentId: EMPLOYEE_ID,
      });

      expect(only(closed.items, 'the completion').status).toBe('satisfied');

      // 8–9. The certificate, with the validity the pinned version was configured with, derived
      // against the day asked about rather than stored.
      await send(harness, {
        commandName: 'learning.issue-certification',
        employmentId: EMPLOYEE_ID,
        enrolmentId,
        courseId,
        title: 'Fire safety',
        source: 'learning_completion',
        issuedOn: TODAY,
        evidenceDocumentId: DOCUMENT_ID,
      });

      const held = await ask<{ readonly items: readonly CertificationView[] }>(harness, {
        queryName: 'learning.search-certifications',
        employmentId: EMPLOYEE_ID,
      });

      const certificate = only(held.items, 'issuance');

      expect(certificate.validUntil).toBe('2027-08-12');
      expect(certificate.validity).toBe('valid');
      expect(certificate.evidenceDocumentId).toBe(DOCUMENT_ID);

      // 10. The projection, assembled on read from the three authoritative tables.
      const history = await ask<LearningHistoryView>(harness, {
        queryName: 'learning.read-history',
        employmentId: EMPLOYEE_ID,
      });

      expect(history.completedCourses).toBe(1);
      expect(history.activeCertifications).toBe(1);
      expect(history.openAssignments).toBe(0);
      expect(history.overdueAssignments).toBe(0);

      // 12. And the retry-sensitive steps, repeated. No duplicates anywhere.
      const again = await send<ReconciliationView>(harness, {
        commandName: 'learning.reconcile-requirements',
        mandatoryRuleId,
      });

      expect(again.generated).toBe(0);

      const reissued = await send<{ created: boolean }>(harness, {
        commandName: 'learning.issue-certification',
        employmentId: EMPLOYEE_ID,
        enrolmentId,
        courseId,
        title: 'Fire safety',
        source: 'learning_completion',
        issuedOn: TODAY,
      });

      expect(reissued.created).toBe(false);

      const counted = await harness.pool.query<{ total: string }>(
        `select count(*)::text as total from learning_certification where tenant_id = $1`,
        [TENANT],
      );

      expect(counted.rows[0]?.total).toBe('1');
    });

    it('records a notification intent and claims no delivery', async () => {
      const courseId = await aPublishedCourse();

      await send(harness, {
        commandName: 'learning.assign',
        employmentId: EMPLOYEE_ID,
        courseId,
        dueOn: '2026-09-30',
      });

      const [sent] = harness.notifications.sent;

      expect(sent?.templateKey).toBe('learning.assignment.created');
      // The port records; nothing delivers. There is no "deliveredAt" to assert, and that absence
      // is the honest state of the capability.
      expect(Object.keys(sent ?? {})).not.toContain('deliveredAt');
    });
  });
});
