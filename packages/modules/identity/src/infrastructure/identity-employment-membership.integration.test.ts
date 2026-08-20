import { uuidV7, type DomainEvent, type Transaction } from '@work/kernel';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  CONNECTION,
  TENANT_A,
  TENANT_B,
  openIdentityFixture,
  requireDatabaseInCi,
  type IdentityFixture,
} from './identity-database.fixture.js';

/**
 * The reverse lookup against the database it will actually meet: real columns, real indexes, and
 * real row-level security under a role that holds no way around it.
 *
 * **The tenant is never a parameter.** `activeForEmployment` takes one employment identifier and
 * reads `transaction.tenantId` for the rest, so there is no argument through which a caller could
 * name another tenant — and RLS refuses the row a second time underneath, which is what the
 * isolation assertions below actually exercise. The fixture role is created `nosuperuser` and holds
 * no `BYPASSRLS`; that is asserted here rather than assumed, because a suite run as a superuser
 * would pass whether or not isolation worked.
 *
 * **One statement, one index, and no enumeration.** The join runs in the database rather than as a
 * link read followed by a membership read per link. The plan is taken from the statement the
 * repository actually issued rather than from a copy retyped beside it, so it keeps meaning
 * something after the repository's own SQL changes.
 */

requireDatabaseInCi("Workforce Identity's employment-membership suite");

const suite = CONNECTION === undefined ? describe.skip : describe;

const EMPLOYMENT = '01930000-0000-7000-8000-0000000000f1';

/** Delegates every statement and keeps what went past, so a plan can be taken from the real SQL. */
const recording = (inner: Transaction, captured: { statement: string; parameters: unknown[] }[]) =>
  ({
    tenantId: inner.tenantId,
    collect: (events: readonly DomainEvent[]): void => {
      inner.collect(events);
    },
    execute: async <TRow>(
      statement: string,
      parameters: readonly unknown[] = [],
    ): Promise<readonly TRow[]> => {
      captured.push({ statement, parameters: [...parameters] });
      return inner.execute<TRow>(statement, parameters);
    },
  }) satisfies Transaction;

