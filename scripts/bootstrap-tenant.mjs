#!/usr/bin/env node
/**
 * Admits a Platform identity to a Munaxa Work tenant, so a freshly migrated database becomes
 * operable without hand-written SQL.
 *
 * **What it is.** Provisioning, not authorization. A Work tenant is not a row in a `tenant` table —
 * there is none — it is a `tenant_id` that memberships and business rows carry (ADR-0033). So the
 * whole of "creating a tenant" is: a `workforce_user` for the Platform account, and a
 * `tenant_membership` joining it to a tenant identifier. Both are written here, in one transaction,
 * as the ordinary application role, under the same row-level security every request runs under.
 *
 * **What it is emphatically not.** It creates no Platform identity, no credential, no token, no
 * password and no permission. It cannot: this repository holds no signing key and no role engine,
 * and authorization arrives in a verified token (ADR-0076). The Platform account named here must
 * already exist — Platform owns identity, and a bootstrap that invented one would be inventing the
 * thing the whole architecture refuses to own. What this buys is the Work-side records that let a
 * *real* Platform-authenticated caller be recognised as a member of somewhere.
 *
 * **Why it needs no elevated database role.** `workforce_user` is protected by reachability rather
 * than by `tenant_id` — a tenant sees a person only through a membership of that tenant — and its
 * policy carries `with check (true)` precisely so that the user may be written a moment before the
 * membership that makes it readable. `tenant_membership` is written under the ordinary tenant
 * policy, with the tenant set transaction-locally exactly as `PostgresUnitOfWork` sets it. Nothing
 * here is granted, disabled or bypassed.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/bootstrap-tenant.mjs --platform-user-id <id> [--tenant-id <uuid>]
 *
 * Options:
 *   --platform-user-id  Required. The Platform account's stable subject — the `sub` of the tokens
 *                       it will present. Never invented here; it must already exist on Platform.
 *   --tenant-id         A UUID v7. Generated when omitted, because the identifier is arbitrary and
 *                       asking somebody to compose one by hand invites a v4 that fails at runtime.
 *   --allow-production  Required when NODE_ENV=production. Admitting an identity to a tenant is a
 *                       real grant of reach, and in production it should be deliberate.
 */

import { randomUUID } from 'node:crypto';

import pg from 'pg';

const CONNECTION = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;

/** The actor written to every audit column here, in the shape a system context already writes. */
const ACTOR = 'system:bootstrap';

/** `runInContext` refuses a tenant that is not a v7, so a v4 would fail on the first request. */
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
};

const argument = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
};

/**
 * A UUID v7, built from the epoch millisecond and random bits.
 *
 * Node ships no v7 generator, and the database's `app_uuid_v7()` cannot be reached before a
 * connection exists. The layout is the one the kernel's `uuidV7` produces and its `isUuidV7`
 * accepts: 48 bits of timestamp, version 7, variant 10.
 */
const uuidV7 = () => {
  const stamp = Date.now().toString(16).padStart(12, '0');
  const rest = randomUUID().slice(14);

  return `${stamp.slice(0, 8)}-${stamp.slice(8, 12)}-7${rest.slice(1)}`;
};

/**
 * What the database already knows about this Platform account, asked the way the request pipeline
 * asks it.
 *
 * `app_memberships_of` is the product's own resolution path (ADR-0033), so a bootstrap that
 * consults it is checking the state the application will actually see rather than a second opinion
 * assembled from tables it cannot read.
 */
const existingMembership = async (client, platformUserId) => {
  const found = await client.query(
    'select tenant_id, membership_id, workforce_user_id from app_memberships_of($1)',
    [platformUserId],
  );
  return found.rows[0];
};

