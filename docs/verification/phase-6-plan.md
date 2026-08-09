# Phase 6 — Recruitment: Definition of Ready

**Status: planning checkpoint. No code has been changed.** No schema, no migration, no endpoint, no
screen, no refactor of Phases 0–5. The only file this checkpoint adds is this one.

This document is what `07_PHASE_6_RECRUITMENT.md`, `27_DEVELOPMENT_PROTOCOL.md` Step 2 and the
Phase 6 planning instruction require before implementation begins.

**Nine decisions in §30 need an answer before a line is written.** Four of them change the
architecture rather than the feature, and one — the authorization boundary for cross-module reference
checks — was raised by the instruction itself as a correction to how Phase 5 composed.

---

## 1. Repository analysis

Read, not assumed. Everything below was verified against the working tree at `29809a4`.

### Workspace

```text
apps/       api (NestJS 11), admin (Next.js), employee-portal, manager-portal, mobile (Flutter)
packages/   kernel, config, contracts (empty), persistence, sdk (empty), testing,
            country-packs (empty), modules/{identity, organization, people, employment}
prisma/     schema.prisma — 37 models, 5 migrations
scripts/    check-standards, check-architecture, check-localization, check-dependencies
```

`pnpm verify` = standards → format → lint → typecheck → test → build. **866 tests pass today.**

### The four modules that exist

| Module | Owns | Tables | Phase |
| ------ | ---- | ------ | ----- |
| `identity` | Workforce user, tenant membership, invitation, portal access, employment link, delegation | 8 | 2 |
| `organization` | Units of any depth, unit types, placements, legal entities, financial centres, **job positions**, **position establishment**, calendars, tenant settings | 10 | 3 |
| `people` | **Person**, names (effective-dated), identifiers (keyed digest), nationalities, contacts, addresses, emergency contacts, preferences, capabilities, history, tags, notes, **duplicate candidates** | 13 | 4 |
| `employment` | Employment, status history, assignments, reporting lines, contracts, number sequence | 6 | 5 |

### What does **not** exist, and matters to Phase 6

| Missing | Owner | Consequence for Phase 6 |
| ------- | ----- | ----------------------- |
| A workflow / approval engine | `workflow`, Phase 16 | Requisition and offer approval have no router. §12 |
| A document store | `documents`, Phase 4.1 | Résumés and attachments have nowhere to live. §14 |
| A communications engine | `communications`, Phase 17 | No candidate email. §15 |
| A projection / search store | Phase 20 | Free-text search reads transactional tables. §26 |
| Any AI capability | Phase 23 | No parsing, no matching. §16 |
| **Any recruitment model whatsoever** | — | No `candidate`, `requisition`, `vacancy`, `application`, `interview` or `offer` table, type or file exists anywhere in the repository. Verified by grep across `prisma/`, `packages/` and `apps/` |

### The three ports Phase 1 declared for exactly this moment

`packages/kernel/src/ports/` holds `ApprovalPort`, `NotificationPort` and `DocumentPort`, added by
ADR-0024 with the reasoning stated in the file itself:

> Workflow is Phase 16, but Attendance, Leave, Compensation, Payroll **and Recruitment** all need
> approvals long before it exists. Depending on this interface from their first commit means Phase 16
> supplies an adapter and no business module changes.

**No module consumes any of the three today.** Recruitment would be the first — which makes Phase 6
the test of whether ADR-0024 was right, and the place where the in-process adapters' honesty matters
(§12, §30 A-3).

The kernel also declares `StoragePort`, `SearchPort`, `JobPort`, `EmailPort` and `FeatureFlagPort` as
interfaces with no adapters, and ships `AutoApprovingPort` and `RecordingNotificationPort` as the
in-process defaults.

### Conventions Phase 6 must follow, verbatim

Unchanged from Phase 5 and verified again: module-first layout (ADR-0023) with the lint-enforced
layer direction; one shared `Dispatcher` and `ModuleRegistry` assembled in
`apps/api/src/identity/identity.module.ts`; stores as application-owned ports taking the
`Transaction`; aggregates returning accept/refuse rather than throwing; effective dating through the
kernel's `Timeline`; rejections carrying catalogue keys with both catalogues gated; every model
tenant-first with UUIDv7, audit columns, `version` and RLS applied by its own migration; file budgets
of 150 (controller) / 250 (repository) / 300 (use case) / 400 (other), complexity 10, five parameters.

---

## 2. Phase 0–5 compatibility analysis

Recruitment is compatible with everything built, and four seams were left for it by name.

1. **`person.status = 'draft'`.** Phase 4's vocabulary file says, in as many words: *"recorded but not
   yet confirmed as a real human being. Bulk import **and recruitment** both create people before
   anybody has checked them."* Phase 4 anticipated this phase's hire transition and left the state for
   it.
2. **People's duplicate machinery.** `people.search` already matches on a **digested** government
   identifier and a **normalized** contact value, and `people.create-person` already refuses when it
   finds candidates unless the caller acknowledges them, queueing a review. Recruitment does not need
   to build matching — it needs to call this.
3. **`organization.list-positions` and `position_establishment`.** A requisition references a position
   and a unit that Organization owns, and Organization already holds the *budgeted* headcount a
   requisition consumes against.
4. **Employment's `create-employment`.** The command a future Onboarding phase will send. Recruitment
   must not send it (AD-003).

### Constraints inherited that shape the design

- **A person's legal name is a join, not a column** (ADR-0037). A candidate who becomes a Person gets
  their name written to `person_name`, and Recruitment resolves names for screens through People's
  query — never by caching one.
- **A person is created once** (Phase 4 AD-001). Every path that could create a second one is the risk
  this phase manages.
- **Country comes from the legal entity** (ADR-0035), reached through a unit. A requisition's unit
  therefore already determines the country a future country pack would apply — Recruitment needs no
  country field.
- **`employment.person_id` is the only cross-module foreign key** (ADR-0042), and Organization
  publishes no single-entity read for a position or a cost centre. Recruitment inherits that gap.
- **Nothing authenticates.** Every business endpoint returns 401 until Platform's adapter lands. Fifth
  phase carrying this; Recruitment will be the sixth.
- **`pnpm test` runs package tasks serially** because suites share one database. A sixth module's
  integration suite makes that slower, not less correct.

### One finding, recorded rather than acted on

