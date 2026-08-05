-- Workforce Identity (Phase 2).
--
-- Eight tables, and the row-level security that makes seven of them tenant-isolated and the
-- eighth reachable only from a tenant that already knows the person (ADR-0030, ADR-0033).
--
-- The policies are created here, in the migration that creates the tables, rather than in a
-- later "hardening" step. A table that exists for one deployment without its policy is a table
-- that leaked for that deployment, and no amount of applying the policy afterwards un-leaks it.

-- ---------------------------------------------------------------------------------------------
-- UUIDv7 in the database.
--
-- Identifiers are minted by the application, which knows the ordering rules and can test them.
-- This exists so that a row inserted by a migration, a data fix or a support script is still a
-- v7 — a v4 default would put a randomly-ordered key into a table whose indexes assume the
-- right edge, and nobody would notice until the table was large enough for it to matter.
--
-- Layout per RFC 9562: 48 bits of Unix milliseconds, 4 bits version, 12 bits sub-millisecond
-- fraction, 2 bits variant, 62 bits random.
-- ---------------------------------------------------------------------------------------------
create or replace function app_uuid_v7() returns uuid
  language plpgsql
  volatile
as $$
declare
  -- gen_random_uuid() is in core since PostgreSQL 13, so this needs no extension. Sixteen
  -- random bytes are exactly what a v7 is, before the timestamp and the tags are written over
  -- the parts the specification reserves.
  bytes     bytea  := uuid_send(gen_random_uuid());
  micros    bigint := (extract(epoch from clock_timestamp()) * 1000000)::bigint;
  millis    bigint := micros / 1000;
  -- The 12 bits after the version, used as a sub-millisecond fraction (RFC 9562 method 3).
  -- Without it, every identifier minted inside one millisecond would be ordered by its random
  -- tail, and "time-ordered" would be true only at millisecond granularity — which a bulk
  -- insert exceeds comfortably.
  fraction  int    := ((micros % 1000) * 4096 / 1000)::int;
begin
  -- Bytes 1-6: the 48-bit big-endian millisecond timestamp, taken from the low six bytes of an
  -- eight-byte integer.
  bytes := overlay(bytes placing substring(int8send(millis) from 3 for 6) from 1 for 6);
  -- Byte 7 (0-indexed 6): version 7 in the high nibble, the fraction's high bits in the low one.
  bytes := set_byte(bytes, 6, 112 | ((fraction >> 8) & 15));
  bytes := set_byte(bytes, 7, fraction & 255);
  -- Top two bits of byte 9 (0-indexed 8): variant 0b10.
  bytes := set_byte(bytes, 8, (get_byte(bytes, 8) & 63) | 128);
  return encode(bytes, 'hex')::uuid;
end;
$$;

comment on function app_uuid_v7() is
  'RFC 9562 UUIDv7. A fallback for rows not written by the application, which mints its own.';

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

-- The business identity of one authenticated Platform user, across every tenant they belong to.
-- Deliberately tenant-less (ADR-0033): it holds the Platform identifier and the account's
-- lifecycle, and nothing a tenant would consider its own. Everything tenant-specific about the
-- person lives in business_profile and user_preference, which are isolated normally.
create table workforce_user (
  id               uuid primary key default app_uuid_v7(),
  platform_user_id varchar(255) not null,
  status           varchar(32)  not null,
  created_at       timestamptz(6) not null,
  created_by       varchar(255) not null,
  updated_at       timestamptz(6) not null,
  updated_by       varchar(255) not null,
  deleted_at       timestamptz(6),
  deleted_by       varchar(255),
  version          integer not null,
  constraint workforce_user_status_check
    check (status in ('provisioned', 'active', 'suspended', 'deactivated'))
);

create unique index workforce_user_platform_user_id_key on workforce_user (platform_user_id);
create index workforce_user_status_idx on workforce_user (status);

