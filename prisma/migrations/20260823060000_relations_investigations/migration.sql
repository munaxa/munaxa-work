-- ================================================================================================
-- Phase 5.2 — Employee Relations · Checkpoint 2 · Investigations and the case lifecycle
--
-- Two tables and one widened CHECK. Additive throughout: **`relation_violation` is not altered**,
-- its immutability trigger is untouched, and its `state` CHECK still reads `('reported')`.
--
--   * **D-5.2-15 — lifecycle state does not live on the violation.** Checkpoint 1 made
--     `relation_violation` immutable, and it stays that way: the row is the factual record of what
--     was reported, and a factual record does not move. Where the *case* has got to is a different
--     fact, and it lives in `relation_case_event`.
--
--   * **D-5.2-16 — the current state is derived, never stored twice.** It is the `to_state` of the
--     case's highest-numbered event, and a case with no events is `reported`. There is no
--     `current_state` column anywhere: a second copy is a second thing that can disagree, which is
--     what ADR-0070 warns about. **No projection was needed for performance** — the derivation is a
--     single indexed lookup of one row per case, and inventing a projection before measuring one
--     would be the redundant column the approval forbids.
--
--   * **D-5.2-17 — transitions are explicit, validated and arbitrated by the database.** `sequence`
--     is unique per case, so two requests that read the same current state compute the same next
--     number and **one of them loses on the index**. That is the ADR-0071 rule applied to a
--     lifecycle: a `select` followed by an `insert` is not idempotent under concurrency, so the
--     index decides rather than the read.
--
--   * **No generic framework.** No state-machine engine, no event-sourcing library, no workflow
--     engine. Three states and the transitions between them, specific to Relations.
-- ================================================================================================

-- ---------------------------------------------------------------------------------------------
-- The inquiry into a recorded violation.
-- ---------------------------------------------------------------------------------------------

create table relation_investigation (
  id                        uuid primary key default app_uuid_v7(),
  tenant_id                 uuid not null,
  violation_id              uuid not null,
  -- A membership identifier held as a value. Relations resolves it to nobody: a disciplinary module
  -- that knew people's names would be a directory of accused people (AD-001).
  investigator_membership_id uuid not null,
  opened_on                 date not null,
  -- What is being investigated, as the person opening it stated it.
  subject                   text not null,
  -- Both null while open; both required at conclusion. The constraint below is what makes that true
  -- rather than a convention.
  findings                  text,
  recommendation            text,
  concluded_on              date,
  state                     varchar(24) not null,
  metadata                  jsonb not null default '{}',
  created_at                timestamptz(6) not null,
  created_by                varchar(255) not null,
  updated_at                timestamptz(6) not null,
  updated_by                varchar(255) not null,
  deleted_at                timestamptz(6),
  deleted_by                varchar(255),
  version                   integer not null,
  constraint relation_investigation_violation_fk
    foreign key (violation_id) references relation_violation (id),
  constraint relation_investigation_state_check check (state in ('open', 'concluded')),
  constraint relation_investigation_subject_check
    check (length(btrim(subject)) between 1 and 4000),
  -- An open investigation has concluded nothing; a concluded one has said what it found and what it
  -- recommends. Neither half is optional, because a conclusion without findings is a case that
  -- closed for no stated reason.
  constraint relation_investigation_conclusion_check
    check (
      (state = 'open' and findings is null and recommendation is null and concluded_on is null)
      or (state = 'concluded' and length(btrim(findings)) between 1 and 8000
          and length(btrim(recommendation)) between 1 and 4000 and concluded_on is not null)
    ),
  constraint relation_investigation_dates_check
    check (concluded_on is null or concluded_on >= opened_on)
);

-- **One open investigation per violation**, settled by the database rather than by a preceding read
-- (ADR-0071). Partial, so any number of *concluded* ones may accumulate on one violation.
create unique index relation_investigation_open_idx
  on relation_investigation (tenant_id, violation_id)
  where state = 'open' and deleted_at is null;

create index relation_investigation_violation_idx
  on relation_investigation (tenant_id, violation_id, opened_on desc, id desc)
  where deleted_at is null;

-- ---------------------------------------------------------------------------------------------
-- The case lifecycle: one row per accepted transition, append-only.
--
-- The specification requires that "every transition is audited with actor, timestamp and reason",
-- and this table is that sentence. It is **separate from `relation_violation_access_event`** on
-- purpose: one records what changed, the other records who looked, and an audit that answered both
-- questions in one table would answer neither cleanly.
-- ---------------------------------------------------------------------------------------------