`PostgresUnitOfWork.execute` **takes a fresh connection and opens a new transaction every time**. A
handler that reaches another module through the dispatcher therefore runs that module's work in a
*second, independent transaction* while holding its own. That is already true of Phase 5's reference
checks (reads, so harmless beyond pool pressure), and it is the central problem for Phase 6's hire
transition, which is a **write** in another module. §13 and §30 A-4.

---

## 3. Platform contract analysis

Consumed, never rebuilt:

| Capability | Source | Phase 6's use |
| ---------- | ------ | ------------- |
| Authentication | `PlatformAuthenticationPort` (kernel), `UnauthenticatedPort` default | Untouched |
| Authorization | `PlatformPermissionChecker` + the CQRS pipeline | Recruitment declares permissions; Platform decides who holds them |
| Tenant context | `tenant_membership` → `TenantMembershipDirectory` → `runInContext` (ADR-0032) | Recruitment reads `currentTenant()`; never accepts a tenant from a caller |
| Design system | `@munaxa/ui`, `@munaxa/tokens`, `@munaxa/theme`, `@munaxa/icons` | Admin screens only. No local components, no local tokens |
| Configuration | `@work/config` | No new variable anticipated |
| Observability | `nestjs-pino`, correlation middleware | Reused as-is |

**No Platform gap is anticipated.** The three capabilities Recruitment needs and does not have —
approvals, documents, communications — are **Work domains not yet built**, not Platform gaps, and each
already has a kernel port and an owning phase.

**A candidate-facing careers portal is out of scope and is not a Platform question.** External
(unauthenticated) application submission would need a public API surface, bot protection and a consent
model. Nothing in Phase 6's specification asks for it, and Munaxa Work has no unauthenticated business
route. §30 A-9.

---

## 4. Existing model reuse analysis

**Nothing in this list is re-created.**