create table tenant_membership (
  id                uuid primary key default app_uuid_v7(),
  tenant_id         uuid not null,
  workforce_user_id uuid not null,
  status            varchar(32) not null,
  invited_at        timestamptz(6),
  joined_at         timestamptz(6),
  ended_at          timestamptz(6),
  created_at        timestamptz(6) not null,
  created_by        varchar(255) not null,
  updated_at        timestamptz(6) not null,
  updated_by        varchar(255) not null,
  deleted_at        timestamptz(6),
  deleted_by        varchar(255),
  version           integer not null,
  constraint tenant_membership_workforce_user_fk
    foreign key (workforce_user_id) references workforce_user (id),
  constraint tenant_membership_status_check
    check (status in ('active', 'suspended', 'ended'))
);

-- One membership per person per tenant. Two would mean two answers to "may this person act
-- here", and the request pipeline would pick whichever the planner returned first.
create unique index tenant_membership_tenant_user_key
  on tenant_membership (tenant_id, workforce_user_id);
-- The index the tenant guard uses on every single request: given a person, which tenants.
create index tenant_membership_user_status_idx on tenant_membership (workforce_user_id, status);
create index tenant_membership_tenant_status_idx on tenant_membership (tenant_id, status);

create table invitation (
  id                            uuid primary key default app_uuid_v7(),
  tenant_id                     uuid not null,
  email                         varchar(320) not null,
  portals                       text[] not null default '{}',
  status                        varchar(32) not null,
  issued_at                     timestamptz(6) not null,
  expires_at                    timestamptz(6) not null,
  accepted_at                   timestamptz(6),
  accepted_by_workforce_user_id uuid,
  created_at                    timestamptz(6) not null,
  created_by                    varchar(255) not null,
  updated_at                    timestamptz(6) not null,
  updated_by                    varchar(255) not null,
  deleted_at                    timestamptz(6),
  deleted_by                    varchar(255),
  version                       integer not null,
  constraint invitation_accepted_by_fk
    foreign key (accepted_by_workforce_user_id) references workforce_user (id),
  constraint invitation_status_check
    check (status in ('pending', 'accepted', 'revoked', 'expired')),
  constraint invitation_expiry_after_issue_check check (expires_at > issued_at)
);

create index invitation_tenant_status_idx on invitation (tenant_id, status);
create index invitation_tenant_email_idx on invitation (tenant_id, email);
-- The sweep that expires elapsed invitations reads by status and expiry, never by tenant.
create index invitation_expiry_sweep_idx on invitation (status, expires_at);
-- One live invitation per address per tenant. Re-inviting somebody who has not answered should
-- resend, not accumulate a second pending row that can be accepted independently.
create unique index invitation_one_pending_per_email_key
  on invitation (tenant_id, lower(email)) where status = 'pending' and deleted_at is null;

create table portal_assignment (
  id            uuid primary key default app_uuid_v7(),
  tenant_id     uuid not null,
  membership_id uuid not null,
  portal        varchar(32) not null,
  status        varchar(32) not null,
  granted_at    timestamptz(6) not null,
  revoked_at    timestamptz(6),
  created_at    timestamptz(6) not null,
  created_by    varchar(255) not null,
  updated_at    timestamptz(6) not null,
  updated_by    varchar(255) not null,
  deleted_at    timestamptz(6),
  deleted_by    varchar(255),
  version       integer not null,
  constraint portal_assignment_membership_fk
    foreign key (membership_id) references tenant_membership (id),
  constraint portal_assignment_portal_check check (portal in ('employee', 'manager', 'admin')),
  constraint portal_assignment_status_check check (status in ('granted', 'revoked'))
);

create unique index portal_assignment_membership_portal_key
  on portal_assignment (tenant_id, membership_id, portal);
create index portal_assignment_membership_status_idx
  on portal_assignment (tenant_id, membership_id, status);

