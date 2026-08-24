-- ================================================================================================
-- Phase 5.3 — Assets & Custody · Checkpoint 2
--
-- One table: the custody period. Who held which asset, from when until when.
--
--   * **One row is one handover** (AD-003). A custody is not an event and not a projection; it is a
--     *period*, and the period is the record. Issuing opens one, returning closes it, and successive
--     rows are the history. A separate event log would be a second answer to "what happened".
--
--   * **At most one open custody per asset** (AD-004), settled by a partial unique index rather than
--     by a preceding read. "Is this asset already held" answered by a select and then acted on by an
--     insert is not idempotent under concurrency (ADR-0071); the index is what actually decides two
--     storekeepers issuing one laptop at the same instant.
--
--   * **A returned custody is immutable.** Update and delete both raise, from any path including a
--     direct psql session — the conditional-trigger shape `relation_investigation` uses, and for the
--     same reason: an open period is still being written, a closed one is history. Correction is a
--     deferred capability whose semantics nobody has agreed (D-5.3-10), so there is no correction
--     mechanism here and no state that would imply one.
--
--   * **Employment, never person** (AD-001). `employment_id` and nothing else — no name, no email, no
--     national identifier, no user account. There is no cross-module foreign key: `employment` is
--     another module's table, and existence is confirmed through Employment's published read before
--     the insert, under a bounded service grant (ADR-0043).
--
--   * **`asset.status` is unchanged, and deliberately so.** An asset in somebody's custody is still
--     `available` — in service. `issued`, `in_custody` and `returned` remain absent from that CHECK
--     because they are facts about *custody*, and this table is their authority (ADR-0070, D-5.2-16).
--     Nothing in this migration alters any existing table, column, constraint, index or trigger.
--
--   * **No condition, no expected return, no acknowledgement, no approval, no amount.** Each belongs
--     to a capability this checkpoint does not build, and three are downstream of decisions that are
--     still open. There is no numeric column on this table but `version`.
-- ================================================================================================

create table asset_custody (
  id             uuid primary key default app_uuid_v7(),
  tenant_id      uuid not null,
  asset_id       uuid not null,
  -- Employment, never person (AD-001). No foreign key across the module boundary.
  employment_id  uuid not null,
  -- The day of the handover. A date, not a timestamp: it is a day in the tenant's world, and
  -- attaching a time zone to it would attach one to a fact that has none.
  issued_on      date not null,
  returned_on    date,
  state          varchar(16) not null,
  issue_note     varchar(500),
  return_note    varchar(500),
  metadata       jsonb not null default '{}',
  created_at     timestamptz(6) not null,
  created_by     varchar(255) not null,
  updated_at     timestamptz(6) not null,
  updated_by     varchar(255) not null,
  -- Present because every table carries them. A soft delete is an update, so the trigger below
  -- refuses one on a returned custody.
  deleted_at     timestamptz(6),
  deleted_by     varchar(255),
  version        integer not null,
  constraint asset_custody_asset_fk foreign key (asset_id) references asset (id),
  -- Closed at what a custody can actually be. The specification's accepted, acknowledged, cancelled
  -- and transferred are reached by capabilities this checkpoint does not build, and the CHECK widens
  -- by an approved change rather than by convenience.
  constraint asset_custody_state_check
    check (state in ('open', 'returned')),
  -- A returned custody has a return date and an open one has none. Either both or neither: a row
  -- that said `returned` with no date, or `open` with one, would be a period nobody could read.
  constraint asset_custody_closure_check
    check ((state = 'returned') = (returned_on is not null)),
  -- A period whose end precedes its beginning is not a period.
  constraint asset_custody_dates_check
    check (returned_on is null or returned_on >= issued_on)
);

-- **AD-004, as an index.** Partial on `state = 'open'`, so any number of returned custodies
-- accumulate on one asset while at most one is ever open.
create unique index asset_custody_open_idx
  on asset_custody (tenant_id, asset_id) where state = 'open' and deleted_at is null;
-- An asset's history, newest handover first.
create index asset_custody_asset_idx
  on asset_custody (tenant_id, asset_id, issued_on) where deleted_at is null;
-- What one employment holds — the read Checkpoint 4's clearance projection will need.
create index asset_custody_employment_idx
  on asset_custody (tenant_id, employment_id, issued_on) where deleted_at is null;

-- ---------------------------------------------------------------------------------------------
-- A returned custody is immutable, from any path.
--
-- Conditional rather than unconditional: an open custody is a period still in progress and must
-- stay correctable, and returning one *is* an update. The moment it closes, it stops being editable
-- — which is the `relation_investigation` shape, whose trigger refuses only once `concluded`.
-- ---------------------------------------------------------------------------------------------

create or replace function app_asset_custody_refuse_returned() returns trigger
language plpgsql as $$
begin
  if old.state = 'returned' then
    raise exception 'asset_custody_returned'
      using errcode = 'restrict_violation',
            detail = format('asset_custody %s has been returned', old.id),
            hint = 'A returned custody is history. Nothing edits or deletes one.';
  end if;
  return case tg_op when 'DELETE' then old else new end;
end; $$;

create trigger asset_custody_no_mutation_once_returned
  before update or delete on asset_custody
  for each row execute function app_asset_custody_refuse_returned();

-- ---------------------------------------------------------------------------------------------
-- Row-level security: enabled and forced (ADR-0030).
--
-- No BYPASSRLS anywhere, and no service-level tenant bypass. The tenant comes from the execution
-- context and never from a request.
-- ---------------------------------------------------------------------------------------------

call app_protect_table('asset_custody');