| Concept | Owner | How Recruitment refers to it |
| ------- | ----- | ---------------------------- |
| Position | `organization` | `requisition.position_id` — identifier only |
| Organizational unit | `organization` | `requisition.unit_id` — identifier only |
| Cost centre | `organization` | `requisition.cost_center_id`, optional |
| Budgeted headcount | `organization` | Read through `organization.establishment-posture`. Recruitment counts no headcount |
| Legal entity / country | `organization` | Resolved through the unit. **No country column in Recruitment** |
| Person | `people` | `candidate.person_id`, set at hire. Never at application |
| Person duplicate detection | `people` | `people.search` and `people.create-person`'s acknowledgement. Recruitment builds no matcher over identity |
| Hiring manager, interviewer, recruiter | `employment` / `identity` | By **employment** identifier where the person is staff (consistent with Phase 5's "a manager is a job"), or by `workforce_user` where the actor is a system user. §30 A-6 |
| Employment | `employment` | Referenced by identifier *after* Onboarding creates it. Recruitment never writes one |
| Approvals | kernel port → `workflow` | `ApprovalPort` |
| Documents | kernel port → `documents` | `DocumentPort` and a `document_reference` string |
| Notifications | kernel port → `communications` | `NotificationPort` |

**Deliberately not built here:** onboarding journeys, employment records, compensation structures,
document storage, message delivery, an approval router, an AI model, a careers site, country rules.

---

## 5. Domain model

Seven aggregates. The specification lists nine roots; two of them are argued down in §30 A-7.

```text
JobRequisition ──1:N──► Vacancy ──1:N──► Application ──N:1──► Candidate
                                              │
                                              ├──1:N──► Interview ──1:N──► InterviewFeedback
                                              └──1:1──► Offer (versioned)
```

| Aggregate | Holds | Why it is its own aggregate |
| --------- | ----- | --------------------------- |
| **JobRequisition** | Position, unit, cost centre, headcount requested, reason code, priority, target start date, status, requested-by | It is approved as a unit and its approval is what authorises hiring at all |
| **Vacancy** | Requisition, title, description, status, opening/closing dates, publication channels | A requisition may open more than one vacancy, and a vacancy's publication lifecycle is not the requisition's |
| **Candidate** | Contact points, source, profile (skills, experience, education, certifications), status, optional `person_id` | A person outside the company. Its lifetime spans applications and outlives every one of them |
| **Application** | Candidate, vacancy, stage, status, source, applied date, rejection reason | The join *is* the process. One candidate, many applications; one vacancy, many applicants |
| **Interview** | Application, round, scheduled window, mode, interviewers, status | Scheduled and rescheduled independently of the application's stage |
| **InterviewFeedback** | Interview, interviewer, score, recommendation, notes | Written by a different person from the one who scheduled it, and **not editable by the recruiter** — which is only enforceable if it is its own aggregate with its own permission |
| **Offer** | Application, version, proposed terms, status, expiry, decision | Versioned: a renegotiated offer is a new version, never an edited one (AD-006, and the same rule every timeline in Phase 5 follows) |

### Vocabulary that is deliberately absent

*Employee*, *employment*, *salary structure*, *pay grade*, *onboarding task*, *background check*,
*visa*, *work permit*, *equal-opportunity classification*. Each belongs to another domain or to a
country pack.

---

## 6. Candidate vs Person — the decision

**Recommendation: a Candidate is a Recruitment aggregate and is never a Person until hire.**

```text
Candidate ──► Application ──► Interviews ──► Offer ──► Accepted ──► Person ──► (Onboarding) ──► Employment
   │                                                                   ▲
   └── person_id is null for its whole life until this point ──────────┘
```

Four rules:

1. **Applying creates no Person.** A speculative applicant who is never contacted must leave no trace
   in the master registry of human identity. AD-001 says so, and Phase 4's design assumes it: `person`
   is "one permanent human identity", and a rejected applicant is not one of the tenant's people.
2. **A candidate may already be a Person** — an internal applicant, or a returning former employee.
   `candidate.person_id` is therefore nullable and settable *before* hire when the recruiter links
   them explicitly. It is never inferred.
3. **At the hiring decision, Recruitment resolves a Person**: match first, create only if no match is
   confirmed. Both go through People's published application service — `people.search` to match,
   `people.create-person` to create — so People's own duplicate detection, its keyed identifier digest
   and its review queue all apply unchanged. Recruitment writes no `person` row and computes no digest.
4. **`person_id` is written once.** A partial unique index on `(tenant_id, person_id) where person_id
   is not null` prevents two candidate records resolving to one human being, and the column is absent
   from the repository's update set once set. This is also what makes a retried hire safe (§13).

### Why not a shared "party" or "pre-employment identity"

Considered, and rejected. Phase 4 owns *one permanent human identity per human being*, with names on a
timeline, keyed identifier digests, a merge that redirects, and thirteen tables of protections around
it. A candidate has none of those needs and one the Person does not: **the right to be forgotten
without disturbing the register**, since a rejected applicant is not somebody the tenant employs. A
shared supertype would either weaken Person's guarantees or impose them on a résumé.

### What Recruitment stores about a human being — and what it must not

**Recommendation: Recruitment stores contact points, a profile and a source. It stores no government
identifier, no date of birth and no nationality.** Those are collected at hire, by People, where nine
tested protections already surround them (ADR-0038). §30 A-2, because §10 of the instruction lists
national identifier as possible matching information.

---

## 7. Recruitment lifecycle

Two lifecycles, deliberately separate, because conflating them is the classic mistake in this domain —
an application's stage is not a candidate's status, and a candidate rejected for one vacancy is not a
rejected candidate.

**Requisition**

```text
draft ──► pending_approval ──► approved ──► open ──► closed
             │                     │                   ▲
             └──► rejected         └──► cancelled ──────┘
```

**Application** (the pipeline)

```text
received ──► screening ──► shortlisted ──► interviewing ──► evaluated ──► offered ──► hired
     │            │             │                │              │            │
     └────────────┴─────────────┴────────────────┴──────────────┴────► rejected / withdrawn
```

**Candidate**: `active → hired`, `archived`, and `talent_pool` as a *tag* rather than a status (§30
A-7).

**Offer**: `draft → pending_approval → approved → issued → accepted | declined | expired | withdrawn`.

**AD-005 — interview stages are configurable by tenant — is honoured**, and the boundary is precise:
the **application's status set is closed** (product behaviour, checked in the database), while the
**stage within it is a tenant-defined code**. A tenant that runs "phone screen → panel → founder chat"
gets three stages; the product still knows the application is `interviewing`. Hardcoding a tenant's
stages would be the country-pack mistake in a different costume.

---

## 8. Requisition model

```text
recruitment_requisition
  id, tenant_id, requisition_number, status,
  position_id, unit_id, cost_center_id?,          -- organization's, by identifier
  headcount_requested, headcount_filled,          -- filled is derived from hires, never typed
  reason_code, priority_code, target_start_date?,
  requested_by_employment_id, hiring_manager_employment_id?,
  approval_id?, approved_at?, approved_by?,
  metadata, + audit/version
```

- **`requisition_number` is generated**, following ADR-0039's precedent exactly — tenant-scoped
  counter, immutable, never reused. Reusing Employment's *mechanism* is right; sharing its *table* is
  not, and the kernel-level counter debt Phase 5 recorded is the honest place for the eventual shared
  one. §30 A-8.
- **`headcount_filled` is maintained by this module from its own hires** and never typed by a user.
  Organization's establishment remains the *budgeted* number (AD-002 of Phase 3); Recruitment reads it
  and does not write it.
- **No country, no legal entity, no currency on the requisition.** All three resolve from the unit.
- A requisition may be approved and still open no vacancy; a vacancy cannot exist without an approved
  requisition. That invariant is what makes "approval authorises hiring" true.

---

## 9. Application model

```text
recruitment_candidate
  id, tenant_id, candidate_number, status, source_code,
  person_id?,                                     -- null until hire; write-once
  primary_email, primary_phone?,                  -- normalized, indexed for matching
  display_name (bilingual json), preferred_language?,
  metadata, withdrawn_at?, + audit/version

recruitment_candidate_profile_entry                -- skills, experience, education, certifications
  id, tenant_id, candidate_id, kind, code?, title (json), organization_name (json)?,
  from_date?, to_date?, level?, years?, document_reference?, + audit/version

recruitment_application
  id, tenant_id, candidate_id, vacancy_id, application_number,
  status, stage_code?, source_code, applied_on,
  screening_outcome?, screening_note?, rejection_reason_code?,
  withdrawn_at?, metadata, + audit/version

recruitment_application_event                      -- the pipeline's history, append-only
  id, tenant_id, application_id, from_status?, to_status, stage_code?,
  reason_code?, note?, occurred_at, recorded_by, + audit/version
```

- **One application per candidate per vacancy**, enforced by partial unique index. A candidate
  re-applying to the same vacancy is a *reopened* application, not a second one — otherwise a pipeline
  count is wrong the first time somebody re-submits.
- **Screening is a result on the application, not an aggregate.** §30 A-7.
- **The pipeline history is a table**, for the reason Phase 5's status history is one: an auditor who
  was not subscribed to events still needs the answer.
- **`recruitment_candidate_profile_entry` mirrors People's `person_capability` and `person_history`
  shapes deliberately**, so that a hire can hand them across without reshaping — but it is not the same
  table, because a candidate's claims are unverified and a Person's are the register's.

---

## 10. Interview model

```text
recruitment_interview
  id, tenant_id, application_id, round_number, stage_code?,
  mode_code, status, scheduled_from?, scheduled_to?, location_text?, meeting_reference?,
  cancelled_reason_code?, metadata, + audit/version

recruitment_interview_participant
  id, tenant_id, interview_id, interviewer_employment_id, role_code, response?, + audit/version

recruitment_interview_feedback
  id, tenant_id, interview_id, interviewer_employment_id,
  score?, recommendation, strengths?, concerns?, submitted_at, + audit/version
```

- **No calendar infrastructure**, as instructed. `scheduled_from`/`scheduled_to` are instants, and
  `meeting_reference` is an opaque string an external system (or a future Integrations phase) owns.
  Organization's `organization_calendar` is for working days and holidays, not appointments, and
  bending it into a scheduler would be the wrong reuse.
- **Feedback is separately permissioned and immutable once submitted.** A recruiter who could edit an
  interviewer's score would make the score worthless in a dispute. Same reasoning as People's notes.
- **One feedback per interviewer per interview**, unique-indexed. A second submission is a refusal, not
  an overwrite.
- **No aggregate score is computed by this module.** Whether three fours beat one five is a hiring
  policy, and a formula shipped here would be a business rule invented where the specification is
  silent.

---

## 11. Offer model

```text
recruitment_offer
  id, tenant_id, application_id, offer_number, version,
  status, proposed_start_date, expires_on?,
  proposed_position_id?, proposed_unit_id?, proposed_employment_type_code?,
  proposed_compensation (json, opaque), currency_code?,
  approval_id?, issued_at?, decided_at?, decision_note?,
  document_reference?, metadata, + audit/version
```

- **Versioned, never edited.** A renegotiated offer is version 2 with version 1 preserved, and exactly
  one version is `issued` at a time (partial unique index). "What did we actually offer them" is a
  question asked in disputes.
- **`proposed_compensation` is opaque JSON and is not money the system computes with.** Compensation
  (Phase 10) owns pay structures; an offer records *what was proposed* — a number and a currency a
  recruiter typed. Modelling it with the kernel's `Money` would imply an arithmetic this module must
  not perform. §30 A-5.
- **It is the most sensitive record in the module** and is permissioned separately from the
  application (§25).
- **AD-006 is structural here**: an Offer references no `employment_contract` and creates none. The
  contract is written by Employment, after Onboarding, from terms a human confirms.

---

## 12. Workflow integration

Two things need approval — a requisition and an offer — and **no approval engine exists until Phase
16**.

**Recommendation.** Recruitment models the approval *state* itself (`pending_approval → approved |
rejected`), with explicit `submit` and `decide` commands guarded by `recruitment.requisition.approve`
and `recruitment.offer.approve`, each writing a history row naming the authenticated approver. It
**declares the `ApprovalPort` seam** and stores `approval_id`, so Phase 16 supplies routing,
delegation and escalation without reshaping the aggregate.

**It does not wire `AutoApprovingPort`**, and that is the point of the recommendation. The adapter is
honest — it records `system:auto-approval` and says no workflow is configured — but an approval nobody
made is exactly the "fake workflow approval" §26 of the instruction forbids, and a requisition is the
control that authorises spending headcount.

This deviates from ADR-0024's "depend on the port from the first commit", so it needs approval. §30
A-3.

**Recruitment never owns routing, delegation, escalation or reminders.** Those are Workflow's, and
none of them appears in this plan.

---

## 13. Employment integration — the hire transition

The most consequential integration in the phase, and the one with a real architectural problem.

```text
Offer accepted
   ↓
Match or create a Person          ← people.search, then people.create-person
   ↓
candidate.person_id written once  ← recruitment's own write
   ↓
Application → hired, Requisition.headcount_filled += 1
   ↓
recruitment.candidate.hired  (event)
   ↓
Onboarding (Phase 7) creates the Employment. Recruitment never does. (AD-003)
```

### The problem: it cannot be one transaction

`PostgresUnitOfWork.execute` takes a **fresh connection and opens a new transaction** on every call.
Recruitment's hire handler therefore cannot atomically create a Person (People's write, second
transaction) and mark the candidate hired (its own, first transaction). Either can succeed while the
other fails.

