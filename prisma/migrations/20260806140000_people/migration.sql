-- People — the enterprise master registry of human identity (Phase 4).
--
-- Thirteen tables, and the row-level security that isolates every one of them (ADR-0030). The
-- policies are created here, in the migration that creates the tables, rather than in a later
-- "hardening" step: a table that exists for one deployment without its policy is a table that
-- leaked for that deployment, and applying the policy afterwards does not un-leak it. That has
-- always mattered; in this module it is the difference between a structure chart and a file of
-- national identifiers.
--
-- Three decisions in this file are the ones a reviewer should challenge.
--
--   * There is **no name column on `person`**. A legal name changes — marriage, naturalisation, a
--     court correction — and "what was this person's legal name when they signed that contract"
--     has legal force and exactly one right answer. Names live entirely in `person_name`, on a
--     timeline, and the person row holds no cached copy, because a cached copy is a second
--     answer. ADR-0037.
--
--   * `person_identifier` carries a `match_key` beside the value, and duplicate detection
--     compares only the key. A national identifier space is small enough to enumerate, so the key
--     is a *keyed* digest (PII_MATCH_SECRET) rather than a plain hash — the index that makes
--     duplicate detection fast holds nothing worth stealing, and the query that finds who already
--     holds a number never reads one.
--
--   * Nothing here is ever deleted. Every child record is withdrawn or superseded, because
--     historical identity information is never destroyed (AD-009), and a merge is a redirect
--     rather than a removal: everything that ever referenced the losing record must still resolve.

-- ---------------------------------------------------------------------------------------------
-- The person: one permanent human identity.
--
-- What this table deliberately has no column for is the boundary being kept rather than
-- described: no department, company, branch, division, section, team, position, manager, cost
-- centre, shift or supervisor (AD-003); no salary or payroll figure (AD-004); no attendance
-- (AD-005). Employment references Person; Person never references Employment (AD-002).
-- ---------------------------------------------------------------------------------------------
create table person (
  id                    uuid primary key default app_uuid_v7(),
  tenant_id             uuid not null,
  person_number         varchar(64) not null,
  -- A date, not a timestamp. `1990-03-14` is the same date in Riyadh and in London; stored as an
  -- instant it shifts across a zone boundary and changes somebody's age, their eligibility and —
  -- in several of this product's markets — their retirement date.
  date_of_birth         date,
  place_of_birth        varchar(255),
  -- Tenant-supplied codes, never enumerations this product ships. Gender and marital status are
  -- inputs to statutory rules in most of this product's markets, and the categories a given
  -- authority recognises are that authority's (00B).
  gender_code           varchar(64),
  marital_status_code   varchar(64),
  status                varchar(32) not null,
  photo_document_id     varchar(64),
  merged_into_person_id uuid,
  metadata              jsonb not null default '{}',
  created_at            timestamptz(6) not null,
  created_by            varchar(255) not null,
  updated_at            timestamptz(6) not null,
  updated_by            varchar(255) not null,
  deleted_at            timestamptz(6),
  deleted_by            varchar(255),
  version               integer not null,
  constraint person_status_check check (status in ('draft', 'active', 'archived', 'merged')),
  -- A merged record points somewhere, and a record that points somewhere is merged. Either half
  -- alone is a redirect nobody follows or a status nothing acts on.
  constraint person_merge_target_check
    check ((status = 'merged') = (merged_into_person_id is not null)),
  constraint person_not_merged_into_itself_check check (merged_into_person_id <> id),
  -- Nobody alive was born before this, and nobody is born tomorrow. A bound rather than a rule
  -- about working age, which is statutory and belongs to the country pack: what this refuses is
  -- `2960` for `1960`, which otherwise reaches a payroll calculation as a plausible number.
  constraint person_birth_plausible_check
    check (date_of_birth is null or date_of_birth between date '1900-01-01' and current_date)
);

-- Case-insensitively unique, matching the repository's lookup rather than merely resembling it: a
-- tenant holding both `E-1001` and `e-1001` would have two people nobody can tell apart in a list.
create unique index person_number_key on person (tenant_id, lower(person_number))
  where deleted_at is null;
