-- Asset notes (MW-008 fixture).
--
-- A note belongs to one asset and one tenant. Row-level security is enabled in the migration that
-- creates the table, never in a later step: a table that exists for one deployment without its
-- policy is a table that leaked for that deployment.

create table asset_note (
  id         uuid primary key,
  tenant_id  uuid not null,
  asset_id   uuid not null,
  body       text not null,
  constraint asset_note_asset_fk foreign key (tenant_id, asset_id)
    references asset (tenant_id, id) on delete restrict
);

create index asset_note_tenant_idx on asset_note (tenant_id, asset_id);

call app_protect_table('asset_note');