**Recommendation: make it idempotent and recoverable rather than atomic**, in this order:

1. Resolve the Person **first**, in its own transaction, through People's service.
2. Then, in Recruitment's transaction, write `person_id` (write-once, unique-indexed) and complete the
   hire.
3. A retry after a crash between the two finds the Person already matched by the same search and
   writes the same `person_id` — the unique index makes a double-write a refusal, not a duplicate.
4. A `hired` application whose `person_id` is null is a **detectable, reportable inconsistency**, not a
   silent one, and is repairable by re-running the same command.

Two alternatives exist and both are worse *for this phase*: extending the kernel's `UnitOfWork` to
join an ambient transaction is a cross-cutting change to a foundation four modules depend on; and a
full outbox/saga is Phase 24's operational machinery. §30 A-4.

### What the transition must never do

Create a Person on application · create a second Person for a candidate already linked · create an
Employment · write to `people`' or `employment`'s tables directly · lose the application history when
the candidate becomes an employee.

---

## 14. Document integration

**Recommendation: Recruitment stores `document_reference` strings and declares the kernel's
`DocumentPort`. It implements no storage and ships no upload endpoint in Phase 6.**

A résumé is a file. Phase 4.1 (`documents`) owns files, and it does not exist. The choices were: build
a minimal store behind `StoragePort` (that *is* document management, grown in the wrong module, and
would have to be migrated), or accept that attachments are references until Phase 4.1 lands.

Recording the reference now costs nothing and means Phase 4.1 supplies an adapter with no reshaping —
exactly the Employment-contract precedent (`document_reference` on `employment_contract`, no bytes).

**This is a gap, stated as one.** "Upload a résumé" is not a Phase 6 capability, and the plan does not
claim it. A tenant integrating an external ATS can store that system's reference today.

---

## 15. Communications integration

**Recommendation: Recruitment depends on `NotificationPort` and wires `RecordingNotificationPort`, the
in-process default.**

Unlike auto-approval, recording is not a pretence: the adapter's own documentation says the record is
what proves a domain *asked*, so Communications can replay it later. The business event — an interview
scheduled, an offer issued, an application rejected — is Recruitment's; the channel, the template and
the delivery guarantee are not.

**Candidate-facing email does not work in Phase 6**, because Communications is Phase 17 and a candidate
is not a workforce user (`NotificationRecipient` carries a `userId`). Two gaps, both stated: no
delivery, and no recipient type for an external person. Phase 17 owns both.

---

## 16. Future AI extension points

**Recommendation: declare no AI ports in Phase 6.** ADR-0024's precedent is that a port precedes its
engine *when consumers already exist*. Nothing in Phase 6 consumes résumé parsing or candidate ranking,
and an interface with no caller is a guess about Phase 23's shape.

What Phase 6 does instead is leave the structure AI needs:

- **Structured profile entries separate from the source document.** A parser fills
  `recruitment_candidate_profile_entry` rows; the résumé stays a reference. Nothing needs reshaping.
- **A `source` marker on any scored or derived field**, so a human score and a machine score are
  distinguishable from the first row rather than after the fact.
- **Application and interview scores are nullable and free of computed aggregates**, so a ranking model
  adds a column rather than contradicting an existing formula.
- **No provider name, model name or vendor SDK anywhere.** ADR-0012 already binds AI to
  recommendations, never critical business actions, and nothing here would let a model change a status.

---

## 17. Database plan

One migration, additive, no historical migration touched. Every table tenant-first, UUIDv7, audit
columns, `version`, soft delete, `snake_case`, and `call app_protect_table(...)` in the same file
(ADR-0030).