create index person_tenant_status_idx on person (tenant_id, status);
create index person_tenant_birth_idx on person (tenant_id, date_of_birth);

-- ---------------------------------------------------------------------------------------------
-- The name timeline (ADR-0037).
-- ---------------------------------------------------------------------------------------------
create table person_name (
  id             uuid primary key default app_uuid_v7(),
  tenant_id      uuid not null,
  person_id      uuid not null,
  legal_name     jsonb not null,
  preferred_name jsonb,
  effective_from timestamptz(6) not null,
  effective_to   timestamptz(6),
  created_at     timestamptz(6) not null,
  created_by     varchar(255) not null,
  updated_at     timestamptz(6) not null,
  updated_by     varchar(255) not null,
  deleted_at     timestamptz(6),
  deleted_by     varchar(255),
  version        integer not null,
  constraint person_name_person_fk foreign key (person_id) references person (id),
  -- Both first-class languages, checked by the database as well as by the aggregate. A person
  -- missing their Arabic name gets Latin characters in the middle of their own name on an Arabic
  -- contract, forever, because nobody was ever asked for the second form.
  constraint person_name_bilingual_check check (legal_name ? 'en' and legal_name ? 'ar'),
  constraint person_name_preferred_bilingual_check
    check (preferred_name is null or (preferred_name ? 'en' and preferred_name ? 'ar')),
  constraint person_name_period_check check (effective_to is null or effective_to > effective_from)
);

-- At most one *open* name period per person. Two would be two answers to "what is this person
-- called", which is the state the whole timeline design exists to make unrepresentable.
create unique index person_name_open_key on person_name (tenant_id, person_id)
  where effective_to is null and deleted_at is null;
create index person_name_person_idx on person_name (tenant_id, person_id, effective_from);
-- There is deliberately **no index for the name search**, and the reason is worth recording
-- because it is not obvious and it was measured rather than assumed.
--
-- A name search is a substring match (`ilike '%…%'`), which wants a `pg_trgm` index. Four such
-- indexes were built and benchmarked over 50,000 people. Without row-level security the planner
-- uses them and the query runs in 5 ms. **With row-level security in force — which is how this
-- application always runs — the planner will not use them at all**, and falls back to a
-- sequential scan: `ilike` is not a leakproof operator, so PostgreSQL refuses to evaluate it as
-- an index condition ahead of the security qual, because doing so could disclose rows the policy
-- would have hidden. That is the database protecting tenant isolation, and it is the right
-- trade.
--
-- Four GIN indexes that the application can never use are pure write amplification on every name
-- change, so they are not shipped. The measured cost of the scan is 90 ms at 50,000 people,
-- inside the < 500 ms search budget, and the answer when it stops being is the Phase 20
-- projection store rather than an index the planner declines to read. See the Phase 4 report.

-- ---------------------------------------------------------------------------------------------
-- Government and business identifiers.
-- ---------------------------------------------------------------------------------------------
create table person_identifier (
  id              uuid primary key default app_uuid_v7(),
  tenant_id       uuid not null,
  person_id       uuid not null,
  -- A code the tenant or a country pack supplies. Which documents exist and which are required is
  -- one country's law, and 00B is explicit that identity document types are country-pack content.
  identifier_type varchar(64) not null,
  value           varchar(64) not null,
  match_key       varchar(128) not null,
  issuing_country char(2),
  issued_on       date,
  expires_on      date,
  is_primary      boolean not null default false,
  withdrawn_at    timestamptz(6),
  created_at      timestamptz(6) not null,
  created_by      varchar(255) not null,
  updated_at      timestamptz(6) not null,
  updated_by      varchar(255) not null,
  deleted_at      timestamptz(6),
  deleted_by      varchar(255),
  version         integer not null,
  constraint person_identifier_person_fk foreign key (person_id) references person (id),
  constraint person_identifier_country_check
    check (issuing_country is null or issuing_country ~ '^[A-Z]{2}$'),
  constraint person_identifier_dates_check
    check (issued_on is null or expires_on is null or expires_on >= issued_on)
);

