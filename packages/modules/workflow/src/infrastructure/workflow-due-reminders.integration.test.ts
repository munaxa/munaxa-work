import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { serviceLevelState } from '../domain/service-level.js';

import {
  APPROVER,
  AUDIT_COLUMNS,
  AUDIT_VALUES,
  CONNECTION,
  TENANT_A,
  TENANT_B,
  openWorkflowFixture,
  requireDatabaseInCi,
  type WorkflowFixture,
} from './workflow-database.fixture.js';
import { seedInstance } from './workflow-seed.js';

/**
 * Discovering due reminders, in PostgreSQL.
 *
 * Three things are proved here and none can be proved anywhere else: that the SQL interval arithmetic
 * agrees with the domain **exactly**, including across a daylight-saving boundary where `interval '1
 * day'` would not; that row-level security scopes discovery to one tenant without the query knowing
 * anything about tenants; and that the query plan is bounded and indexed rather than a sweep.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi("Workflow's due-reminder discovery suite");

/** Sets a step awaiting at an instant with a target, as the engine would have left it. */
const makeAwaiting = (
  fixture: WorkflowFixture,
  stepId: string,
  awaitingAt: string,
  count: number,
  unit: 'hours' | 'days',
) =>
  fixture.admin.query(
    `update workflow_step
        set awaiting_at = $2::timestamptz, service_level_count = $3, service_level_unit = $4
      where id = $1`,
    [stepId, awaitingAt, count, unit],
  );

/** The query under test, run as the unprivileged role inside one tenant. */
const discover = async (
  fixture: WorkflowFixture,
  tenantId: string,
  asAt: string,
  limit = 100,
  cursor?: string,
): Promise<readonly string[]> =>
  fixture.asTenant(tenantId, async (client) => {
    const parameters: unknown[] = [tenantId, asAt, limit];
    const after = cursor === undefined ? '' : `and s.id > $${String(parameters.push(cursor))}`;
    const { rows } = await client.query<{ id: string }>(
      `select s.instance_id, s.id
         from workflow_step s
         join workflow_instance i
           on i.id = s.instance_id and i.tenant_id = s.tenant_id
          and i.status = 'running' and i.deleted_at is null
        where s.tenant_id = $1
          and s.status = 'awaiting'
          and s.deleted_at is null
          and s.service_level_count is not null
          and s.awaiting_at is not null
          and s.awaiting_at + (interval '1 hour' * s.service_level_count
                * (case s.service_level_unit when 'hours' then 1 else 24 end)) < $2::timestamptz
          ${after}
          and not exists (
            select 1 from workflow_history h
             where h.tenant_id = s.tenant_id and h.step_id = s.id
               and h.event = 'step-reminded' and h.deleted_at is null)
        order by s.id
        limit $3`,
      parameters,
    );

    return rows.map((row) => row.id);
  });

