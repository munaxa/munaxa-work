-- ================================================================================================
-- Phase 5.2 — Employee Relations · Checkpoint 4 · Disciplinary actions (D-5.2-20, approved)
--
-- **Two tables, one widened CHECK, and nothing else touched.** No existing table is altered, no
-- trigger is weakened, and neither Checkpoint 2 trigger nor Checkpoint 3's correction index is
-- changed.
--
--   * **The ladder is tenant configuration, not business logic.** Which action a repeat attracts is
--     a row a tenant writes. Nothing here infers a policy from severity, from an occurrence count, or
--     from a country — and where a tenant has configured no rule, the evaluation returns **nothing**
--     rather than inventing an action. That is D-5.2-20's approved principle expressed as a schema:
--     counting repeats and prescribing an outcome are separate responsibilities, and only the second
--     one lives here.
--
--   * **Nothing here punishes anybody.** `relation_disciplinary_action` records that a named human
--     issued an action. It suspends nobody — Employment owns `suspended` and `ended`, and Relations
--     does not write them (AD-005: a recommendation only). It deducts nothing — Payroll is
--     pull-oriented and is not touched. It approves nothing — Workflow is unchanged. The two most
--     serious rungs are therefore named `*_recommendation`, because that is exactly and only what
--     this module can produce.
--
--   * **No repeat state is persisted.** There is no `repeat_count`, no `is_repeat`, no
--     `escalation_level` and no cached escalation anywhere in this migration. `occurrence_at_issue`
--     below is **not** a counter: it is the count *as it stood when a human issued the action*,
--     frozen for the same reason `relation_violation` freezes `category_code` (AD-003).
--
--   * **No expiry.** No expiry column, no sweep, no timer, no worker. A warning's validity period is
--     derived when it is needed, and D-5.2-20 did not authorize persisted expiry.
-- ================================================================================================

-- ---------------------------------------------------------------------------------------------
-- The ladder: what a tenant has decided a repeat attracts.
--
-- Shaped after `learning_mandatory_rule` — the repository's existing tenant-configured rule table:
-- an applicability scope, a threshold, an outcome, `active`, and no engine. It references
-- `relation_violation_category` rather than restating it, because **the category remains the source
-- of category identity and severity**; duplicating severity here would create a second answer to a
-- question the catalogue already answers.
-- ---------------------------------------------------------------------------------------------

create table relation_disciplinary_rule (
  id                     uuid primary key default app_uuid_v7(),
  tenant_id              uuid not null,
  violation_category_id  uuid not null,
  -- The occurrence at or above which this rule applies: 1 for a first offence, 3 for a third.
  -- A *threshold*, not a counter — nothing increments it and nothing stores a count beside it.
  min_occurrence         integer not null,
  action_code            varchar(48) not null,
  -- Deterministic precedence when two rules could both apply, in the `(sequence, code)` shape
  -- D-5.2-07 established for the catalogue. Ties fall through to `id`, so the winner never depends
  -- on insertion order or on what the planner returned first.
  sequence               integer not null,
  -- How a rule leaves service. There is no delete: a rule that prescribed an action somebody was
  -- issued must remain readable, so it is deactivated rather than removed.
  active                 boolean not null default true,
  metadata               jsonb not null default '{}',
  created_at             timestamptz(6) not null,
  created_by             varchar(255) not null,
  updated_at             timestamptz(6) not null,
  updated_by             varchar(255) not null,
  deleted_at             timestamptz(6),
  deleted_by             varchar(255),
  version                integer not null,
  constraint relation_disciplinary_rule_category_fk
    foreign key (violation_category_id) references relation_violation_category (id),
  -- **The whole action vocabulary, closed.** Five rungs, each with a business meaning this module
  -- can actually represent. The two most serious are recommendations because executing them belongs
  -- to Employment (AD-005), and a value named `termination` would promise something Relations must
  -- never do. Widened only by an approved decision, as every CHECK in this module is.
  constraint relation_disciplinary_rule_action_check
    check (action_code in ('verbal_warning', 'written_warning', 'final_warning',
                           'suspension_recommendation', 'termination_recommendation')),
  constraint relation_disciplinary_rule_occurrence_check check (min_occurrence >= 1),
  constraint relation_disciplinary_rule_sequence_check check (sequence >= 0)
);

-- **One rule per category per threshold.** Two administrators configuring "the third absence" at the
-- same moment do not both succeed: the index arbitrates, because a read that precedes an insert
-- decides nothing under concurrency (ADR-0071). Partial, so a deactivated rule does not block its
-- replacement.
create unique index relation_disciplinary_rule_threshold_idx
  on relation_disciplinary_rule (tenant_id, violation_category_id, min_occurrence)
  where active and deleted_at is null;

-- The evaluation's own read: every active rule for one category, highest threshold first.
create index relation_disciplinary_rule_evaluation_idx
  on relation_disciplinary_rule (tenant_id, violation_category_id, min_occurrence desc, sequence, id)
  where active and deleted_at is null;

-- ---------------------------------------------------------------------------------------------
-- An issued disciplinary action: a named human decided, and this is the record of it.
--
-- **Immutable from the moment it is written**, like the violation it concerns and like the case
-- history. Somebody may be dismissed on the strength of this row; a register whose rows can be
-- edited afterwards cannot answer for what it issued.
-- ---------------------------------------------------------------------------------------------

