import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  APPROVER,
  AUDIT_COLUMNS,
  AUDIT_VALUES,
  CONNECTION,
  DEPUTY,
  SECOND_APPROVER,
  TENANT_A,
  TENANT_B,
  openWorkflowFixture,
  probe,
  refusalOf,
  requireDatabaseInCi,
  type PoolLike,
  type WorkflowFixture,
} from './workflow-database.fixture.js';
import { seedInstance } from './workflow-seed.js';

/**
 * One escalation per person per branch, arbitrated by PostgreSQL.
 *
 * `workflow_step_escalation_idx` is unique on `(tenant_id, instance_id, ordinal,
 * approver_membership_id)` **where the step is escalated and not soft-deleted**. Every assertion here
 * is about one of those two halves: the key, and the predicate that makes it a rule about
 * escalations rather than about steps.
 *
 * **The partial half is not a detail.** Two ordinary steps at one ordinal naming the same membership
 * is something this schema has never forbidden — a group could legitimately contain somebody twice
 * over two lists, and 16B chose not to rule on it. A non-partial index would forbid it now, silently,
 * as a side effect of a phase about something else. So the first test below is that two *unescalated*
 * duplicates are still allowed, and it is the one that would catch that mistake.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi("Workflow's escalation uniqueness suite");

const INDEX = 'workflow_step_escalation_idx';
const AT = '2026-08-18T11:00:00.000Z';

/** One step of a branch, escalated or snapshotted, written as the handler would write it. */
const insertStep = (
  client: PoolLike,
  step: {
    readonly tenantId: string;
    readonly instanceId: string;
    readonly ordinal: number;
    readonly membershipId: string;
    readonly escalated: boolean;
  },
) =>
  probe(
    client,
    `insert into workflow_step
       (tenant_id, instance_id, ordinal, approver_kind, approver_membership_id, status,
        escalated_at, metadata, ${AUDIT_COLUMNS})
     values ($1, $2, $3, 'membership', $4, 'awaiting', $5::timestamptz, '{}'::jsonb, ${AUDIT_VALUES})`,
    [step.tenantId, step.instanceId, step.ordinal, step.membershipId, step.escalated ? AT : null],
  );

