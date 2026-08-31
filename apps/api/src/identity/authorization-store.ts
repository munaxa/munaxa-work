import type {
  RoleAssignment,
  RoleAssignmentPort,
  RoleDefinition,
  RoleRepositoryPort,
} from '@munaxa/interfaces';
import { assertValidGrant } from '@munaxa/rbac';
import { unsafeId, type TenantId, type UserId } from '@munaxa/types';
import { auditForInsert, auditForUpdate } from '@work/persistence';
import type { Pool, PoolClient } from 'pg';

/**
 * Munaxa Work's side of the approved authorization split: it **stores** assignments, and
 * `@munaxa/rbac` decides with them.
 *
 * Everything a resolver needs is here and nothing else is. There is no evaluation, no
 * inheritance walk, no wildcard matching and no scope arithmetic in this file — all four live in
 * the platform's resolver, and a second implementation of any of them would be the second
 * authorization engine the architecture exists to prevent.
 *
 * **The subject is a membership.** `RoleAssignmentPort` calls it a `UserId`, and what Munaxa Work
 * supplies is the membership identifier — the person *in this tenant*. That is the narrower of
 * the two available subjects and the one that makes non-union structural: a person with two
 * memberships has two disjoint grant sets, and no query shape here could combine them even by
 * mistake.
 *
 * **Every statement runs inside a transaction that has set the tenant.** Not because the `where`
 * clauses would otherwise be wrong — they name `tenant_id` too — but because row-level security
 * is what makes them true when they are wrong, and a connection that has not set `app.tenant_id`
 * reads nothing rather than reading everything.
 */

/**
 * Runs one unit of work with the tenant established transaction-locally.
 *
 * `set_config(..., true)` rather than a session setting, for the reason the unit of work gives:
 * on a pooled connection a session-level tenant survives the checkout and silently applies one
 * request's tenant to the next request's queries, which fails *open* and looks like it is
 * working.
 */
