-- Binding a Work tenant to the one Platform organisation whose grants may be exercised in it
-- (WK-01, ADR-0080).
--
-- An access token's `perms` are what the account holds in the organisation named by its `tid`.
-- Before this migration nothing tied a Work tenant to an organisation, so a person with active
-- memberships in two Work tenants carried one organisation's grants into both: payroll
-- administrator in one tenant became payroll administrator in the other by changing the tenant
-- header. Membership answered "may this person be in the tenant" and the token answered "what may
-- they do in the organisation"; the request used the second in a tenant it was never computed for.
--
-- The fix is a fact the product stores, not a claim it believes: each Work tenant is bound to one
-- (issuer, organisation), and resolution returns only memberships in the tenant bound to the
-- token's organisation. The token's `tid` becomes a filter on a stored relationship. It still never
-- selects a tenant by itself, and a tenant with no binding resolves nobody, which is the fail-closed
-- direction.

create table tenant_platform_binding (
  id                 uuid primary key default app_uuid_v7(),
  tenant_id          uuid           not null,
  -- The issuer the binding holds for, exactly as `PLATFORM_AUTH_ISSUER`. A binding never carries
  -- over to a different Identity deployment that happens to reuse an organisation id.
  platform_issuer    varchar(2048)  not null,
  platform_tenant_id varchar(255)   not null,
  created_at         timestamptz(6) not null,
  created_by         varchar(255)   not null,
  updated_at         timestamptz(6) not null,
  updated_by         varchar(255)   not null,
  deleted_at         timestamptz(6),
  deleted_by         varchar(255),
  version            integer        not null,

  constraint tenant_platform_binding_issuer_present check (btrim(platform_issuer) <> ''),
  constraint tenant_platform_binding_tenant_present check (btrim(platform_tenant_id) <> '')
);

-- One organisation per tenant, and one tenant per organisation. The second constraint is the one
-- WK-01 needs: if one organisation could be bound to two Work tenants, its grants would again apply
-- in both. Plain unique constraints rather than partial ones, so that even a soft-deleted binding
-- cannot be duplicated around; re-binding is a deliberate owner action, not an application write.
create unique index tenant_platform_binding_tenant_key
  on tenant_platform_binding (tenant_id);
create unique index tenant_platform_binding_organisation_key
  on tenant_platform_binding (platform_issuer, platform_tenant_id);

-- Isolated like every other table: a tenant sees its own binding and nothing else.
call app_protect_table('tenant_platform_binding');

-- The resolver may read bindings before any tenant is in context, through the one function below,
-- exactly as it reads memberships (ADR-0077). Nothing else gains reach.
grant select on tenant_platform_binding to work_membership_resolver;

drop policy if exists membership_resolution on tenant_platform_binding;
create policy membership_resolution on tenant_platform_binding
  for select to work_membership_resolver using (true);

-- Resolution for an authenticated request, with the organisation the token was issued for.
--
-- The same rows `app_memberships_of` returns, restricted to the Work tenant bound to
-- (p_platform_issuer, p_platform_tenant_id). The predicate lives here rather than in application
-- code because it is the control: a caller that forgot it would reintroduce WK-01 silently.
create or replace function app_bound_memberships_of(
  p_platform_user_id   varchar,
  p_platform_issuer    varchar,
  p_platform_tenant_id varchar
)
  returns table (
    tenant_id         uuid,
    membership_id     uuid,
    workforce_user_id uuid,
    platform_user_id  varchar,
    status            varchar
  )
  language sql
  stable
  security definer
  set search_path = public
as $$
  select m.tenant_id, m.id, u.id, u.platform_user_id, m.status
    from tenant_membership m
    join workforce_user u on u.id = m.workforce_user_id
    join tenant_platform_binding b on b.tenant_id = m.tenant_id
   where u.platform_user_id = p_platform_user_id
     and b.platform_issuer = p_platform_issuer
     and b.platform_tenant_id = p_platform_tenant_id
     and u.status = 'active'
     and m.status = 'active'
     and u.deleted_at is null
     and m.deleted_at is null
     and b.deleted_at is null
   order by m.id
$$;

-- Owned by the NOLOGIN resolver, exactly as `app_memberships_of` is (ADR-0077), and for the same
-- reason: as its owner the function runs subject to FORCE ROW LEVEL SECURITY, and only the
-- resolver's own select policies give it the rows. Guarded so a re-run is a no-op.
do $$ begin
  if (select r.rolname
        from pg_proc p join pg_roles r on r.oid = p.proowner
       where p.proname = 'app_bound_memberships_of') <> 'work_membership_resolver' then

    execute $comment$comment on function app_bound_memberships_of(varchar, varchar, varchar) is
      'Resolves an authenticated Platform user, for a token issued by one Platform organisation, '
      'to the memberships of the one Work tenant bound to that organisation (ADR-0080). Owned by '
      'work_membership_resolver (ADR-0077). Returns identifiers, never data.'$comment$;

    execute 'grant create on schema public to work_membership_resolver';
    execute 'alter function app_bound_memberships_of(varchar, varchar, varchar) owner to work_membership_resolver';
    execute 'revoke create on schema public from work_membership_resolver';
  end if;
end $$;

-- The runtime role reads bindings and never writes them. `deploy/aws/runtime-grants.sql` states
-- this too; it is repeated here so that no deployment that skips or fails that step leaves the
-- runtime able to rebind its own tenant. Where no `work_app` role exists yet there is nothing to
-- revoke, and runtime-grants.sql applies the same rule when it creates the role's grants.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'work_app') then
    execute 'revoke insert, update, delete, truncate on table tenant_platform_binding from work_app';
  end if;
end $$;