suite('escalating the same person onto the same branch twice', () => {
  let fixture: WorkflowFixture;
  let instanceId: string;

  beforeAll(async () => {
    fixture = await openWorkflowFixture('workflow_escalation_uniqueness_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
    instanceId = (await seedInstance(fixture.admin, TENANT_A, [APPROVER])).instanceId;
  });

  const escalate = (client: PoolLike, membershipId: string, ordinal = 1) =>
    insertStep(client, { tenantId: TENANT_A, instanceId, ordinal, membershipId, escalated: true });

  /**
   * The predicate, proved from the side that would break if it were missing.
   *
   * Two snapshotted approvers at one ordinal naming the same membership: allowed before this
   * migration and allowed after it. A non-partial unique index would refuse the second.
   */
  it('still allows two unescalated steps with the same logical key', async () => {
    await fixture.asTenant(TENANT_A, async (client) => {
      const shape = { tenantId: TENANT_A, instanceId, ordinal: 1, membershipId: SECOND_APPROVER };

      expect(await insertStep(client, { ...shape, escalated: false })).toBe('accepted');
      expect(await insertStep(client, { ...shape, escalated: false })).toBe('accepted');
    });
  });

  it('allows one escalated step and refuses a second by the index that forbids it', async () => {
    await fixture.asTenant(TENANT_A, async (client) => {
      expect(await escalate(client, SECOND_APPROVER)).toBe('accepted');

      const refused = await escalate(client, SECOND_APPROVER);

      expect(refused).toContain(INDEX);
      expect(refused).toContain('duplicate key');
    });
  });

  it('allows the same membership on a different ordinal of the same approval', async () => {
    await fixture.asTenant(TENANT_A, async (client) => {
      expect(await escalate(client, SECOND_APPROVER, 1)).toBe('accepted');
      expect(await escalate(client, SECOND_APPROVER, 2)).toBe('accepted');
    });
  });

  it('allows different memberships on the same branch', async () => {
    await fixture.asTenant(TENANT_A, async (client) => {
      expect(await escalate(client, SECOND_APPROVER)).toBe('accepted');
      expect(await escalate(client, DEPUTY)).toBe('accepted');
    });
  });

  it('allows the same membership on a different approval', async () => {
    const other = await seedInstance(fixture.admin, TENANT_A, [APPROVER], 'requisition-2');

    await fixture.asTenant(TENANT_A, async (client) => {
      expect(await escalate(client, SECOND_APPROVER)).toBe('accepted');
      expect(
        await insertStep(client, {
          tenantId: TENANT_A,
          instanceId: other.instanceId,
          ordinal: 1,
          membershipId: SECOND_APPROVER,
          escalated: true,
        }),
      ).toBe('accepted');
    });
  });

  /**
   * The tenant leads the key, and this is what that buys.
   *
   * Both tenants hold an approval at ordinal 1 and escalate the same membership identifier. Without
   * `tenant_id` in the key one tenant's escalation would refuse the other's, which is a cross-tenant
   * effect from a table neither can read.
   */
  it('allows the same logical key in a different tenant', async () => {
    const theirs = await seedInstance(fixture.admin, TENANT_B, [APPROVER]);

    await fixture.asTenant(TENANT_A, async (client) => {
      expect(await escalate(client, SECOND_APPROVER)).toBe('accepted');
    });
    await fixture.asTenant(TENANT_B, async (client) => {
      expect(
        await insertStep(client, {
          tenantId: TENANT_B,
          instanceId: theirs.instanceId,
          ordinal: 1,
          membershipId: SECOND_APPROVER,
          escalated: true,
        }),
      ).toBe('accepted');
    });
  });

  /**
   * An escalated step is a step, and row-level security does not know it is special.
   *
   * Asserted anyway, because the index is the one object in this migration that spans tenants: a
   * unique index is enforced by the *system* rather than by the querying role, exactly as a foreign
   * key is, so it sees rows a policy would have hidden. Two things therefore have to hold at once —
   * the neighbour cannot read the row, and the neighbour's write is not refused because of it.
   */
  it('hides an escalated step from the neighbouring tenant', async () => {
    await fixture.asTenant(TENANT_A, async (client) => {
      expect(await escalate(client, SECOND_APPROVER)).toBe('accepted');
    });

    const seen = await fixture.asTenant(TENANT_B, async (client) => {
      const { rows } = await client.query<{ count: string }>(
        `select count(*)::text as count from workflow_step where escalated_at is not null`,
      );

      return rows[0]?.count;
    });

    expect(seen).toBe('0');
  });

  /**
   * And the neighbour cannot be blocked by a row it cannot see.
   *
   * Tenant B writes the **same** instance, ordinal and membership identifiers as tenant A's live
   * escalation. Were `tenant_id` missing from the key, this would fail with a duplicate-key error
   * naming a row belonging to an organization B has no access to — an isolation leak arriving as a
   * constraint violation rather than as data.
   */
  it('does not let one tenant’s escalation refuse another’s identical write', async () => {
    await fixture.asTenant(TENANT_A, async (client) => {
      expect(await escalate(client, SECOND_APPROVER)).toBe('accepted');
    });

    // Deliberately the *same* instance identifier as tenant A's, which no policy prevents writing
    // because `workflow_step` carries its own `tenant_id`.
    const refused = await fixture.asTenant(TENANT_B, (client) =>
      insertStep(client, {
        tenantId: TENANT_B,
        instanceId,
        ordinal: 1,
        membershipId: SECOND_APPROVER,
        escalated: true,
      }),
    );

    expect(refused).not.toContain(INDEX);
  });

  it('is unique, partial, and keyed on the four columns in order', async () => {
    const { rows } = await fixture.admin.query<{ indexdef: string }>(
      `select indexdef from pg_indexes where schemaname = 'public' and indexname = $1`,
      [INDEX],
    );
    const definition = rows[0]?.indexdef ?? '';

    expect(definition).toContain('CREATE UNIQUE INDEX');
    expect(definition).toContain('(tenant_id, instance_id, ordinal, approver_membership_id)');
    // Partial on both halves: escalated rows only, and live rows only. The second follows every
    // other partial index in this module — a soft-deleted row must not reserve a live row's key.
    expect(definition).toContain('WHERE ((escalated_at IS NOT NULL) AND (deleted_at IS NULL))');
  });

  /** A soft-deleted escalation releases its key, exactly as every other partial index here behaves. */
  it('lets a soft-deleted escalation be replaced by a live one', async () => {
    await fixture.asTenant(TENANT_A, async (client) => {
      expect(await escalate(client, SECOND_APPROVER)).toBe('accepted');
      await client.query(
        `update workflow_step set deleted_at = now(), deleted_by = 'user:test'
          where tenant_id = $1 and escalated_at is not null`,
        [TENANT_A],
      );
      expect(await escalate(client, SECOND_APPROVER)).toBe('accepted');
    });
  });
});

/**
 * The race the index exists for, on two real connections.
 *
 * No sleep, no fake, no disabled constraint and no mocked repository. Both transactions insert the
 * same escalated key and are held open until both have tried, so PostgreSQL — not Node's scheduler —
 * decides which one commits.
 */
suite('two connections escalating the same person at once', () => {
  let fixture: WorkflowFixture;

  beforeAll(async () => {
    fixture = await openWorkflowFixture('workflow_escalation_race_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  it('lets exactly one commit and refuses the other by name', async () => {
    const seeded = await seedInstance(fixture.admin, TENANT_A, [APPROVER]);
    const write = (client: PoolLike) =>
      client.query(
        `insert into workflow_step
           (tenant_id, instance_id, ordinal, approver_kind, approver_membership_id, status,
            escalated_at, metadata, ${AUDIT_COLUMNS})
         values ($1, $2, 1, 'membership', $3, 'awaiting', $4::timestamptz, '{}'::jsonb, ${AUDIT_VALUES})`,
        [TENANT_A, seeded.instanceId, SECOND_APPROVER, AT],
      );

    const outcomes = await Promise.allSettled([
      fixture.asTenant(TENANT_A, write),
      fixture.onSecondConnection(TENANT_A, write),
    ]);
    const committed = outcomes.filter((outcome) => outcome.status === 'fulfilled');
    const refused = outcomes.filter((outcome) => outcome.status === 'rejected');

    expect(committed).toHaveLength(1);
    expect(refused).toHaveLength(1);

    // The loser gets PostgreSQL's uniqueness violation, and it names the index rather than some
    // generic serialization failure — which is what makes the guarantee attributable.
    const reason = refused[0]?.status === 'rejected' ? refusalOf(refused[0].reason) : '';

    expect(reason).toContain(INDEX);
    expect(reason).toContain('duplicate key');

    // And exactly one escalated row survives, which is the property the whole index is for.
    const { rows } = await fixture.admin.query<{ count: string }>(
      `select count(*)::text as count from workflow_step
        where tenant_id = $1 and escalated_at is not null`,
      [TENANT_A],
    );

    expect(rows[0]?.count).toBe('1');
  });

  /** Two different memberships racing onto one branch both commit: the index blocks duplicates only. */
  it('lets two different memberships escalate onto one branch concurrently', async () => {
    const seeded = await seedInstance(fixture.admin, TENANT_A, [APPROVER]);
    const write = (membershipId: string) => (client: PoolLike) =>
      client.query(
        `insert into workflow_step
           (tenant_id, instance_id, ordinal, approver_kind, approver_membership_id, status,
            escalated_at, metadata, ${AUDIT_COLUMNS})
         values ($1, $2, 1, 'membership', $3, 'awaiting', $4::timestamptz, '{}'::jsonb, ${AUDIT_VALUES})`,
        [TENANT_A, seeded.instanceId, membershipId, AT],
      );

    const outcomes = await Promise.allSettled([
      fixture.asTenant(TENANT_A, write(SECOND_APPROVER)),
      fixture.onSecondConnection(TENANT_A, write(DEPUTY)),
    ]);

    expect(outcomes.every((outcome) => outcome.status === 'fulfilled')).toBe(true);
  });
});