const withTenant = async <TResult>(
  pool: Pool,
  tenantId: string,
  work: (client: PoolClient) => Promise<TResult>,
): Promise<TResult> => {
  const client = await pool.connect();

  try {
    await client.query('begin');
    await client.query('select set_config($1, $2, true)', ['app.tenant_id', tenantId]);

    const result = await work(client);

    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
};

interface RoleRow {
  readonly role_id: string;
  readonly name: string;
  readonly description: string | null;
  readonly permissions: string[];
  readonly inherits: string[];
  readonly system: boolean;
}

interface AssignmentRow {
  readonly role_id: string;
  readonly membership_id: string;
  readonly scope: string | null;
  readonly created_at: Date;
  readonly created_by: string;
  readonly expires_at: Date | null;
}

const ROLE_COLUMNS = 'role_id, name, description, permissions, inherits, system';

const roleFrom = (row: RoleRow, tenantId: TenantId): RoleDefinition => ({
  id: row.role_id,
  tenantId,
  name: row.name,
  ...(row.description === null ? {} : { description: row.description }),
  permissions: row.permissions,
  inherits: row.inherits,
  system: row.system,
});

const assignmentFrom = (row: AssignmentRow, tenantId: TenantId): RoleAssignment => ({
  tenantId,
  userId: unsafeId<UserId>(row.membership_id),
  roleId: row.role_id,
  assignedAt: row.created_at.getTime(),
  assignedBy: unsafeId<UserId>(row.created_by),
  ...(row.expires_at === null ? {} : { expiresAt: row.expires_at.getTime() }),
  ...(row.scope === null ? {} : { scope: row.scope }),
});

/** The roles a tenant has defined. Read by the resolver; written by administration. */
export class PostgresRoleRepository implements RoleRepositoryPort {
  public constructor(private readonly pool: Pool) {}

  public async list(tenantId: TenantId): Promise<readonly RoleDefinition[]> {
    const rows = await withTenant(this.pool, tenantId, async (client) => {
      const result = await client.query<RoleRow>(
        `select ${ROLE_COLUMNS} from tenant_role
          where tenant_id = $1 and deleted_at is null
          order by role_id`,
        [tenantId],
      );

      return result.rows;
    });

    return rows.map((row) => roleFrom(row, tenantId));
  }

  public async get(tenantId: TenantId, roleId: string): Promise<RoleDefinition | undefined> {
    const rows = await withTenant(this.pool, tenantId, async (client) => {
      const result = await client.query<RoleRow>(
        `select ${ROLE_COLUMNS} from tenant_role
          where tenant_id = $1 and role_id = $2 and deleted_at is null`,
        [tenantId, roleId],
      );

      return result.rows;
    });
    const [row] = rows;

    return row === undefined ? undefined : roleFrom(row, tenantId);
  }

  /**
   * Writes a role, replacing the grants it confers.
   *
   * Each grant is validated by the platform's own `assertValidGrant` before it is stored. The
   * table's CHECK says the same thing, and both are worth having: the check makes it true of
   * rows written by anything at all, and this makes the failure a legible error at the point
   * somebody made the mistake rather than a constraint violation.
   */
  public async save(role: RoleDefinition): Promise<void> {
    for (const permission of role.permissions) assertValidGrant(permission);

    const audit = auditForInsert(new Date());

    await withTenant(this.pool, role.tenantId, async (client) => {
      await client.query(
        `insert into tenant_role
           (tenant_id, role_id, name, description, permissions, inherits, system,
            created_at, created_by, updated_at, updated_by, version)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $8, $9, 1)
         on conflict (tenant_id, role_id) where deleted_at is null
         do update set
           name = excluded.name,
           description = excluded.description,
           permissions = excluded.permissions,
           inherits = excluded.inherits,
           system = excluded.system,
           updated_at = excluded.updated_at,
           updated_by = excluded.updated_by,
           version = tenant_role.version + 1`,
        [
          role.tenantId,
          role.id,
          role.name,
          role.description ?? null,
          role.permissions,
          role.inherits ?? [],
          role.system ?? false,
          audit.created_at,
          audit.created_by,
        ],
      );
    });
  }

  /** Soft-deletes a role. Assignments naming it resolve to no permissions, never to an error. */
  public async remove(tenantId: TenantId, roleId: string): Promise<boolean> {
    const audit = auditForUpdate(new Date());

    return withTenant(this.pool, tenantId, async (client) => {
      const result = await client.query(
        `update tenant_role
            set deleted_at = $3, deleted_by = $4, updated_at = $3, updated_by = $4,
                version = version + 1
          where tenant_id = $1 and role_id = $2 and deleted_at is null`,
        [tenantId, roleId, audit.updated_at, audit.updated_by],
      );

      return (result.rowCount ?? 0) > 0;
    });
  }
}

/** Who holds which role. The authoritative grant source the resolver reads on every request. */
export class PostgresRoleAssignments implements RoleAssignmentPort {
  public constructor(private readonly pool: Pool) {}

  /**
   * Every live assignment for one membership in one tenant.
   *
   * Both are in the `where` clause and both are enforced by the policy. Expiry is deliberately
   * *not* filtered here: `isAssignmentActive` is the platform's rule about what "in force" means,
   * and applying a second version of it in SQL would be this file deciding something the resolver
   * decides.
   */
  public async listForUser(tenantId: TenantId, userId: UserId): Promise<readonly RoleAssignment[]> {
    const rows = await withTenant(this.pool, tenantId, async (client) => {
      const result = await client.query<AssignmentRow>(
        `select role_id, membership_id, scope, created_at, created_by, expires_at
           from tenant_role_assignment
          where tenant_id = $1 and membership_id = $2 and deleted_at is null
          order by role_id, scope`,
        [tenantId, userId],
      );

      return result.rows;
    });

    return rows.map((row) => assignmentFrom(row, tenantId));
  }

  public async assign(assignment: RoleAssignment): Promise<void> {
    const audit = auditForInsert(new Date(assignment.assignedAt));

    await withTenant(this.pool, assignment.tenantId, async (client) => {
      await client.query(
        `insert into tenant_role_assignment
           (tenant_id, membership_id, role_id, scope, expires_at,
            created_at, created_by, updated_at, updated_by, version)
         values ($1, $2, $3, $4, $5, $6, $7, $6, $7, 1)
         on conflict (tenant_id, membership_id, role_id, coalesce(scope, ''))
           where deleted_at is null
         do update set
           expires_at = excluded.expires_at,
           updated_at = excluded.updated_at,
           updated_by = excluded.updated_by,
           version = tenant_role_assignment.version + 1`,
        [
          assignment.tenantId,
          assignment.userId,
          assignment.roleId,
          assignment.scope ?? null,
          assignment.expiresAt === undefined ? null : new Date(assignment.expiresAt),
          audit.created_at,
          assignment.assignedBy ?? audit.created_by,
        ],
      );
    });
  }

  /**
   * Withdraws one assignment.
   *
   * Scope-aware, because a course administrator and an administrator everywhere are two different
   * grants of the same role, and revoking one must not silently revoke the other.
   */
  public async revoke(
    tenantId: TenantId,
    userId: UserId,
    roleId: string,
    scope?: string,
  ): Promise<boolean> {
    const audit = auditForUpdate(new Date());

    return withTenant(this.pool, tenantId, async (client) => {
      const result = await client.query(
        `update tenant_role_assignment
            set deleted_at = $5, deleted_by = $6, updated_at = $5, updated_by = $6,
                version = version + 1
          where tenant_id = $1 and membership_id = $2 and role_id = $3
            and coalesce(scope, '') = $4 and deleted_at is null`,
        [tenantId, userId, roleId, scope ?? '', audit.updated_at, audit.updated_by],
      );

      return (result.rowCount ?? 0) > 0;
    });
  }
}