suite('the due predicate, against the domain', () => {
  let fixture: WorkflowFixture;
  let stepId: string;

  beforeAll(async () => {
    fixture = await openWorkflowFixture('workflow_due_reminder_role');
  }, 30_000);

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
    const seeded = await seedInstance(fixture.admin, TENANT_A, [APPROVER]);

    stepId = seeded.stepIds[0] ?? '';
  });

  const AWAITING = '2026-08-20T09:00:00.000Z';

  /**
   * The boundary, from both sides of one millisecond, **in the database**.
   *
   * The application suite asks the same of the fake. Asking both is the point: a query and a command
   * that disagreed by a millisecond would offer a runner work its own command refuses.
   */
  it('excludes at exactly due and includes one millisecond later', async () => {
    await makeAwaiting(fixture, stepId, AWAITING, 2, 'hours');

    expect(await discover(fixture, TENANT_A, '2026-08-20T10:59:59.999Z')).toStrictEqual([]);
    expect(await discover(fixture, TENANT_A, '2026-08-20T11:00:00.000Z')).toStrictEqual([]);
    expect(await discover(fixture, TENANT_A, '2026-08-20T11:00:00.001Z')).toStrictEqual([stepId]);
  });

  /**
   * **A `days` target is exactly twenty-four hours, not a calendar day.**
   *
   * The domain adds `count × 86_400_000 ms`. PostgreSQL's `interval '1 day'` is calendar arithmetic on
   * a `timestamptz`: across a daylight-saving boundary it is twenty-three or twenty-five hours. This
   * seeds a step across Europe's spring-forward and asserts the database agrees with the domain to the
   * millisecond — which it does only because the SQL multiplies hours rather than adding days.
   */
  it('treats a days target as 24 hours even across a daylight-saving boundary', async () => {
    // 2026-03-29 is the European spring-forward. A calendar day here is 23 hours; the target is 24.
    const awaiting = '2026-03-28T23:30:00.000Z';

    await makeAwaiting(fixture, stepId, awaiting, 1, 'days');

    const domainDue = new Date(new Date(awaiting).getTime() + 86_400_000);

    expect(domainDue.toISOString()).toBe('2026-03-29T23:30:00.000Z');
    expect(await discover(fixture, TENANT_A, '2026-03-29T23:30:00.000Z')).toStrictEqual([]);
    expect(await discover(fixture, TENANT_A, '2026-03-29T23:30:00.001Z')).toStrictEqual([stepId]);
    // And the domain says the same of the same instants, which is the agreement being asserted.
    const target = { count: 1, unit: 'days' } as const;

    expect(serviceLevelState(target, new Date(awaiting), domainDue)).toBe('within');
    expect(serviceLevelState(target, new Date(awaiting), new Date(domainDue.getTime() + 1))).toBe(
      'overdue',
    );
  });

  it('excludes a step with no target, and one that is not awaiting', async () => {
    expect(await discover(fixture, TENANT_A, '2026-08-21T00:00:00.000Z')).toStrictEqual([]);

    await makeAwaiting(fixture, stepId, AWAITING, 2, 'hours');
    await fixture.admin.query(`update workflow_step set status = 'approved' where id = $1`, [
      stepId,
    ]);

    expect(await discover(fixture, TENANT_A, '2026-08-21T00:00:00.000Z')).toStrictEqual([]);
  });

  it('excludes a step whose instance is no longer running', async () => {
    await makeAwaiting(fixture, stepId, AWAITING, 2, 'hours');
    // A cancelled instance names who ended it and why — three constraints enforce that pair, and a
    // fixture that skipped them would be testing a row the engine could never write.
    await fixture.admin.query(
      `update workflow_instance
          set status = 'cancelled', completed_at = now(),
              cancelled_by = $2, cancellation_reason = 'no longer needed'
        where id = (select instance_id from workflow_step where id = $1)`,
      [stepId, APPROVER],
    );

    expect(await discover(fixture, TENANT_A, '2026-08-21T00:00:00.000Z')).toStrictEqual([]);
  });

  /** Already reminded, so not offered again — the narrowing, proved against a real history row. */
  it('excludes a step that already has a step-reminded entry', async () => {
    await makeAwaiting(fixture, stepId, AWAITING, 2, 'hours');
    expect(await discover(fixture, TENANT_A, '2026-08-21T00:00:00.000Z')).toStrictEqual([stepId]);

    await fixture.asTenant(TENANT_A, (client) =>
      client.query(
        `insert into workflow_history
           (tenant_id, instance_id, event, occurred_at, step_id, ordinal, execution_identity,
            execution_correlation_id, metadata, ${AUDIT_COLUMNS})
         values ($1, (select instance_id from workflow_step where id = $2), 'step-reminded', now(),
                 $2, 1, 'service:x', 'c-1', '{}'::jsonb, ${AUDIT_VALUES})`,
        [TENANT_A, stepId],
      ),
    );

    expect(await discover(fixture, TENANT_A, '2026-08-21T00:00:00.000Z')).toStrictEqual([]);
  });

  /** And an unrelated history event on the same step does not hide it. */
  it('is not confused by another event on the same step', async () => {
    await makeAwaiting(fixture, stepId, AWAITING, 2, 'hours');
    await fixture.asTenant(TENANT_A, (client) =>
      client.query(
        `insert into workflow_history
           (tenant_id, instance_id, event, occurred_at, step_id, ordinal, metadata, ${AUDIT_COLUMNS})
         values ($1, (select instance_id from workflow_step where id = $2), 'step-awaiting', now(),
                 $2, 1, '{}'::jsonb, ${AUDIT_VALUES})`,
        [TENANT_A, stepId],
      ),
    );

    expect(await discover(fixture, TENANT_A, '2026-08-21T00:00:00.000Z')).toStrictEqual([stepId]);
  });
});