-- One live document per digest per tenant. This is the constraint AD-001 rests on: two people in
-- one customer holding one national identifier is the duplicate this product exists to prevent.
-- Scoped to the tenant deliberately — two customers may legitimately employ the same human being,
-- and a global constraint would leak the fact that they do.
create unique index person_identifier_live_key
  on person_identifier (tenant_id, match_key)
  where withdrawn_at is null and deleted_at is null;
create index person_identifier_person_idx on person_identifier (tenant_id, person_id);
-- Expiry sweeps: a residency permit lapsing is somebody's right to work lapsing. Phase 4.1 owns
-- the reminders; the index they will need is created with the table rather than bolted on later.
create index person_identifier_expiry_idx on person_identifier (tenant_id, expires_on);

-- ---------------------------------------------------------------------------------------------
-- Nationalities. A row rather than a column, because dual nationality is ordinary and a single
-- column forces somebody to choose which of their citizenships the system may know about.
-- ---------------------------------------------------------------------------------------------
create table person_nationality (
  id           uuid primary key default app_uuid_v7(),
  tenant_id    uuid not null,
  person_id    uuid not null,
  country_code char(2) not null,
  is_primary   boolean not null default false,
  acquired_on  date,
  withdrawn_at timestamptz(6),
  created_at   timestamptz(6) not null,
  created_by   varchar(255) not null,
  updated_at   timestamptz(6) not null,
  updated_by   varchar(255) not null,
  deleted_at   timestamptz(6),
  deleted_by   varchar(255),
  version      integer not null,
  constraint person_nationality_person_fk foreign key (person_id) references person (id),
  -- A shape, never a list. Selling into a new market is configuration, not a schema change (00B).
  constraint person_nationality_country_check check (country_code ~ '^[A-Z]{2}$')
);

create unique index person_nationality_held_key
  on person_nationality (tenant_id, person_id, country_code)
  where withdrawn_at is null and deleted_at is null;
create index person_nationality_person_idx on person_nationality (tenant_id, person_id);

-- ---------------------------------------------------------------------------------------------
-- Contact points.
-- ---------------------------------------------------------------------------------------------
create table person_contact (
  id             uuid primary key default app_uuid_v7(),
  tenant_id      uuid not null,
  person_id      uuid not null,
  channel        varchar(32) not null,
  purpose        varchar(32) not null,
  value          varchar(320) not null,
  display_value  varchar(320) not null,
  is_primary     boolean not null default false,
  effective_from timestamptz(6) not null,
  effective_to   timestamptz(6),
  created_at     timestamptz(6) not null,
  created_by     varchar(255) not null,
  updated_at     timestamptz(6) not null,
  updated_by     varchar(255) not null,
  deleted_at     timestamptz(6),
  deleted_by     varchar(255),
  version        integer not null,
  constraint person_contact_person_fk foreign key (person_id) references person (id),
  constraint person_contact_channel_check
    check (channel in ('email', 'mobile', 'phone', 'fax', 'messaging')),
  constraint person_contact_purpose_check check (purpose in ('personal', 'work', 'emergency')),
  constraint person_contact_period_check
    check (effective_to is null or effective_to > effective_from)
);

-- The *slot* is the channel and the purpose together: a personal mobile and a work email are two
-- timelines, and recording a new work email must not close somebody's mobile number.
create unique index person_contact_open_key
  on person_contact (tenant_id, person_id, channel, purpose)
  where effective_to is null and deleted_at is null;
create index person_contact_person_idx on person_contact (tenant_id, person_id);
-- The second duplicate signal: who else holds this normalized value.
create index person_contact_value_idx on person_contact (tenant_id, value);

