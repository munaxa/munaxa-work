-- ================================================================================================
-- Phase 5.3 — Assets & Custody · Checkpoint 1
--
-- Two tables: the tenant's asset catalogue, and the individual items it owns.
--
--   * **No custody, and no column that hints at one.** There is no `employment_id`, no holder, no
--     acknowledgement, no condition and no amount anywhere in this migration. Custody is Checkpoint
--     2's table and needs decisions nobody has taken (D-5.3-01, D-5.3-05). A column added here "for
--     later" is a column something eventually reads and nothing maintains (ADR-0070).
--
--   * **`status` is closed at four values, and the three that are missing are the point.** The
--     specification's lifecycle runs Registered -> Available -> Issued -> In Custody -> Returned ->
--     Under Repair -> Retired. `issued`, `in_custody` and `returned` are facts about *custody*, and
--     the custody table is their authority: a copy here would be a second answer that goes stale.
--     The CHECK widens by an approved change, exactly as `workflow_history`'s event CHECK was
--     widened for `step-reminded`.
--
--   * **Two identifiers, asymmetric on purpose.** `asset_tag` is the tenant's own and is required
--     and unique per tenant; `serial_number` is the manufacturer's and is optional but unique per
--     tenant when present. Both are partial unique indexes rather than reads, because a select
--     followed by an insert is not idempotent under concurrency (ADR-0071), and partial so that a
--     soft-deleted row never blocks its replacement.
--
--   * **Nothing here is immutable, and no trigger is created.** A catalogue and an inventory are
--     mutable by design — a description is corrected, a serial number is entered late, an asset is
--     retired. AD-003's immutability is about *custody history*, and reading it across to these
--     tables would freeze an inventory the day it was typed, including its typos. The append-only
--     table with the unconditional trigger arrives with `asset_custody`.
--
--   * **Nothing ships in the catalogue.** No asset type, no condition scale, no valuation basis, no
--     depreciation and no country rule. Every entry is a row a tenant writes (AD-002).
-- ================================================================================================

-- ---------------------------------------------------------------------------------------------
-- The catalogue a tenant's inventory is classified in.
-- ---------------------------------------------------------------------------------------------

create table asset_category (
  id          uuid primary key default app_uuid_v7(),
  tenant_id   uuid not null,
  code        varchar(64) not null,
  name        jsonb not null,
  -- What ordering actually uses (D-5.2-07). Not unique: reads order by (sequence, code), which is
  -- deterministic whether or not two entries share a rank, so inserting between two others never
  -- forces a tenant to renumber its catalogue.
  sequence    integer not null,
  -- How an entry leaves service. There is no delete: assets classified under it must still read
  -- correctly years later, and Checkpoint 2's custody history will point at items whose category
  -- left service long before.
  active      boolean not null,
  metadata    jsonb not null default '{}',
  created_at  timestamptz(6) not null,
  created_by  varchar(255) not null,
  updated_at  timestamptz(6) not null,
  updated_by  varchar(255) not null,
  deleted_at  timestamptz(6),
  deleted_by  varchar(255),
  version     integer not null,
  constraint asset_category_code_shape_check
    check (code ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'),
  constraint asset_category_sequence_check
    check (sequence >= 0)
);

create unique index asset_category_code_idx
  on asset_category (tenant_id, code) where deleted_at is null;
create index asset_category_order_idx
  on asset_category (tenant_id, sequence, code) where deleted_at is null;

-- ---------------------------------------------------------------------------------------------
-- One item the company owns. What it is, which one it is, and whether it is in service.
-- ---------------------------------------------------------------------------------------------

create table asset (
  id                  uuid primary key default app_uuid_v7(),
  tenant_id           uuid not null,
  asset_category_id   uuid not null,
  -- The tenant's own identifier: the thing written on the sticker.
  asset_tag           varchar(64) not null,
  -- The manufacturer's. Null is ordinary — a chair has no serial number — and the uniqueness index
  -- below is partial for exactly that reason.
  serial_number       varchar(128),
  description         varchar(500),
  -- A note somebody writes and reads back. **Not an Organization unit reference**: Organization owns
  -- units, and a foreign key from here would be inventing a boundary rather than crossing one.
  location_note       varchar(255),
  -- A note, for the same reason. **Never an amount**: Finance owns value and depreciation, and this
  -- domain owns custody. There is no numeric column on this table at all.
  purchase_reference  varchar(128),
  status              varchar(24) not null,
  metadata            jsonb not null default '{}',
  created_at          timestamptz(6) not null,
  created_by          varchar(255) not null,
  updated_at          timestamptz(6) not null,
  updated_by          varchar(255) not null,
  deleted_at          timestamptz(6),
  deleted_by          varchar(255),
  version             integer not null,
  constraint asset_category_fk foreign key (asset_category_id) references asset_category (id),
  constraint asset_tag_shape_check check (length(btrim(asset_tag)) > 0),
  constraint asset_serial_shape_check
    check (serial_number is null or length(btrim(serial_number)) > 0),
  -- Closed at what an asset can actually be. `issued`, `in_custody` and `returned` are absent
  -- because they are facts about custody, not about the asset.
  constraint asset_status_check
    check (status in ('registered', 'available', 'under_repair', 'retired'))
);

-- The tenant's own identifier, unique per tenant. Partial, so a soft-deleted row never blocks the
-- replacement that reuses its tag.
create unique index asset_tag_idx
  on asset (tenant_id, asset_tag) where deleted_at is null;
-- The manufacturer's, unique per tenant **when present**. Partial on both counts: many rows have no
-- serial number, and a null must never collide with another null.
create unique index asset_serial_idx
  on asset (tenant_id, serial_number) where serial_number is not null and deleted_at is null;
create index asset_category_ref_idx
  on asset (tenant_id, asset_category_id) where deleted_at is null;
-- The inventory read: filtered by status, ordered by tag.
create index asset_status_idx
  on asset (tenant_id, status, asset_tag) where deleted_at is null;

-- ---------------------------------------------------------------------------------------------
-- Row-level security: enabled and forced on both (ADR-0030).
--
-- No BYPASSRLS anywhere, and no service-level tenant bypass. The tenant comes from the execution
-- context and never from a request.
-- ---------------------------------------------------------------------------------------------

call app_protect_table('asset_category');
call app_protect_table('asset');
