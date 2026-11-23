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
 * **Guarded (MW-005).** Every database-free check runs first (scripts/bootstrap-tenant-guard.mjs):
 * an explicit --issuer equal to PLATFORM_AUTH_ISSUER of the running environment, an Identity
 * organisation id echoed with --confirm-organisation, no unknown option. Then every read, check,
 * write and the resolution proof run in ONE transaction, which is committed only when all of them
 * passed: a refusal at any point leaves the database as it was. With --dry-run the same
 * transaction is always rolled back, so it performs every check (constraints included) and prints
 * the writes it would make, and commits nothing.
 *
 * Usage:
 *   DATABASE_URL=... PLATFORM_AUTH_ISSUER=<issuer> node scripts/bootstrap-tenant.mjs \
 *     --platform-user-id <id> --platform-tenant-id <organisation id> \
 *     --confirm-organisation <organisation id> --issuer <issuer> [--tenant-id <uuid>] [--dry-run]
 *
 * Options (`--name value` or `--name=value`; unknown or repeated options are refused):
 *   --platform-user-id  Required. The Platform account's stable subject — the `sub` of the tokens
 *                       it will present. Never invented here; it must already exist on Platform.
 *   --platform-tenant-id
 *                       Required. The Identity organisation id this tenant belongs to — the `tid`
 *                       of that account's tokens (a UUID, not the organisation slug).
 *   --confirm-organisation
 *                       Required. The same organisation id again, after checking in Identity that
 *                       it exists: Identity has no credential-free endpoint to check it here.
 *   --issuer            Required (formerly --platform-issuer, still accepted). Must equal
 *                       PLATFORM_AUTH_ISSUER of the running environment character for character.
 *   --tenant-id         A UUID v7. Generated when omitted, because the identifier is arbitrary and
 *                       asking somebody to compose one by hand invites a v4 that fails at runtime.
 *   --dry-run           Every check, the planned writes printed, nothing committed.
 *   --allow-production  Required when NODE_ENV=production. Admitting an identity to a tenant is a
 *                       real grant of reach, and in production it should be deliberate.
 *
 * The connection is DATABASE_URL, else DATABASE_MIGRATION_URL (the work-migrate task's owner URL),
 * else TEST_DATABASE_URL.
 */

import { randomUUID } from 'node:crypto';

import pg from 'pg';

import { guard } from './bootstrap-tenant-guard.mjs';

/** The actor written to every audit column here, in the shape a system context already writes. */
const ACTOR = 'system:bootstrap';

const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
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

class BindingConflict extends Error {}

/**
 * Transaction-local, exactly as `PostgresUnitOfWork` sets it: a session-level setting would outlive
 * the checkout and apply this tenant to whatever used the connection next.
 */
const enterTenant = (client, tenantId) =>
  client.query('select set_config($1, $2, true)', ['app.tenant_id', tenantId]);

/**
 * What the database already knows about this Platform account, asked the way the request pipeline
 * asks it: `app_memberships_of` (ADR-0033), deliberately the unbound lookup, because bootstrap must
 * see every membership, including those in tenants not yet bound to an organisation.
 */
const membershipsOf = async (client, platformUserId) => {
  const found = await client.query(
    'select tenant_id, membership_id, workforce_user_id from app_memberships_of($1)',
    [platformUserId],
  );
  return found.rows;
};

/** The binding a tenant already has, read under its own tenant context in the open transaction. */
const bindingOf = async (client, tenantId) => {
  await enterTenant(client, tenantId);
  const found = await client.query(
    `select platform_issuer, platform_tenant_id, deleted_at from tenant_platform_binding
      where tenant_id = $1`,
    [tenantId],
  );
  return found.rows[0];
};

/**
 * Writes the binding unless the tenant already has this one. Refuses a different one: re-binding a
 * tenant moves whose grants apply in it, which is not a thing a bootstrap does by accident. Refuses
 * a retired one, which bootstrap will not revive or replace.
 */
const bind = async (client, { tenantId, organisation }) => {
  const row = await bindingOf(client, tenantId);
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
        `${row.platform_issuer}. Bootstrap will not re-bind it; nothing was written.`,
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

/**
 * Every read, check and write, inside the caller's open transaction. Returns what it found and the
 * writes it made, which the caller commits or (dry run, or any failure) rolls back.
 */
const plan = async (client, { platformUserId, namedTenant, organisation }) => {
  const writes = [];
  const binding = (tenantId) =>
    `tenant_platform_binding  tenant ${tenantId} -> organisation ${organisation.tenantId} of ${organisation.issuer}`;
  const already = await alreadyBootstrapped(
    client,
    await membershipsOf(client, platformUserId),
    namedTenant,
  );
  if (already !== undefined) {
    // Idempotent, and deliberately without touching the membership: a second run reports the
    // state it found rather than reasserting it. A tenant bootstrapped before the binding existed
    // gets its binding now; one bound to another organisation is refused.
    if (await bind(client, { tenantId: already.tenant_id, organisation })) {
      writes.push(binding(already.tenant_id));
    }
    return { already, tenantId: already.tenant_id, writes };
  }

  const tenantId = namedTenant ?? uuidV7();
  const workforceUserId = uuidV7();
  const membershipId = uuidV7();
  if (await bind(client, { tenantId, organisation })) writes.push(binding(tenantId));
  // No `returning`: reading the row back is a select, and the reachability policy refuses it
  // until the membership below exists. The identifier is generated here instead.
  await client.query(
    `insert into workforce_user
       (id, platform_user_id, status, created_at, created_by, updated_at, updated_by, version)
     values ($1, $2, 'active', now(), $3, now(), $3, 1)`,
    [workforceUserId, platformUserId, ACTOR],
  );
  writes.push(`workforce_user           ${workforceUserId}  platform user ${platformUserId}`);
  await client.query(
    `insert into tenant_membership
       (id, tenant_id, workforce_user_id, status, joined_at,
        created_at, created_by, updated_at, updated_by, version)
     values ($1, $2, $3, 'active', now(), now(), $4, now(), $4, 1)`,
    [membershipId, tenantId, workforceUserId, ACTOR],
  );
  writes.push(`tenant_membership        ${membershipId}  tenant ${tenantId}, status active`);
  return { tenantId, membershipId, workforceUserId, writes };
};

/**
 * Proves, before commit, that the records resolve through the path every request uses
 * (`app_bound_memberships_of`, owned by `work_membership_resolver`, ADR-0077). Without that
 * ownership the function matches nothing under forced row-level security and every authenticated
 * request answers 401 with nothing in the log to say why; catching it here costs a message.
 */
const verify = async (client, platformUserId, expectedTenantId, organisation) => {
  const found = await client.query('select tenant_id from app_bound_memberships_of($1, $2, $3)', [
    platformUserId,
    organisation.issuer,
    organisation.tenantId,
  ]);

  if (found.rows[0]?.tenant_id === expectedTenantId) return;

  throw new Error(
    'app_bound_memberships_of() does not resolve the records, so tenant resolution would find no ' +
      'membership and every authenticated request would answer 401; the transaction was rolled ' +
      'back and nothing was written. Check that the function is owned by work_membership_resolver ' +
      'and that the membership_resolution policies exist on tenant_membership, workforce_user and ' +
      'tenant_platform_binding — the 20260901090000_membership_resolution_role and ' +
      '20261112090000_tenant_platform_binding migrations establish them (ADR-0077, ADR-0080). Do not ' +
      'grant BYPASSRLS to work around this: no role in the deployment needs it, and the ' +
      'application role must stay unprivileged (ADR-0030).',
  );
};

const report = (options, outcome) => {
  const { platformUserId, organisation, dryRun } = options;
  if (dryRun) {
    return (
      `Dry run: every check passed; nothing was committed.\n` +
      (outcome.writes.length === 0
        ? `  no writes needed (tenant ${outcome.tenantId} is already bootstrapped and bound)\n`
        : `  planned writes:\n${outcome.writes.map((write) => `    ${write}\n`).join('')}`)
    );
  }
  if (outcome.already !== undefined) {
    const { already } = outcome;
    return (
      `Already bootstrapped. ${platformUserId} is an active member of tenant ${already.tenant_id}` +
      ` (membership ${already.membership_id}, workforce user ${already.workforce_user_id}).` +
      (outcome.writes.length > 0
        ? ` Bound the tenant to organisation ${organisation.tenantId}; nothing else was written.\n`
        : ' Nothing was written.\n')
    );
  }
  return (
    `Bootstrapped tenant ${outcome.tenantId}.\n` +
    `  bound to        organisation ${organisation.tenantId} of ${organisation.issuer}\n` +
    `  workforce user  ${outcome.workforceUserId}  (platform user ${platformUserId})\n` +
    `  membership      ${outcome.membershipId}  status active\n` +
    'No permission was granted: Platform must assign this account the work:* grants it needs' +
    ' (ADR-0076, scripts/emit-permission-catalogue.mjs).\n'
  );
};

const run = async (options) => {
  const { platformUserId, namedTenant, organisation, dryRun } = options;
  process.stdout.write(
    `Bootstrap ${dryRun ? '(dry run) ' : ''}inputs, checked:\n` +
      `  platform user   ${platformUserId}\n` +
      `  organisation    ${organisation.tenantId} (confirmed)\n` +
      `  issuer          ${organisation.issuer} (equals PLATFORM_AUTH_ISSUER)\n` +
      `  tenant          ${namedTenant ?? 'new'}\n`,
  );
  const pool = new pg.Pool({ connectionString: options.connection, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('begin');
    try {
      const outcome = await plan(client, options);
      await verify(client, platformUserId, outcome.tenantId, organisation);
      await client.query(dryRun ? 'rollback' : 'commit');
      process.stdout.write(report(options, outcome));
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    }
  } finally {
    client.release();
    await pool.end();
  }
};

const explain = (error, options) => {
  if (error instanceof BindingConflict) return error.message;
  const unique = error instanceof Error && error.code === '23505';
  if (unique && error.constraint === 'tenant_platform_binding_organisation_key') {
    return (
      `Organisation ${options.organisation.tenantId} is already bound to another Work tenant. One ` +
      "organisation's grants may apply in one Work tenant only (ADR-0080); nothing was written."
    );
  }
  if (unique && error.constraint === 'tenant_platform_binding_tenant_key') {
    return (
      `Tenant ${options.namedTenant} was bound by another run while this one was working.` +
      ' Nothing was written by this run; run it again to see the state it left.'
    );
  }
  if (unique) {
    return (
      `A workforce user already exists for ${options.platformUserId}, but it resolves to no` +
      ' active membership. Bootstrap will not alter it: inspect the account and its membership' +
      ' status before deciding what should happen. Nothing was written.'
    );
  }
  return `Bootstrap failed: ${error instanceof Error ? error.message : String(error)}`;
};

const checked = guard(process.argv.slice(2), process.env);
if (!checked.ok) {
  fail(checked.message);
} else {
  await run(checked.options).catch((error) => fail(explain(error, checked.options)));
}
