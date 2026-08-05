import type { Pool } from 'pg';

/**
 * Refuses to start against a database that is not enforcing tenant isolation (ADR-0030).
 *
 * A superuser bypasses row-level security entirely, and `FORCE ROW LEVEL SECURITY` does not
 * apply to one. So a single connection-string mistake — pointing the application at the
 * migration role, or at the bootstrap superuser — disables every policy in the schema while
 * every test still passes and every screen still works. Nothing about the running system looks
 * wrong until a tenant sees another tenant's payroll.
 *
 * That is a failure mode a person cannot be expected to notice, so the process checks at
 * startup and exits instead. A database that is not enforcing isolation must fail loudly.
 */

export interface IsolationDiagnostics {
  readonly role: string;
  readonly isSuperuser: boolean;
  readonly canBypassRowLevelSecurity: boolean;
  readonly policyFunctionInstalled: boolean;
}

export class IsolationNotEnforcedError extends Error {
  public constructor(public readonly diagnostics: IsolationDiagnostics) {
    super(
      `Refusing to start: the database role "${diagnostics.role}" can bypass row-level security` +
        `${diagnostics.isSuperuser ? ' because it is a superuser' : ''}. ` +
        'Tenant isolation would not be enforced. Connect as an unprivileged application role ' +
        'that does not own the tables (ADR-0030).',
    );
    this.name = 'IsolationNotEnforcedError';
  }
}

export class IsolationPolicyMissingError extends Error {
  public constructor() {
    super(
      'Refusing to start: app_isolation_diagnostics() is not installed. The row-level security ' +
        'migration has not been applied to this database. Run `pnpm db:migrate`.',
    );
    this.name = 'IsolationPolicyMissingError';
  }
}

interface DiagnosticsRow {
  readonly role_name: string;
  readonly is_superuser: boolean;
  readonly can_bypass_rls: boolean;
}

const isPolicyInstalled = async (pool: Pool): Promise<boolean> => {
  const installed = await pool.query<{ present: boolean }>(
    `select exists (
       select 1 from pg_proc where proname = 'app_isolation_diagnostics'
     ) as present`,
  );
  return installed.rows[0]?.present === true;
};

/** Reads the diagnostics, reporting rather than throwing. Used by health as well as startup. */
export const readIsolationDiagnostics = async (pool: Pool): Promise<IsolationDiagnostics> => {
  if (!(await isPolicyInstalled(pool))) {
    const role = await pool.query<{ role: string }>('select current_user as role');
    return {
      role: role.rows[0]?.role ?? 'unknown',
      isSuperuser: false,
      canBypassRowLevelSecurity: false,
      policyFunctionInstalled: false,
    };
  }

  const result = await pool.query<DiagnosticsRow>('select * from app_isolation_diagnostics()');
  const row = result.rows[0];

  return {
    role: row?.role_name ?? 'unknown',
    isSuperuser: row?.is_superuser ?? false,
    canBypassRowLevelSecurity: row?.can_bypass_rls ?? false,
    policyFunctionInstalled: true,
  };
};

/**
 * Called once at startup, before the application accepts a request. Throws rather than logging:
 * a warning about disabled tenant isolation is a warning nobody reads until it is too late.
 */
export const assertIsolationEnforced = async (pool: Pool): Promise<IsolationDiagnostics> => {
  const diagnostics = await readIsolationDiagnostics(pool);

  if (!diagnostics.policyFunctionInstalled) {
    throw new IsolationPolicyMissingError();
  }
  if (diagnostics.canBypassRowLevelSecurity) {
    throw new IsolationNotEnforcedError(diagnostics);
  }
  return diagnostics;
};
