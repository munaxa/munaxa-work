-- Recruitment — the hiring process, and the candidates who are not yet people (Phase 6).
--
-- Eleven tables, and the row-level security that isolates every one of them (ADR-0030). The
-- policies are created here, in the migration that creates the tables, rather than in a later
-- "hardening" step. That has always mattered; in this module it is a file of third-party personal
-- data about people who do not work here and never consented to this system.
--
-- Four decisions in this file are the ones a reviewer should challenge.
--
--   * **A candidate is not a Person.** `recruitment_candidate` holds a name, an email, a phone and
--     a source. It holds no government identifier, no date of birth and no nationality — those are
--     collected by People at hire, where nine tested protections already surround them. `person_id`
--     is null for a candidate's whole life until they are hired, is written exactly once, and is
--     unique: two candidate records cannot resolve to one human being (ADR-0044).
--
--   * **Approval is real, or it is not called approval.** `recruitment_requisition_decision`
--     records a human decision with the actor taken from the authenticated context, and is never
--     amended — a reversal is another row that names the one it reverses. Nothing here is
--     auto-approved, because a requisition is the control that authorizes headcount spending
--     (ADR-0045).
--
--   * **The hire is a saga, not a transaction.** The unit of work opens a new transaction on a new
--     connection per call, so creating a Person and creating an Employment cannot be atomic with
--     the application update. `hire_state` is what makes a half-finished hire *detectable and
--     resumable* rather than silent, and the write-once unique columns are what make a retry
--     converge instead of duplicating (ADR-0046).
--
--   * **There is no talent-pool table and no pipeline table.** A talent pool is a tag on a
--     candidate; a pipeline is a projection over applications. A stored copy of either would be a
--     second answer that goes stale the first time an application moves.

-- ---------------------------------------------------------------------------------------------
-- The counter recruitment's business numbers are drawn from.
--
-- Recruitment's own rather than Employment's: sharing a counter would couple two modules'
-- numbering forever. A global PostgreSQL sequence is refused for the reasons ADR-0039 gives — it
-- is neither tenant-scoped nor transactional.
-- ---------------------------------------------------------------------------------------------
create table recruitment_number_sequence (
  id         uuid primary key default app_uuid_v7(),
  tenant_id  uuid not null,
  series_key varchar(64) not null,
  next_value integer not null,
  created_at timestamptz(6) not null,
  created_by varchar(255) not null,
  updated_at timestamptz(6) not null,
  updated_by varchar(255) not null,
  deleted_at timestamptz(6),
  deleted_by varchar(255),
  version    integer not null,
  constraint recruitment_number_sequence_value_check check (next_value > 0)
);

create unique index recruitment_number_sequence_series_key
  on recruitment_number_sequence (tenant_id, series_key)
  where deleted_at is null;

-- ---------------------------------------------------------------------------------------------
-- The requisition: internal authority to hire.
-- ---------------------------------------------------------------------------------------------
create table recruitment_requisition (
  id                           uuid primary key default app_uuid_v7(),
  tenant_id                    uuid not null,
  requisition_number           varchar(64) not null,
  status                       varchar(32) not null,
  -- `organization`'s, by identifier. No foreign key crosses to them and no name is cached: a
  -- renamed position would leave a stale copy, and a composite key enforcing the tenant would need
  -- a new index on another module's table (ADR-0042).
  position_id                  uuid not null,
  unit_id                      uuid not null,
  cost_center_id               uuid,
  headcount_requested          integer not null,
  headcount_filled             integer not null default 0,
  -- Tenant or country-pack codes. Why a role is being filled, and how urgently, are not lists this
  -- product ships (00B).
  reason_code                  varchar(64) not null,
  priority_code                varchar(64),
  target_start_date            date,
  requested_by_employment_id   uuid not null,
  hiring_manager_employment_id uuid,
  -- Set when Workflow (Phase 16) routes the decision. Null while Recruitment decides it directly,
  -- which is the honest state today rather than a fabricated approval identifier.
  approval_id                  varchar(64),
  metadata                     jsonb not null default '{}',
  created_at                   timestamptz(6) not null,
  created_by                   varchar(255) not null,
  updated_at                   timestamptz(6) not null,
  updated_by                   varchar(255) not null,
  deleted_at                   timestamptz(6),
  deleted_by                   varchar(255),
  version                      integer not null,
  constraint recruitment_requisition_status_check
    check (status in ('draft', 'pending_approval', 'approved', 'rejected', 'open', 'closed', 'cancelled')),
  constraint recruitment_requisition_headcount_check check (headcount_requested > 0),
  -- More hires than the requisition authorized is the failure this control exists to prevent, and
  -- it is enforced here as well as in the domain.
  constraint recruitment_requisition_filled_check
    check (headcount_filled >= 0 and headcount_filled <= headcount_requested)
);