const create = async (client, { tenantId, platformUserId }) => {
  const workforceUserId = uuidV7();
  const membershipId = uuidV7();

  await client.query('begin');
  try {
    // Transaction-local, exactly as `PostgresUnitOfWork` sets it: a session-level setting would
    // outlive the checkout and apply this tenant to whatever used the connection next.
    await client.query('select set_config($1, $2, true)', ['app.tenant_id', tenantId]);
    // No `returning`: reading the row back is a select, and the reachability policy refuses it
    // until the membership below exists. The identifier is generated here instead.
    await client.query(
      `insert into workforce_user
         (id, platform_user_id, status, created_at, created_by, updated_at, updated_by, version)
       values ($1, $2, 'active', now(), $3, now(), $3, 1)`,
      [workforceUserId, platformUserId, ACTOR],
    );
    await client.query(
      `insert into tenant_membership
         (id, tenant_id, workforce_user_id, status, joined_at,
          created_at, created_by, updated_at, updated_by, version)
       values ($1, $2, $3, 'active', now(), now(), $4, now(), $4, 1)`,
      [membershipId, tenantId, workforceUserId, ACTOR],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  }
  return { tenantId, membershipId, workforceUserId };
};

/**
 * Proves the records resolve through the path every request uses, and diagnoses the one failure
 * that otherwise looks like nothing at all.
 *
 * `app_memberships_of` is `security definer`, and the tables it reads carry `force row level
 * security` — which applies to their owner too. So if the role that ran the migrations can neither
 * bypass row-level security nor is a superuser, the function returns no rows, tenant resolution
 * finds no membership, and every authenticated request answers 401 with nothing in the log to say
 * why. Catching it here, at provisioning time, is the difference between a message and an
 * afternoon.
 */
const verify = async (client, platformUserId, expectedTenantId) => {
  const membership = await existingMembership(client, platformUserId);

  if (membership?.tenant_id === expectedTenantId) return;

  throw new Error(
    'The records were written, but app_memberships_of() does not resolve them. That function is ' +
      'security definer over tables with force row level security, so the role that owns them — ' +
      'the role the migrations ran as — must be able to bypass row-level security for tenant ' +
      'resolution to work at all. Grant it BYPASSRLS and re-run this command to confirm. The ' +
      'application role is unaffected and must stay unprivileged (ADR-0030).',
  );
};

const run = async () => {
  const platformUserId = argument('platform-user-id');
  const tenantId = argument('tenant-id') ?? uuidV7();

  if (CONNECTION === undefined) {
    return fail('Set DATABASE_URL to a migrated database, as the application role.');
  }
  if (platformUserId === undefined || platformUserId.trim() === '') {
    return fail(
      'Give --platform-user-id: the Platform account this tenant admits. Munaxa Work does not ' +
        'create Platform identities (ADR-0001); the account must already exist on Platform.',
    );
  }
  if (!UUID_V7.test(tenantId)) {
    return fail(`--tenant-id "${tenantId}" is not a UUID v7. Every tenant identifier is one.`);
  }
  if (process.env.NODE_ENV === 'production' && !process.argv.includes('--allow-production')) {
    return fail(
      'Refusing to bootstrap a production database without --allow-production. Admitting an ' +
        'identity to a tenant is a real grant of reach; in production it should be deliberate.',
    );
  }
  const pool = new pg.Pool({ connectionString: CONNECTION, max: 1 });
  const client = await pool.connect();

  try {
    const already = await existingMembership(client, platformUserId.trim());

    if (already !== undefined) {
      // Idempotent, and deliberately without touching anything: a second run reports the state it
      // found rather than reasserting it. Re-writing the row would move `updated_at` and could
      // overwrite a status somebody changed on purpose.
      process.stdout.write(
        `Already bootstrapped. ${platformUserId} is an active member of tenant ${already.tenant_id}` +
          ` (membership ${already.membership_id}, workforce user ${already.workforce_user_id}).` +
          ' Nothing was written.\n',
      );
      return;
    }
    const created = await create(client, { tenantId, platformUserId: platformUserId.trim() });
    await verify(client, platformUserId.trim(), tenantId);

    process.stdout.write(
      `Bootstrapped tenant ${created.tenantId}.\n` +
        `  workforce user  ${created.workforceUserId}  (platform user ${platformUserId})\n` +
        `  membership      ${created.membershipId}  status active\n` +
        'No permission was granted: Platform must assign this account the work:* grants it needs' +
        ' (ADR-0076, scripts/emit-permission-catalogue.mjs).\n',
    );
  } finally {
    client.release();
    await pool.end();
  }
};

await run().catch((error) => {
  fail(
    error instanceof Error && error.code === '23505'
      ? `A workforce user already exists for ${argument('platform-user-id')}, but it resolves to no` +
          ' active membership. Bootstrap will not alter it: inspect the account and its membership' +
          ' status before deciding what should happen.'
      : `Bootstrap failed: ${error instanceof Error ? error.message : String(error)}`,
  );
});