| # | Table | Notes |
| - | ----- | ----- |
| 1 | `recruitment_requisition_number_sequence` | Tenant-scoped counter, ADR-0039's shape |
| 2 | `recruitment_requisition` | Position/unit/cost-centre by identifier; no foreign key across modules (ADR-0042) |
| 3 | `recruitment_vacancy` | FK → requisition |
| 4 | `recruitment_vacancy_publication` | Channel, published/withdrawn instants |
| 5 | `recruitment_candidate` | `person_id` nullable, write-once, partial unique |
| 6 | `recruitment_candidate_profile_entry` | Skills, experience, education, certifications |
| 7 | `recruitment_application` | FK → candidate, vacancy. Unique per pair |
| 8 | `recruitment_application_event` | Append-only pipeline history |
| 9 | `recruitment_interview` | FK → application |
| 10 | `recruitment_interview_participant` | FK → interview |
| 11 | `recruitment_interview_feedback` | FK → interview. Unique per interviewer |
| 12 | `recruitment_offer` | FK → application. One issued version at a time |

**Twelve tables** — more than any phase so far, and §30 A-7 argues two of the specification's nine
aggregates down to keep it from being fourteen.

### Constraints that carry the design

`(tenant_id, requisition_number)`, `(tenant_id, candidate_number)`, `(tenant_id, application_number)`
unique · `(tenant_id, person_id) where person_id is not null` unique — one candidate per human being ·
`(tenant_id, candidate_id, vacancy_id)` unique — one application per pair · one `issued` offer version
per application · one feedback per interviewer per interview · status check constraints on every
lifecycle · `expires_on >= proposed_start_date` refused · `headcount_requested > 0` · scheduled window
end after start.

### Indexes

Per table: `(tenant_id, status)`, plus `(tenant_id, vacancy_id, status)` for pipeline views,
`(tenant_id, candidate_id)`, `(tenant_id, primary_email)` and `(tenant_id, primary_phone)` for
matching, `(tenant_id, application_id)` on every child, `(tenant_id, requisition_id)` on vacancies, and
`(tenant_id, scheduled_from)` for interview lists.

---

## 18. API plan

`/api/v1` under the existing architecture. No second framework, no second pipeline. Controllers split
to stay inside the 150-line budget, with the export-before-`:id` ordering trap asserted by test as in
Phases 4 and 5.

| Resource | Endpoints |
| -------- | --------- |
| Requisitions | `GET`/`POST` `/requisitions`, `GET`/`PATCH` `/requisitions/:id`, `POST /:id/submit`, `POST /:id/decision`, `POST /:id/close` |
| Vacancies | `GET`/`POST` `/vacancies`, `GET` `/vacancies/:id`, `POST /:id/publish`, `POST /:id/close` |
| Candidates | `GET`/`POST` `/candidates`, `GET`/`PATCH` `/candidates/:id`, `GET`/`POST` `/candidates/:id/profile`, `POST /:id/link-person` |
| Applications | `GET`/`POST` `/applications`, `GET` `/applications/:id`, `POST /:id/stage`, `POST /:id/screening`, `POST /:id/reject`, `POST /:id/withdraw`, `GET /:id/history` |
| Interviews | `GET`/`POST` `/applications/:id/interviews`, `POST /interviews/:id/reschedule`, `POST /interviews/:id/cancel`, `POST /interviews/:id/feedback` |
| Offers | `GET`/`POST` `/applications/:id/offers`, `POST /offers/:id/submit`, `POST /offers/:id/decision`, `POST /offers/:id/issue`, `POST /offers/:id/response` |
| Hiring | `POST /applications/:id/hire` |
| Pipeline | `GET /vacancies/:id/pipeline` — counts and a bounded page per stage |
| Transfer | `GET /candidates/export`, `POST /candidates/import` — bounded, resumable |

Every endpoint: authentication, authorization, tenant enforcement, validation with
`forbidNonWhitelisted`, Problem Details (RFC 9457), OpenAPI, correlation and request identifiers,
`expectedVersion` on anything touching an existing row, standard pagination.

**Idempotency stays where Phase 5 left it**: natural keys and unique indexes. `POST /hire` is the one
operation where a retry must be safe, and §13's write-once `person_id` is what makes it so.

---

## 19. Authorization plan

Recruitment declares its own permissions; Platform decides who holds them.

```text
recruitment.requisition.read        recruitment.requisition.manage
recruitment.requisition.approve
recruitment.vacancy.read            recruitment.vacancy.manage
recruitment.vacancy.publish
recruitment.candidate.read          recruitment.candidate.manage
recruitment.application.read        recruitment.application.manage
recruitment.interview.read          recruitment.interview.manage
recruitment.interview.feedback.write
recruitment.offer.read              recruitment.offer.manage
recruitment.offer.approve
recruitment.hire
recruitment.export                  recruitment.import
```

Four separations are deliberate: **approving** a requisition is not managing one; **publishing** a
vacancy is externally visible and is not editing one; **writing feedback** is what an interviewer does
and is not what a recruiter does; and **hiring** is the single act that reaches into the master
registry.

### The reference-check boundary — raised by the instruction, and the phase's hardest question

Phase 5 composed its cross-module reference checks through the shared dispatcher, so creating an
employment requires `people.person.read` and placing one requires `organization.hierarchy.read`. The
instruction says explicitly: *do not require unrelated interactive read permissions merely because
Recruitment internally needs a domain reference.*

Recruitment would otherwise be worse than Phase 5: a recruiter creating a requisition would need
`organization.position.read` and `organization.hierarchy.read`, and hiring would need
`people.person.read` **and** `people.person.manage` — which is to say every recruiter would hold the
permission to edit the master registry of human identity.

Three distinct kinds of authorization are being conflated, and separating them is the recommendation:

| Kind | Question | Who decides |
| ---- | -------- | ----------- |
| **User permission** | May *this human* perform this operation? | Platform, per the caller |
| **Domain-reference check** | Does this identifier exist in this tenant? | The owning module — but the answer is a **boolean**, not data |
| **Service authority** | May *this module* ask another to do something on the user's behalf? | The composition root, once |

**Recommendation: a bounded service context.** The kernel gains a way to run a *named, whitelisted*
cross-module read as the calling **module** rather than the calling user, returning existence only,
recorded in the audit trail with the originating actor and correlation identifier. The user permission
for the *operation* is unchanged; only the incidental read is elevated.