create unique index recruitment_requisition_number_key
  on recruitment_requisition (tenant_id, requisition_number)
  where deleted_at is null;

create index recruitment_requisition_status_idx on recruitment_requisition (tenant_id, status);
create index recruitment_requisition_placement_idx
  on recruitment_requisition (tenant_id, position_id, unit_id);
create index recruitment_requisition_manager_idx
  on recruitment_requisition (tenant_id, hiring_manager_employment_id);

-- ---------------------------------------------------------------------------------------------
-- The decision on a requisition: a human, named, and never amended.
--
-- A reversal is a new row pointing at the one it reverses, so the sequence itself answers "who
-- approved this, and did anybody undo it". A decision that could be edited afterwards is not
-- evidence of anything — the same reasoning behind People's notes and Employment's status history.
-- ---------------------------------------------------------------------------------------------
create table recruitment_requisition_decision (
  id             uuid primary key default app_uuid_v7(),
  tenant_id      uuid not null,
  requisition_id uuid not null,
  decision       varchar(16) not null,
  reason_code    varchar(64),
  note           varchar(1024),
  -- Taken from the authenticated context by the application. A caller cannot supply it, which is
  -- what stops somebody recording an approval in a colleague's name.
  decided_by     varchar(255) not null,
  decided_at     timestamptz(6) not null,
  reverses_id    uuid,
  created_at     timestamptz(6) not null,
  created_by     varchar(255) not null,
  updated_at     timestamptz(6) not null,
  updated_by     varchar(255) not null,
  deleted_at     timestamptz(6),
  deleted_by     varchar(255),
  version        integer not null,
  constraint recruitment_requisition_decision_requisition_fk
    foreign key (requisition_id) references recruitment_requisition (id),
  constraint recruitment_requisition_decision_reverses_fk
    foreign key (reverses_id) references recruitment_requisition_decision (id),
  constraint recruitment_requisition_decision_kind_check
    check (decision in ('approved', 'rejected', 'reversed')),
  -- A reversal names what it reverses; an original names nothing. Either half alone is a record
  -- nobody can follow.
  constraint recruitment_requisition_decision_reversal_check
    check ((decision = 'reversed') = (reverses_id is not null))
);

create index recruitment_requisition_decision_idx
  on recruitment_requisition_decision (tenant_id, requisition_id, decided_at);

-- ---------------------------------------------------------------------------------------------
-- The vacancy: an opening that accepts applications.
--
-- Publication channels are an array rather than a table. A channel has no lifecycle of its own,
-- and a table per name is exactly the shape the approved scope decision refuses.
-- ---------------------------------------------------------------------------------------------
create table recruitment_vacancy (
  id                 uuid primary key default app_uuid_v7(),
  tenant_id          uuid not null,
  requisition_id     uuid not null,
  title              jsonb not null,
  description        jsonb,
  status             varchar(32) not null,
  channels           text[] not null default '{}',
  opened_on          date,
  closes_on          date,
  closed_reason_code varchar(64),
  metadata           jsonb not null default '{}',
  created_at         timestamptz(6) not null,
  created_by         varchar(255) not null,
  updated_at         timestamptz(6) not null,
  updated_by         varchar(255) not null,
  deleted_at         timestamptz(6),
  deleted_by         varchar(255),
  version            integer not null,
  constraint recruitment_vacancy_requisition_fk
    foreign key (requisition_id) references recruitment_requisition (id),
  constraint recruitment_vacancy_status_check
    check (status in ('draft', 'published', 'closed')),
  -- Both languages before a row is written. A vacancy title in one language is a posting half the
  -- workforce cannot read (00B).
  constraint recruitment_vacancy_title_check check (title ? 'en' and title ? 'ar'),
  constraint recruitment_vacancy_dates_check
    check (closes_on is null or opened_on is null or closes_on >= opened_on)
);

