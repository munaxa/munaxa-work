-- Membership resolution under FORCE ROW LEVEL SECURITY (ADR-0077, refining ADR-0033).
--
-- `app_memberships_of` answers the one question the request pipeline must ask before any tenant is
-- in context: which tenants may this authenticated person act in. It is `security definer` so that
-- it can, and ADR-0033 chose that deliberately over "a second connection holding BYPASSRLS, which
-- would open a general hole to solve one specific problem".
--
-- `security definer` was not enough, and the gap is silent. ADR-0030 requires FORCE ROW LEVEL
-- SECURITY, and FORCE applies row-level security to the table *owner* as well. The function
-- therefore ran as a role that was still subject to `tenant_isolation`, with no tenant in context —
-- so `app_current_tenant()` was null, the policy matched nothing, and the function returned zero
-- rows. Tenant resolution then found no membership and every authenticated request answered 401,
-- with nothing in any log to say why. It worked in CI only because migrations there run as a
-- superuser, whom FORCE does not apply to.
--
-- The fix keeps ADR-0033's decision rather than reversing it. The reach the function needs is
-- expressed as a policy on two named tables, granted to one role that cannot log in, instead of as
-- a privilege on a role that could read everything:
--
--   * `work_membership_resolver` owns the function and nothing else. It has NOLOGIN, so no
--     connection can ever be made as it; NOBYPASSRLS, so it is subject to every other policy in
--     the schema; and SELECT on exactly two tables.
--   * Two policies, `for select`, `to work_membership_resolver`, give it the rows the function
--     reads. A permissive policy is a union, so this adds reach for that role alone and changes
--     nothing for `work_app`, which is not a member of it.
--   * The migration role may SET ROLE to it — required to transfer ownership — but explicitly
--     does NOT inherit it. Without `inherit false` the migration role would silently acquire
--     unrestricted read on both tables, which is the hole this is avoiding.
--
-- The result is that no role in the deployment holds BYPASSRLS, FORCE stays on every table, and
-- the total additional reach in the system is `select` on two tables by a role nobody can
-- authenticate as. See ADR-0077 for the alternatives and why each was rejected.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'work_membership_resolver') then
    -- Every attribute is a refusal. The role exists to own one function and to be named by two
    -- policies; it must never be able to do anything else, and least of all to be connected as.
    create role work_membership_resolver
      nologin nosuperuser nobypassrls nocreatedb nocreaterole noreplication;
  end if;
end $$;

-- Roles are cluster-wide, so the role may predate this database. Ownership transfer needs SET
-- ROLE; `inherit false` is what keeps the migration role from gaining the reach along with it.
-- `SET` specifically, not `MEMBER`: creating a role grants the creator ADMIN with neither INHERIT
-- nor SET, so a membership test would report satisfied while the ownership transfer below still
-- fails. `inherit false` is restated because that is the property being protected.
do $$ begin
  if not pg_has_role(current_user, 'work_membership_resolver', 'SET') then
    execute format(
      'grant work_membership_resolver to %I with inherit false, set true', current_user);
  end if;
exception when insufficient_privilege then
  raise exception using
    message = 'Cannot administer role work_membership_resolver.',
    detail  = 'It exists in this cluster and was created by another role, so this migration role '
              || 'holds no ADMIN option on it.',
    hint    = 'Grant it: GRANT work_membership_resolver TO <migration role> WITH ADMIN OPTION, '
              || 'INHERIT FALSE, SET TRUE. See ADR-0077.';
end $$;

grant usage on schema public to work_membership_resolver;
grant select on tenant_membership, workforce_user to work_membership_resolver;

-- Owning an object in a schema requires CREATE on it: granted for the transfer and taken straight
-- back, so the role owns the function afterwards and can create nothing. Guarded by the current
-- owner so that re-running this file is a no-op rather than an error — after the transfer the
-- migration role is no longer the owner and may neither comment on it nor move it again.
do $$ begin
  if (select r.rolname
        from pg_proc p join pg_roles r on r.oid = p.proowner
       where p.proname = 'app_memberships_of') <> 'work_membership_resolver' then

    execute $comment$comment on function app_memberships_of(varchar) is
      'Resolves an authenticated Platform user to the tenants they may act in. The only deliberate '
      'cross-tenant read in Munaxa Work (ADR-0033). Owned by work_membership_resolver, which cannot '
      'log in and reads two tables (ADR-0077). Returns identifiers, never data.'$comment$;

    execute 'grant create on schema public to work_membership_resolver';
    execute 'alter function app_memberships_of(varchar) owner to work_membership_resolver';
    execute 'revoke create on schema public from work_membership_resolver';
  end if;
end $$;

-- The reach itself, and the whole of it. `for select` because the function only reads, and `to`
-- the resolver because a policy without one would apply to every role including the application's.
drop policy if exists membership_resolution on tenant_membership;
create policy membership_resolution on tenant_membership
  for select to work_membership_resolver using (true);

drop policy if exists membership_resolution on workforce_user;
create policy membership_resolution on workforce_user
  for select to work_membership_resolver using (true);