-- ---------------------------------------------------------------------------------------------
-- Addresses.
--
-- No country's format is assumed. There is no `state`, no `county`, no five-digit postal pattern
-- and no required ordering of the lines, because an address that fits one country's form does not
-- fit another's — and 00B forbids a country being wired into a business module. Validating a
-- postal code against a country's pattern is country-pack content (Phase 11.1).
-- ---------------------------------------------------------------------------------------------
create table person_address (
  id             uuid primary key default app_uuid_v7(),
  tenant_id      uuid not null,
  person_id      uuid not null,
  kind           varchar(32) not null,
  lines          jsonb not null,
  city           jsonb not null,
  region         jsonb,
  postal_code    varchar(16),
  country_code   char(2) not null,
  effective_from timestamptz(6) not null,
  effective_to   timestamptz(6),
  created_at     timestamptz(6) not null,
  created_by     varchar(255) not null,
  updated_at     timestamptz(6) not null,
  updated_by     varchar(255) not null,
  deleted_at     timestamptz(6),
  deleted_by     varchar(255),
  version        integer not null,
  constraint person_address_person_fk foreign key (person_id) references person (id),
  constraint person_address_kind_check
    check (kind in ('residential', 'mailing', 'national', 'other')),
  constraint person_address_country_check check (country_code ~ '^[A-Z]{2}$'),
  constraint person_address_lines_check check (jsonb_array_length(lines) between 1 and 8),
  constraint person_address_city_bilingual_check check (city ? 'en' and city ? 'ar'),
  constraint person_address_period_check
    check (effective_to is null or effective_to > effective_from)
);

create unique index person_address_open_key on person_address (tenant_id, person_id, kind)
  where effective_to is null and deleted_at is null;
create index person_address_person_idx on person_address (tenant_id, person_id, kind);

-- ---------------------------------------------------------------------------------------------
-- Emergency contacts.
-- ---------------------------------------------------------------------------------------------
create table person_emergency_contact (
  id                  uuid primary key default app_uuid_v7(),
  tenant_id           uuid not null,
  person_id           uuid not null,
  name                jsonb not null,
  relationship_code   varchar(64) not null,
  telephone           varchar(32) not null,
  alternate_telephone varchar(32),
  email               varchar(320),
  priority            integer not null default 1,
  effective_from      timestamptz(6) not null,
  effective_to        timestamptz(6),
  created_at          timestamptz(6) not null,
  created_by          varchar(255) not null,
  updated_at          timestamptz(6) not null,
  updated_by          varchar(255) not null,
  deleted_at          timestamptz(6),
  deleted_by          varchar(255),
  version             integer not null,
  constraint person_emergency_contact_person_fk foreign key (person_id) references person (id),
  constraint person_emergency_contact_name_bilingual_check check (name ? 'en' and name ? 'ar'),
  constraint person_emergency_contact_priority_check check (priority between 1 and 20),
  constraint person_emergency_contact_period_check
    check (effective_to is null or effective_to > effective_from)
);

create unique index person_emergency_contact_open_key
  on person_emergency_contact (tenant_id, person_id, priority)
  where effective_to is null and deleted_at is null;
create index person_emergency_contact_person_idx
  on person_emergency_contact (tenant_id, person_id, priority);

-- ---------------------------------------------------------------------------------------------
-- Preferences.
-- ---------------------------------------------------------------------------------------------
create table person_preference (
  id             uuid primary key default app_uuid_v7(),
  tenant_id      uuid not null,
  person_id      uuid not null,
  preference_key varchar(64) not null,
  value          varchar(1024) not null,
  effective_from timestamptz(6) not null,
  effective_to   timestamptz(6),
  created_at     timestamptz(6) not null,
  created_by     varchar(255) not null,
  updated_at     timestamptz(6) not null,
  updated_by     varchar(255) not null,
  deleted_at     timestamptz(6),
  deleted_by     varchar(255),
  version        integer not null,
  constraint person_preference_person_fk foreign key (person_id) references person (id),
  constraint person_preference_period_check
    check (effective_to is null or effective_to > effective_from)
);

create unique index person_preference_open_key
  on person_preference (tenant_id, person_id, preference_key)
  where effective_to is null and deleted_at is null;
create index person_preference_person_idx
  on person_preference (tenant_id, person_id, preference_key);

