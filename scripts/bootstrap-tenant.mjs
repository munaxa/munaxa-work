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
 * **The binding (ADR-0080).** A Work tenant records the one Platform organisation (`tid`) it
 * belongs to; requests resolve only memberships of the tenant bound to the token's organisation.
 * The binding is written here once and never changed: a different organisation for a bound tenant,
 * a retired binding, or an unbound tenant the operator did not name with --tenant-id is refused.
 * The runtime role cannot write bindings, so run this as the owner role (deploy/aws/README.md).
 *
 * Usage:
 *   DATABASE_URL=... node scripts/bootstrap-tenant.mjs --platform-user-id <id> \
 *     --platform-tenant-id <organisation id> [--platform-issuer <url>] [--tenant-id <uuid>]
 *
 * Options:
 *   --platform-user-id  Required. The Platform account's stable subject — the `sub` of the tokens
 *                       it will present. Never invented here; it must already exist on Platform.
 *   --platform-tenant-id
 *                       Required. The Platform organisation this tenant belongs to — the `tid` of
 *                       that account's tokens (Identity's organisation id, not its slug).
 *   --platform-issuer   The issuer, exactly as PLATFORM_AUTH_ISSUER. Defaults to that variable.
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
 * Node ships no v7 generator. The layout is the kernel's `uuidV7`: 48 bits of timestamp, version
 * 7, variant 10.
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
 * assembled from tables it cannot read. It is deliberately the unbound lookup: bootstrap must see
 * every membership, including those in tenants not yet bound to an organisation.
 */
const membershipsOf = async (client, platformUserId) => {
  const found = await client.query(
    'select tenant_id, membership_id, workforce_user_id from app_memberships_of($1)',
    [platformUserId],
  );
  return found.rows;
};

/** The binding a tenant already has, read under its own tenant context. */
const bindingOf = async (client, tenantId) => {
  await client.query('begin');
  try {
    await client.query('select set_config($1, $2, true)', ['app.tenant_id', tenantId]);
    const found = await client.query(
      `select platform_issuer, platform_tenant_id, deleted_at from tenant_platform_binding
        where tenant_id = $1`,
      [tenantId],
    );
    await client.query('commit');
    return found.rows[0];
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  }
};

/**
 * Writes the binding inside an open, tenant-scoped transaction, unless the tenant already has one.
 * Refuses a different one: re-binding a tenant moves whose grants apply in it, which is not a
 * thing a bootstrap does by accident.
 */
const bind = async (client, { tenantId, organisation }) => {
  const existing = await client.query(
    `select platform_issuer, platform_tenant_id, deleted_at from tenant_platform_binding
      where tenant_id = $1`,
    [tenantId],
  );
  const row = existing.rows[0];
  if (row?.deleted_at !== undefined && row.deleted_at !== null) {
    throw new BindingConflict(
      `Tenant ${tenantId} has a retired binding (organisation ${row.platform_tenant_id}).` +
        ' Bootstrap will not revive or replace it; nothing was written.',
    );
  }
  if (row !== undefined) {
    if (
      row.platform_issuer === organisation.issuer &&
      row.platform_tenant_id === organisation.tenantId
    ) {
      return false;
    }
    throw new BindingConflict(
      `Tenant ${tenantId} is already bound to organisation ${row.platform_tenant_id} of ` +
        `${row.platform_issuer}. Bootstrap will not re-bind it.`,
    );
  }
  await client.query(
    `insert into tenant_platform_binding
       (id, tenant_id, platform_issuer, platform_tenant_id,
        created_at, created_by, updated_at, updated_by, version)
     values ($1, $2, $3, $4, now(), $5, now(), $5, 1)`,
    [uuidV7(), tenantId, organisation.issuer, organisation.tenantId, ACTOR],
  );
  return true;
};

class BindingConflict extends Error {}

