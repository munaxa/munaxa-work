import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { WorkflowInstanceDetailView } from '@work/workflow';

import {
  APPROVER,
  CONNECTION,
  DEPUTY,
  MANAGER,
  MANAGER_EMPLOYMENT,
  REQUESTER,
  REQUESTER_EMPLOYMENT,
  TENANT_A,
  UNADOPTED,
  applicationConnection,
  ask,
  attempt,
  harnessFor,
  requireDatabaseInCi,
  roleIsUnprivileged,
  seedReportingLine,
  send,
  type WorkflowCrossModuleHarness,
} from './workflow-cross-module-harness.js';

/**
 * Phase 16C Checkpoint 10 — the two manager-routing properties no checkpoint suite established.
 *
 * The manager suites prove the chain resolves, that each refusal fails closed, and that a running
 * approval keeps the manager it started with when the reporting line moves underneath it. Two things
 * they do not prove, and this audit adds rather than assumes:
 *
 * **The other half of the snapshot rule.** "A running approval does not follow a reorganization" is
 * only half of D-16C-08, and on its own it is satisfiable by a system that resolves the manager once
 * and then never resolves one again. The half that says the mechanism still works — *a newly started
 * approval reaches the new manager* — is what makes the first half a snapshot rather than a freeze,
 * and nothing asserted it. The two are asserted here as one scenario, against one reorganization, so
 * neither can pass while the other is broken.
 *
 * **The query plans of the three cross-module reads.** Workflow's own reads have a plan suite;
 * the manager path crosses into Identity and Employment, and no suite in either module plans it,
 * because in neither module is it a path anybody walks. A resolution happens on every approval that
 * starts, so a sequential scan of `employment_link` on the way would be paid by every requester in
 * the tenant.
 *
 * **Plans are audited for reachability, not for which index wins.** That rule is
 * `workflow-schema-boundaries`', written down there and followed here: at fixture size two indexes
 * that can both answer a predicate cost the same, and an assertion naming one of them pins a
 * tie-break rather than a property. What is pinned is that an index is reached, that the tenant is
 * inside its condition, and that nothing scans a table sequentially.
 */

requireDatabaseInCi('the Phase 16C routing audit');

const suite = CONNECTION === undefined ? describe.skip : describe;

/** The employment the reorganization moves the requester to, and the person who holds it. */
const SECOND_MANAGER_EMPLOYMENT = '01930000-0000-7000-8000-0000000000c9';