suite('row-level security over discovery', () => {
  let fixture: WorkflowFixture;

  beforeAll(async () => {
    fixture = await openWorkflowFixture('workflow_due_reminder_rls_role');
  }, 30_000);

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  /**
   * Each tenant discovers its own work and nobody else's.
   *
   * Both tenants hold an identically-shaped overdue step, so a "0" from the other side would be
   * ambiguous — the assertion is that each sees exactly **its own one**, and the admin connection
   * confirms both exist. A machine execution is not a reason to see across a tenant boundary.
   */
  it('scopes discovery to the calling tenant, in both directions', async () => {
    const ours = await seedInstance(fixture.admin, TENANT_A, [APPROVER]);
    const theirs = await seedInstance(fixture.admin, TENANT_B, [APPROVER]);
    const awaiting = '2026-08-20T09:00:00.000Z';

    await makeAwaiting(fixture, ours.stepIds[0] ?? '', awaiting, 2, 'hours');
    await makeAwaiting(fixture, theirs.stepIds[0] ?? '', awaiting, 2, 'hours');

    const asAt = '2026-08-21T00:00:00.000Z';

    expect(await discover(fixture, TENANT_A, asAt)).toStrictEqual([ours.stepIds[0]]);
    expect(await discover(fixture, TENANT_B, asAt)).toStrictEqual([theirs.stepIds[0]]);

    const { rows } = await fixture.admin.query<{ count: string }>(
      `select count(*)::text as count from workflow_step where status = 'awaiting'
         and service_level_count is not null`,
    );

    expect(rows[0]?.count).toBe('2');
  });
});

suite('the discovery query plan', () => {
  let fixture: WorkflowFixture;

  beforeAll(async () => {
    fixture = await openWorkflowFixture('workflow_due_reminder_plan_role');
  }, 30_000);

  afterAll(async () => {
    await fixture.close();
  });

  /**
   * The plan is bounded and reaches `workflow_step` through an index rather than a sequential scan.
   *
   * Asserted rather than assumed, because a discovery loop runs repeatedly and for ever: a plan that
   * degraded to a scan would be a slow query nobody watched. The partial indexes on
   * `status = 'awaiting'` are what make this cheap — the open work is a small fraction of the history.
   */
  it('uses an index on workflow_step and is limited', async () => {
    await fixture.truncate();
    const seeded = await seedInstance(fixture.admin, TENANT_A, [APPROVER]);

    await makeAwaiting(fixture, seeded.stepIds[0] ?? '', '2026-08-20T09:00:00.000Z', 2, 'hours');

    const plan = await fixture.asTenant(TENANT_A, async (client) => {
      const { rows } = await client.query<{ 'QUERY PLAN': string }>(
        `explain (analyze, buffers)
         select s.instance_id, s.id
           from workflow_step s
           join workflow_instance i
             on i.id = s.instance_id and i.tenant_id = s.tenant_id
            and i.status = 'running' and i.deleted_at is null
          where s.tenant_id = $1
            and s.status = 'awaiting'
            and s.deleted_at is null
            and s.service_level_count is not null
            and s.awaiting_at is not null
            and s.awaiting_at + (interval '1 hour' * s.service_level_count
                  * (case s.service_level_unit when 'hours' then 1 else 24 end)) < $2::timestamptz
            and not exists (
              select 1 from workflow_history h
               where h.tenant_id = s.tenant_id and h.step_id = s.id
                 and h.event = 'step-reminded' and h.deleted_at is null)
          order by s.id
          limit 100`,
        [TENANT_A, '2026-08-21T00:00:00.000Z'],
      );

      return rows.map((row) => row['QUERY PLAN']).join('\n');
    });

    expect(plan).toContain('Limit');
    // The open work is reached through one of the partial indexes on `status = 'awaiting'`, not by
    // reading the whole table.
    expect(plan).toMatch(/Index (Scan|Only Scan).*workflow_step/);
    expect(plan).not.toMatch(/Seq Scan on workflow_step/);
  });
});
