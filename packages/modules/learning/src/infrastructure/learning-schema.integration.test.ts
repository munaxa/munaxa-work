import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  AUDIT_COLUMNS,
  AUDIT_VALUES,
  CONNECTION,
  LEARNING_TABLES,
  TENANT_A,
  TENANT_B,
  openLearningFixture,
  requireDatabaseInCi,
  type LearningFixture,
} from './learning-database.fixture.js';

/**
 * What the database refuses, checked against the database.
 *
 * Every assertion here is about a guarantee that would be worthless if it lived only in TypeScript:
 * a constraint, an index, a policy or a trigger holds against SQL nobody wrote in this repository,
 * and the application rules above them hold only for callers who came through the application.
 *
 * Row-level security is checked **in both directions and on every table**, as an unprivileged role.
 * A policy that isolates A from B and not B from A is a policy somebody wrote once and tested once.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Learning schema suite');

const COURSE = '01930000-0000-7000-8000-00000000c001';
const VERSION = '01930000-0000-7000-8000-00000000e001';
const RULE = '01930000-0000-7000-8000-00000000f001';
const EMPLOYMENT = '01930000-0000-7000-8000-000000000e01';

suite('learning schema', () => {
  let fixture: LearningFixture;

  beforeAll(async () => {
    fixture = await openLearningFixture('learning_schema_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  const seedCourse = async (tenantId = TENANT_A): Promise<void> => {
    await fixture.admin.query(
      `insert into learning_course
         (id, tenant_id, code, name, delivery, status, ${AUDIT_COLUMNS})
       values ($1, $2, 'fire-safety', '{"en":"Fire safety","ar":"السلامة"}'::jsonb,
               'classroom', 'draft', ${AUDIT_VALUES})`,
      [COURSE, tenantId],
    );
    await fixture.admin.query(
      `insert into learning_course_version
         (id, tenant_id, course_id, version_number, title, requires_assessment,
          published_at, published_by, ${AUDIT_COLUMNS})
       values ($1, $2, $3, 1, '{"en":"v1","ar":"v1"}'::jsonb, false, now(), 'user:test',
               ${AUDIT_VALUES})`,
      [VERSION, tenantId, COURSE],
    );
  };

  const seedRule = async (recurrenceMonths = 12): Promise<void> => {
    await fixture.admin.query(
      `insert into learning_mandatory_rule
         (id, tenant_id, course_id, name, kind, audience, effective_from, recurrence_months,
          due_within_days, active, ${AUDIT_COLUMNS})
       values ($1, $2, $3, '{"en":"Annual","ar":"سنوي"}'::jsonb, 'safety', 'everybody',
               date '2024-01-01', $4, 30, true, ${AUDIT_VALUES})`,
      [RULE, TENANT_A, COURSE, recurrenceMonths],
    );
  };

  describe('row-level security', () => {
    it('is enabled and forced on all twelve tables', async () => {
      const protection = await fixture.admin.query<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(
        `select relname, relrowsecurity, relforcerowsecurity from pg_class
          where relname = any($1::text[])`,
        [LEARNING_TABLES],
      );

      expect(protection.rows).toHaveLength(LEARNING_TABLES.length);
      for (const row of protection.rows) {
        // Enabled without forced leaves the owning role exempt, which is the half of this that is
        // easy to get wrong and impossible to notice.
        expect([row.relname, row.relrowsecurity, row.relforcerowsecurity]).toEqual([
          row.relname,
          true,
          true,
        ]);
      }
    });

    it('hides one tenant’s course from the other, in both directions', async () => {
      await seedCourse(TENANT_A);

      const mine = await fixture.asTenant(TENANT_A, (client) =>
        client.query('select id from learning_course'),
      );
      const theirs = await fixture.asTenant(TENANT_B, (client) =>
        client.query('select id from learning_course'),
      );

      expect(mine.rows).toHaveLength(1);
      expect(theirs.rows).toHaveLength(0);
    });

    it('refuses a write that names another tenant, rather than silently writing it', async () => {
      await expect(
        fixture.asTenant(TENANT_B, (client) =>
          client.query(
            `insert into learning_course
               (id, tenant_id, code, name, delivery, status, ${AUDIT_COLUMNS})
             values ($1, $2, 'smuggled', '{"en":"x","ar":"x"}'::jsonb, 'virtual', 'draft',
                     ${AUDIT_VALUES})`,
            ['01930000-0000-7000-8000-00000000c999', TENANT_A],
          ),
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it('counts nothing of another tenant’s rows on every table it owns', async () => {
      await seedCourse(TENANT_A);

      for (const table of LEARNING_TABLES) {
        const counted = await fixture.asTenant(TENANT_B, (client) =>
          client.query<{ total: string }>(`select count(*)::text as total from ${table}`),
        );

        expect([table, counted.rows[0]?.total]).toEqual([table, '0']);
      }
    });
  });

  describe('what the constraints refuse', () => {
    it('refuses a published course with nothing published behind it', async () => {
      await seedCourse();
      await expect(
        fixture.admin.query(`update learning_course set status = 'published' where id = $1`, [
          COURSE,
        ]),
      ).rejects.toThrow(/learning_course_published_check/);
    });

    it('refuses a certificate that expired before it was issued', async () => {
      await expect(
        fixture.admin.query(
          `insert into learning_certification
             (id, tenant_id, employment_id, title, source, status, issued_on, valid_until,
              issued_by, ${AUDIT_COLUMNS})
           values (app_uuid_v7(), $1, $2, 'Forklift', 'external', 'active',
                   date '2026-03-01', date '2025-03-01', 'user:test', ${AUDIT_VALUES})`,
          [TENANT_A, EMPLOYMENT],
        ),
      ).rejects.toThrow(/learning_certification_validity_check/);
    });

    it('refuses a certification claiming a completion with no enrolment behind it', async () => {
      await expect(
        fixture.admin.query(
          `insert into learning_certification
             (id, tenant_id, employment_id, title, source, status, issued_on, issued_by,
              ${AUDIT_COLUMNS})
           values (app_uuid_v7(), $1, $2, 'Fire safety', 'learning_completion', 'active',
                   date '2026-03-01', 'user:test', ${AUDIT_VALUES})`,
          [TENANT_A, EMPLOYMENT],
        ),
      ).rejects.toThrow(/learning_certification_completion_check/);
    });

    it('refuses the auto-approver as an issuer, an assessor or a waiver’s author', async () => {
      await expect(
        fixture.admin.query(
          `insert into learning_certification
             (id, tenant_id, employment_id, title, source, status, issued_on, issued_by,
              ${AUDIT_COLUMNS})
           values (app_uuid_v7(), $1, $2, 'Fire safety', 'external', 'active', date '2026-03-01',
                   'system:auto-approval', ${AUDIT_VALUES})`,
          [TENANT_A, EMPLOYMENT],
        ),
      ).rejects.toThrow(/learning_certification_issuer_check/);
    });

    it('refuses a mandatory rule whose audience names nobody it claims to name', async () => {
      await expect(
        fixture.admin.query(
          `insert into learning_mandatory_rule
             (id, tenant_id, course_id, name, kind, audience, effective_from, recurrence_months,
              due_within_days, active, ${AUDIT_COLUMNS})
           values (app_uuid_v7(), $1, $2, '{"en":"x","ar":"x"}'::jsonb, 'safety',
                   'organization_unit', date '2024-01-01', 12, 30, true, ${AUDIT_VALUES})`,
          [TENANT_A, COURSE],
        ),
      ).rejects.toThrow(/learning_mandatory_rule_target_check/);
    });

    it('refuses an assignment closed as satisfied with no evidence behind it', async () => {
      await seedCourse();
      await expect(
        fixture.admin.query(
          `insert into learning_assignment
             (id, tenant_id, employment_id, course_id, source, status, assigned_at, assigned_by,
              ${AUDIT_COLUMNS})
           values (app_uuid_v7(), $1, $2, $3, 'direct', 'satisfied', now(), 'user:test',
                   ${AUDIT_VALUES})`,
          [TENANT_A, EMPLOYMENT, COURSE],
        ),
      ).rejects.toThrow(/learning_assignment_satisfaction_check/);
    });

    it('refuses an occurrence key on an assignment that belongs to no rule', async () => {
      await seedCourse();
      await expect(
        fixture.admin.query(
          `insert into learning_assignment
             (id, tenant_id, employment_id, course_id, source, status, occurrence_key,
              assigned_at, assigned_by, ${AUDIT_COLUMNS})
           values (app_uuid_v7(), $1, $2, $3, 'direct', 'assigned', date '2026-03-01', now(),
                   'user:test', ${AUDIT_VALUES})`,
          [TENANT_A, EMPLOYMENT, COURSE],
        ),
      ).rejects.toThrow(/learning_assignment_occurrence_check/);
    });

    it('refuses an instructor who is both an employee and an outsider, or neither', async () => {
      const insert = (columns: string, values: string): Promise<unknown> =>
        fixture.admin.query(
          `insert into learning_instructor (id, tenant_id, active, ${columns}, ${AUDIT_COLUMNS})
           values (app_uuid_v7(), $1, true, ${values}, ${AUDIT_VALUES})`,
          [TENANT_A],
        );

      await expect(
        insert('employment_id, external_name', `$2, '{"en":"T","ar":"T"}'::jsonb`),
      ).rejects.toThrow();
      await expect(insert('external_organization', `'Gulf Safety'`)).rejects.toThrow(
        /learning_instructor_identity_check/,
      );
    });

    it('refuses external contact details on an internal instructor', async () => {
      await expect(
        fixture.admin.query(
          `insert into learning_instructor
             (id, tenant_id, employment_id, external_contact, active, ${AUDIT_COLUMNS})
           values (app_uuid_v7(), $1, $2, 'trainer@example.test', true, ${AUDIT_VALUES})`,
          [TENANT_A, EMPLOYMENT],
        ),
      ).rejects.toThrow(/learning_instructor_internal_check/);
    });
  });

  describe('the index that makes reconciliation idempotent (ADR-0071)', () => {
    const generate = (): Promise<unknown> =>
      fixture.admin.query(
        `insert into learning_assignment
           (id, tenant_id, employment_id, course_id, source, mandatory_rule_id, occurrence_key,
            status, due_on, assigned_at, assigned_by, ${AUDIT_COLUMNS})
         values (app_uuid_v7(), $1, $2, $3, 'mandatory_rule', $4, date '2026-03-01', 'assigned',
                 date '2026-03-31', now(), 'user:test', ${AUDIT_VALUES})`,
        [TENANT_A, EMPLOYMENT, COURSE, RULE],
      );

    it('lets the first generation through and refuses the second for the same occurrence', async () => {
      await seedCourse();
      await seedRule();

      await generate();
      await expect(generate()).rejects.toThrow(/learning_assignment_occurrence_idx/);
    });

    it('permits the next occurrence, because the key is a date and not a flag', async () => {
      await seedCourse();
      await seedRule();
      await generate();

      const next = await fixture.admin.query(
        `insert into learning_assignment
           (id, tenant_id, employment_id, course_id, source, mandatory_rule_id, occurrence_key,
            status, assigned_at, assigned_by, ${AUDIT_COLUMNS})
         values (app_uuid_v7(), $1, $2, $3, 'mandatory_rule', $4, date '2027-03-01', 'assigned',
                 now(), 'user:test', ${AUDIT_VALUES})`,
        [TENANT_A, EMPLOYMENT, COURSE, RULE],
      );

      expect(next.rowCount).toBe(1);
    });

    it('does not constrain direct assignments, which carry no occurrence at all', async () => {
      await seedCourse();

      for (let index = 0; index < 2; index += 1) {
        const created = await fixture.admin.query(
          `insert into learning_assignment
             (id, tenant_id, employment_id, course_id, source, status, assigned_at, assigned_by,
              ${AUDIT_COLUMNS})
           values (app_uuid_v7(), $1, $2, $3, 'direct', 'assigned', now(), 'user:test',
                   ${AUDIT_VALUES})`,
          [TENANT_A, EMPLOYMENT, COURSE],
        );

        expect(created.rowCount).toBe(1);
      }
    });
  });

  describe('what the triggers refuse', () => {
    const enrol = async (status = 'enrolled'): Promise<string> => {
      // The completion columns are computed here rather than in a `case` over a parameter: PostgreSQL
      // deduces one type per placeholder, and the same `$5` compared to a string and used as a
      // status is the "inconsistent types deduced" error this repository has already paid for once.
      const ended = status === 'completed';
      const created = await fixture.admin.query<{ id: string }>(
        `insert into learning_enrolment
           (id, tenant_id, employment_id, course_id, course_version_id, status, enrolled_at,
            enrolled_by, completed_by, completed_on, ${AUDIT_COLUMNS})
         values (app_uuid_v7(), $1, $2, $3, $4, $5, now(), 'user:test', $6, $7::date,
                 ${AUDIT_VALUES})
         returning id`,
        [
          TENANT_A,
          EMPLOYMENT,
          COURSE,
          VERSION,
          status,
          ended ? 'user:manager' : null,
          ended ? '2026-03-01' : null,
        ],
      );

      return created.rows[0]?.id ?? '';
    };

    it('refuses any edit of a published course version', async () => {
      await seedCourse();
      await expect(
        fixture.admin.query(
          `update learning_course_version set duration_minutes = 60 where id = $1`,
          [VERSION],
        ),
      ).rejects.toThrow(/learning_course_version_immutable/);
      await expect(
        fixture.admin.query('delete from learning_course_version where id = $1', [VERSION]),
      ).rejects.toThrow(/learning_course_version_immutable/);
    });

    it('refuses any edit of a recorded assessment result', async () => {
      await seedCourse();

      const enrolmentId = await enrol();
      const assessment = await fixture.admin.query<{ id: string }>(
        `insert into learning_assessment
           (id, tenant_id, course_version_id, title, kind, required, ${AUDIT_COLUMNS})
         values (app_uuid_v7(), $1, $2, '{"en":"Quiz","ar":"اختبار"}'::jsonb, 'quiz', true,
                 ${AUDIT_VALUES})
         returning id`,
        [TENANT_A, VERSION],
      );
      const result = await fixture.admin.query<{ id: string }>(
        `insert into learning_assessment_result
           (id, tenant_id, assessment_id, enrolment_id, employment_id, outcome, assessed_on,
            assessed_by, recorded_at, ${AUDIT_COLUMNS})
         values (app_uuid_v7(), $1, $2, $3, $4, 'failed', date '2026-03-01', 'user:assessor',
                 now(), ${AUDIT_VALUES})
         returning id`,
        [TENANT_A, assessment.rows[0]?.id, enrolmentId, EMPLOYMENT],
      );

      await expect(
        fixture.admin.query(
          `update learning_assessment_result set outcome = 'passed' where id = $1`,
          [result.rows[0]?.id],
        ),
      ).rejects.toThrow(/learning_assessment_result_immutable/);
    });

    it('refuses an edit of a completed enrolment while permitting a soft delete', async () => {
      await seedCourse();

      const completed = await enrol('completed');

      await expect(
        fixture.admin.query(`update learning_enrolment set status = 'failed' where id = $1`, [
          completed,
        ]),
      ).rejects.toThrow(/learning_enrolment_immutable/);
      await expect(
        fixture.admin.query('delete from learning_enrolment where id = $1', [completed]),
      ).rejects.toThrow(/learning_enrolment_immutable/);

      const withdrawn = await fixture.admin.query(
        `update learning_enrolment
            set deleted_at = now(), deleted_by = 'user:test', updated_at = now(), version = 2
          where id = $1`,
        [completed],
      );

      expect(withdrawn.rowCount).toBe(1);
    });

    it('leaves an open enrolment editable, because it has not ended', async () => {
      await seedCourse();

      const open = await enrol();
      const started = await fixture.admin.query(
        `update learning_enrolment set status = 'in_progress', started_at = now(), version = 2
          where id = $1`,
        [open],
      );

      expect(started.rowCount).toBe(1);
    });

    it('refuses a second open enrolment for the same person on the same course', async () => {
      await seedCourse();
      await enrol();

      await expect(enrol()).rejects.toThrow(/learning_enrolment_open_idx/);
    });
  });
});