/**
 * The membership a re-run is about, or `undefined` for a first run. Bootstrap binds only a tenant
 * the operator named or one already bound, never an unnamed unbound one: binding a person's other
 * (perhaps legacy, unbound) tenant to this organisation would hand this organisation's grants that
 * tenant's data (WK-01).
 */
const alreadyBootstrapped = async (client, memberships, namedTenant) => {
  if (memberships.length === 0) return undefined;
  const tenants = memberships.map((membership) => membership.tenant_id).join(', ');
  if (namedTenant !== undefined) {
    const named = memberships.find((membership) => membership.tenant_id === namedTenant);
    if (named !== undefined) return named;
    throw new BindingConflict(
      `The person is already a member of tenant(s) ${tenants}, not of ${namedTenant}. Bootstrap ` +
        'admits the first person of a new tenant only; nothing was written.',
    );
  }
  if (memberships.length > 1) {
    throw new BindingConflict(
      `The person is a member of several tenants (${tenants}). Name one with --tenant-id; ` +
        'nothing was written.',
    );
  }
  const [only] = memberships;
  if ((await bindingOf(client, only.tenant_id)) === undefined) {
    throw new BindingConflict(
      `Tenant ${only.tenant_id} is not bound to any organisation yet. Name it with --tenant-id to ` +
        'bind it; bootstrap binds no tenant it was not given. Nothing was written.',
    );
  }
  return only;
};

const ensureBinding = async (client, { tenantId, organisation }) => {
  await client.query('begin');
  try {
    await client.query('select set_config($1, $2, true)', ['app.tenant_id', tenantId]);
    const written = await bind(client, { tenantId, organisation });
    await client.query('commit');
    return written;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  }
};

