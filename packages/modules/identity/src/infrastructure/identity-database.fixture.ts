import { Pool } from 'pg';
import {
  InProcessEventDispatcher,
  runInContext,
  uuidV7,
  type Transaction,
  type UnitOfWork,
} from '@work/kernel';
import { PostgresUnitOfWork } from '@work/persistence';

import { postgresIdentityStores } from './identity-stores.js';

/**
 * The database fixture the module's integration suites share.
 *
 * They run against a real PostgreSQL because what they check belongs to the database: row-level
 * security, unique indexes, check constraints and the reachability policy on `workforce_user`
 * are not properties of our code, and a mock would only prove the mock behaves as instructed.
 *
 * Two connections, deliberately. `admin` seeds and inspects, as a migration would. `application`
 * connects as a role that owns nothing and cannot bypass row-level security — which is the only
 * configuration under which any of these assertions mean anything.
 */

export const CONNECTION = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

/**
 * A suite that quietly skips itself on the machine that gates merges reports success for a
 * property nobody checked. So it skips for a developer without a database, and never in CI.
 */
export const requireDatabaseInCi = (suite: string): void => {
  if (CONNECTION === undefined && process.env.CI !== undefined) {
    throw new Error(`${suite} requires a database. Set TEST_DATABASE_URL. Refusing to skip in CI.`);
  }
};

export const TENANT_A = '01920000-0000-7000-8000-00000000aaaa';
export const TENANT_B = '01920000-0000-7000-8000-00000000bbbb';

/** The tables this module owns, most dependent first, for truncation between tests. */
export const IDENTITY_TABLES = [
  'delegation',
  'employment_link',
  'portal_assignment',
  'user_preference',
  'business_profile',
  'invitation',
  'tenant_membership',
  'workforce_user',
];

export interface IdentityFixture {
  readonly admin: Pool;
  readonly application: Pool;
  readonly unitOfWork: UnitOfWork;
  readonly stores: ReturnType<typeof postgresIdentityStores>;
  asTenant<TResult>(
    tenantId: string,
    work: (transaction: Transaction) => Promise<TResult>,
  ): Promise<TResult>;
  seedUser(platformUserId: string): Promise<string>;
  seedMembership(tenantId: string, workforceUserId: string): Promise<string>;
  truncate(): Promise<void>;
  close(): Promise<void>;
}

export const openIdentityFixture = async (role: string): Promise<IdentityFixture> => {
  const admin = new Pool({ connectionString: CONNECTION });

  await admin.query(
    `do $$ begin
       if not exists (select 1 from pg_roles where rolname = '${role}') then
         create role ${role} login nosuperuser password 'fixture';
       end if;
     end $$`,
  );
  await admin.query(
    `grant select, insert, update, delete on ${IDENTITY_TABLES.join(', ')} to ${role}`,
  );

  const url = new URL(CONNECTION ?? '');
  url.username = role;
  url.password = 'fixture';

  const application = new Pool({ connectionString: url.toString() });
  const unitOfWork = new PostgresUnitOfWork(application, new InProcessEventDispatcher());
  const stores = postgresIdentityStores();

  const seedUser = async (platformUserId: string): Promise<string> => {
    const id = uuidV7();

    await admin.query(
      `insert into workforce_user
         (id, platform_user_id, status, created_at, created_by, updated_at, updated_by, version)
       values ($1, $2, 'active', now(), 'test', now(), 'test', 1)`,
      [id, platformUserId],
    );
    return id;
  };

  const seedMembership = async (tenantId: string, workforceUserId: string): Promise<string> => {
    const id = uuidV7();

    await admin.query(
      `insert into tenant_membership
         (id, tenant_id, workforce_user_id, status, joined_at,
          created_at, created_by, updated_at, updated_by, version)
       values ($1, $2, $3, 'active', now(), now(), 'test', now(), 'test', 1)`,
      [id, tenantId, workforceUserId],
    );
    return id;
  };

  return {
    admin,
    application,
    unitOfWork,
    stores,
    // Through the real Unit of Work, so `app.tenant_id` is genuinely set on the transaction.
    asTenant: (tenantId, work) =>
      runInContext({ tenantId, correlationId: uuidV7(), actor: 'user:test' }, () =>
        unitOfWork.execute(work),
      ),
    seedUser,
    seedMembership,
    truncate: async () => {
      await admin.query(`truncate ${IDENTITY_TABLES.join(', ')} cascade`);
    },
    close: async () => {
      await application.end();
      await admin.query(`truncate ${IDENTITY_TABLES.join(', ')} cascade`);
      await admin.end();
    },
  };
};
