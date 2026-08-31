-- ================================================================================================
-- Security Foundation — the tenant's authorization assignments.
--
-- Two tables, and what they deliberately are *not* is the important half.
--
--   * **This is storage, not an engine.** Munaxa Work persists which roles a tenant has defined and
--     who holds them; `@munaxa/rbac` resolves the graph, applies scoping and decides every check.
--     There is no policy table, no deny table, no condition column and no evaluation order here,
--     because none of those are facts a product owns — they are decisions the platform's resolver
--     already makes, and a second copy would eventually disagree with the first.
--
--   * **The subject is a membership, not a person.** `membership_id` rather than
--     `workforce_user_id` is what makes "a grant from one membership never becomes a grant for
--     another" structural instead of a rule somebody has to remember. A person who works for two
--     tenants has two memberships and therefore two disjoint sets of grants; there is no row shape
--     that could express a grant spanning both, so no query can accidentally union them.
--
--   * **Nothing is seeded.** No default role, no administrator, no bootstrap grant. A shipped
--     grant is the same grant in every deployment, and a security table whose first row this
--     repository wrote is a security table nobody decided (AD-002).
--
--   * **`permissions` holds Platform grant strings**, `resource:action`, wildcards allowed — the
--     vocabulary the resolver evaluates. Work's own `resource.action` declarations are translated
--     at the seam and are never stored here; storing both would make the mapping a fact in two
--     places.
-- ================================================================================================

-- ---------------------------------------------------------------------------------------------
-- A role the tenant has defined: a name, and the grants it confers.
-- ---------------------------------------------------------------------------------------------

create table tenant_role (
  id           uuid primary key default app_uuid_v7(),
  tenant_id    uuid not null,
  -- The tenant's own identifier for the role, and the value an assignment names. Stable by
  -- contract: renaming it would silently detach every assignment that points at it.
  role_id      varchar(64) not null,
  name         varchar(200) not null,
  description  varchar(500),
  -- Platform grant strings. Wildcards are permitted *here* — a grant may say `documents:*` — and
  -- never in a check, which is the asymmetry the resolver relies on.
  permissions  text[] not null default '{}',
  -- Role inheritance is a DAG the resolver walks. An unknown parent resolves to fewer
  -- permissions rather than to an error, so a dangling reference cannot fail open.
  inherits     text[] not null default '{}',
  -- A role the platform ships and a tenant administrator may not edit. Nothing sets this today;
  -- the column exists because `RoleDefinition` carries it and a resolver that reads a role would
  -- otherwise lose the flag on every round trip.
  system       boolean not null default false,
  created_at   timestamptz(6) not null,
  created_by   varchar(255) not null,
  updated_at   timestamptz(6) not null,
  updated_by   varchar(255) not null,
  deleted_at   timestamptz(6),
  deleted_by   varchar(255),
  version      integer not null,
  constraint tenant_role_id_shape_check
    check (role_id ~ '^[a-z0-9]([a-z0-9_-]{0,62}[a-z0-9])?$'),
  -- The platform's grammar, enforced where the rows live rather than only where they are written.
  -- A malformed grant does not deny safely: `courses:*:scope` is a wildcard that has stopped
  -- being trailing, so it matches nothing while reading in an administration screen as authority.
  constraint tenant_role_permission_grammar_check
    check (
      cardinality(permissions) = 0
      or array_to_string(permissions, ' ') ~
         '^(\*|[a-z0-9][a-z0-9_-]*)(:(\*|[a-z0-9][a-z0-9_-]*))*( (\*|[a-z0-9][a-z0-9_-]*)(:(\*|[a-z0-9][a-z0-9_-]*))*)*$'
    ),
  constraint tenant_role_inherits_shape_check
    check (
      cardinality(inherits) = 0
      or array_to_string(inherits, ' ') ~
         '^[a-z0-9][a-z0-9_-]*( [a-z0-9][a-z0-9_-]*)*$'
    )
);

-- Partial, so a soft-deleted role never blocks the one that replaces it.
create unique index tenant_role_id_idx
  on tenant_role (tenant_id, role_id) where deleted_at is null;

-- The pair the assignment's foreign key references. `id` alone is already unique, so this adds no
-- constraint on Identity's own rows; it exists because a composite reference needs a matching
-- unique index, and that reference is what keeps a grant's subject inside the granting tenant.
create unique index tenant_membership_tenant_id_idx on tenant_membership (tenant_id, id);

-- ---------------------------------------------------------------------------------------------
-- Who holds a role. One row is one membership holding one role, optionally within one scope.
-- ---------------------------------------------------------------------------------------------

create table tenant_role_assignment (
  id             uuid primary key default app_uuid_v7(),
  tenant_id      uuid not null,
  -- The subject. A membership is a person *in this tenant*, which is exactly the granularity a
  -- grant may have and the reason no union across tenants is expressible.
  membership_id  uuid not null,
  role_id        varchar(64) not null,
  -- Narrows the role's grants to one scope — a unit, a workspace — by suffixing each permission.
  -- Null means the role applies wherever the tenant does.
  scope          varchar(120),
  -- A grant that stops on its own. Null is ordinary: most grants end when somebody removes them.
  expires_at     timestamptz(6),
  -- `created_at` and `created_by` are the assignment's `assignedAt` and `assignedBy`. Two more
  -- columns holding the same two facts would be two more columns to disagree.
  created_at     timestamptz(6) not null,
  created_by     varchar(255) not null,
  updated_at     timestamptz(6) not null,
  updated_by     varchar(255) not null,
  deleted_at     timestamptz(6),
  deleted_by     varchar(255),
  version        integer not null,
  -- **Composite, and that is the isolation.** A single-column reference would let a tenant hold an
  -- assignment naming another tenant's membership: inert, because that person can never establish
  -- this tenant's context, but a row an administrator could plant and nobody would explain. The
  -- pair makes "the subject of a grant is a member of the tenant that granted it" a constraint.
  constraint tenant_role_assignment_membership_fk
    foreign key (tenant_id, membership_id) references tenant_membership (tenant_id, id),
  constraint tenant_role_assignment_role_shape_check
    check (role_id ~ '^[a-z0-9]([a-z0-9_-]{0,62}[a-z0-9])?$'),
  constraint tenant_role_assignment_scope_shape_check
    check (scope is null or scope ~ '^[a-z0-9][a-z0-9_-]*$')
);

-- One row per (membership, role, scope). `coalesce` because two null scopes are the same
-- assignment twice, and a unique index would not otherwise say so.
create unique index tenant_role_assignment_unique_idx
  on tenant_role_assignment (tenant_id, membership_id, role_id, coalesce(scope, ''))
  where deleted_at is null;
-- The resolution read: every live assignment for one membership, on every authorized request.
create index tenant_role_assignment_membership_idx
  on tenant_role_assignment (tenant_id, membership_id) where deleted_at is null;
-- Answering "who holds this role", which is what makes a grant auditable.
create index tenant_role_assignment_role_idx
  on tenant_role_assignment (tenant_id, role_id) where deleted_at is null;

-- ---------------------------------------------------------------------------------------------
-- Row-level security: enabled and forced on both (ADR-0030).
--
-- These are the two tables where isolation failing open would not merely leak a record but hand
-- one tenant's grants to another. No BYPASSRLS, no service-level exemption, and the tenant comes
-- from the execution context exactly as it does everywhere else.
-- ---------------------------------------------------------------------------------------------

call app_protect_table('tenant_role');
call app_protect_table('tenant_role_assignment');