suite('Phase 16C audit — manager routing', () => {
  let harness: WorkflowCrossModuleHarness;

  beforeAll(async () => {
    harness = harnessFor({ connectionString: await applicationConnection() });
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.truncate();
  });

  it('audits through a role that is neither a superuser nor exempt from row-level security', async () => {
    await expect(roleIsUnprivileged(harness.pool)).resolves.toStrictEqual({
      rolsuper: false,
      rolbypassrls: false,
    });
  });

  const managerProcess = async (): Promise<string> => {
    const definition = await harness.inTenant(TENANT_A, APPROVER, () =>
      send<{ definitionId: string }>(harness, {
        commandName: 'workflow.create-definition',
        code: 'audit-manager',
        name: { en: 'Manager approval', ar: 'اعتماد المدير' },
        subjectType: UNADOPTED,
      }),
    );
    const version = await harness.inTenant(TENANT_A, APPROVER, () =>
      send<{ workflowVersionId: string }>(harness, {
        commandName: 'workflow.draft-version',
        definitionId: definition.definitionId,
      }),
    );

    await harness.inTenant(TENANT_A, APPROVER, async () => {
      await send(harness, {
        commandName: 'workflow.add-step',
        workflowVersionId: version.workflowVersionId,
        ordinal: 1,
        name: { en: 'Manager', ar: 'المدير' },
        approverKind: 'manager',
      });
      await send(harness, {
        commandName: 'workflow.publish-version',
        workflowVersionId: version.workflowVersionId,
        expectedVersion: 1,
      });
    });

    return definition.definitionId;
  };

  const start = (definitionId: string, subjectId: string) =>
    harness.inTenant(TENANT_A, REQUESTER, () =>
      attempt(harness, {
        commandName: 'workflow.start-instance',
        definitionId,
        subjectType: UNADOPTED,
        subjectId,
      }),
    );

  const approverOf = async (instanceId: string): Promise<string | undefined> => {
    const detail = await harness.inTenant(TENANT_A, APPROVER, () =>
      ask<WorkflowInstanceDetailView>(harness, {
        queryName: 'workflow.read-instance',
        instanceId,
      }),
    );

    return detail.steps[0]?.approverMembershipId;
  };

  const startedId = (started: Awaited<ReturnType<typeof start>>): string => {
    if (!started.ok) throw new Error('The approval did not start.');
    return (started.value as { instanceId: string }).instanceId;
  };

  /**
   * The snapshot rule, both halves, against one reorganization.
   *
   * `MANAGER` holds the requester's manager employment when the first approval starts. The line then
   * moves to a different employment held by `DEPUTY` — a real reorganization, not a relabelling. The
   * first approval must still name `MANAGER`, because its answer was copied onto a row; the second
   * must name `DEPUTY`, because it asked afresh.
   *
   * Asserted as one test rather than two. Split apart, "the old approval kept its manager" passes
   * for a system that has stopped resolving managers altogether, and only the pair rules that out.
   */
  it('freezes the approval that was running and routes the next one to the new manager', async () => {
    await seedReportingLine(harness.owner, {
      tenantId: TENANT_A,
      requesterMembershipId: REQUESTER,
      requesterEmploymentId: REQUESTER_EMPLOYMENT,
      line: { managerEmploymentId: MANAGER_EMPLOYMENT, managerMembershipIds: [MANAGER] },
    });

    const definitionId = await managerProcess();
    const before = startedId(await start(definitionId, 'audit-subject-1'));

    expect(await approverOf(before)).toBe(MANAGER);

    // The reorganization: the requester now reports to a different employment, held by somebody else.
    await harness.owner.query('delete from employment_reporting_line where tenant_id = $1', [
      TENANT_A,
    ]);
    await seedReportingLine(harness.owner, {
      tenantId: TENANT_A,
      requesterMembershipId: REQUESTER,
      requesterEmploymentId: REQUESTER_EMPLOYMENT,
      line: {
        managerEmploymentId: SECOND_MANAGER_EMPLOYMENT,
        managerMembershipIds: [DEPUTY],
      },
    });

    const after = startedId(await start(definitionId, 'audit-subject-2'));

    // Half one: the running approval did not follow the reorganization.
    expect(await approverOf(before)).toBe(MANAGER);
    // Half two: the mechanism still resolves, and resolves to the new manager.
    expect(await approverOf(after)).toBe(DEPUTY);
    // And the two approvals genuinely disagree, which is the whole point of the pair.
    expect(await approverOf(before)).not.toBe(await approverOf(after));
  });

  /**
   * The plans of the three reads a resolution makes, captured against real rows.
   *
   * Each is the statement its repository issues, run through `explain` as the unprivileged role so
   * the row-level security predicate is part of the plan rather than absent from it.
   */
  describe('the query plans of the three cross-module reads', () => {
    const seeded = async (): Promise<void> => {
      await seedReportingLine(harness.owner, {
        tenantId: TENANT_A,
        requesterMembershipId: REQUESTER,
        requesterEmploymentId: REQUESTER_EMPLOYMENT,
        line: { managerEmploymentId: MANAGER_EMPLOYMENT, managerMembershipIds: [MANAGER] },
      });
    };

    /**
     * A plan captured on a connection that is genuinely inside the tenant.
     *
     * `set local app.tenant_id` on the same client, in the same transaction, is what the unit of
     * work does before every statement. Without it the policy collapses to a `One-Time Filter` that
     * is false, PostgreSQL marks the scan **never executed**, and the plan below would be a plan for
     * a query that read nothing — which is exactly how a plan audit passes while proving nothing.
     */
    const planOf = async (statement: string, values: readonly unknown[]): Promise<string> => {
      const client = await harness.pool.connect();

      try {
        await client.query('begin');
        // `set_config(..., true)` rather than `set local`: only the function form takes a bind
        // parameter, and it is transaction-local exactly as the unit of work's is.
        await client.query(`select set_config('app.tenant_id', $1, true)`, [TENANT_A]);

        const { rows } = await client.query<{ 'QUERY PLAN': string }>(
          `explain (analyze, buffers, verbose) ${statement}`,
          [...values],
        );

        await client.query('rollback');
        return rows.map((row) => row['QUERY PLAN']).join('\n');
      } finally {
        client.release();
      }
    };

    /**
     * Every plan below is held to the same four rules.
     *
     * The tenant must be *inside* an index condition rather than filtered after the fact — a
     * predicate applied above the scan is a predicate paid for every row of the tenant next door.
     * Under `verbose` the planner qualifies the column with its table, which is why the pattern
     * allows a prefix rather than anchoring on the column name.
     *
     * And the scan must have **run**: a plan whose every node reads `never executed` describes a
     * query that was short-circuited before it touched a page.
     */
    const reaches = (plan: string): void => {
      expect(plan).toMatch(/Index (Only )?Scan/);
      expect(plan).toMatch(/Index Cond: \(\(?[a-z_]*\.?tenant_id =/);
      expect(plan).not.toContain('Seq Scan');
      expect(plan).not.toContain('never executed');
    };

    beforeEach(seeded);

    /** One: the requester's primary employment. Unique per member, and the index says so. */
    it('reaches an index for the requester’s primary employment link', async () => {
      const plan = await planOf(
        `select id from employment_link
          where tenant_id = $1 and membership_id = $2
            and is_primary and status = 'linked' and deleted_at is null`,
        [TENANT_A, REQUESTER],
      );

      reaches(plan);
    });

    /** Two: the primary reporting line in force on a date. */
    it('reaches an index for the reporting line in force on the date', async () => {
      const plan = await planOf(
        `select manager_employment_id from employment_reporting_line
          where tenant_id = $1 and employment_id = $2 and line_type = 'primary'
            and effective_from <= $3::timestamptz
            and (effective_to is null or effective_to > $3::timestamptz)
            and deleted_at is null`,
        [TENANT_A, REQUESTER_EMPLOYMENT, '2026-08-17T00:00:00.000Z'],
      );

      reaches(plan);
    });

    /**
     * Three: who holds the manager's employment.
     *
     * The one join on the path. `employment_link` is the driving side and carries the tenant in its
     * own index condition; the membership is reached by primary key, which is why the assertion here
     * asks for the tenant on the driving scan rather than on both.
     */
    it('reaches an index on both sides of the manager-membership join', async () => {
      const plan = await planOf(
        `select m.id from tenant_membership m
           join employment_link el
             on el.tenant_id = m.tenant_id and el.membership_id = m.id
          where m.tenant_id = $1 and el.employment_id = $2
            and el.status = 'linked' and m.status = 'active'
            and el.deleted_at is null and m.deleted_at is null
          order by m.id`,
        [TENANT_A, MANAGER_EMPLOYMENT],
      );

      reaches(plan);
      // One pass over each side. A nested loop that re-read the link table per membership would be
      // the N+1 this join exists to avoid.
      expect(plan).not.toContain('Materialize');
    });

    /**
     * And the whole resolution is **three statements**, not three plus a lookup per candidate.
     *
     * Counted at the dispatcher rather than at the database, because that is the boundary the
     * three-read budget B-2 approved is expressed in.
     */
    it('spends exactly two cross-module grants on one resolution, and none on a read', async () => {
      const definitionId = await managerProcess();
      const before = harness.elevations.length;

      startedId(await start(definitionId, 'audit-subject-3'));

      const spent = harness.elevations.slice(before).map((elevation) => elevation.permission);

      // Three reads — B-2's budget exactly — and no fourth.
      expect(spent).toHaveLength(3);
      // Two permissions, both employment-scoped, and nothing resembling a member register.
      expect([...new Set(spent)].sort()).toStrictEqual([
        'employment.employment.read',
        'identity.employment-link.read',
      ]);
      expect(spent).not.toContain('identity.membership.read');
    });
  });
});
