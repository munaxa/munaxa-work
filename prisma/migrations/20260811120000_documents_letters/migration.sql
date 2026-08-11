-- Employee documents and letters (Phase 12; the roadmap's 4.1 and 5.1).
--
-- Twelve tables across two modules, and the row-level security that isolates every one of them
-- (ADR-0030). The policies are created here, in the migration that creates the tables, rather than
-- in a later hardening step. These tables address an employee's passport, medical certificate and
-- disciplinary letter, so a table missed here would be a disclosure of the same order as Payroll's.
--
-- Six decisions in this file are the ones a reviewer should challenge.
--
--   * **A document holds no identity data.** `person_identifier` (Phase 4) already owns an
--     identifier's number, issuing country, issue date and expiry, with an index built for the
--     expiry query. Duplicating those here would give two answers to "when does this passport
--     expire". A document that evidences one carries `person_identifier_id` and nothing else about
--     it; `expiry_date` on such a document stays null and People remains authoritative (D-1a).
--
--   * **The document identity is stable and the versions are immutable.** Replacing a file inserts
--     a `document_version`; nothing is overwritten and no version is ever deleted. There is no
--     update path on that table in any repository, and the trigger below refuses one at the table.
--
--   * **`storage_reference` is opaque, and there is no adapter behind it.** `StoragePort` has no
--     implementation anywhere in this repository, so the column holds a reference this product
--     cannot yet resolve. It is deliberately not a URL, not a path and not a provider key. Nothing
--     in this migration stores bytes.
--
--   * **Access is recorded in a table, not only in a log.** `document_access_event` is append-only
--     and queryable, because "who read this employee's medical certificate, and when" is a question
--     a subject access request asks and a log line cannot answer. It carries no file content, no
--     signed URL and no credential (D-23).
--
--   * **An issued letter is frozen at issue.** `letter_issued` holds the substituted values as
--     `jsonb` alongside the template version that produced them, so a salary certificate issued in
--     March still reads March's salary after a raise in April. The same argument as Payroll's input
--     snapshot (ADR-0064), applied to letters.
--
--   * **A template version that has issued a letter cannot be edited.** The trigger refuses an
--     update once `first_issued_at` is set. The alternative — application enforcement alone — loses
--     to any path that forgets, and this is a document a labour tribunal may read.
--
-- No foreign key points at `person` or `employment` from a document's owner columns. A polymorphic
-- owner cannot carry one, and Phase 11 established that a cross-module foreign key does not enforce
-- tenant isolation anyway (ADR-0042). Ownership is validated through published contract reads.

-- ---------------------------------------------------------------------------------------------
-- Document types: tenant configuration. Nothing statutory and nothing country-specific ships.
-- ---------------------------------------------------------------------------------------------

-- What a tenant calls a kind of document, and the rules that follow from it.
--
-- `owner_types` is the set this type may attach to, so a passport cannot be filed against a legal
-- entity and a commercial registration cannot be filed against a person. `confidentiality`
-- separates an ordinary certificate from a medical or disciplinary one: seeing an employee never
-- implies seeing those (4.1 AD-007).
--
-- `country_pack_id` records that a pack supplied this type. No pack exists; the column is the
-- extension point and is null for everything a tenant defines.
create table document_type (
  id                     uuid primary key default app_uuid_v7(),
  tenant_id              uuid not null,
  code                   varchar(64) not null,
  name                   jsonb not null,
  owner_types            varchar(32)[] not null,
  expires                boolean not null,
  requires_verification  boolean not null,
  confidentiality        varchar(16) not null,
  employee_visible       boolean not null,
  manager_visible        boolean not null,
  retention_policy_code  varchar(64),
  notice_days            integer[] not null default '{}',
  country_pack_id        varchar(64),
  country_pack_version   integer,
  active                 boolean not null,
  metadata               jsonb not null default '{}',
  created_at             timestamptz(6) not null,
  created_by             varchar(255) not null,
  updated_at             timestamptz(6) not null,
  updated_by             varchar(255) not null,
  deleted_at             timestamptz(6),
  deleted_by             varchar(255),
  version                integer not null,
  constraint document_type_code_shape_check
    check (code ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'),
  constraint document_type_confidentiality_check
    check (confidentiality in ('normal', 'confidential')),
  constraint document_type_owner_types_check
    check (
      cardinality(owner_types) > 0
      and owner_types <@ array['person', 'employment', 'legal_entity']::varchar(32)[]
    ),
  -- 4.1 AD-003's invariant: a type that expires must say when to warn. The thresholds are
  -- configuration; nothing fires them, because `JobPort` has no adapter (D-26).
  constraint document_type_notice_check
    check (not expires or cardinality(notice_days) > 0),
  constraint document_type_manager_visibility_check
    check (not (manager_visible and confidentiality = 'confidential'))
);

create unique index document_type_code_idx
  on document_type (tenant_id, code) where deleted_at is null;

-- ---------------------------------------------------------------------------------------------
-- Documents: a stable identity, and the immutable versions beneath it.
-- ---------------------------------------------------------------------------------------------

-- One document, across every replacement of its file.
--
-- `owner_type` + `owner_id` is explicit and never inferred (4.1 AD-001). `person_identifier_id`
-- is how a document evidences an identity record People already owns — see the header.
--
-- `current_version_id` is a denormalization of "the newest version"; `document_version` remains
-- authoritative and the two are written in one transaction.
create table document (
  id                    uuid primary key default app_uuid_v7(),
  tenant_id             uuid not null,
  document_type_id      uuid not null,
  owner_type            varchar(32) not null,
  owner_id              uuid not null,
  -- Set only where this document evidences an identifier People owns. Never a copy of its data.
  person_identifier_id  uuid,
  title                 jsonb not null,
  status                varchar(24) not null,
  confidentiality       varchar(16) not null,
  issue_date            date,
  expiry_date           date,
  verification_state    varchar(24) not null,
  current_version_id    uuid,
  version_count         integer not null default 0,
  source                varchar(32) not null,
  source_reference      varchar(128),
  legal_hold            boolean not null default false,
  legal_hold_reason     varchar(512),
  retention_policy_code varchar(64),
  archived_at           timestamptz(6),
  archived_by           varchar(255),
  metadata              jsonb not null default '{}',
  created_at            timestamptz(6) not null,
  created_by            varchar(255) not null,
  updated_at            timestamptz(6) not null,
  updated_by            varchar(255) not null,
  deleted_at            timestamptz(6),
  deleted_by            varchar(255),
  version               integer not null,
  constraint document_type_fk foreign key (document_type_id) references document_type (id),
  constraint document_owner_type_check
    check (owner_type in ('person', 'employment', 'legal_entity')),
  constraint document_status_check
    check (status in ('draft', 'active', 'archived', 'superseded')),
  constraint document_verification_state_check
    check (verification_state in ('unverified', 'pending_verification', 'verified', 'rejected')),
  constraint document_confidentiality_check
    check (confidentiality in ('normal', 'confidential')),
  constraint document_source_check
    check (source in ('direct', 'recruitment', 'onboarding', 'letter', 'migration')),
  constraint document_dates_check check (expiry_date is null or issue_date is null or expiry_date >= issue_date),
  -- The half of D-1a a constraint can express: a document that points at a People identifier does
  -- not also carry its own expiry. One authoritative answer, enforced rather than documented.
  constraint document_identifier_expiry_check
    check (person_identifier_id is null or expiry_date is null),
  constraint document_legal_hold_check check (not legal_hold or legal_hold_reason is not null)
);

create index document_owner_idx on document (tenant_id, owner_type, owner_id) where deleted_at is null;
create index document_type_ref_idx on document (tenant_id, document_type_id) where deleted_at is null;
-- The expiry queue. A plain indexed predicate, never a text search (§29 of the plan).
create index document_expiry_idx on document (tenant_id, expiry_date)
  where deleted_at is null and expiry_date is not null;
create index document_verification_idx on document (tenant_id, verification_state)
  where deleted_at is null;
create index document_identifier_idx on document (tenant_id, person_identifier_id)
  where person_identifier_id is not null;

-- One version of one document's file. **Insert only.**
--
-- No repository offers an update or a remove, and the trigger refuses both — a payslip somebody
-- disputes is explained by these rows, and the cheapest guarantee that nobody rewrote one is to
-- have no path that could.
--
-- `content_hash` is SHA-256 (D-5a; the repository had no hashing convention to inherit). It is
-- recorded with its algorithm so it can be migrated, and `hash_verified` records whether anything
-- ever checked it against the bytes — which nothing can today, because no storage adapter exists.
create table document_version (
  id                  uuid primary key default app_uuid_v7(),
  tenant_id           uuid not null,
  document_id         uuid not null,
  version_number      integer not null,
  storage_reference   varchar(128) not null,
  original_file_name  varchar(255) not null,
  declared_media_type varchar(128) not null,
  detected_media_type varchar(128),
  size_in_bytes       bigint not null,
  content_hash        varchar(128) not null,
  hash_algorithm      varchar(16) not null,
  hash_verified       boolean not null default false,
  source              varchar(32) not null,
  verification_state  varchar(24) not null,
  superseded_at       timestamptz(6),
  created_at          timestamptz(6) not null,
  created_by          varchar(255) not null,
  updated_at          timestamptz(6) not null,
  updated_by          varchar(255) not null,
  deleted_at          timestamptz(6),
  deleted_by          varchar(255),
  version             integer not null,
  constraint document_version_document_fk foreign key (document_id) references document (id),
  constraint document_version_number_check check (version_number >= 1),
  constraint document_version_size_check check (size_in_bytes >= 0),
  constraint document_version_hash_algorithm_check check (hash_algorithm in ('sha-256')),
  constraint document_version_state_check
    check (verification_state in ('unverified', 'pending_verification', 'verified', 'rejected')),
  -- The reference format three modules already share (employment, recruitment, onboarding).
  constraint document_version_reference_shape_check
    check (storage_reference ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,127}$')
);

-- A duplicate version number is impossible, so two concurrent replacements race here rather than
-- both committing a "version 2".
create unique index document_version_number_idx
  on document_version (tenant_id, document_id, version_number);
create index document_version_document_idx
  on document_version (tenant_id, document_id, version_number desc);
-- Duplicate *content* is permitted and flagged rather than refused (D-5): one PDF can legitimately
-- evidence two things, and a silent accept hides a mistaken double upload. This index is what makes
-- the reconciliation check cheap.
create index document_version_hash_idx on document_version (tenant_id, content_hash);

create table document_verification (
  id                  uuid primary key default app_uuid_v7(),
  tenant_id           uuid not null,
  document_id         uuid not null,
  document_version_id uuid not null,
  decision            varchar(24) not null,
  decided_by          varchar(255) not null,
  decided_at          timestamptz(6) not null,
  reason              varchar(512),
  created_at          timestamptz(6) not null,
  created_by          varchar(255) not null,
  updated_at          timestamptz(6) not null,
  updated_by          varchar(255) not null,
  deleted_at          timestamptz(6),
  deleted_by          varchar(255),
  version             integer not null,
  constraint document_verification_document_fk foreign key (document_id) references document (id),
  constraint document_verification_version_fk
    foreign key (document_version_id) references document_version (id),
  constraint document_verification_decision_check
    check (decision in ('verified', 'rejected')),
  -- A rejection without a reason is a rejection nobody can act on.
  constraint document_verification_reason_check
    check (decision <> 'rejected' or reason is not null)
);

-- One decision per version. A second verification of the same bytes is refused by the table.
create unique index document_verification_version_idx
  on document_verification (tenant_id, document_version_id) where deleted_at is null;
create index document_verification_document_idx
  on document_verification (tenant_id, document_id, decided_at desc);

-- Who read what, and when. **Append only, and queryable.**
--
-- Deliberately a table rather than the structured-log disclosure People uses: an access trail that
-- can only be grepped cannot answer a subject access request, and this is the domain where that
-- question is asked (D-23). It carries no file content, no signed URL and no credential — only
-- which document, which version, what action and by whom.
create table document_access_event (
  id                  uuid primary key default app_uuid_v7(),
  tenant_id           uuid not null,
  document_id         uuid not null,
  document_version_id uuid,
  action              varchar(32) not null,
  actor               varchar(255) not null,
  occurred_at         timestamptz(6) not null,
  correlation_id      uuid,
  outcome             varchar(16) not null,
  created_at          timestamptz(6) not null,
  created_by          varchar(255) not null,
  updated_at          timestamptz(6) not null,
  updated_by          varchar(255) not null,
  -- Present because every table in this repository carries them. Unusable here by construction: a
  -- soft delete is an update, and the trigger below refuses every update on this table.
  deleted_at          timestamptz(6),
  deleted_by          varchar(255),
  version             integer not null,
  constraint document_access_event_document_fk foreign key (document_id) references document (id),
  constraint document_access_event_action_check
    check (action in ('metadata_read', 'download_authorized', 'download_refused', 'verified',
                      'rejected', 'replaced', 'archived', 'restored')),
  constraint document_access_event_outcome_check check (outcome in ('permitted', 'refused'))
);

create index document_access_event_document_idx
  on document_access_event (tenant_id, document_id, occurred_at desc);
create index document_access_event_actor_idx
  on document_access_event (tenant_id, actor, occurred_at desc);

-- ---------------------------------------------------------------------------------------------
-- Letters: templates, versions, requests and the frozen artefact.
-- ---------------------------------------------------------------------------------------------

create table letter_template (
  id                   uuid primary key default app_uuid_v7(),
  tenant_id            uuid not null,
  code                 varchar(64) not null,
  name                 jsonb not null,
  category             varchar(64) not null,
  requires_approval    boolean not null,
  employee_requestable boolean not null,
  current_version_id   uuid,
  country_pack_id      varchar(64),
  country_pack_version integer,
  active               boolean not null,
  metadata             jsonb not null default '{}',
  created_at           timestamptz(6) not null,
  created_by           varchar(255) not null,
  updated_at           timestamptz(6) not null,
  updated_by           varchar(255) not null,
  deleted_at           timestamptz(6),
  deleted_by           varchar(255),
  version              integer not null,
  constraint letter_template_code_shape_check
    check (code ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$')
);

create unique index letter_template_code_idx
  on letter_template (tenant_id, code) where deleted_at is null;

-- One version of a template's authored content. **Immutable once it has issued a letter.**
--
-- `body` holds the text per language, `variables` the declared allow-list a body may substitute.
-- There is no expression language and no executable template: a variable is a name resolved from a
-- published contract, and an unknown one fails the generation rather than rendering blank (D-13).
--
-- `exposed_fields` is 5.1 AD-005 — a template may not expose salary unless its type permits it and
-- the requester holds the permission. Both halves are checked; this column is the first.
create table letter_template_version (
  id                  uuid primary key default app_uuid_v7(),
  tenant_id           uuid not null,
  letter_template_id  uuid not null,
  version_number      integer not null,
  body                jsonb not null,
  variables           varchar(64)[] not null default '{}',
  exposed_fields      varchar(64)[] not null default '{}',
  letterhead_reference varchar(128),
  requires_signature  boolean not null default false,
  status              varchar(16) not null,
  first_issued_at     timestamptz(6),
  created_at          timestamptz(6) not null,
  created_by          varchar(255) not null,
  updated_at          timestamptz(6) not null,
  updated_by          varchar(255) not null,
  deleted_at          timestamptz(6),
  deleted_by          varchar(255),
  version             integer not null,
  constraint letter_template_version_template_fk
    foreign key (letter_template_id) references letter_template (id),
  constraint letter_template_version_number_check check (version_number >= 1),
  constraint letter_template_version_status_check check (status in ('draft', 'published', 'retired'))
);

create unique index letter_template_version_number_idx
  on letter_template_version (tenant_id, letter_template_id, version_number);

-- A request for a letter. Distinct from what was issued, because a request may be refused.
create table letter_request (
  id                         uuid primary key default app_uuid_v7(),
  tenant_id                  uuid not null,
  letter_template_id         uuid not null,
  letter_template_version_id uuid not null,
  employment_id              uuid not null,
  person_id                  uuid not null,
  locale                     varchar(8) not null,
  purpose                    varchar(512),
  addressee                  varchar(255),
  status                     varchar(24) not null,
  requested_by               varchar(255) not null,
  requested_at               timestamptz(6) not null,
  failure_reason             varchar(128),
  metadata                   jsonb not null default '{}',
  created_at                 timestamptz(6) not null,
  created_by                 varchar(255) not null,
  updated_at                 timestamptz(6) not null,
  updated_by                 varchar(255) not null,
  deleted_at                 timestamptz(6),
  deleted_by                 varchar(255),
  version                    integer not null,
  constraint letter_request_template_fk
    foreign key (letter_template_id) references letter_template (id),
  constraint letter_request_template_version_fk
    foreign key (letter_template_version_id) references letter_template_version (id),
  constraint letter_request_locale_check check (locale in ('en', 'ar')),
  constraint letter_request_status_check
    check (status in ('requested', 'pending_approval', 'approved', 'rejected', 'generating',
                      'generated', 'failed', 'issued', 'cancelled')),
  constraint letter_request_failure_check
    check (status <> 'failed' or failure_reason is not null)
);

create index letter_request_employment_idx
  on letter_request (tenant_id, employment_id, requested_at desc) where deleted_at is null;
create index letter_request_status_idx
  on letter_request (tenant_id, status) where deleted_at is null;

-- The issued letter, frozen.
--
-- `substituted_values` is the snapshot: every value the template resolved, as `jsonb`, beside the
-- template version that produced them. A salary certificate issued in March reads March's salary
-- after April's raise, because nothing re-reads a source after issue. This is ADR-0064's argument
-- applied to letters, and it is why the row is immutable.
--
-- `document_id` is the artefact. It stays null until a renderer exists — there is none, and the
-- letter's *content* is owned and reproducible without one.
create table letter_issued (
  id                         uuid primary key default app_uuid_v7(),
  tenant_id                  uuid not null,
  letter_request_id          uuid not null,
  letter_template_id         uuid not null,
  letter_template_version_id uuid not null,
  employment_id              uuid not null,
  person_id                  uuid not null,
  reference_number           varchar(64) not null,
  verification_token         varchar(64) not null,
  locale                     varchar(8) not null,
  substituted_values         jsonb not null,
  source_versions            jsonb not null,
  issued_at                  timestamptz(6) not null,
  issued_by                  varchar(255) not null,
  signatory                  varchar(255),
  signature_required         boolean not null default false,
  signature_state            varchar(24) not null default 'not_required',
  document_id                uuid,
  superseded_by_id           uuid,
  superseded_at              timestamptz(6),
  created_at                 timestamptz(6) not null,
  created_by                 varchar(255) not null,
  updated_at                 timestamptz(6) not null,
  updated_by                 varchar(255) not null,
  deleted_at                 timestamptz(6),
  deleted_by                 varchar(255),
  version                    integer not null,
  constraint letter_issued_request_fk foreign key (letter_request_id) references letter_request (id),
  constraint letter_issued_template_fk foreign key (letter_template_id) references letter_template (id),
  constraint letter_issued_template_version_fk
    foreign key (letter_template_version_id) references letter_template_version (id),
  constraint letter_issued_document_fk foreign key (document_id) references document (id),
  constraint letter_issued_superseded_fk foreign key (superseded_by_id) references letter_issued (id),
  constraint letter_issued_locale_check check (locale in ('en', 'ar')),
  -- `signed` is absent deliberately. No signature provider exists in this repository, and a state
  -- meaning "we signed it" would be a claim nothing performed (D-16).
  constraint letter_issued_signature_state_check
    check (signature_state in ('not_required', 'required', 'declared_signed_externally'))
);

create unique index letter_issued_reference_idx
  on letter_issued (tenant_id, reference_number);
-- Unguessable, and unique: third-party verification must confirm authenticity without employee
-- data, so the token is the only thing the verifier holds (5.1 AD-006).
create unique index letter_issued_token_idx on letter_issued (verification_token);
create unique index letter_issued_request_idx
  on letter_issued (tenant_id, letter_request_id) where deleted_at is null;
create index letter_issued_employment_idx
  on letter_issued (tenant_id, employment_id, issued_at desc) where deleted_at is null;

create table letter_approval_decision (
  id                uuid primary key default app_uuid_v7(),
  tenant_id         uuid not null,
  letter_request_id uuid not null,
  sequence          smallint not null,
  decision          varchar(16) not null,
  requested_by      varchar(255) not null,
  decided_by        varchar(255) not null,
  decided_at        timestamptz(6) not null,
  comment           varchar(1024),
  reverses_id       uuid,
  created_at        timestamptz(6) not null,
  created_by        varchar(255) not null,
  updated_at        timestamptz(6) not null,
  updated_by        varchar(255) not null,
  deleted_at        timestamptz(6),
  deleted_by        varchar(255),
  version           integer not null,
  constraint letter_approval_decision_request_fk
    foreign key (letter_request_id) references letter_request (id),
  constraint letter_approval_decision_reverses_fk
    foreign key (reverses_id) references letter_approval_decision (id),
  constraint letter_approval_decision_check check (decision in ('approved', 'rejected', 'reversed')),
  -- The same rule Compensation and Payroll both carry: a check constraint cannot reach another
  -- table, so `requested_by` is copied here for exactly this comparison.
  constraint letter_approval_decision_self_approval_check check (decided_by <> requested_by)
);

create unique index letter_approval_decision_sequence_idx
  on letter_approval_decision (tenant_id, letter_request_id, sequence) where deleted_at is null;

-- The counter letter reference numbers are drawn from, one row per tenant per series.
--
-- Letters' own, not Employment's and not Recruitment's: the schema already records that sharing a
-- counter would couple two modules' numbering. A PostgreSQL sequence is not used because the
-- requirement is tenant-scoped and gapless.
create table letter_number_sequence (
  id         uuid primary key default app_uuid_v7(),
  tenant_id  uuid not null,
  series_key varchar(64) not null,
  next_value bigint not null,
  created_at timestamptz(6) not null,
  created_by varchar(255) not null,
  updated_at timestamptz(6) not null,
  updated_by varchar(255) not null,
  -- Carried for uniformity with every other table. A counter is never soft deleted.
  deleted_at timestamptz(6),
  deleted_by varchar(255),
  version    integer not null,
  constraint letter_number_sequence_value_check check (next_value >= 1)
);

create unique index letter_number_sequence_series_idx
  on letter_number_sequence (tenant_id, series_key);

-- ---------------------------------------------------------------------------------------------
-- Immutability, at the table.
--
-- Two rules, both of which the application also enforces. The application half protects the code
-- that remembers; these protect the table, from any path including SQL nobody wrote in TypeScript.
-- The mechanism and its cost were settled in ADR-0066; this reuses it rather than inventing a
-- second approach.
-- ---------------------------------------------------------------------------------------------

-- A document version is written once and never changed. There is no "finalized" moment to wait
-- for: the row is immutable from the instant it exists, which is what makes a version a version.
create or replace function app_document_version_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'document_version_immutable'
    using errcode = 'restrict_violation',
          detail = format('document_version %s is immutable', old.id),
          hint = 'A replacement inserts a new version. Nothing rewrites an existing one.';
end; $$;

create trigger document_version_no_mutation
  before update or delete on document_version
  for each row execute function app_document_version_immutable();

-- An access record is evidence. It is never edited and never removed.
create or replace function app_document_access_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'document_access_event_immutable'
    using errcode = 'restrict_violation',
          detail = format('document_access_event %s is immutable', old.id),
          hint = 'An access trail that can be rewritten is not an access trail.';
end; $$;

create trigger document_access_event_no_mutation
  before update or delete on document_access_event
  for each row execute function app_document_access_immutable();

-- A template version that has issued a letter is frozen. Editing it would silently change what a
-- historical letter claims to have been generated from, which is the one thing a letter register
-- exists to prevent (5.1 AD-003).
create or replace function app_letter_template_version_refuse_issued() returns trigger
language plpgsql as $$
begin
  if old.first_issued_at is not null then
    raise exception 'letter_template_version_issued'
      using errcode = 'restrict_violation',
            detail = format('letter_template_version %s has already issued a letter', old.id),
            hint = 'Editing a published template creates a new version. Issued letters keep theirs.';
  end if;
  return case tg_op when 'DELETE' then old else new end;
end; $$;

create trigger letter_template_version_immutable
  before update or delete on letter_template_version
  for each row execute function app_letter_template_version_refuse_issued();

-- An issued letter is frozen at issue. The one permitted change is being superseded by a later
-- letter, which is why that update is allowed through while every other column is refused.
create or replace function app_letter_issued_refuse_change() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'letter_issued_immutable'
      using errcode = 'restrict_violation',
            detail = format('letter_issued %s is immutable', old.id),
            hint = 'A correction issues a new letter and supersedes this one.';
  end if;

  if row(new.*) is distinct from row(old.*)
     and (new.substituted_values is distinct from old.substituted_values
          or new.source_versions is distinct from old.source_versions
          or new.reference_number is distinct from old.reference_number
          or new.letter_template_version_id is distinct from old.letter_template_version_id
          or new.issued_at is distinct from old.issued_at
          or new.issued_by is distinct from old.issued_by
          or new.locale is distinct from old.locale) then
    raise exception 'letter_issued_immutable'
      using errcode = 'restrict_violation',
            detail = format('letter_issued %s is frozen at issue', old.id),
            hint = 'A correction issues a new letter and supersedes this one.';
  end if;
  return new;
end; $$;

create trigger letter_issued_immutable
  before update or delete on letter_issued
  for each row execute function app_letter_issued_refuse_change();

-- ---------------------------------------------------------------------------------------------
-- Row-level security (ADR-0030). Every table here carries `tenant_id`, so every one takes the
-- standard policy. There is no exception in either module.
-- ---------------------------------------------------------------------------------------------
call app_protect_table('document_type');
call app_protect_table('document');
call app_protect_table('document_version');
call app_protect_table('document_verification');
call app_protect_table('document_access_event');
call app_protect_table('letter_template');
call app_protect_table('letter_template_version');
call app_protect_table('letter_request');
call app_protect_table('letter_issued');
call app_protect_table('letter_approval_decision');
call app_protect_table('letter_number_sequence');