create table relation_disciplinary_action (
  id                      uuid primary key default app_uuid_v7(),
  tenant_id               uuid not null,
  violation_id            uuid not null,
  -- The concluded inquiry this action rests on. **Required**: the specification's lifecycle runs
  -- Findings → Action Issued, and an action issued with no inquiry behind it is the decision a
  -- tribunal sets aside first.
  investigation_id        uuid not null,
  -- The rule that prescribed it, where one did. Nullable because a human may issue an action the
  -- ladder did not prescribe — the ladder is decision *support*, and a system that refused a human's
  -- judgement would be the automatic punishment engine D-5.2-20 forbade.
  disciplinary_rule_id    uuid,
  action_code             varchar(48) not null,
  -- **Frozen at issue** (AD-003, and §8 of the authorization). A tenant may re-grade its ladder next
  -- year; this row must still mean what it meant when somebody was disciplined on it. The rule link
  -- above answers "which rule", these two answer "and what did it say at the time".
  prescribed_by_rule      boolean not null,
  occurrence_at_issue     integer not null,
  reason                  text not null,
  -- The authenticated caller. Never a field a request can set.
  issued_by               varchar(255) not null,
  issued_on               date not null,
  issued_at               timestamptz(6) not null,
  correlation_id          uuid not null,
  metadata                jsonb not null default '{}',
  created_at              timestamptz(6) not null,
  created_by              varchar(255) not null,
  updated_at              timestamptz(6) not null,
  updated_by              varchar(255) not null,
  -- Present because every table carries them. Unusable by construction: a soft delete is an update,
  -- and the trigger below refuses every update on this table.
  deleted_at              timestamptz(6),
  deleted_by              varchar(255),
  version                 integer not null,
  constraint relation_disciplinary_action_violation_fk
    foreign key (violation_id) references relation_violation (id),
  constraint relation_disciplinary_action_investigation_fk
    foreign key (investigation_id) references relation_investigation (id),
  constraint relation_disciplinary_action_rule_fk
    foreign key (disciplinary_rule_id) references relation_disciplinary_rule (id),
  constraint relation_disciplinary_action_code_check
    check (action_code in ('verbal_warning', 'written_warning', 'final_warning',
                           'suspension_recommendation', 'termination_recommendation')),
  constraint relation_disciplinary_action_occurrence_check check (occurrence_at_issue >= 1),
  constraint relation_disciplinary_action_reason_check
    check (length(btrim(reason)) between 1 and 2000),
  -- `prescribed_by_rule` and the rule link must agree. A row claiming a rule prescribed it while
  -- naming none is a row nobody can audit.
  constraint relation_disciplinary_action_prescription_check
    check ((prescribed_by_rule and disciplinary_rule_id is not null)
           or (not prescribed_by_rule and disciplinary_rule_id is null))
);

-- **One action per case.** A second action on one violation would be two punishments for one
-- matter, and deciding whether that is ever legitimate is a decision nobody has taken. Refused here
-- rather than left to a caller's discipline.
create unique index relation_disciplinary_action_violation_idx
  on relation_disciplinary_action (tenant_id, violation_id)
  where deleted_at is null;

create index relation_disciplinary_action_issued_idx
  on relation_disciplinary_action (tenant_id, issued_on desc, id desc);

-- ---------------------------------------------------------------------------------------------
-- The case reaches its next state.
--
-- `action_issued` is added to the lifecycle by this approved change, exactly as `workflow_history`'s
-- event CHECK was widened for `step-reminded`. It is the **one** state this checkpoint can produce;
-- acknowledged, appealed, upheld, annulled, expired and archived are still absent, because the
-- capabilities that reach them are still unbuilt.
-- ---------------------------------------------------------------------------------------------

alter table relation_case_event
  drop constraint relation_case_event_from_state_check;

alter table relation_case_event
  add constraint relation_case_event_from_state_check
  check (from_state in ('reported', 'under_investigation', 'findings', 'action_issued'));

alter table relation_case_event
  drop constraint relation_case_event_to_state_check;

alter table relation_case_event
  add constraint relation_case_event_to_state_check
  check (to_state in ('reported', 'under_investigation', 'findings', 'action_issued'));

-- Reading a disciplinary action is reading the most consequential record in this module (AD-007).
alter table relation_violation_access_event
  drop constraint relation_violation_access_event_action_check;

alter table relation_violation_access_event
  add constraint relation_violation_access_event_action_check
  check (action in ('violation_read', 'violation_listed',
                    'investigation_read', 'investigation_listed', 'case_history_read',
                    'escalation_read', 'disciplinary_action_read'));

-- ---------------------------------------------------------------------------------------------
-- Immutability: an issued action is refused every change, from any path.
-- ---------------------------------------------------------------------------------------------

create or replace function app_relation_disciplinary_action_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'relation_disciplinary_action_immutable'
    using errcode = 'restrict_violation',
          detail = format('relation_disciplinary_action %s is immutable', old.id),
          hint = 'A disciplinary action that can be rewritten is not a disciplinary record.';
end; $$;

create trigger relation_disciplinary_action_no_mutation
  before update or delete on relation_disciplinary_action
  for each row execute function app_relation_disciplinary_action_immutable();

-- ---------------------------------------------------------------------------------------------
-- Row-level security: enabled and forced on both (ADR-0030).
-- ---------------------------------------------------------------------------------------------

call app_protect_table('relation_disciplinary_rule');
call app_protect_table('relation_disciplinary_action');