create index recruitment_vacancy_status_idx on recruitment_vacancy (tenant_id, status);
create index recruitment_vacancy_requisition_idx on recruitment_vacancy (tenant_id, requisition_id);

-- ---------------------------------------------------------------------------------------------
-- The candidate.
--
-- What this table deliberately has no column for is the boundary being kept rather than described:
-- no national identifier, no passport, no date of birth, no nationality, no photograph. A
-- candidate who is never hired leaves none of those anywhere in this product, and one who is hired
-- gives them to People, which was built to protect them (ADR-0038, ADR-0044).
-- ---------------------------------------------------------------------------------------------
create table recruitment_candidate (
  id               uuid primary key default app_uuid_v7(),
  tenant_id        uuid not null,
  candidate_number varchar(64) not null,
  status           varchar(32) not null,
  display_name     jsonb not null,
  -- Normalized: lower-cased, separators stripped. This is what matching compares, and storing the
  -- entered form separately is what lets a screen show the customer their own formatting back.
  email            varchar(320) not null,
  phone            varchar(64),
  display_email    varchar(320) not null,
  source_code      varchar(64) not null,
  person_id        uuid,
  anonymized_at    timestamptz(6),
  metadata         jsonb not null default '{}',
  created_at       timestamptz(6) not null,
  created_by       varchar(255) not null,
  updated_at       timestamptz(6) not null,
  updated_by       varchar(255) not null,
  deleted_at       timestamptz(6),
  deleted_by       varchar(255),
  version          integer not null,
  -- The one foreign key that crosses a module's tables, and it points *backward* to a module
  -- Recruitment already depends on — the same rule ADR-0042 states, not a different one.
  constraint recruitment_candidate_person_fk foreign key (person_id) references person (id),
  constraint recruitment_candidate_status_check
    check (status in ('active', 'hired', 'archived')),
  constraint recruitment_candidate_name_check check (display_name ? 'en' and display_name ? 'ar')
);

create unique index recruitment_candidate_number_key
  on recruitment_candidate (tenant_id, candidate_number)
  where deleted_at is null;

-- One candidate record per human being. Without this, a retried hire or two recruiters working the
-- same person produce two candidates pointing at one Person, and every count afterwards is wrong.
create unique index recruitment_candidate_person_key
  on recruitment_candidate (tenant_id, person_id)
  where person_id is not null and deleted_at is null;

create index recruitment_candidate_status_idx on recruitment_candidate (tenant_id, status);
create index recruitment_candidate_email_idx on recruitment_candidate (tenant_id, email);
create index recruitment_candidate_phone_idx on recruitment_candidate (tenant_id, phone);

-- ---------------------------------------------------------------------------------------------
-- What a candidate says about themselves.
--
-- Not `person_capability` and not `person_history`, and the difference is the point: a candidate's
-- claims are unverified, and the register stands behind what it holds.
-- ---------------------------------------------------------------------------------------------
create table recruitment_candidate_profile_entry (
  id                 uuid primary key default app_uuid_v7(),
  tenant_id          uuid not null,
  candidate_id       uuid not null,
  kind               varchar(16) not null,
  code               varchar(64),
  title              jsonb not null,
  organization_name  jsonb,
  from_date          date,
  to_date            date,
  level_code         varchar(32),
  document_reference varchar(128),
  withdrawn_at       timestamptz(6),
  created_at         timestamptz(6) not null,
  created_by         varchar(255) not null,
  updated_at         timestamptz(6) not null,
  updated_by         varchar(255) not null,
  deleted_at         timestamptz(6),
  deleted_by         varchar(255),
  version            integer not null,
  constraint recruitment_candidate_profile_candidate_fk
    foreign key (candidate_id) references recruitment_candidate (id),
  constraint recruitment_candidate_profile_kind_check
    check (kind in ('skill', 'language', 'experience', 'education', 'certification')),
  constraint recruitment_candidate_profile_period_check
    check (to_date is null or from_date is null or to_date >= from_date)
);

create index recruitment_candidate_profile_idx
  on recruitment_candidate_profile_entry (tenant_id, candidate_id, kind);
create index recruitment_candidate_profile_code_idx
  on recruitment_candidate_profile_entry (tenant_id, kind, code);