create table employment_link (
  id            uuid primary key default app_uuid_v7(),
  tenant_id     uuid not null,
  membership_id uuid not null,
  -- Employment's identifier (Phase 5), referenced by identity only. No foreign key, by design:
  -- one would couple this module's schema to another module's and make either impossible to
  -- deploy without the other.
  employment_id uuid not null,
  is_primary    boolean not null,
  status        varchar(32) not null,
  linked_at     timestamptz(6) not null,
  unlinked_at   timestamptz(6),
  created_at    timestamptz(6) not null,
  created_by    varchar(255) not null,
  updated_at    timestamptz(6) not null,
  updated_by    varchar(255) not null,
  deleted_at    timestamptz(6),
  deleted_by    varchar(255),
  version       integer not null,
  constraint employment_link_membership_fk
    foreign key (membership_id) references tenant_membership (id),
  constraint employment_link_status_check check (status in ('linked', 'unlinked'))
);

create unique index employment_link_membership_employment_key
  on employment_link (tenant_id, membership_id, employment_id);
create index employment_link_employment_idx on employment_link (tenant_id, employment_id);
create index employment_link_membership_status_idx
  on employment_link (tenant_id, membership_id, status);
-- At most one primary employment per member. Enforced by the database rather than by the
-- application service alone, because "which job is this person's main one" drives payroll
-- grouping and letter generation, and two answers there is a defect nobody sees until a payslip.
create unique index employment_link_one_primary_key
  on employment_link (tenant_id, membership_id)
  where is_primary and status = 'linked' and deleted_at is null;

create table delegation (
  id                      uuid primary key default app_uuid_v7(),
  tenant_id               uuid not null,
  delegator_membership_id uuid not null,
  delegate_membership_id  uuid not null,
  scope                   varchar(128) not null,
  effective_from          timestamptz(6) not null,
  effective_to            timestamptz(6) not null,
  status                  varchar(32) not null,
  reason                  varchar(512) not null,
  created_at              timestamptz(6) not null,
  created_by              varchar(255) not null,
  updated_at              timestamptz(6) not null,
  updated_by              varchar(255) not null,
  deleted_at              timestamptz(6),
  deleted_by              varchar(255),
  version                 integer not null,
  constraint delegation_delegator_fk
    foreign key (delegator_membership_id) references tenant_membership (id),
  constraint delegation_delegate_fk
    foreign key (delegate_membership_id) references tenant_membership (id),
  constraint delegation_status_check
    check (status in ('scheduled', 'active', 'revoked', 'expired')),
  constraint delegation_period_check check (effective_to > effective_from),
  -- Delegating to yourself is a no-op that reads in the register as arranged cover.
  constraint delegation_not_to_self_check
    check (delegator_membership_id <> delegate_membership_id)
);

create index delegation_delegate_status_idx
  on delegation (tenant_id, delegate_membership_id, status);
create index delegation_delegator_status_idx
  on delegation (tenant_id, delegator_membership_id, status);
create index delegation_expiry_sweep_idx on delegation (status, effective_to);

create table business_profile (
  id             uuid primary key default app_uuid_v7(),
  tenant_id      uuid not null,
  membership_id  uuid not null,
  display_name   jsonb not null,
  job_title      jsonb,
  business_email varchar(320),
  business_phone varchar(64),
  created_at     timestamptz(6) not null,
  created_by     varchar(255) not null,
  updated_at     timestamptz(6) not null,
  updated_by     varchar(255) not null,
  deleted_at     timestamptz(6),
  deleted_by     varchar(255),
  version        integer not null,
  constraint business_profile_membership_fk
    foreign key (membership_id) references tenant_membership (id),
  -- Both first-class languages, checked by the database as well as by the aggregate. A profile
  -- missing its Arabic name renders Latin characters in the middle of an Arabic page, forever.
  constraint business_profile_bilingual_name_check
    check (display_name ? 'en' and display_name ? 'ar')
);

create unique index business_profile_membership_key
  on business_profile (tenant_id, membership_id);
-- Search by name, in either language, without a sequential scan.
create index business_profile_display_name_idx on business_profile using gin (display_name);

