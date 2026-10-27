-- ================================================================================================
-- Licensing state (ADR-0079) — what this deployment last verified about a tenant's entitlements.
--
--   * **One row per tenant**, written by the API process only: the last snapshot the central
--     subscription service (or a licence file) gave, and the latest instant the deployment observed.
--   * **It survives a restart.** Before this table both lived in the process, so a process that
--     started while the central service was down had nothing to bridge the outage with, and a clock
--     wound back across a restart was judged only against a licence's issue time.
--   * **`last_observed_at` only moves forward.** The writer takes `greatest(stored, given)`, so a
--     wound-back clock cannot pull it back, and decisions are made at the later of it and the clock.
--   * **A `null` snapshot is an answer**: the service said "no subscription", and nothing may bridge
--     a later outage into access it has already withdrawn.
--   * Tenant-isolated like every other table (`app_protect_table`). Nothing else in Work reads it.
-- ================================================================================================

create table licensing_state (
  id                uuid primary key default app_uuid_v7(),
  tenant_id         uuid not null,
  snapshot          jsonb,
  source            varchar(32) not null,
  last_observed_at  timestamptz(6) not null,
  created_at        timestamptz(6) not null,
  created_by        varchar(255) not null,
  updated_at        timestamptz(6) not null,
  updated_by        varchar(255) not null,
  deleted_at        timestamptz(6),
  deleted_by        varchar(255),
  version           integer not null,
  constraint licensing_state_source_check check (source in ('LICENSE_FILE', 'CONTROL_PLANE'))
);

create unique index licensing_state_tenant_key on licensing_state (tenant_id);

call app_protect_table('licensing_state');