The hire path is different in kind, because it *writes* to People. That one should stay a genuine
delegation: a caller holding `recruitment.hire` acts through a Recruitment service identity that holds
a **narrow** People grant (`people.person.create-from-recruitment`), not blanket
`people.person.manage`. That grant is Platform's to define, which makes it a Platform conversation
rather than a Work-side workaround.

This is a kernel change and it needs approval. §30 A-1, the top decision of the phase.

---

## 20. Tenant isolation plan

Identical in method to Phases 2–5, which is the point: the property is proved the same way each time
or it is not proved at all.

- Every one of the twelve tables carries `tenant_id` and takes the standard policy in the migration
  that creates it.
- The integration suite connects as a role that **owns nothing and cannot bypass RLS**, and asserts
  that fact with `app_isolation_diagnostics()` before asserting anything else.
- Every scenario in the instruction's §15, per table: read, modify, write-into-another-tenant (the
  `with check` half), search, export, and the background-job path.
- Plus two specific to this phase: **a candidate cannot be linked to another tenant's Person**, and **a
  requisition cannot reference another tenant's position or unit** — the second resting on RLS, since
  Organization publishes no single-entity read (ADR-0042, inherited).

---

## 21. Audit plan

The existing mechanism: audit columns written by infrastructure from the authenticated context, which
a caller cannot supply or override; domain events after commit; append-only history tables where the
sequence itself is the evidence.

| Action | Where the evidence lives |
| ------ | ------------------------ |
| Requisition created, submitted, approved, rejected | Aggregate + a requisition history row naming the approver |
| Vacancy published, closed | Aggregate + event |
| Candidate created, profile amended, linked to a Person | Audit columns + event |
| Application status and stage changes | `recruitment_application_event`, append-only |
| Interview scheduled, rescheduled, cancelled | Aggregate + event |
| Feedback submitted | Immutable row, `submitted_at`, interviewer from context |
| Offer created, versioned, approved, issued, accepted, declined | Version rows — the offer's history *is* its versions |
| **Candidate hired** | Application event + candidate `person_id` + `recruitment.candidate.hired` |

**No separate audit infrastructure.** Where an action needs an actor that a caller must not be able to
forge — an approver, an interviewer's feedback, a hire — the actor comes from
`originOfCurrentRequest()`, exactly as Phase 5's `recorded_by` does, and is asserted by test with a
request that tries to supply its own.

---

## 22. Domain event plan

Published only where a consumer is identifiable — Onboarding, Communications, Workflow, Reporting.
Events that exist only because a list suggested them are noise that later versions must keep.

```text
recruitment.requisition.created        recruitment.requisition.decided
recruitment.vacancy.published          recruitment.vacancy.closed
recruitment.candidate.created          recruitment.candidate.linked-to-person
recruitment.application.received       recruitment.application.status-changed
recruitment.application.rejected
recruitment.interview.scheduled        recruitment.interview.completed
recruitment.offer.issued               recruitment.offer.accepted
recruitment.offer.declined
recruitment.candidate.hired
```

`recruitment.candidate.hired` is the one Phase 7 is built on: it carries the application, the candidate
and the resolved `person_id`, and it is what Onboarding subscribes to.

**No event carries a résumé, a contact point, a proposed salary or a name.** Events fan out to
consumers this module does not know and end up in logs — the rule Phases 4 and 5 both applied, applied
again to the module with the most third-party personal data in it.

---

## 23. UI plan

`/recruitment` in the admin portal, `@munaxa/ui` only, no local tokens, no duplicate primitives,
`?lang=` switching language and direction together.

| Screen | Content |
| ------ | ------- |
| Dashboard | Open requisitions, open vacancies, applications by stage, interviews this week |
| Requisitions | List, filters, detail with approval state and history |
| Vacancies | List, detail, publication state |
| Candidates | Search by email, phone, skill, source; detail with profile and every application |
| Applications | List, and the **pipeline board** by stage per vacancy |
| Application detail | Stage, screening, interviews, feedback, offers, full history |
| Interviews | Upcoming and past, per interviewer and per vacancy |
| Offers | List, versions, decision state |

All eight states handled per screen: loading, empty, success, validation error, authorization error,
not found, server error, conflict. WCAG 2.2 AA, keyboard navigation, RTL/LTR, responsive.

**Read-only**, consistent with Phases 3, 4 and 5. §30 A-9 asks whether Recruitment should be the phase
that breaks that pattern, since a pipeline board nobody can drag a card on is a demonstration rather
than a tool — and the honest answer may be that the write screens belong here rather than in Phase
18/19.

**The pipeline board is the performance risk on this screen**: it is eight lists at once. It must page
per stage and read counts from an aggregate query, never load a vacancy's applications and group them
in the browser.

---

## 24. Testing plan

The shape Phases 4 and 5 established, extended to this domain.

- **Domain** — requisition, application, interview, offer and candidate lifecycles, each state machine
  exhaustive over every pair; headcount invariants; offer versioning; one-application-per-pair;
  feedback immutability; date validity.
- **Application** — every command through the real pipeline; authorization granted *and* denied per
  handler; tenant scope; optimistic concurrency; the hire transition against a fake People port,
  including **the retry after a simulated crash between the two transactions**.
- **Persistence (real PostgreSQL)** — every unique index and check constraint proved by a real insert;
  RLS per table; pipeline and search queries against seeded data with their plans asserted.
- **API** — 401/403/400/404/409/422 per surface, pagination, filtering, route ordering, Problem Details
  with no internals.
- **Security** — cross-tenant per §20; privilege escalation (a caller with `recruitment.candidate.read`
  cannot read an offer or feedback); **candidate PII exposure** (no contact point in an event, none in
  an export the caller may not take, none in a rejection response).
- **Regression** — the full suite. Phase 6 must not break Phases 0–5, and the 866 existing tests are
  the measure.

---

## 25. Security and privacy plan

Recruitment holds **third-party personal data about people who do not work here and may never** — the
most sensitive posture in the product so far, and different in kind from Phase 4's, because a candidate
never entered an employment relationship.