-- ---------------------------------------------------------------------------------------------
-- Capabilities: languages and skills. Self-declared claims, not assessments.
-- ---------------------------------------------------------------------------------------------
create table person_capability (
  id                  uuid primary key default app_uuid_v7(),
  tenant_id           uuid not null,
  person_id           uuid not null,
  kind                varchar(16) not null,
  capability_code     varchar(64) not null,
  title               jsonb,
  level               varchar(32) not null,
  years_of_experience numeric(4, 1),
  last_used_on        date,
  withdrawn_at        timestamptz(6),
  created_at          timestamptz(6) not null,
  created_by          varchar(255) not null,
  updated_at          timestamptz(6) not null,
  updated_by          varchar(255) not null,
  deleted_at          timestamptz(6),
  deleted_by          varchar(255),
  version             integer not null,
  constraint person_capability_person_fk foreign key (person_id) references person (id),
  constraint person_capability_kind_check check (kind in ('language', 'skill')),
  -- A skill carries a name in both languages; a language tag needs none, because the tag renders
  -- from the reader's own locale data rather than from a table the customer maintains.
  -- A `case` rather than a disjunction, because a check constraint **passes** when its result is
  -- NULL. `kind = 'skill' and title ? 'en'` is NULL for a skill with no title at all, so the
  -- obvious spelling of this rule silently admits exactly the row it exists to refuse. The
  -- integration suite caught it.
  constraint person_capability_title_check
    check (
      case kind
        when 'language' then title is null
        when 'skill' then title is not null and title ? 'en' and title ? 'ar'
        else false
      end
    ),
  constraint person_capability_years_check
    check (years_of_experience is null or years_of_experience between 0 and 80)
);

create index person_capability_person_idx on person_capability (tenant_id, person_id);
-- Skills search, which is what a resourcing manager actually runs.
create index person_capability_code_idx on person_capability (tenant_id, kind, capability_code);

-- ---------------------------------------------------------------------------------------------
-- Education, experience elsewhere, and certifications.
-- ---------------------------------------------------------------------------------------------
create table person_history (
  id                uuid primary key default app_uuid_v7(),
  tenant_id         uuid not null,
  person_id         uuid not null,
  kind              varchar(16) not null,
  organization_name jsonb not null,
  title             jsonb not null,
  field_of_study    jsonb,
  country_code      char(2),
  from_date         date not null,
  to_date           date,
  expires_on        date,
  reference         varchar(128),
  withdrawn_at      timestamptz(6),
  created_at        timestamptz(6) not null,
  created_by        varchar(255) not null,
  updated_at        timestamptz(6) not null,
  updated_by        varchar(255) not null,
  deleted_at        timestamptz(6),
  deleted_by        varchar(255),
  version           integer not null,
  constraint person_history_person_fk foreign key (person_id) references person (id),
  constraint person_history_kind_check check (kind in ('education', 'experience', 'certification')),
  constraint person_history_names_bilingual_check
    check (organization_name ? 'en' and organization_name ? 'ar' and title ? 'en' and title ? 'ar'),
  constraint person_history_country_check
    check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  constraint person_history_period_check check (to_date is null or to_date >= from_date),
  -- Only a certification lapses. "Expired" is a meaningful state for a licence and a meaningless
  -- one for a degree.
  constraint person_history_expiry_check
    check (expires_on is null or kind = 'certification'),
  constraint person_history_field_check
    check (field_of_study is null or kind = 'education')
);

create index person_history_person_idx on person_history (tenant_id, person_id, kind);
create index person_history_expiry_idx on person_history (tenant_id, expires_on);

-- ---------------------------------------------------------------------------------------------
-- Tags and notes.
-- ---------------------------------------------------------------------------------------------
create table person_tag (
  id           uuid primary key default app_uuid_v7(),
  tenant_id    uuid not null,
  person_id    uuid not null,
  tag_code     varchar(64) not null,
  withdrawn_at timestamptz(6),
  created_at   timestamptz(6) not null,
  created_by   varchar(255) not null,
  updated_at   timestamptz(6) not null,
  updated_by   varchar(255) not null,
  deleted_at   timestamptz(6),
  deleted_by   varchar(255),
  version      integer not null,
  constraint person_tag_person_fk foreign key (person_id) references person (id)
);

create unique index person_tag_applied_key on person_tag (tenant_id, person_id, lower(tag_code))
  where withdrawn_at is null and deleted_at is null;
create index person_tag_code_idx on person_tag (tenant_id, tag_code);
create index person_tag_person_idx on person_tag (tenant_id, person_id);