suite('the memberships that hold one employment, in PostgreSQL', () => {
  let fixture: IdentityFixture;

  beforeAll(async () => {
    fixture = await openIdentityFixture('work_employment_membership_test');
  });

  afterAll(async () => {
    // The plan test leaves a few thousand rows' worth of statistics behind, and `truncate` does not
    // clear `pg_statistic`. Re-analyzing the emptied tables stops a later suite planning against a
    // volume that is no longer there — the leftover-statistics defect Phase 16B's benchmarks found.
    await fixture.truncate();
    await fixture.admin.query('analyze employment_link');
    await fixture.admin.query('analyze tenant_membership');
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  /** A membership of a tenant, linked to an employment, seeded through the admin connection. */
  const holder = async (
    tenantId: string,
    employmentId: string,
    options: { readonly membershipStatus?: string; readonly linkStatus?: string } = {},
  ): Promise<string> => {
    const user = await fixture.seedUser(`platform-${uuidV7()}`);
    const membership = await fixture.seedMembership(tenantId, user);

    if (options.membershipStatus !== undefined) {
      await fixture.admin.query(`update tenant_membership set status = $1 where id = $2`, [
        options.membershipStatus,
        membership,
      ]);
    }
    await fixture.admin.query(
      `insert into employment_link
         (id, tenant_id, membership_id, employment_id, is_primary, status, linked_at,
          created_at, created_by, updated_at, updated_by, version)
       values ($1, $2, $3, $4, true, $5, now(), now(), 'test', now(), 'test', 1)`,
      [uuidV7(), tenantId, membership, employmentId, options.linkStatus ?? 'linked'],
    );
    return membership;
  };

  /**
   * A few thousand other people, each holding their own job.
   *
   * One statement rather than a loop: this exists to give the planner something to plan against,
   * and a suite that inserted two thousand rows one at a time would spend its time proving that
   * `insert` works.
   */
  const manyOtherHolders = async (count: number): Promise<void> => {
    await fixture.admin.query(
      `insert into workforce_user
         (id, platform_user_id, status, created_at, created_by, updated_at, updated_by, version)
       select gen_random_uuid(), 'bulk-' || g, 'active', now(), 'test', now(), 'test', 1
         from generate_series(1, $1) g`,
      [count],
    );
    await fixture.admin.query(
      `insert into tenant_membership
         (id, tenant_id, workforce_user_id, status, joined_at,
          created_at, created_by, updated_at, updated_by, version)
       select gen_random_uuid(), $1, u.id, 'active', now(), now(), 'test', now(), 'test', 1
         from workforce_user u where u.platform_user_id like 'bulk-%'`,
      [TENANT_A],
    );
    await fixture.admin.query(
      `insert into employment_link
         (id, tenant_id, membership_id, employment_id, is_primary, status, linked_at,
          created_at, created_by, updated_at, updated_by, version)
       select gen_random_uuid(), m.tenant_id, m.id, gen_random_uuid(), true, 'linked', now(),
              now(), 'test', now(), 'test', 1
         from tenant_membership m
        where m.tenant_id = $1 and m.id not in (select membership_id from employment_link)`,
      [TENANT_A],
    );
    // Without this the planner is working from an empty table's statistics and the assertion below
    // would be about a plan no production database would ever produce.
    await fixture.admin.query('analyze employment_link');
    await fixture.admin.query('analyze tenant_membership');
  };

  const holdersIn = (tenantId: string, employmentId = EMPLOYMENT) =>
    fixture.asTenant(tenantId, (transaction) =>
      fixture.stores.memberships.activeForEmployment(transaction, employmentId),
    );

  it('runs as a role that can neither bypass row-level security nor own the tables', async () => {
    const { rows } = await fixture.application.query<{
      rolsuper: boolean;
      rolbypassrls: boolean;
      current_user: string;
    }>(
      `select r.rolsuper, r.rolbypassrls, current_user
         from pg_roles r where r.rolname = current_user`,
    );

    expect(rows[0]).toMatchObject({ rolsuper: false, rolbypassrls: false });
  });

  it('returns the membership that holds the employment', async () => {
    const membership = await holder(TENANT_A, EMPLOYMENT);
    const found = await holdersIn(TENANT_A);

    expect(found.map((row) => row.id)).toStrictEqual([membership]);
    expect(found[0]?.status).toBe('active');
  });

  it('excludes an unlinked link and a membership that is not active', async () => {
    await holder(TENANT_A, EMPLOYMENT, { linkStatus: 'unlinked' });
    await holder(TENANT_A, EMPLOYMENT, { membershipStatus: 'suspended' });
    await holder(TENANT_A, EMPLOYMENT, { membershipStatus: 'ended' });

    expect(await holdersIn(TENANT_A)).toStrictEqual([]);
  });

  it('returns two holders in identifier order, and picks neither', async () => {
    const first = await holder(TENANT_A, EMPLOYMENT);
    const second = await holder(TENANT_A, EMPLOYMENT);
    const found = await holdersIn(TENANT_A);

    expect(found.map((row) => row.id)).toStrictEqual(
      [first, second].sort((left, right) => left.localeCompare(right)),
    );
  });

  it('gives the same answer to the same question, asked twice', async () => {
    await holder(TENANT_A, EMPLOYMENT);

    expect(await holdersIn(TENANT_A)).toStrictEqual(await holdersIn(TENANT_A));
  });

  describe('tenant isolation', () => {
    it('does not resolve another tenant’s holder', async () => {
      await holder(TENANT_A, EMPLOYMENT);

      expect(await holdersIn(TENANT_B)).toStrictEqual([]);
    });

    /**
     * The sharpest form: the **same** employment identifier used in both tenants.
     *
     * An employment identifier is opaque to Identity and nothing stops two tenants recording the
     * same one. Each must see only its own holder, and neither may see the other's — which is a
     * stronger statement than "a caller with the wrong tenant gets nothing back".
     */
    it('keeps two tenants apart when they name the same employment', async () => {
      const inA = await holder(TENANT_A, EMPLOYMENT);
      const inB = await holder(TENANT_B, EMPLOYMENT);

      expect((await holdersIn(TENANT_A)).map((row) => row.id)).toStrictEqual([inA]);
      expect((await holdersIn(TENANT_B)).map((row) => row.id)).toStrictEqual([inB]);
    });

    /** And a link written in one tenant cannot reach a membership row in the other. */
    it('cannot join across the tenant boundary even with both rows present', async () => {
      const membershipInB = await holder(TENANT_B, EMPLOYMENT);

      await fixture.admin.query(
        `insert into employment_link
           (id, tenant_id, membership_id, employment_id, is_primary, status, linked_at,
            created_at, created_by, updated_at, updated_by, version)
         values ($1, $2, $3, $4, false, 'linked', now(), now(), 'test', now(), 'test', 1)`,
        [uuidV7(), TENANT_A, membershipInB, EMPLOYMENT],
      );

      // The link row is in tenant A and the membership row is in tenant B. The join requires both
      // in the same tenant, and row-level security refuses the other half regardless.
      expect(await holdersIn(TENANT_A)).toStrictEqual([]);
    });
  });

  describe('how it reads', () => {
    it('issues exactly one statement, with no membership enumeration', async () => {
      await holder(TENANT_A, EMPLOYMENT);

      const captured: { statement: string; parameters: unknown[] }[] = [];

      await fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.memberships.activeForEmployment(
          recording(transaction, captured),
          EMPLOYMENT,
        ),
      );

      expect(captured).toHaveLength(1);

      const [only] = captured;

      // The employment is a bound parameter and the tenant comes from the transaction — there is no
      // third parameter, because there is no filter, page or term to carry one.
      expect(only?.parameters).toStrictEqual([TENANT_A, EMPLOYMENT]);
      expect(only?.statement).not.toMatch(/limit|offset|ilike|recursive/i);
    });

    /**
     * The plan, from the statement the repository issued rather than a copy of it.
     *
     * `enable_seqscan` is turned off, which is a statement about *reachability* rather than about
     * the planner: a handful of rows are cheaper to scan than to index at any size, so the question
     * worth asking of a fixture-sized table is whether the query could use its index at all. A
     * predicate on the wrong column or a leading key omitted makes an index unreachable at every
     * size, and that is what this catches.
     */
    /**
     * The plan, from the statement the repository issued and against a table with rows in it.
     *
     * **The volume is the point.** At fixture size every access path costs nothing, and the planner
     * picks between `employment_link_employment_idx` and the membership-status index by whim — the
     * second of which reads every linked row in the tenant and filters the employment afterwards.
     * That is the shape §19 forbids, and it is invisible at seven rows. With a few thousand links
     * the planner chooses the employment index and drives the membership by primary key, which is
     * the bounded lookup this query is supposed to be.
     *
     * No index was added for this. `employment_link_employment_idx` on `(tenant_id, employment_id)`
     * has existed since Identity's own phase; the reverse direction was already indexed and only
     * the query was missing.
     */
    it('reaches the employment index and the membership primary key, at realistic volume', async () => {
      await holder(TENANT_A, EMPLOYMENT);
      await manyOtherHolders(2000);

      const plan = await fixture.asTenant(TENANT_A, async (transaction) => {
        const captured: { statement: string; parameters: unknown[] }[] = [];

        await fixture.stores.memberships.activeForEmployment(
          recording(transaction, captured),
          EMPLOYMENT,
        );

        const [only] = captured;

        if (only === undefined) throw new Error('The repository issued no statement.');

        const rows = await transaction.execute<{ 'QUERY PLAN': string }>(
          `explain (costs off) ${only.statement}`,
          only.parameters,
        );

        return rows.map((row) => row['QUERY PLAN']).join('\n');
      });

      expect(plan).toMatch(/employment_link_employment_idx/);
      expect(plan).toMatch(/Index Cond:.*employment_id/s);
      // Neither table is enumerated, and nothing recurses: one level is all this answers.
      expect(plan).not.toMatch(/Seq Scan/);
      expect(plan).not.toMatch(/Recursive/i);
    });
  });
});