create table user_preference (
  id            uuid primary key default app_uuid_v7(),
  tenant_id     uuid not null,
  membership_id uuid not null,
  language      varchar(35) not null,
  calendar      varchar(16) not null,
  time_zone     varchar(64) not null,
  numerals      varchar(16) not null,
  created_at    timestamptz(6) not null,
  created_by    varchar(255) not null,
  updated_at    timestamptz(6) not null,
  updated_by    varchar(255) not null,
  deleted_at    timestamptz(6),
  deleted_by    varchar(255),
  version       integer not null,
  constraint user_preference_membership_fk
    foreign key (membership_id) references tenant_membership (id),
  constraint user_preference_calendar_check check (calendar in ('gregorian', 'hijri')),
  constraint user_preference_numerals_check check (numerals in ('western', 'arabic-indic'))
);

create unique index user_preference_membership_key on user_preference (tenant_id, membership_id);

-- ---------------------------------------------------------------------------------------------
-- Row-level security (ADR-0030)
-- ---------------------------------------------------------------------------------------------

call app_protect_table('tenant_membership');
call app_protect_table('invitation');
call app_protect_table('portal_assignment');
call app_protect_table('employment_link');
call app_protect_table('delegation');
call app_protect_table('business_profile');
call app_protect_table('user_preference');

-- workforce_user has no tenant_id, so the standard policy cannot apply to it. It is protected
-- by reachability instead: a tenant may see a workforce user only if that user holds a
-- membership of the tenant currently in context.
--
-- This is strictly stronger than nothing and, for reads, equivalent in effect to the tenant
-- policy: tenant A cannot see, update or delete a person who has never been admitted to tenant
-- A. Inserts are permitted, because a workforce user necessarily exists a moment before the
-- membership that makes it reachable — and a row nobody can read is a row nobody can use.
alter table workforce_user enable row level security;
alter table workforce_user force row level security;

drop policy if exists tenant_reachability on workforce_user;
create policy tenant_reachability on workforce_user
  using (
    exists (
      select 1
      from tenant_membership m
      where m.workforce_user_id = workforce_user.id
        and m.tenant_id = app_current_tenant()
        and m.deleted_at is null
    )
  )
  with check (true);

comment on table workforce_user is
  'Tenant-less by design (ADR-0033). Protected by reachability from a membership of the current tenant, not by tenant_id.';

-- The policy above reads tenant_membership, which is itself protected. A policy is evaluated
-- with the permissions of the table owner rather than the querying role, so the subquery sees
-- the rows it needs; the tenant predicate inside it is what does the filtering.

-- ---------------------------------------------------------------------------------------------
-- The one cross-tenant read in the product.
--
-- The request pipeline has to answer "which tenants may this authenticated person act in?"
-- *before* any tenant is in context — that question is what establishes the context. So it
-- cannot run under a tenant policy: there is no tenant to run it under yet.
--
-- Rather than give the application a second connection that can bypass row-level security —
-- which would be a general hole opened to solve one specific problem — the exception is this
-- single function. It is narrow by construction:
--
--   * Its only input is a platform_user_id, which the caller cannot choose: the pipeline passes
--     whatever Platform authenticated, never anything from the request.
--   * It returns identifiers only. No name, no address, no profile, nothing that would be a
--     disclosure if the answer were wrong.
--   * It returns active memberships of active users only, so a suspended person resolves to
--     nothing and their request runs with no tenant.
--
-- EXECUTE is left at its default. Reaching this function at all requires a database connection
-- as the application role, and that role can read none of the tables underneath it; what this
-- adds to such an attacker is a set of opaque UUIDs for a platform user id they already knew.
-- That is the whole of the exposure, and it is recorded in ADR-0033 rather than left implicit.
-- ---------------------------------------------------------------------------------------------
create or replace function app_memberships_of(p_platform_user_id varchar)
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
   where u.platform_user_id = p_platform_user_id
     and u.status = 'active'
     and m.status = 'active'
     and u.deleted_at is null
     and m.deleted_at is null
   order by m.id
$$;

comment on function app_memberships_of(varchar) is
  'Resolves an authenticated Platform user to the tenants they may act in. The only deliberate cross-tenant read in Munaxa Work (ADR-0033). Returns identifiers, never data.';