create table person_note (
  id            uuid primary key default app_uuid_v7(),
  tenant_id     uuid not null,
  person_id     uuid not null,
  category_code varchar(64) not null,
  body          text not null,
  authored_by   varchar(255) not null,
  authored_at   timestamptz(6) not null,
  withdrawn_at  timestamptz(6),
  created_at    timestamptz(6) not null,
  created_by    varchar(255) not null,
  updated_at    timestamptz(6) not null,
  updated_by    varchar(255) not null,
  deleted_at    timestamptz(6),
  deleted_by    varchar(255),
  version       integer not null,
  constraint person_note_person_fk foreign key (person_id) references person (id),
  constraint person_note_body_check check (length(body) between 1 and 8192)
);

create index person_note_person_idx on person_note (tenant_id, person_id, authored_at);

-- ---------------------------------------------------------------------------------------------
-- Suspected duplicates awaiting review.
-- ---------------------------------------------------------------------------------------------
create table person_duplicate_candidate (
  id                     uuid primary key default app_uuid_v7(),
  tenant_id              uuid not null,
  -- The lower of the two identifiers, enforced below, so detecting A against B and later B
  -- against A queues one decision rather than two.
  person_id              uuid not null,
  duplicate_of_person_id uuid not null,
  reason                 varchar(64) not null,
  confidence             integer not null,
  status                 varchar(16) not null,
  reviewed_by            varchar(255),
  reviewed_at            timestamptz(6),
  review_note            varchar(1024),
  created_at             timestamptz(6) not null,
  created_by             varchar(255) not null,
  updated_at             timestamptz(6) not null,
  updated_by             varchar(255) not null,
  deleted_at             timestamptz(6),
  deleted_by             varchar(255),
  version                integer not null,
  constraint person_duplicate_candidate_person_fk foreign key (person_id) references person (id),
  constraint person_duplicate_candidate_other_fk
    foreign key (duplicate_of_person_id) references person (id),
  constraint person_duplicate_candidate_ordered_check check (person_id < duplicate_of_person_id),
  constraint person_duplicate_candidate_status_check
    check (status in ('pending', 'confirmed', 'dismissed')),
  constraint person_duplicate_candidate_confidence_check check (confidence between 0 and 100),
  -- A decided candidate records who decided it and when. Either half alone is a decision nobody
  -- can be held to.
  constraint person_duplicate_candidate_review_check
    check ((status = 'pending') = (reviewed_by is null and reviewed_at is null))
);

create unique index person_duplicate_candidate_pair_key
  on person_duplicate_candidate (tenant_id, person_id, duplicate_of_person_id)
  where deleted_at is null;
create index person_duplicate_candidate_status_idx
  on person_duplicate_candidate (tenant_id, status);

-- ---------------------------------------------------------------------------------------------
-- Row-level security (ADR-0030).
--
-- Every table here carries `tenant_id`, so every one takes the standard policy. There is no
-- exception in this module — `workforce_user` in Phase 2 remains the only tenant-less table in
-- the product (ADR-0033).
-- ---------------------------------------------------------------------------------------------
call app_protect_table('person');
call app_protect_table('person_name');
call app_protect_table('person_identifier');
call app_protect_table('person_nationality');
call app_protect_table('person_contact');
call app_protect_table('person_address');
call app_protect_table('person_emergency_contact');
call app_protect_table('person_preference');
call app_protect_table('person_capability');
call app_protect_table('person_history');
call app_protect_table('person_tag');
call app_protect_table('person_note');
call app_protect_table('person_duplicate_candidate');

comment on table person is
  'One permanent human identity. Holds no employment, no assignment and no organizational placement: Employment references Person, and Person never references Employment (AD-002).';
comment on table person_name is
  'What a person was called, and from when. A legal name has a history and a contract is signed on a date, so this is a timeline rather than a column (ADR-0037).';
comment on column person_identifier.match_key is
  'The keyed digest duplicate detection compares. A national identifier space is small enough to enumerate, so this is an HMAC rather than a plain hash — finding who holds a number never reads one.';
comment on table person_note is
  'Free text an administrator wrote about somebody. Never amended and never deleted: a note that could be edited after the fact cannot be relied on in a disciplinary case.';