create table relation_case_event (
  id               uuid primary key default app_uuid_v7(),
  tenant_id        uuid not null,
  violation_id     uuid not null,
  -- 1 for the first transition of a case, and one more for each after it. Unique per case, which is
  -- what makes concurrent transitions safe and what makes "latest" unambiguous.
  sequence         integer not null,
  from_state       varchar(32) not null,
  to_state         varchar(32) not null,
  -- Why. Required by the specification, and not defaulted: a transition with no stated reason is the
  -- thing a labour tribunal asks about.
  reason           text not null,
  -- The authenticated caller. Never a field a request can set.
  actor            varchar(255) not null,
  occurred_at      timestamptz(6) not null,
  correlation_id   uuid not null,
  -- Which investigation caused this transition, where one did. Null for transitions that are not an
  -- investigation's doing — none exist in Checkpoint 2, and the column is nullable rather than
  -- absent so a later checkpoint's transitions need no migration to be recorded honestly.
  investigation_id uuid,
  created_at       timestamptz(6) not null,
  created_by       varchar(255) not null,
  updated_at       timestamptz(6) not null,
  updated_by       varchar(255) not null,
  -- Present because every table carries them. Unusable here by construction: a soft delete is an
  -- update, and the trigger below refuses every update on this table.
  deleted_at       timestamptz(6),
  deleted_by       varchar(255),
  version          integer not null,
  constraint relation_case_event_violation_fk
    foreign key (violation_id) references relation_violation (id),
  constraint relation_case_event_investigation_fk
    foreign key (investigation_id) references relation_investigation (id),
  -- The states Checkpoint 2 can actually reach, and no others. The specification's lifecycle
  -- continues through pending-approval, action-issued, acknowledged, appealed, upheld, annulled,
  -- expired and archived; every one of those is reached by a capability this checkpoint does not
  -- build, and listing a state nothing can produce would be a promise the code cannot keep. This
  -- CHECK widens by an approved change, exactly as `workflow_history`'s event CHECK was widened for
  -- `step-reminded` and as `relation_violation.state` will be if it ever needs to be.
  constraint relation_case_event_from_state_check
    check (from_state in ('reported', 'under_investigation', 'findings')),
  constraint relation_case_event_to_state_check
    check (to_state in ('reported', 'under_investigation', 'findings')),
  -- A transition that changes nothing is not a transition.
  constraint relation_case_event_moves_check check (from_state <> to_state),
  constraint relation_case_event_sequence_check check (sequence >= 1),
  constraint relation_case_event_reason_check check (length(btrim(reason)) between 1 and 2000)
);

-- **The concurrency arbiter.** Two requests reading the same current state compute the same next
-- sequence; one commits and the other raises here. Without it, both would append and the case would
-- have two "latest" events.
create unique index relation_case_event_sequence_idx
  on relation_case_event (tenant_id, violation_id, sequence);

-- The derivation of the current state is `order by sequence desc limit 1` over this index.
create index relation_case_event_case_idx
  on relation_case_event (tenant_id, violation_id, sequence desc);
create index relation_case_event_actor_idx
  on relation_case_event (tenant_id, actor, occurred_at desc);

-- ---------------------------------------------------------------------------------------------
-- Reading an investigation is reading a disciplinary record, so it is audited (AD-007).
--
-- The existing action vocabulary is widened rather than a second trail created: "who looked at this
-- case" is one question, and answering it from two tables would mean joining them to answer it.
-- ---------------------------------------------------------------------------------------------

alter table relation_violation_access_event
  drop constraint relation_violation_access_event_action_check;

alter table relation_violation_access_event
  add constraint relation_violation_access_event_action_check
  check (action in ('violation_read', 'violation_listed',
                    'investigation_read', 'investigation_listed', 'case_history_read'));

-- ---------------------------------------------------------------------------------------------
-- Immutability (D-5.2-17). Refused from any path, including a direct psql session.
-- ---------------------------------------------------------------------------------------------

-- **Unconditional**: a lifecycle transition is history the moment it is written.
create or replace function app_relation_case_event_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'relation_case_event_immutable'
    using errcode = 'restrict_violation',
          detail = format('relation_case_event %s is immutable', old.id),
          hint = 'A case history that can be rewritten is not a case history. Append a transition.';
end; $$;

create trigger relation_case_event_no_mutation
  before update or delete on relation_case_event
  for each row execute function app_relation_case_event_immutable();

-- **Conditional**: an investigation still open is a draft its investigator is writing; the moment it
-- concludes it becomes evidence and stops moving. The same shape as
-- `app_letter_template_version_refuse_issued`, which refuses a change only after first issue.
create or replace function app_relation_investigation_refuse_concluded() returns trigger
language plpgsql as $$
begin
  if old.state = 'concluded' then
    raise exception 'relation_investigation_concluded'
      using errcode = 'restrict_violation',
            detail = format('relation_investigation %s has concluded', old.id),
            hint = 'A concluded investigation is evidence. Nothing edits or deletes one.';
  end if;
  return case tg_op when 'DELETE' then old else new end;
end; $$;

create trigger relation_investigation_no_mutation_once_concluded
  before update or delete on relation_investigation
  for each row execute function app_relation_investigation_refuse_concluded();

-- ---------------------------------------------------------------------------------------------
-- Row-level security: enabled and forced on both (ADR-0030).
-- ---------------------------------------------------------------------------------------------

call app_protect_table('relation_investigation');
call app_protect_table('relation_case_event');