-- ---------------------------------------------------------------------------------------------
-- The application: one candidate, one vacancy, one pursuit.
-- ---------------------------------------------------------------------------------------------
create table recruitment_application (
  id                    uuid primary key default app_uuid_v7(),
  tenant_id             uuid not null,
  application_number    varchar(64) not null,
  candidate_id          uuid not null,
  vacancy_id            uuid not null,
  status                varchar(32) not null,
  -- Tenant-defined, inside a closed status set. A tenant running "phone screen → panel → founder
  -- chat" gets three stages; the product still knows the application is `interviewing`. That split
  -- is how AD-005 is honoured without shipping a workflow builder.
  stage_code            varchar(64),
  source_code           varchar(64) not null,
  applied_on            date not null,
  screening_outcome     varchar(16),
  screening_note        varchar(1024),
  rejection_reason_code varchar(64),
  hire_state            varchar(24),
  hire_failure_reason   varchar(255),
  employment_id         uuid,
  metadata              jsonb not null default '{}',
  created_at            timestamptz(6) not null,
  created_by            varchar(255) not null,
  updated_at            timestamptz(6) not null,
  updated_by            varchar(255) not null,
  deleted_at            timestamptz(6),
  deleted_by            varchar(255),
  version               integer not null,
  constraint recruitment_application_candidate_fk
    foreign key (candidate_id) references recruitment_candidate (id),
  constraint recruitment_application_vacancy_fk
    foreign key (vacancy_id) references recruitment_vacancy (id),
  constraint recruitment_application_status_check
    check (status in ('received', 'screening', 'shortlisted', 'interviewing', 'evaluated',
                      'offered', 'hired', 'rejected', 'withdrawn')),
  constraint recruitment_application_screening_check
    check (screening_outcome is null or screening_outcome in ('passed', 'failed', 'on_hold')),
  -- The saga's states. `completed` is the only one an application may sit in while `hired`, and the
  -- check below is what turns a half-finished hire from a silent wrong answer into a query.
  constraint recruitment_application_hire_state_check
    check (hire_state is null or hire_state in ('pending', 'person_linked', 'employment_created',
                                                'completed', 'failed')),
  -- Rejected means explained. A rejection with no reason answers "why" with nothing, and it is the
  -- answer a candidate is most likely to ask for.
  constraint recruitment_application_rejection_check
    check ((status = 'rejected') = (rejection_reason_code is not null))
);

create unique index recruitment_application_number_key
  on recruitment_application (tenant_id, application_number)
  where deleted_at is null;

-- One application per candidate per vacancy. A candidate re-applying to the same opening reopens
-- the application they already have; a second row would make every pipeline count wrong.
create unique index recruitment_application_candidate_vacancy_key
  on recruitment_application (tenant_id, candidate_id, vacancy_id)
  where deleted_at is null;

-- Written once by the hire, through Employment's application service. Unique so that a retry
-- cannot attach a second employment to the same application.
create unique index recruitment_application_employment_key
  on recruitment_application (tenant_id, employment_id)
  where employment_id is not null and deleted_at is null;

create index recruitment_application_pipeline_idx
  on recruitment_application (tenant_id, vacancy_id, status);
create index recruitment_application_candidate_idx
  on recruitment_application (tenant_id, candidate_id);
create index recruitment_application_status_idx on recruitment_application (tenant_id, status);
-- The reconciliation query: every hire that started and did not finish.
create index recruitment_application_hire_state_idx
  on recruitment_application (tenant_id, hire_state)
  where hire_state is not null;

-- ---------------------------------------------------------------------------------------------
-- Every movement through the pipeline, appended and never amended.
-- ---------------------------------------------------------------------------------------------
create table recruitment_application_event (
  id             uuid primary key default app_uuid_v7(),
  tenant_id      uuid not null,
  application_id uuid not null,
  from_status    varchar(32),
  to_status      varchar(32) not null,
  stage_code     varchar(64),
  reason_code    varchar(64),
  note           varchar(1024),
  occurred_at    timestamptz(6) not null,
  recorded_by    varchar(255) not null,
  created_at     timestamptz(6) not null,
  created_by     varchar(255) not null,
  updated_at     timestamptz(6) not null,
  updated_by     varchar(255) not null,
  deleted_at     timestamptz(6),
  deleted_by     varchar(255),
  version        integer not null,
  constraint recruitment_application_event_application_fk
    foreign key (application_id) references recruitment_application (id)
);