const create = async (client, { tenantId, platformUserId, organisation }) => {
  const workforceUserId = uuidV7();
  const membershipId = uuidV7();

  await client.query('begin');
  try {
    // Transaction-local, exactly as `PostgresUnitOfWork` sets it: a session-level setting would
    // outlive the checkout and apply this tenant to whatever used the connection next.
    await client.query('select set_config($1, $2, true)', ['app.tenant_id', tenantId]);
    await bind(client, { tenantId, organisation });
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
 * `app_memberships_of` must be owned by `work_membership_resolver` for tenant resolution to work:
 * the tables it reads carry `force row level security`, which applies to their owner too, so a
 * function owned by anything else runs subject to `tenant_isolation` with no tenant in context,
 * matches nothing, and returns no rows. Tenant resolution then finds no membership and every
 * authenticated request answers 401 with nothing in the log to say why. The migration establishes
 * that ownership (ADR-0077); this checks it held, because catching it at provisioning time is the
 * difference between a message and an afternoon.
 */
const verify = async (client, platformUserId, expectedTenantId, organisation) => {
  const found = await client.query('select tenant_id from app_bound_memberships_of($1, $2, $3)', [
    platformUserId,
    organisation.issuer,
    organisation.tenantId,
  ]);

  if (found.rows[0]?.tenant_id === expectedTenantId) return;

  throw new Error(
    'The records were written, but app_bound_memberships_of() does not resolve them, so tenant ' +
      'resolution would find no membership and every authenticated request would answer 401. ' +
      'Check that the function is owned by work_membership_resolver and that the ' +
      'membership_resolution policies exist on tenant_membership, workforce_user and ' +
      'tenant_platform_binding — the 20260901090000_membership_resolution_role and ' +
      '20261112090000_tenant_platform_binding migrations establish them (ADR-0077, ADR-0080). Do not ' +
      'grant BYPASSRLS to work around this: no role in the deployment needs it, and the ' +
      'application role must stay unprivileged (ADR-0030).',
  );
};

const run = async () => {
  const platformUserId = argument('platform-user-id');
  const namedTenant = argument('tenant-id');
  const tenantId = namedTenant ?? uuidV7();
  const platformTenantId = argument('platform-tenant-id')?.trim();
  const platformIssuer = (argument('platform-issuer') ?? process.env.PLATFORM_AUTH_ISSUER)?.trim();

  if (CONNECTION === undefined) {
    return fail('Set DATABASE_URL to a migrated database, as the application role.');
  }
  if (platformUserId === undefined || platformUserId.trim() === '') {
    return fail(
      'Give --platform-user-id: the Platform account this tenant admits. Munaxa Work does not ' +
        'create Platform identities (ADR-0001); the account must already exist on Platform.',
    );
  }
  if (
    platformTenantId === undefined ||
    platformTenantId === '' ||
    platformTenantId.startsWith('--')
  ) {
    return fail(
      'Give --platform-tenant-id: the Platform organisation id this tenant belongs to (the tid of ' +
        "the account's tokens). A Work tenant with no organisation admits nobody (ADR-0080).",
    );
  }
  if (platformIssuer === undefined || platformIssuer === '' || platformIssuer.startsWith('--')) {
    return fail(
      'Give --platform-issuer or set PLATFORM_AUTH_ISSUER: the issuer the binding holds for, ' +
        'exactly as the deployment verifies it.',
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
    const organisation = { issuer: platformIssuer, tenantId: platformTenantId };
    const memberships = await membershipsOf(client, platformUserId.trim());
    const already = await alreadyBootstrapped(client, memberships, namedTenant);
    if (already !== undefined) {
      // Idempotent, and deliberately without touching the membership: a second run reports the
      // state it found rather than reasserting it. Re-writing the row would move `updated_at` and
      // could overwrite a status somebody changed on purpose. A tenant bootstrapped before the
      // binding existed gets its binding now; one bound to another organisation is refused.
      const bound = await ensureBinding(client, { tenantId: already.tenant_id, organisation });
      await verify(client, platformUserId.trim(), already.tenant_id, organisation);
      process.stdout.write(
        `Already bootstrapped. ${platformUserId} is an active member of tenant ${already.tenant_id}` +
          ` (membership ${already.membership_id}, workforce user ${already.workforce_user_id}).` +
          (bound
            ? ` Bound the tenant to organisation ${platformTenantId}; nothing else was written.\n`
            : ' Nothing was written.\n'),
      );
      return;
    }
    const existingBinding = await bindingOf(client, tenantId);
    if (
      existingBinding !== undefined &&
      (existingBinding.platform_issuer !== organisation.issuer ||
        existingBinding.platform_tenant_id !== organisation.tenantId)
    ) {
      throw new BindingConflict(
        `Tenant ${tenantId} is already bound to organisation ${existingBinding.platform_tenant_id}.` +
          ' Bootstrap will not re-bind it.',
      );
    }
    const created = await create(client, {
      tenantId,
      platformUserId: platformUserId.trim(),
      organisation,
    });
    await verify(client, platformUserId.trim(), tenantId, organisation);

    process.stdout.write(
      `Bootstrapped tenant ${created.tenantId}.\n` +
        `  bound to        organisation ${platformTenantId} of ${platformIssuer}\n` +
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
  if (error instanceof BindingConflict) return fail(error.message);
  if (
    error instanceof Error &&
    error.code === '23505' &&
    error.constraint === 'tenant_platform_binding_organisation_key'
  ) {
    return fail(
      `Organisation ${argument('platform-tenant-id')} is already bound to another Work tenant. One ` +
        "organisation's grants may apply in one Work tenant only (ADR-0080); nothing was written.",
    );
  }
  if (
    error instanceof Error &&
    error.code === '23505' &&
    error.constraint === 'tenant_platform_binding_tenant_key'
  ) {
    return fail(
      `Tenant ${argument('tenant-id')} was bound by another run while this one was working.` +
        ' Nothing was written by this run; run it again to see the state it left.',
    );
  }
  fail(
    error instanceof Error && error.code === '23505'
      ? `A workforce user already exists for ${argument('platform-user-id')}, but it resolves to no` +
          ' active membership. Bootstrap will not alter it: inspect the account and its membership' +
          ' status before deciding what should happen.'
      : `Bootstrap failed: ${error instanceof Error ? error.message : String(error)}`,
  );
});
