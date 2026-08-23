-- ================================================================================================
-- Phase 5.2 — Employee Relations & Disciplinary · Checkpoint 1
--
-- Three tables: the tenant's violation catalogue, the violations recorded against an employment, and
-- the trail of who read one.
--
--   * **The violation is immutable, at the database.** Update and delete both raise. AD-003 says the
--     record is evidence in a labour dispute, and an application-level guard is a guarantee that
--     holds until somebody opens psql. This is the trigger pattern `document_version`,
--     `document_access_event` and `workflow_history` already use (D-5.2-03).
--
--   * **Nothing statutory ships.** No offence, no penalty, no jurisdiction, no limit. Every catalogue
--     entry is a row a tenant writes; `source` records which authority wrote it, and `country_pack`
--     provenance is carried so that when Phase 11.1 supplies packs a row's origin is already
--     recorded rather than guessed (AD-002, D-5.2-06). **Legal enforcement is NOT VERIFIED.**
--
--   * **`state` is closed at one value, deliberately.** The specification's lifecycle runs
--     Reported -> Under Investigation -> ... and every state after the first is reached by a
--     capability Checkpoint 1 does not build. The CHECK widens by an approved change, exactly as
--     `workflow_history`'s event CHECK was widened for `step-reminded`. A vocabulary listing states
--     nothing can produce would be a promise the code cannot keep.
--
--   * **The three tables carry no person.** `employment_id` and nothing else — no person, no name,
--     no manager, no organisation (AD-001).
-- ================================================================================================

-- ---------------------------------------------------------------------------------------------
-- The catalogue a tenant's disciplinary policy is written in.
-- ---------------------------------------------------------------------------------------------