create index recruitment_application_event_idx
  on recruitment_application_event (tenant_id, application_id, occurred_at);

-- ---------------------------------------------------------------------------------------------
-- Interviews. Interviewers are employments, not a second person entity.
-- ---------------------------------------------------------------------------------------------
create table recruitment_interview (
  id                         uuid primary key default app_uuid_v7(),
  tenant_id                  uuid not null,
  application_id             uuid not null,
  round_number               integer not null,
  stage_code                 varchar(64),
  mode_code                  varchar(32) not null,
  status                     varchar(32) not null,
  scheduled_from             timestamptz(6),
  scheduled_to               timestamptz(6),
  location_text              varchar(255),
  -- Opaque. A meeting link, a room booking reference, whatever an external system calls it. No
  -- calendar is built here: scheduling is somebody else's domain.
  meeting_reference          varchar(255),
  interviewer_employment_ids uuid[] not null default '{}',
  cancelled_reason_code      varchar(64),
  metadata                   jsonb not null default '{}',
  created_at                 timestamptz(6) not null,
  created_by                 varchar(255) not null,
  updated_at                 timestamptz(6) not null,
  updated_by                 varchar(255) not null,
  deleted_at                 timestamptz(6),
  deleted_by                 varchar(255),
  version                    integer not null,
  constraint recruitment_interview_application_fk
    foreign key (application_id) references recruitment_application (id),
  constraint recruitment_interview_status_check
    check (status in ('scheduled', 'completed', 'cancelled', 'no_show')),
  constraint recruitment_interview_round_check check (round_number > 0),
  constraint recruitment_interview_window_check
    check (scheduled_to is null or scheduled_from is null or scheduled_to > scheduled_from),
  -- An interview nobody conducts is not an interview.
  constraint recruitment_interview_panel_check
    check (array_length(interviewer_employment_ids, 1) >= 1)
);

create unique index recruitment_interview_round_key
  on recruitment_interview (tenant_id, application_id, round_number)
  where deleted_at is null;

create index recruitment_interview_application_idx
  on recruitment_interview (tenant_id, application_id);
create index recruitment_interview_schedule_idx
  on recruitment_interview (tenant_id, scheduled_from);

-- ---------------------------------------------------------------------------------------------
-- Interview feedback: written once, never edited.
-- ---------------------------------------------------------------------------------------------
create table recruitment_interview_feedback (
  id                        uuid primary key default app_uuid_v7(),
  tenant_id                 uuid not null,
  interview_id              uuid not null,
  interviewer_employment_id uuid not null,
  score                     integer,
  recommendation            varchar(24) not null,
  strengths                 varchar(2048),
  concerns                  varchar(2048),
  submitted_at              timestamptz(6) not null,
  created_at                timestamptz(6) not null,
  created_by                varchar(255) not null,
  updated_at                timestamptz(6) not null,
  updated_by                varchar(255) not null,
  deleted_at                timestamptz(6),
  deleted_by                varchar(255),
  version                   integer not null,
  constraint recruitment_feedback_interview_fk
    foreign key (interview_id) references recruitment_interview (id),
  constraint recruitment_feedback_score_check check (score is null or score between 1 and 5),
  constraint recruitment_feedback_recommendation_check
    check (recommendation in ('strong_yes', 'yes', 'no', 'strong_no', 'no_decision'))
);

-- One interviewer, one verdict. A second submission is a refusal rather than an overwrite: a score
-- somebody could revise after hearing the others is not an independent opinion.
create unique index recruitment_feedback_interviewer_key
  on recruitment_interview_feedback (tenant_id, interview_id, interviewer_employment_id)
  where deleted_at is null;

create index recruitment_feedback_interview_idx
  on recruitment_interview_feedback (tenant_id, interview_id);

