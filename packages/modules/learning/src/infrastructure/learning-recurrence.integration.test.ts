import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidV7 } from '@work/kernel';

import type { CertificationView, LearningHistoryView } from '../contracts/views.js';
import type { ReconciliationView } from '../contracts/views.js';
import {
  CONNECTION,
  TENANT_A,
  TENANT_B,
  openLearningFixture,
  requireDatabaseInCi,
  type LearningFixture,
} from './learning-database.fixture.js';
import {
  TODAY,
  ask,
  postgresHarnessFor,
  send,
  type PostgresHarness,
} from './learning-postgres-harness.js';

/**
 * Recurrence, expiry and the learning-record projection — over a real database.
 *
 * The application suites prove what the handlers decide. This proves the decisions survive
 * PostgreSQL: that the occurrence key a rule computes lands in the column the partial unique index
 * covers, that a certificate's validity is derived from the civil date the table actually returned,
 * and that a projection assembled from three real queries stays inside its tenant and its bound.
 *
 * **Nothing here is scheduled.** Every reconciliation below is a command somebody ran. `JobPort` has
 * no adapter anywhere in this repository, so scheduled execution remains `NOT VERIFIED` — and no
 * assertion pretends otherwise.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Learning recurrence-persistence suite');

const EMPLOYMENT = uuidV7();
const OTHER_EMPLOYMENT = uuidV7();

suite('learning recurrence over PostgreSQL', () => {
  let fixture: LearningFixture;
  let harness: PostgresHarness;

  beforeAll(async () => {
    fixture = await openLearningFixture('learning_recurrence_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
    harness = postgresHarnessFor(fixture);
    for (const employmentId of [EMPLOYMENT, OTHER_EMPLOYMENT]) {
      harness.employment.add({ employmentId, status: 'active', active: true });
    }
  });

  const aPublishedCourse = async (): Promise<string> => {
    const { courseId } = await send<{ courseId: string }>(harness, {
      commandName: 'learning.create-course',
      code: `fire-safety-${uuidV7().slice(0, 8)}`,
      name: { en: 'Fire safety', ar: 'السلامة من الحرائق' },
      delivery: 'classroom',
    });

    await send(harness, {
      commandName: 'learning.publish-course-version',
      courseId,
      expectedVersion: 1,
      title: { en: 'Fire safety v1', ar: 'السلامة ١' },
      requiresAssessment: false,
      certificationValidMonths: 12,
    });

    return courseId;
  };

  const aRule = async (courseId: string, recurrenceMonths = 12): Promise<string> => {
    const { mandatoryRuleId } = await send<{ mandatoryRuleId: string }>(harness, {
      commandName: 'learning.define-mandatory-rule',
      courseId,
      name: { en: 'Annual fire safety', ar: 'السلامة السنوية' },
      kind: 'safety',
      audience: 'everybody',
      effectiveFrom: '2024-01-01',
      recurrenceMonths,
      dueWithinDays: 30,
    });

    return mandatoryRuleId;
  };

  const reconcile = (mandatoryRuleId: string): Promise<ReconciliationView> =>
    send(harness, { commandName: 'learning.reconcile-requirements', mandatoryRuleId });

  describe('the current occurrence, persisted', () => {
    it('writes one occurrence per person, with the derived key and due date in the columns', async () => {
      await harness.as(TENANT_A, async () => {
        const courseId = await aPublishedCourse();
        const run = await reconcile(await aRule(courseId));

        expect(run).toMatchObject({ examined: 2, generated: 2, alreadyPresent: 0, notDue: 0 });
      });

      const rows = await fixture.admin.query<{ occurrence_key: string; due_on: string }>(
        `select to_char(occurrence_key, 'YYYY-MM-DD') as occurrence_key,
                to_char(due_on, 'YYYY-MM-DD') as due_on
           from learning_assignment where tenant_id = $1 order by employment_id`,
        [TENANT_A],
      );

      expect(rows.rows).toHaveLength(2);
      // Nobody has ever done it, so the occurrence is the one that opened when the rule took effect
      // — and the due date is that plus the tenant's own window, as a date and not an instant.
      expect(rows.rows[0]).toEqual({ occurrence_key: '2024-01-01', due_on: '2024-01-31' });
    });

    it('creates nothing on a second and third run, decided by the index', async () => {
      await harness.as(TENANT_A, async () => {
        const ruleId = await aRule(await aPublishedCourse());

        await reconcile(ruleId);
        expect(await reconcile(ruleId)).toMatchObject({ generated: 0, alreadyPresent: 2 });
        expect(await reconcile(ruleId)).toMatchObject({ generated: 0, alreadyPresent: 2 });
      });

      const counted = await fixture.admin.query<{ total: string }>(
        `select count(*)::text as total from learning_assignment where tenant_id = $1`,
        [TENANT_A],
      );

      expect(counted.rows[0]?.total).toBe('2');
    });

    it('creates exactly one occurrence when two connections reconcile at the same moment', async () => {
      const other = postgresHarnessFor(fixture, fixture.onSecondConnection());

      for (const employmentId of [EMPLOYMENT, OTHER_EMPLOYMENT]) {
        other.employment.add({ employmentId, status: 'active', active: true });
      }

      const ruleId = await harness.as(TENANT_A, async () => aRule(await aPublishedCourse()));

      const [first, second] = await Promise.all([
        harness.as(TENANT_A, () => reconcile(ruleId)),
        other.as(TENANT_A, () =>
          send<ReconciliationView>(other, {
            commandName: 'learning.reconcile-requirements',
            mandatoryRuleId: ruleId,
          }),
        ),
      ]);

      // Between them they generated two occurrences and found two already present — never four.
      expect(first.generated + second.generated).toBe(2);
      expect(first.alreadyPresent + second.alreadyPresent).toBe(2);

      const counted = await fixture.admin.query<{ total: string }>(
        `select count(*)::text as total from learning_assignment where mandatory_rule_id = $1`,
        [ruleId],
      );

      expect(counted.rows[0]?.total).toBe('2');
    });

    it('never writes a future occurrence, even years after the rule was made', async () => {
      await harness.as(TENANT_A, async () => {
        const ruleId = await aRule(await aPublishedCourse());

        await reconcile(ruleId);
        harness.clock.advanceTo(new Date('2030-08-12T09:00:00.000Z'));
        // The one occurrence still open is still the one that is due. A calendar of future rows
        // would be state nothing owns.
        expect(await reconcile(ruleId)).toMatchObject({ generated: 0, alreadyPresent: 2 });
      });

      const keys = await fixture.admin.query<{ occurrence_key: string }>(
        `select distinct to_char(occurrence_key, 'YYYY-MM-DD') as occurrence_key
           from learning_assignment where tenant_id = $1`,
        [TENANT_A],
      );

      expect(keys.rows).toEqual([{ occurrence_key: '2024-01-01' }]);
    });

    it('keeps one tenant’s reconciliation entirely out of another’s tables', async () => {
      const ruleId = await harness.as(TENANT_A, async () => aRule(await aPublishedCourse()));

      await harness.as(TENANT_A, () => reconcile(ruleId));

      // The same rule identifier, run by another tenant, finds no rule at all.
      await expect(harness.as(TENANT_B, () => reconcile(ruleId))).rejects.toThrow(/not_found/);

      const tenants = await fixture.admin.query<{ tenant_id: string }>(
        `select distinct tenant_id from learning_assignment`,
      );

      expect(tenants.rows).toEqual([{ tenant_id: TENANT_A }]);
    });
  });

  describe('certification validity, derived from what the table returned', () => {
    const issue = (validUntil?: string): Promise<{ certificationId: string }> =>
      send(harness, {
        commandName: 'learning.issue-certification',
        employmentId: EMPLOYMENT,
        title: 'Forklift licence',
        source: 'external',
        issuedOn: '2026-01-15',
        ...(validUntil === undefined ? {} : { validUntil }),
      });

    const validityOn = async (asOf: string, noticeDays?: number): Promise<string | undefined> => {
      const found = await ask<{ readonly items: readonly CertificationView[] }>(harness, {
        queryName: 'learning.search-certifications',
        employmentId: EMPLOYMENT,
        asOf,
        ...(noticeDays === undefined ? {} : { noticeDays }),
      });

      return found.items[0]?.validity;
    };

    it('walks the whole boundary from valid to expired against a stored date', async () => {
      await harness.as(TENANT_A, async () => {
        await issue('2027-03-01');

        expect(await validityOn('2026-08-12')).toBe('valid');
        // The final valid day is still valid — an expiry is the end of that day, not its start.
        expect(await validityOn('2027-03-01')).toBe('valid');
        expect(await validityOn('2027-03-02')).toBe('expired');
        expect(await validityOn('2027-02-01', 30)).toBe('expiring_soon');
        expect(await validityOn('2027-01-01', 30)).toBe('valid');
      });
    });

    it('never says expiring soon with a zero notice window — the regression, over SQL', async () => {
      await harness.as(TENANT_A, async () => {
        await issue('2027-03-01');

        // The defect this guards produced a third answer where a caller asked a yes-or-no question,
        // and a compliance count expecting two got three.
        expect(await validityOn('2027-03-01', 0)).toBe('valid');
        expect(await validityOn('2027-02-28', 0)).toBe('valid');
      });
    });

    it('says no expiry rather than valid where the column is null', async () => {
      await harness.as(TENANT_A, async () => {
        await issue();

        expect(await validityOn('2099-01-01')).toBe('no_expiry');
      });
    });

    it('never calls a revoked or superseded certification valid, whatever the date says', async () => {
      await harness.as(TENANT_A, async () => {
        const { certificationId } = await issue('2099-01-15');

        await send(harness, {
          commandName: 'learning.revoke-certification',
          certificationId,
          expectedVersion: 1,
          reason: 'Licence withdrawn by the issuer',
        });

        expect(await validityOn(TODAY)).toBe('expired');
      });

      // The row is still there, saying what happened to it. Revoked is not deleted.
      const held = await fixture.admin.query<{ status: string; revocation_reason: string }>(
        `select status, revocation_reason from learning_certification where tenant_id = $1`,
        [TENANT_A],
      );

      expect(held.rows[0]).toEqual({
        status: 'revoked',
        revocation_reason: 'Licence withdrawn by the issuer',
      });
    });

    it('keeps a historical certification readable after a recertification supersedes it', async () => {
      await harness.as(TENANT_A, async () => {
        const first = await issue('2026-06-01');

        await send(harness, {
          commandName: 'learning.issue-certification',
          employmentId: EMPLOYMENT,
          title: 'Forklift licence',
          source: 'external',
          issuedOn: '2026-06-02',
          validUntil: '2029-06-02',
          supersedesCertificationId: first.certificationId,
        });

        const all = await ask<{ readonly items: readonly CertificationView[] }>(harness, {
          queryName: 'learning.search-certifications',
          employmentId: EMPLOYMENT,
          asOf: TODAY,
        });

        expect(all.items).toHaveLength(2);
        expect(all.items.map((item) => item.status).sort()).toEqual(['active', 'superseded']);
      });
    });
  });

  describe('the learning-record projection', () => {
    it('reports what the authoritative tables say, and writes nothing itself', async () => {
      await harness.as(TENANT_A, async () => {
        const courseId = await aPublishedCourse();

        await reconcile(await aRule(courseId));
        await send(harness, {
          commandName: 'learning.issue-certification',
          employmentId: EMPLOYMENT,
          title: 'Forklift licence',
          source: 'external',
          issuedOn: '2026-01-15',
          validUntil: '2026-09-01',
        });

        const history = await ask<LearningHistoryView>(harness, {
          queryName: 'learning.read-history',
          employmentId: EMPLOYMENT,
          noticeDays: 30,
        });

        expect(history.asOf).toBe(TODAY);
        expect(history.openAssignments).toBe(1);
        expect(history.overdueAssignments).toBe(1);
        expect(history.expiringCertifications).toBe(1);
        // The header can never disagree with the list beneath it: both come from the same rows.
        expect(history.assignments.filter((item) => item.overdue)).toHaveLength(
          history.overdueAssignments,
        );
      });

      // No projection table exists, so there is nothing that could fall out of step with the truth.
      const tables = await fixture.admin.query<{ table_name: string }>(
        `select table_name from information_schema.tables
          where table_schema = 'public' and table_name like 'learning\\_%'
            and (table_name like '%history%' or table_name like '%summary%'
                 or table_name like '%projection%')`,
      );

      expect(tables.rows).toEqual([]);
    });

    it('shows another tenant nothing, and does not confirm the employment exists', async () => {
      await harness.as(TENANT_A, async () => {
        await reconcile(await aRule(await aPublishedCourse()));
      });

      const theirs = await harness.as(TENANT_B, () =>
        ask<LearningHistoryView>(harness, {
          queryName: 'learning.read-history',
          employmentId: EMPLOYMENT,
        }),
      );

      expect(theirs.assignments).toEqual([]);
      expect(theirs.openAssignments).toBe(0);
    });

    it('bounds every list it returns rather than loading a whole career', async () => {
      await harness.as(TENANT_A, async () => {
        for (let index = 0; index < 4; index += 1) {
          await send(harness, {
            commandName: 'learning.issue-certification',
            employmentId: EMPLOYMENT,
            title: `Licence ${String(index)}`,
            source: 'external',
            issuedOn: '2026-01-15',
          });
        }

        const history = await ask<LearningHistoryView>(harness, {
          queryName: 'learning.read-history',
          employmentId: EMPLOYMENT,
          size: 2,
        });

        expect(history.certifications).toHaveLength(2);
      });
    });
  });
});