| Concern | Treatment |
| ------- | --------- |
| What is held | Contact points, self-declared profile, source, application history, interview feedback, offer terms |
| What is **not** held | Government identifiers, date of birth, nationality, photographs. Collected at hire, by People (§6, A-2) |
| Access | Reading a candidate, reading an offer and reading feedback are three permissions. Most recruiters need the first |
| Data minimisation | A rejection response names no reason to the candidate-facing side; the reason code is internal |
| Export | Separately permissioned, never carrying documents, and refused beyond a bound |
| Documents | References only. Signed, time-limited URLs when `DocumentPort` has an adapter — never permanent links |
| Audit | Who read an offer and who submitted feedback are both answerable |
| **Retention** | **Not implemented, and not invented.** How long a rejected candidate's data may be kept is a legal question that differs per market, and belongs to Country Compliance (Phase 11.1) and GRC (Phase 21). The plan provides `withdrawn_at` and a deletable candidate, and states the gap |

**Erasure is a live question here in a way it was not in Phase 4.** Phase 4 recorded that erasure is
unimplemented and in tension with AD-009 (identity is never destroyed). A *candidate* has no such
tension: nothing downstream depends on a rejected applicant. §30 A-9 asks whether candidate erasure
should be in scope now.

---

## 26. Performance plan

Reconciled with the repository's own budgets — API < 300 ms, search < 500 ms, page load < 2 s — rather
than assumed. Measured as Phases 4 and 5 were: real PostgreSQL, seeded, through the unprivileged role
with RLS in force.

**Representative data:** 100,000 candidates, 250,000 applications, 10,000 vacancies, 500 requisitions,
50,000 interviews. Consistent with the instruction and with the enterprise scale the standards imply.

| Operation | Budget | Expected shape |
| --------- | ------ | -------------- |
| Candidate search by email or phone | < 500 ms | Indexed, normalized — fast |
| Candidate search by **name** | < 500 ms | **Sequential scan.** The known finding |
| Application list filtered by vacancy and status | < 500 ms | `(tenant_id, vacancy_id, status)` |
| Pipeline board for one vacancy | < 500 ms | Aggregate count per stage + a bounded page each |
| Candidate detail with applications | < 300 ms | Batched, no N+1 |
| Interview list for a week | < 500 ms | `(tenant_id, scheduled_from)` |

**The name search is the inherited finding, and it will be worse here.** Phases 4 and 5 both measured
it: `ilike` is not leakproof, so PostgreSQL will not use a trigram index ahead of the security qual, and
falls back to a scan. Phase 4 measured 98 ms at 50,000 people; **100,000 candidates plus a bilingual
name column will be slower**, and it is the first search users reach for.

Three responses, in order: match on email and phone (indexed, and what a recruiter actually has); page
and filter server-side always; and if the measured number exceeds budget, **say so and do not ship an
index the planner declines to read** — the answer is the Phase 20 projection store, or `SearchPort`
with an engine, which is a phase of its own.

---

## 27. Migration plan

1. Author `prisma/migrations/<timestamp>_recruitment/migration.sql`. **No historical migration is
   touched.**
2. Tables, constraints, indexes, comments and `app_protect_table` in that one file, in that order.
3. `pnpm prisma:validate` → `pnpm db:reset` → `pnpm db:migrate` on a clean database, then again on one
   already carrying Phases 0–5.
4. `node scripts/check-architecture.mjs` must pass on the updated schema.
5. **Rollback:** the phase is additive — twelve new tables, one new package, one new portal route, and
   no change to any existing table. Reverting means reverting the commit and dropping the twelve
   tables. Unlike Phase 5, **no completed module's behaviour changes** — there is no equivalent of the
   filled-headcount swap.

---

## 28. Risks

1. **The hire transition is not atomic** (§13). Mitigated by ordering and a write-once unique index, and
   detectable when it fails — but a partial hire is possible and the plan says so rather than implying
   otherwise.
2. **The authorization boundary is unresolved** (§19). Left as Phase 5 composed it, every recruiter
   needs permission to edit the master registry of human identity. That is the largest single risk in
   the phase and the instruction is right to have raised it.
3. **Twelve tables is the largest schema addition yet.** Every one is justified in §17, and §30 A-7
   proposes cutting two more concepts. A domain this size is also where "one aggregate too many" costs
   most.
4. **Third-party PII with no retention model.** Nothing here deletes a rejected candidate, and no
   market's rule is invented. Legally live in several of this product's markets.
5. **Candidate name search will likely miss its budget at 100,000 records**, for a reason two previous
   phases already measured and neither could fix without a projection store.
6. **Nothing candidate-facing works.** No portal, no email, no document upload. Everything in Phase 6
   is an internal recruiter's tool, and a customer expecting an ATS will find three quarters of one.
7. **AD-005's "configurable stages" invites scope creep** toward a workflow builder. The boundary in §7
   — closed status set, open stage codes — is the line, and it will be pushed.

---

## 29. Ambiguities

| # | Ambiguity | Where it comes from |
| - | --------- | ------------------- |
| 1 | Who creates the Person at hire — Recruitment or Onboarding? | Phase 6 AD-002 says hiring creates or links a Person; AD-003 says Onboarding creates Employment. Silent on which side of the handoff the Person falls. **Read as: Recruitment resolves the Person, Onboarding creates the Employment.** §6, §13 |
| 2 | Does a requisition consume budgeted headcount? | Phase 3 owns budgeted establishment and Phase 5 supplies filled headcount. Whether an *unfilled requisition* counts against a budget is a planning rule nobody has stated. **Read as: it does not — Recruitment reports its own requested and filled numbers and reads Organization's budget without writing it.** |
| 3 | What is a "talent pool"? | Listed as an aggregate root with no definition. A saved list, a candidate status, or a tag. §30 A-7 |
| 4 | What is a "recruitment pipeline" as an *aggregate*? | Listed as a root, but everything it would hold is derivable from applications. §30 A-7 |
| 5 | Are interviewers always employees? | An external panel member or an agency interviewer has no employment. **Read as: an interviewer is an employment in Phase 6; external panels are a stated limitation.** §30 A-6 |
| 6 | Is a candidate ever tenant-shared? | Every entity is tenant-scoped, but an agency operating two tenants would expect one candidate. **Read as: strictly tenant-scoped, no exception, per §15 of the instruction.** |
| 7 | Does "Recruitment Search / Advanced Search" mean a saved-search feature? | The specification marks saved searches "(future)". **Read as: server-side filtered search now, saved searches out of scope.** |

Items 1, 2, 5, 6 and 7 are read as stated above and need no separate approval unless the reading is
wrong. Items 3 and 4 are A-7.

---

## 30. Decisions requiring approval

**A-1 — The authorization boundary for cross-module reference checks and the hire delegation.**
*Architectural. The most consequential decision in the phase.*