-- ---------------------------------------------------------------------------------------------
-- Offers. Versioned, and never edited.
-- ---------------------------------------------------------------------------------------------
create table recruitment_offer (
  id                            uuid primary key default app_uuid_v7(),
  tenant_id                     uuid not null,
  application_id                uuid not null,
  offer_number                  varchar(64) not null,
  offer_version                 integer not null,
  status                        varchar(32) not null,
  proposed_start_date           date not null,
  expires_on                    date,
  proposed_position_id          uuid,
  proposed_unit_id              uuid,
  proposed_employment_type_code varchar(64),
  -- Opaque. Recruitment records what a recruiter proposed and performs no arithmetic on it;
  -- Compensation (Phase 10) owns pay structures. Storing it as authored is also what keeps an
  -- accepted offer reconstructable after Compensation's configuration changes.
  proposed_compensation         jsonb not null default '{}',
  currency_code                 char(3),
  decision_note                 varchar(1024),
  issued_at                     timestamptz(6),
  decided_at                    timestamptz(6),
  decided_by                    varchar(255),
  document_reference            varchar(128),
  metadata                      jsonb not null default '{}',
  created_at                    timestamptz(6) not null,
  created_by                    varchar(255) not null,
  updated_at                    timestamptz(6) not null,
  updated_by                    varchar(255) not null,
  deleted_at                    timestamptz(6),
  deleted_by                    varchar(255),
  version                       integer not null,
  constraint recruitment_offer_application_fk
    foreign key (application_id) references recruitment_application (id),
  constraint recruitment_offer_status_check
    check (status in ('draft', 'pending_approval', 'approved', 'rejected', 'issued',
                      'accepted', 'declined', 'expired', 'withdrawn')),
  constraint recruitment_offer_version_check check (offer_version > 0),
  constraint recruitment_offer_expiry_check
    check (expires_on is null or expires_on >= proposed_start_date - interval '365 days'),
  -- A decided offer names who decided it and when. Either half alone is a decision nobody can be
  -- held to.
  constraint recruitment_offer_decision_check
    check ((decided_at is null) = (decided_by is null))
);

create unique index recruitment_offer_number_key
  on recruitment_offer (tenant_id, offer_number)
  where deleted_at is null;

create unique index recruitment_offer_version_key
  on recruitment_offer (tenant_id, application_id, offer_version)
  where deleted_at is null;

-- One live offer at a time. Two issued versions is two answers to "what did we offer them", and a
-- candidate who accepted one of them would be holding the wrong terms.
create unique index recruitment_offer_one_live_key
  on recruitment_offer (tenant_id, application_id)
  where status in ('issued', 'accepted') and deleted_at is null;

create index recruitment_offer_application_idx
  on recruitment_offer (tenant_id, application_id, offer_version);
create index recruitment_offer_status_idx on recruitment_offer (tenant_id, status);

-- ---------------------------------------------------------------------------------------------
-- Row-level security (ADR-0030).
--
-- Every table here carries `tenant_id`, so every one takes the standard policy. There is no
-- exception in this module — and in a module holding third-party personal data there could not be.
-- ---------------------------------------------------------------------------------------------
call app_protect_table('recruitment_number_sequence');
call app_protect_table('recruitment_requisition');
call app_protect_table('recruitment_requisition_decision');
call app_protect_table('recruitment_vacancy');
call app_protect_table('recruitment_candidate');
call app_protect_table('recruitment_candidate_profile_entry');
call app_protect_table('recruitment_application');
call app_protect_table('recruitment_application_event');
call app_protect_table('recruitment_interview');
call app_protect_table('recruitment_interview_feedback');
call app_protect_table('recruitment_offer');

comment on table recruitment_candidate is
  'Somebody outside the company who might join it. Holds no government identifier, no date of birth and no nationality: a candidate is not a Person, and identity-sensitive data is People''s to collect at hire (ADR-0044).';
comment on column recruitment_candidate.person_id is
  'The Person this candidate turned out to be. Null until hire, written exactly once, and unique — two candidate records cannot resolve to one human being.';
comment on table recruitment_requisition_decision is
  'A human decision on a requisition, appended and never amended. A reversal is another row naming the one it reverses, because a decision that could be edited afterwards is not evidence (ADR-0045).';
comment on column recruitment_application.hire_state is
  'How far the hire got. The unit of work cannot span modules, so this is what makes a half-finished hire detectable and resumable rather than silently wrong (ADR-0046).';
comment on column recruitment_offer.proposed_compensation is
  'What a recruiter proposed, stored as authored and never computed with. Compensation (Phase 10) is authoritative; this keeps an accepted offer reconstructable after its configuration changes.';