create table relation_violation_category (
  id                    uuid primary key default app_uuid_v7(),
  tenant_id             uuid not null,
  code                  varchar(64) not null,
  name                  jsonb not null,
  -- A tenant's own word. Deliberately not a closed set: a fixed list of severities would be this
  -- product deciding what "gross misconduct" means for every customer (AD-002). Nothing orders by it.
  severity              varchar(64) not null,
  -- What ordering actually uses (D-5.2-07). Not unique: reads order by (sequence, code), which is
  -- deterministic whether or not two entries share a rank, so inserting between two others never
  -- forces a tenant to renumber its catalogue.
  sequence              integer not null,
  -- How far back a prior violation counts toward escalation. Configuration only; **nothing reads it
  -- in Checkpoint 1**, because escalation is a later capability.
  repeat_window_days    integer not null,
  -- `tenant` today; `country_pack` when Phase 11.1 supplies the statutory version. The same
  -- discriminator `attendance_policy.source` carries.
  source                varchar(24) not null,
  country_pack_id       varchar(64),
  country_pack_version  integer,
  active                boolean not null,
  metadata              jsonb not null default '{}',
  created_at            timestamptz(6) not null,
  created_by            varchar(255) not null,
  updated_at            timestamptz(6) not null,
  updated_by            varchar(255) not null,
  deleted_at            timestamptz(6),
  deleted_by            varchar(255),
  version               integer not null,
  constraint relation_violation_category_code_shape_check
    check (code ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'),
  constraint relation_violation_category_severity_check
    check (length(btrim(severity)) > 0),
  constraint relation_violation_category_sequence_check
    check (sequence >= 0),
  constraint relation_violation_category_repeat_window_check
    check (repeat_window_days >= 0),
  constraint relation_violation_category_source_check
    check (source in ('tenant', 'country_pack')),
  -- The boundary, made explicit in the schema rather than implied: an entry claiming statutory
  -- provenance must name the pack it came from, and one written by a tenant must not pretend to.
  constraint relation_violation_category_pack_shape_check
    check (
      (source = 'country_pack' and country_pack_id is not null)
      or (source = 'tenant' and country_pack_id is null and country_pack_version is null)
    ),
  constraint relation_violation_category_pack_version_check
    check (country_pack_version is null or country_pack_version >= 1)
);

create unique index relation_violation_category_code_idx
  on relation_violation_category (tenant_id, code) where deleted_at is null;
create index relation_violation_category_order_idx
  on relation_violation_category (tenant_id, sequence, code) where deleted_at is null;

-- ---------------------------------------------------------------------------------------------
-- A violation, recorded against an employment. Immutable from the moment it is written.
-- ---------------------------------------------------------------------------------------------

create table relation_violation (
  id                     uuid primary key default app_uuid_v7(),
  tenant_id              uuid not null,
  -- Employment, never person (AD-001). No foreign key: `employment` is another module's table and a
  -- cross-module FK would couple two schemas that are meant to separate. Existence is confirmed
  -- through Employment's published read before the insert, under a bounded service grant (ADR-0043).
  employment_id          uuid not null,
  violation_category_id  uuid not null,
  -- Frozen at recording. A catalogue entry may be renamed or re-graded, and a record whose meaning
  -- changed because somebody edited a dropdown two years later is not evidence (AD-003).
  category_code          varchar(64) not null,
  severity               varchar(64) not null,
  -- The day the conduct occurred. A date, not a timestamp: it is a day in the tenant's world.
  occurred_on            date not null,
  -- The authenticated caller. Never supplied by a command — a caller who could set this could file
  -- an allegation under a colleague's name.
  reported_by            varchar(255) not null,
  description            text not null,
  state                  varchar(32) not null,
  recorded_at            timestamptz(6) not null,
  metadata               jsonb not null default '{}',
  created_at             timestamptz(6) not null,
  created_by             varchar(255) not null,
  updated_at             timestamptz(6) not null,
  updated_by             varchar(255) not null,
  -- Present because every table in this repository carries them. Unusable here by construction: a
  -- soft delete is an update, and the trigger below refuses every update on this table.
  deleted_at             timestamptz(6),
  deleted_by             varchar(255),
  version                integer not null,
  constraint relation_violation_category_fk
    foreign key (violation_category_id) references relation_violation_category (id),
  constraint relation_violation_state_check check (state in ('reported')),
  constraint relation_violation_description_check check (length(btrim(description)) between 1 and 4000),
  constraint relation_violation_severity_check check (length(btrim(severity)) > 0)
);

create index relation_violation_employment_idx
  on relation_violation (tenant_id, employment_id, occurred_on desc, id desc)
  where deleted_at is null;
create index relation_violation_category_ref_idx
  on relation_violation (tenant_id, violation_category_id) where deleted_at is null;

-- ---------------------------------------------------------------------------------------------
-- Who read which disciplinary record — AD-007's "every read is audited".
--
-- A table rather than a log line, for the reason Documents gave when it made the same choice: a
-- trail that can only be grepped cannot answer "who has been looking at this employee's file", and
-- this is the domain where a lawyer asks that.
--
-- **It carries who looked at what, and nothing about the matter.** No employment, no category, no
-- severity, no description. Copying those here would make the audit table a second, less-guarded
-- copy of the thing it audits.
--
-- Catalogue reads are not recorded: a catalogue names nobody, and auditing it would be the
-- "audit every query" mechanism the approval forbids (D-5.2-05).
-- ---------------------------------------------------------------------------------------------

create table relation_violation_access_event (
  id             uuid primary key default app_uuid_v7(),
  tenant_id      uuid not null,
  violation_id   uuid not null,
  action         varchar(32) not null,
  actor          varchar(255) not null,
  occurred_at    timestamptz(6) not null,
  correlation_id uuid not null,
  created_at     timestamptz(6) not null,
  created_by     varchar(255) not null,
  updated_at     timestamptz(6) not null,
  updated_by     varchar(255) not null,
  deleted_at     timestamptz(6),
  deleted_by     varchar(255),
  version        integer not null,
  constraint relation_violation_access_event_violation_fk
    foreign key (violation_id) references relation_violation (id),
  constraint relation_violation_access_event_action_check
    check (action in ('violation_read', 'violation_listed'))
);

create index relation_violation_access_event_violation_idx
  on relation_violation_access_event (tenant_id, violation_id, occurred_at desc);
create index relation_violation_access_event_actor_idx
  on relation_violation_access_event (tenant_id, actor, occurred_at desc);

-- ---------------------------------------------------------------------------------------------
-- Immutability (D-5.2-03). Refused from any path, including a direct psql session.
-- ---------------------------------------------------------------------------------------------

create or replace function app_relation_violation_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'relation_violation_immutable'
    using errcode = 'restrict_violation',
          detail = format('relation_violation %s is immutable', old.id),
          hint = 'A disciplinary record is evidence. A correction is a new linked record, never an edit.';
end; $$;

create trigger relation_violation_no_mutation
  before update or delete on relation_violation
  for each row execute function app_relation_violation_immutable();

create or replace function app_relation_access_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'relation_violation_access_event_immutable'
    using errcode = 'restrict_violation',
          detail = format('relation_violation_access_event %s is immutable', old.id),
          hint = 'An access trail that can be rewritten is not an access trail.';
end; $$;

create trigger relation_violation_access_event_no_mutation
  before update or delete on relation_violation_access_event
  for each row execute function app_relation_access_immutable();

-- ---------------------------------------------------------------------------------------------
-- Row-level security: enabled and forced on all three (ADR-0030).
-- ---------------------------------------------------------------------------------------------

call app_protect_table('relation_violation_category');
call app_protect_table('relation_violation');
call app_protect_table('relation_violation_access_event');