Recommended: a **bounded service context** in the kernel — a named, whitelisted, existence-only
cross-module read performed as the calling module rather than the calling user, audited with the
originating actor; and, for the hire, a narrow Platform grant
(`people.person.create-from-recruitment`) held by a Recruitment service identity rather than blanket
`people.person.manage` for every recruiter.

Alternatives: (b) compose as Phase 5 did — every recruiter needs `people.person.read`,
`people.person.manage` and `organization.hierarchy.read`, which the instruction explicitly warns
against; (c) add low-privilege existence queries to People and Organization, which modifies completed
modules. **This also implies revisiting Phase 5's composition later — as a separate, approved change,
not in this phase.**

**A-2 — Recruitment stores no government identifier, date of birth or nationality.**
*Behavioural.* §10 of the instruction lists national identifier among possible matching information.
Recommended: it does not, and matching runs on email and phone through People's search, with identity
documents collected at hire by the module already built to protect them. Narrower than the instruction
allows, so it is asked rather than assumed.

**A-3 — Requisition and offer approval are modelled and decided in Recruitment; `AutoApprovingPort`
is not wired.**
*Architectural, and a partial deviation from ADR-0024.* Recommended: real single-step human decisions
now, `ApprovalPort` declared and `approval_id` stored so Phase 16 takes over routing with no reshaping.
Alternative: wire the auto-approving adapter, which would make every requisition "approved" by
`system:auto-approval` — honest in its record and, in this reviewer's judgement, indistinguishable from
the fake approvals §26 forbids.

**A-4 — The hire transition is idempotent and recoverable, not atomic.**
*Architectural.* Recommended: resolve the Person first, write `person_id` once under a unique index,
make a retry converge, and make a half-completed hire detectable. Alternatives: extend the kernel's
`UnitOfWork` to join an ambient transaction (a foundation change affecting four modules), or an
outbox/saga (Phase 24's machinery).

**A-5 — An offer's proposed compensation is opaque and uncomputed.**
*Behavioural.* Recommended: a JSON structure and a currency code, stored and never arithmetic'd, with
Compensation (Phase 10) owning the authoritative model. Alternative: model it with the kernel's `Money`
now, which implies a computation this module must not perform and a structure Phase 10 would have to
either adopt or migrate.

**A-6 — Recruiters, hiring managers and interviewers are identified by *employment*.**
*Behavioural.* Recommended: consistent with Phase 5's "a manager is a job, not a name", which keeps
"who interviewed this candidate in March" answerable after the interviewer changes roles. Consequence:
**external interviewers are not supported in Phase 6** and are a stated limitation.

**A-7 — Two of the nine specified aggregate roots are argued down.**
*Scope.* Recommended: **`TalentPool` becomes a tag on a candidate** (a saved list of candidates is a
list, and its own aggregate buys nothing this phase uses), and **`RecruitmentPipeline` becomes a
projection over applications** rather than a stored aggregate (every field it would hold is derivable,
and a stored copy is a second answer that goes stale). **`Screening` likewise stays a result on the
application** rather than a root. If either is genuinely required as a root, that is a decision to
take now rather than after twelve tables exist.

**A-8 — Requisition, candidate and application numbers reuse ADR-0039's mechanism, per module.**
*Implementation with an architectural shadow.* Recommended: the same tenant-scoped counter pattern,
its own tables, and the kernel-level shared counter left as the debt Phase 5 recorded. Alternative:
extract the shared capability into the kernel now — the right long-term home, and a foundation change
inside a business phase.

**A-9 — Three scope questions the specification does not settle.**
*Scope.* Each is asked separately because each is a different size:
1. **Write screens.** Phases 3–5 shipped read-only admin screens with writes deferred to Phase 18/19. A
   recruitment pipeline board that cannot move a card is a demonstration. Recommended: **read-only,
   consistent with precedent** — but this is the phase where that precedent costs the most, and
   changing it is a legitimate call.
2. **Candidate erasure.** Unlike a Person, a rejected candidate has no downstream dependants and no
   AD-009 tension. Recommended: **in scope** — a real, permissioned, audited deletion — because the
   alternative is a growing store of third-party personal data with no way to remove any of it.
3. **A candidate-facing careers portal.** Recommended: **out of scope.** It needs unauthenticated
   routes, bot protection and consent — none of which exists — and Phase 6's specification does not
   ask for it.

---

## 31. Definition of done

Phase 6 is complete only when all of the following hold. A failed gate means incomplete; a partially
implemented capability is reported as a gap, never as done.

**Architecture**
- Twelve tables tenant-first, audited, versioned, soft-deleted, UUIDv7, `snake_case`, with RLS applied
  by the migration that creates them.
- No Platform capability duplicated; no completed module's source modified.
- No second workflow engine, document store, messaging engine, identity registry or API framework.
- Candidate and Person remain distinct; no Person is created before hire; `person_id` is write-once.
- Recruitment creates no Employment.

**Gates** — architecture, engineering standards, localization (both catalogues complete), dependencies
(no cycles, none unused, none unreachable), format, lint, typecheck, all tests, migration validation on
a clean database *and* on one carrying Phases 0–5, production build. All `PASS`.

**Tests** — the full matrix in §24, including tenant isolation per table against a role that cannot
bypass RLS, permissions granted and denied per handler, the hire retry, and **the complete existing
866-test suite unbroken**.

**Performance** — measured at the §26 volumes, through the unprivileged role with RLS in force,
reported as measured including any number that misses its budget, with the reason and the owning phase.

**Documentation** — `docs/modules/recruitment.md` with the ER diagram; ADRs for every decision in §30
that is approved; `DOMAIN_OWNERSHIP.md`, `PHASES.md`, `ARCHITECTURE.md`, `RELEASE_NOTES.md` and the
debt register updated; OpenAPI current.

**Honesty** — every gap named in this plan (documents, communications, candidate portal, retention,
external interviewers, approval routing) restated in the completion report as a limitation, with its
owning phase. No mock, stub, fake repository, hardcoded pipeline, placeholder interview, simulated
offer or auto-approval presented as working software.

---

## What happens next

**Nothing, until §30 is answered.** On approval the sequence is: schema and migration → domain →
application → infrastructure → API → admin screens → tests at every layer → `pnpm verify` →
performance measurement against seeded data → documentation, ADRs, module guide, release notes, debt
register → completion report → stop.
