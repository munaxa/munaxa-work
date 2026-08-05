-- Row-level security (ADR-0030).
--
-- Every business table gets this treatment in the migration that creates it. A table without a
-- policy is a table without isolation, so this is applied by the migration rather than
-- remembered later.
--
-- The application connects as `work_app`, which owns nothing and holds no BYPASSRLS. Migrations
-- run as a separate privileged role. FORCE ROW LEVEL SECURITY closes the case where the
-- application role would otherwise be exempt as the owner of a table.

-- The current tenant, read from a transaction-local setting. `true` in current_setting means
-- "missing is null rather than an error", so an unset context yields no rows instead of every
-- row — failing closed is the only acceptable direction for this function.
create or replace function app_current_tenant() returns uuid
  language sql
  stable
as $$
  select nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

-- Applies isolation to one table. Called by the migration that creates it.
create or replace procedure app_protect_table(target regclass)
  language plpgsql
as $$
begin
  execute format('alter table %s enable row level security', target);
  execute format('alter table %s force row level security', target);

  execute format('drop policy if exists tenant_isolation on %s', target);
  execute format(
    'create policy tenant_isolation on %s
       using (tenant_id = app_current_tenant())
       with check (tenant_id = app_current_tenant())',
    target
  );
end;
$$;

-- `using` governs what a statement may see; `with check` governs what it may write. Both are
-- required: without `with check`, a tenant could insert or update a row into another tenant —
-- writing a record it would then be unable to read.

-- Superusers bypass row-level security entirely, and FORCE does not apply to them. That makes
-- "the application connected as a superuser" a single misconfiguration that silently disables
-- every policy in this file while every test still passes.
--
-- This reports the current role's ability to bypass isolation. The application calls it at
-- startup and refuses to serve if it can — a database that is not enforcing isolation must fail
-- loudly, not quietly.
create or replace function app_isolation_diagnostics()
  returns table (role_name name, is_superuser boolean, can_bypass_rls boolean, tenant_set boolean)
  language sql
  stable
as $$
  select
    r.rolname,
    r.rolsuper,
    r.rolsuper or r.rolbypassrls,
    app_current_tenant() is not null
  from pg_roles r
  where r.rolname = current_user
$$;
