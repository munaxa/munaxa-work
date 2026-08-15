import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AssessmentResultView, AssignmentView, ReconciliationView } from '@work/learning';

import {
  CONNECTION,
  DOCUMENT_ID,
  EMPLOYEE_ID,
  ENDED_ID,
  PEER_ID,
  POSITION_ID,
  TENANT,
  TODAY,
  UNIT_ID,
  ask,
  attempt,
  harnessFor,
  reasonOf,
  requireDatabaseInCi,
  send,
  type CrossModuleHarness,
} from './phase-fourteen-harness.js';

/**
 * What Learning does when a module it depends on cannot answer — and the three things it refuses to
 * invent on the way.
 *
 * Every refusal below is proved against the **production adapters**, reaching the upstream contracts
 * through the real bounded service grants. The dangerous version of each case is the quiet one: a
 * reconciliation reporting full compliance for an organization it never looked at, a certification
 * recorded against an employment nobody confirmed, or a screen implying a certificate is on file
 * because a document reference was accepted without checking.
 *
 * Each block also proves the **permitted** case, because a module that refused everything would pass
 * a suite that only tested refusals.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Phase 14A dependency suite');

suite('Phase 14A — Learning and its dependencies', () => {
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

  describe('when a dependency cannot answer', () => {
    it('refuses to reconcile rather than reporting that nobody needs training', async () => {
      const courseId = await aPublishedCourse();
      const { mandatoryRuleId } = await send<{ mandatoryRuleId: string }>(harness, {
        commandName: 'learning.define-mandatory-rule',
        courseId,
        name: { en: 'Annual', ar: 'سنوي' },
        kind: 'safety',
        audience: 'everybody',
        effectiveFrom: '2024-01-01',
        recurrenceMonths: 12,
        dueWithinDays: 30,
      });

      harness.facts.employmentReachable = false;

      const refused = await attempt(harness, {
        commandName: 'learning.reconcile-requirements',
        mandatoryRuleId,
      });

      // `{ generated: 0, alreadyPresent: 0 }` would read as "everybody is up to date" on a
      // compliance screen for an organization this never looked at.
      expect(reasonOf(refused)).toBe('learning.rejection.employment-unavailable');

      const counted = await harness.pool.query<{ total: string }>(
        `select count(*)::text as total from learning_assignment where tenant_id = $1`,
        [TENANT],
      );

      expect(counted.rows[0]?.total).toBe('0');
    });

    it('does not invent an employee when Employment is unreachable', async () => {
      const courseId = await aPublishedCourse();

      harness.facts.employmentReachable = false;

      const refused = await attempt(harness, {
        commandName: 'learning.assign',
        employmentId: EMPLOYEE_ID,
        courseId,
      });

      expect(reasonOf(refused)).toBe('learning.rejection.assignment-employment-unknown');
    });

    it('does not treat an unknown unit as valid when Organization is unreachable', async () => {
      const courseId = await aPublishedCourse();

      harness.facts.organizationReachable = false;

      const refused = await attempt(harness, {
        commandName: 'learning.define-mandatory-rule',
        courseId,
        name: { en: 'Unit training', ar: 'تدريب الوحدة' },
        kind: 'compliance',
        audience: 'organization_unit',
        organizationUnitId: UNIT_ID,
        effectiveFrom: '2024-01-01',
        recurrenceMonths: 12,
        dueWithinDays: 30,
      });

      expect(reasonOf(refused)).toBe('learning.rejection.rule-organization-unit-unknown');
    });

    it('does not fabricate document availability when Documents has nothing', async () => {
      harness.facts.documentPresent = false;

      const refused = await attempt(harness, {
        commandName: 'learning.issue-certification',
        employmentId: EMPLOYEE_ID,
        title: 'Forklift licence',
        source: 'external',
        issuedOn: '2026-01-15',
        evidenceDocumentId: DOCUMENT_ID,
      });

      expect(reasonOf(refused)).toBe('learning.rejection.certification-evidence-unknown');
    });

    it('refuses an employment Employment reports as ended', async () => {
      const courseId = await aPublishedCourse();

      const refused = await attempt(harness, {
        commandName: 'learning.assign',
        employmentId: ENDED_ID,
        courseId,
      });

      expect(reasonOf(refused)).toBe('learning.rejection.assignment-employment-inactive');
    });

    it('still permits everything once the dependencies answer again', async () => {
      const courseId = await aPublishedCourse();

      harness.facts.employmentReachable = false;
      expect(
        reasonOf(
          await attempt(harness, {
            commandName: 'learning.assign',
            employmentId: EMPLOYEE_ID,
            courseId,
          }),
        ),
      ).toBe('learning.rejection.assignment-employment-unknown');

      // The refusal is about the dependency, not a state this module latched. Nothing to reset.
      harness.facts.employmentReachable = true;

      const assigned = await send<{ created: boolean }>(harness, {
        commandName: 'learning.assign',
        employmentId: EMPLOYEE_ID,
        courseId,
      });

      expect(assigned.created).toBe(true);
    });
  });

  describe('the audience, resolved through the real contract', () => {
    it('covers a position through Employment’s own filter, not a stored list', async () => {
      const courseId = await aPublishedCourse();
      const { mandatoryRuleId } = await send<{ mandatoryRuleId: string }>(harness, {
        commandName: 'learning.define-mandatory-rule',
        courseId,
        name: { en: 'Role training', ar: 'تدريب الدور' },
        kind: 'role_based',
        audience: 'position',
        positionId: POSITION_ID,
        effectiveFrom: '2024-01-01',
        recurrenceMonths: 12,
        dueWithinDays: 30,
      });

      const run = await send<ReconciliationView>(harness, {
        commandName: 'learning.reconcile-requirements',
        mandatoryRuleId,
      });

      // Only the one employment Employment reports in that position.
      expect(run).toMatchObject({ examined: 1, generated: 1 });
    });

    it('covers somebody who transfers in afterwards, with nobody editing the rule', async () => {
      const courseId = await aPublishedCourse();
      const { mandatoryRuleId } = await send<{ mandatoryRuleId: string }>(harness, {
        commandName: 'learning.define-mandatory-rule',
        courseId,
        name: { en: 'Unit training', ar: 'تدريب الوحدة' },
        kind: 'compliance',
        audience: 'organization_unit',
        organizationUnitId: UNIT_ID,
        effectiveFrom: '2024-01-01',
        recurrenceMonths: 12,
        dueWithinDays: 30,
      });

      expect(
        (
          await send<ReconciliationView>(harness, {
            commandName: 'learning.reconcile-requirements',
            mandatoryRuleId,
          })
        ).generated,
      ).toBe(3);

      harness.facts.employments.push({
        employmentId: '01900000-0000-7000-8000-00000000d0ff',
        status: 'active',
        unitId: UNIT_ID,
      });

      const later = await send<ReconciliationView>(harness, {
        commandName: 'learning.reconcile-requirements',
        mandatoryRuleId,
      });

      expect(later).toMatchObject({ examined: 4, generated: 1, alreadyPresent: 3 });
    });
  });

  describe('assessments, with no formula invented', () => {
    it('records the outcome and the tenant’s own mark, and totals nothing', async () => {
      const courseId = await aPublishedCourse();
      const detail = await ask<{ readonly versions: readonly { courseVersionId: string }[] }>(
        harness,
        { queryName: 'learning.read-course', courseId },
      );
      const { assessmentId } = await send<{ assessmentId: string }>(harness, {
        commandName: 'learning.define-assessment',
        courseVersionId: detail.versions[0]?.courseVersionId ?? '',
        title: { en: 'Observation', ar: 'ملاحظة' },
        kind: 'observation',
        required: false,
      });
      const { enrolmentId } = await send<{ enrolmentId: string }>(harness, {
        commandName: 'learning.enrol',
        employmentId: EMPLOYEE_ID,
        courseId,
      });

      await send(harness, {
        commandName: 'learning.record-assessment-result',
        assessmentId,
        enrolmentId,
        outcome: 'recorded',
        // A mark a parse would silently alter: `Number('18.50')` is `18.5`, and a tenant who wrote
        // two decimal places would be shown one. The domain permits up to twelve integer digits and
        // four decimals; this sits well inside that and still proves nothing on the path parses it.
        rawMark: '18.50',
        rawMarkScale: 'out of 20',
        assessedOn: TODAY,
      });

      const results = await ask<readonly AssessmentResultView[]>(harness, {
        queryName: 'learning.read-assessment-results',
        enrolmentId,
      });

      // An observation is neither a pass nor a fail, and the mark comes back as it was typed.
      expect(results[0]?.outcome).toBe('recorded');
      expect(results[0]?.rawMark).toBe('18.50');
      // The assertion that gives the previous line its meaning: a parse *would* have changed it.
      expect(String(Number('18.50'))).not.toBe('18.50');
      expect(Object.keys(results[0] ?? {})).not.toContain('score');
    });
  });

  describe('self-service and team reads', () => {
    it('gives a `read-team` caller nothing, whatever employment they name', async () => {
      const courseId = await aPublishedCourse();

      await send(harness, {
        commandName: 'learning.assign',
        employmentId: EMPLOYEE_ID,
        courseId,
      });

      const team = harnessFor({
        permissions: ['learning.assignment.read', 'learning.assignment.read-team'],
        facts: harness.facts,
      });

      try {
        const found = await team.as('user:some-manager', () =>
          ask<{ readonly items: readonly AssignmentView[] }>(team, {
            queryName: 'learning.search-assignments',
            employmentId: EMPLOYEE_ID,
          }),
        );

        // There is no principal-to-employment resolution (ADR-0032), so a caller-supplied
        // identifier is not proof of identity and honouring it would be an IDOR. NOT VERIFIED.
        expect(found.items).toHaveLength(0);

        const managed = await team.as('user:some-manager', () =>
          ask<{ readonly items: readonly AssignmentView[] }>(team, {
            queryName: 'learning.search-assignments',
            employmentId: PEER_ID,
          }),
        );

        expect(managed.items).toHaveLength(0);
      } finally {
        await team.pool.end();
      }
    });
  });
});
