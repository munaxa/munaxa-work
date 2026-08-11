# Phase 12 — Employee Documents, Letters & HR Document Management — Definition of Ready

**Status** Planning · **Date** 2026-08-11 · **Baseline** Phase 11 at `0807b1d` · **Code changes**
NONE

This is a planning checkpoint. No code, schema, migration or UI was written.

---

## 0. Two things to settle before anything else

### 0.1 This phase is not the repository's Phase 12

The roadmap in [`../PHASES.md`](../PHASES.md) numbers the work this brief describes as **two**
phases, and numbers something else 12:

| Roadmap | Domain | Specification | Status |
| --- | --- | --- | --- |
| **4.1** | Employee documents & expiry | `05A_PHASE_4.1_EMPLOYEE_DOCUMENTS.md` | Not started |
| **5.1** | Employee letters | `06A_PHASE_5.1_EMPLOYEE_LETTERS.md` | Not started |
| 5.2 | Employee relations (disciplinary) | `06B_PHASE_5.2_EMPLOYEE_RELATIONS.md` | Not started |
| **12** | **Benefits** | `13_PHASE_12_BENEFITS.md` | Not started |

Both specifications exist, are marked **Approved**, and are detailed. This plan is written against
them; the file is named `phase-12-plan.md` because the brief named it so.

Nothing is blocked by the discrepancy, but the label should be deliberate rather than accidental —
`PHASES.md`, `DOMAIN_OWNERSHIP.md` and the eventual report all key off these numbers, and Benefits
already occupies 12. **See D-0.**

### 0.2 The approved specifications are authoritative and this brief differs from them in places

Where the brief and the approved specification disagree, the plan records both and raises a
decision rather than silently preferring one. Two examples: the specification requires **dual
calendars** on every issue and expiry date (§4.1 acceptance criteria) and **notice thresholds with
escalation and recipients**, neither of which the brief mentions. Both are called out below.

---

## 1. Repository analysis

Read: `00_MASTER_INSTRUCTIONS.md`, `00_ENGINEERING_STANDARDS.md`, `00B_LOCALIZATION_AND_STATUTORY_FRAMEWORK.md`,
the 4.1 / 5.1 / 5.2 specifications, `docs/adr/` (0001–0067), `docs/PHASES.md`,
`docs/DOMAIN_OWNERSHIP.md`, `docs/foundation/architecture.md`, `prisma/schema.prisma` (109 models),
and the published contracts, permissions, persistence and API conventions of all eleven completed
modules.

Searched the whole repository for: `DocumentPort`, `document`, `attachment`, `file`, `storage`,
`object`, `blob`, `upload`, `download`, `signed`, `presigned`, `template`, `letter`, `PDF`,
`render`, `retention`, `expiry`, `verification`, `employee_letter`, `S3`, `Azure`, `R2`, `minio`,
`supabase`, `sha256`, `createHash`, `checksum`, `handlebars`, `mustache`, `liquid`, `nunjucks`,
`puppeteer`, `playwright`.

**No `documents` or `letters` module exists.** `packages/modules/` holds eleven: attendance,
compensation, employment, identity, leave, onboarding, organization, payroll, people, recruitment.

---

## 2. Existing document and storage infrastructure

This is the section the brief's §3 asks for, and the answer is **more exists than expected, and
none of it is an implementation.**

### 2.1 What exists

| Thing | Where | State |
| --- | --- | --- |
| `StoragePort` — `put`, `get`, `exists`, `remove`, `signedUrl(key, expiresInSeconds)` | `packages/kernel/src/ports/index.ts` | **Interface only. Zero implementers.** |
| `DocumentPort` — `attach`, `url(documentId, expiresInSeconds)`, `detach` | `packages/kernel/src/ports/document.ts` | **Interface only. Zero adapters.** |
| `DocumentReference` — `documentId`, `fileName`, `contentType`, `sizeInBytes` | same file | Type only |
| `DocumentAttachment` — carries `ownerType`, `ownerId`, `content: Uint8Array`, `confidentiality: 'normal' \| 'confidential'` | same file | Type only |
| `EmailPort`, `SearchPort`, `JobPort`, `FeatureFlagPort` | `ports/index.ts` | Interfaces; `JobPort` has no adapter |
| `ApprovalPort` → `AutoApprovingPort`, `NotificationPort` → `RecordingNotificationPort` | `kernel/src/adapters/in-process-ports.ts` | **Adapters exist** |
| `DisclosurePort` + `StructuredDisclosureLog` | `packages/modules/people` + `apps/api/src/people/people.composition.ts` | **Adapter exists**, writes to the structured logger |
| `LocalizedText` | `packages/kernel/src/value/localized-text.ts` | Exists; its docstring names **letter templates** as its motivating case |

`DocumentPort`'s own docstring already assigns this work: *"Phase 4.1 owns documents and their
expiry; Phase 5.1 owns generated letters."* It also already decided the access model: *"`url`
returns a signed URL with an expiry rather than a path, because an employee's medical certificate
must not remain fetchable by anyone who once saw the link."*

### 2.2 What does not exist

No storage adapter of any kind. No provider SDK — no S3, Azure, R2, minio or Supabase reference
anywhere, including `package.json`. No signed-URL implementation. No hashing utility (`createHash`
appears nowhere; People's `match_key` is a *keyed PII digest*, not a content checksum). No MIME
sniffing. No malware scanning. No PDF library. No template engine. No rendering service. No
retention engine. No `JobPort` adapter, so nothing scheduled runs.

### 2.3 Five modules already hold opaque document references and defer to this phase

| Table | Column | Comment in the schema |
| --- | --- | --- |
| `person` | `photo_document_id varchar(64)` | "A reference into the document store, never bytes in a row." |
| `employment_contract` | `document_reference varchar(128)` | "Employment builds no document management (§24); the store is the future Documents domain's." |
| `recruitment_candidate_profile_entry` | `document_reference varchar(128)` | "Documents are Phase 4.1's." |
| `recruitment_offer` | `document_reference varchar(128)` | — |
| `onboarding_task` | `document_reference varchar(128)` | "A reference into the document store. This module holds no bytes." |
| `leave_request` | `attachment_reference varchar(512)` | "A reference. Leave stores no bytes." |

Three modules independently define the **same validator**:

```ts
/^[A-Za-z0-9][A-Za-z0-9:._/-]{0,127}$/   // employment, recruitment, onboarding
```

This is the repository's existing document-reference format and Phase 12 should adopt it rather
than invent a second one. Two inconsistencies to note: `person.photo_document_id` is `varchar(64)`
and `leave_request.attachment_reference` is `varchar(512)` — both outside the 128 the validator
implies. Neither is Phase 12's to change without a decision (**D-25**).

---

## 3. Phase 0–11 compatibility

| Constraint | Consequence for Phase 12 |
| --- | --- |
| Module-first layout, lint-enforced `domain ◄ application ◄ infrastructure ◄ api` (ADR-0023) | Same structure. No new shared layer |
| One shared `Dispatcher` + `ModuleRegistry` assembled in `identity.module.ts` | Register the same way; nothing new |
| `PostgresUnitOfWork`: transaction-local `app.tenant_id`, post-commit **in-process at-most-once** dispatch, **no outbox** | Correctness must not depend on an event (§36) |
| RLS applied by the creating migration (ADR-0030) | Every new table, in its own migration |
| Bounded service grant (ADR-0043) for cross-module reads | Every People / Employment / Compensation / Payroll read goes through it |
| Audit **columns** (`created_at/by`, `updated_at/by`, `version`, `deleted_at/by`) — via `auditForInsert` | There is **no central audit-log table** anywhere. See §17 |
| Per-domain append-only event tables (`recruitment_application_event`, `onboarding_task_event`, `attendance_time_event`, `leave_request_event`) | The established shape for domain history |
| Per-module tenant-scoped counters (`employment_number_sequence`, `recruitment_number_sequence`, keyed by `series_key`) — the schema explicitly says sharing one would couple two modules | Documents/Letters need their own if numbering is required |
| Permission convention: `Permissions` const object, dotted `module.noun.verb` or `module.verb`, plus `ALL_*_PERMISSIONS` | Follow exactly |
| `exactOptionalPropertyTypes`, no `any`, no `eslint-disable`, budgets 400/300/250/150, complexity ≤10 | Unchanged |
| **No authentication adapter** (ADR-0032) | Every endpoint is unauthenticated in this repository today |

---

## 4. Domain ownership

Phase 12 owns **document metadata, versions, classification, verification, expiry state, letters,
templates, generation and issuance**. It owns **no bytes** and **no rendering**.

It does not own: the People registry; Employment; the employment contract's *terms*; payslips;
Learning certifications (Phase 14); violations and disciplinary actions (Phase 5.2); notification
delivery (Phase 17); approval routing (Phase 16); statutory retention periods (country packs);
government portal connectivity (Phase 22).

### 4.1 One module or two

The roadmap says two (`documents` 4.1, `letters` 5.1). The specifications are separate and their
non-goals point at each other. They have different aggregates, different permissions and different
lifecycles; what they share is that a letter's *artifact* is a document.

Recommendation: **two modules, one phase** — `@work/documents` and `@work/letters`, with Letters
depending on Documents' published contract only. This keeps the roadmap's ownership, keeps each
module inside its budgets, and makes the dependency direction explicit and lint-checkable.
Delivering them as one module would produce the largest module in the repository and blur a
boundary the specifications draw deliberately. **See D-12.**

---

## 5. Person vs Employment ownership

The 4.1 specification, AD-001: *"Documents attach to a Person, an Employment, an Organization
entity or a Dependent. The owner type is explicit and never inferred."*

| Owner | Examples | Rationale |
| --- | --- | --- |
| **Person** | Passport, national ID, residency permit, photograph, education certificate | Survives every employment change. A rehire must not lose their passport scan |
| **Employment** | Employment contract scan, probation confirmation, disciplinary letter artifact, resignation | Meaningless without the employment that produced it |
| **Organization entity** | Commercial registration, tax card, entity licences | Not about a person at all |
| **Dependent** | Dependant ID, medical card | **No `Dependent` model exists** in the schema |

An explicit `owner_type` + `owner_id` pair, validated per type, with `owner_type` on the document
*type* declaring what it may attach to. **No foreign key** to `person` or `employment` — see §49.3.

**Dependent** is unbuildable: nothing in the schema models one. Phase 12 should reserve the
`owner_type` value and refuse it until a Dependents domain exists, rather than model a second
person registry. **See D-1.**

### 5.1 The overlap this inspection found — and it is material

`person_identifier` (People, Phase 4) already stores:

```
identifier_type, value, match_key, issuing_country, issued_on, expires_on, is_primary, withdrawn_at
                                                    ^^^^^^^^^^^^^^^^^^^^^
   index: person_identifier_expiry_idx on (tenant_id, expires_on)
```

The 4.1 specification assigns **`Document`** these same fields: *"identifier number, issuing
authority, issuing country, issue date, expiry date"*.

So a passport's *number and expiry* already have an owner, with an expiry index built for exactly
the query Documents wants to run. A naive Phase 12 would store the number and expiry a second time
and produce two answers to "when does this passport expire".

Three options, none of which may be chosen silently:

1. **Documents holds the file and no identity data.** The passport's number and expiry stay in
   People; a document may *reference* a `person_identifier`. Expiry monitoring for identity
   documents becomes a People read. No duplication; requires a new published People read.
2. **Documents holds its own issue/expiry** and identity documents are duplicated. Simple, and
   wrong — two expiry dates that will disagree.
3. **Documents owns document-bearing identity records and People's identifier becomes the number
   only.** Cleanest conceptually; structurally changes a completed module. **This is a §60 stop
   condition.**

Recommendation: **option 1**. **See D-1a.** This is the single most important decision in this
plan.

---

## 6. Document identity

Stable identity, independent of versions, as the brief's §7 requires and AD-006 already states.

`document` carries: `tenant_id`, `owner_type`, `owner_id`, `document_type_id`, `title`
(`LocalizedText`), `status`, `confidentiality`, `effective_date`, `expiry_date`,
`verification_state`, `current_version_id`, `source`, plus audit columns. Replacing the file
creates a version; the document identity never changes.

`current_version_id` is a denormalization of "the highest version number not superseded". It is
worth its cost — every list view needs the current file's name, size and type — and it must be
maintained inside the same transaction as the version insert, with the version table remaining
authoritative. **See D-2.**

---

## 7. Versioning

`document_version` is **insert-only**: no update path, no remove path, matching the shape Payroll
proved (`SnapshotStore`, `ResultStore` — inserts, reads and a freeze, no general `update`).

Per version: `document_id`, `version_number`, `storage_reference` (opaque), `original_file_name`,
`content_type`, `size_in_bytes`, `content_hash`, `hash_algorithm`, `source`, `verification_state`,
`superseded_at`, `created_at`, `created_by`.

`unique (tenant_id, document_id, version_number)` makes a duplicate version impossible at the
table, and version numbers are allocated inside the transaction that inserts.

Historical versions are never deleted by an ordinary path. Whether they are ever deletable is §19.

---

## 8. Storage boundary

```
Documents domain  ──► document / document_version (metadata + opaque reference)
                              │
                              ▼
                      StoragePort (kernel, Phase 0)   ── interface, zero implementers
                              │
                              ▼
                      Object storage adapter          ── DOES NOT EXIST
```

**Binary storage is `NOT VERIFIED`.** The exact missing dependency is *an implementation of
`StoragePort`* (`packages/kernel/src/ports/index.ts:13`). No provider will be named, no adapter
written, and no bytes stored in PostgreSQL.

`DocumentPort` (`attach` taking `content: Uint8Array`) is the *older* Phase-1 shape and is
byte-carrying. A large-file upload should not pass a `Uint8Array` through an application handler.
The intended production shape is initialize-upload → client sends bytes to a signed URL → complete
-upload records the metadata, which needs `signedUrl` on `StoragePort` and does not need
`DocumentPort` at all. Whether Phase 12 implements `DocumentPort` for its five existing consumers,
supersedes it, or leaves it unimplemented is **D-3**.

Until an adapter exists, the domain is fully testable — metadata, versioning, verification, expiry,
authorization and issuance are all decidable without a single byte. The plan must not pretend
otherwise, and no UI may offer an upload button that cannot work (§53).

---

## 9. File integrity

| Concern | Position |
| --- | --- |
| Hash | **No hashing convention exists.** `createHash` appears nowhere. People's `match_key` is a keyed PII digest and is not a precedent for content integrity. Proposal: **SHA-256**, stored with an explicit `hash_algorithm` column so it can be migrated. **D-5a** |
| Who computes it | Not the browser. Computed where the bytes are — which today is nowhere. Until an adapter exists the hash is **supplied and unverified**, and must be recorded as such rather than trusted |
| MIME type | The browser's value is stored as *claimed*, never trusted. Content sniffing needs the bytes: **NOT VERIFIED** |
| Size | Recorded; enforced as a bound at the API |
| Malware scanning | No infrastructure. **NOT VERIFIED.** A file is never described as "safe" because it uploaded |

---

## 10. Duplicate policy

Nothing in the specifications or the repository settles these, so they are decisions, not defaults.

| Case | Options | Recommendation |
| --- | --- | --- |
| Same title, same owner | permit / refuse / refuse within a type | **Permit.** "Passport" twice is legitimate — an old and a new one — and the *type* is what carries mandatory-satisfaction rules. **D-4** |
| Same content hash, same owner | permit / refuse / permit and flag | **Permit and flag.** Refusing breaks the legitimate case where one PDF genuinely evidences two things; silently accepting hides a mistaken double upload. Surfaced as a reconciliation finding, not an error. **D-5** |
| Same version number | never | Enforced by `unique (tenant_id, document_id, version_number)` |
| Same letter issued twice | see §24 | Deterministic refusal, not an idempotency key |

---

## 11. Categories

`document_type`, tenant-configurable, **nothing hardcoded** — AD-002 is explicit that residency
permits, work permits, passports and national identifiers are *country-pack content*.

Per type: `code`, `name` (`LocalizedText`), permitted `owner_type`s, `expires` (boolean),
`requires_verification`, `confidentiality_level`, `retention_policy_code` (opaque),
`country_pack_id` / `country_pack_version` where a pack supplied it, `active`.

AD-003 adds *"whether it is mandatory, for whom"* — that is `document_requirement` (§11.1). AD-115's
invariant: **a type that expires must define at least one notice threshold.** Notice thresholds are
part of the approved specification and absent from this brief (§0.2) — they belong to expiry
monitoring, which depends on `JobPort`, which has no adapter. **See D-26.**

The seed set (national ID, passport, work permit, contract, certificates, medical, warning letters,
resignation, termination) ships as **default configuration a tenant may edit or disable**, exactly
as the Letters specification requires for letter types. It is not an enum in the domain.

### 11.1 Mandatory-document rules

AD-003 and the acceptance criterion *"missing mandatory documents are detectable for any
population"* require `document_requirement`: a type, a population predicate (employment type,
nationality, legal entity, position), and an effective window. Evaluating it needs Employment and
People reads. This is real scope; it may be deferred, but not silently. **See D-27.**

---

## 12. Expiration

Expiry is **state, never deletion** — the brief and the specification agree.

States: `no_expiry`, `valid`, `expiring_soon`, `expired`.

Three implementations, and the repository already has a strong precedent: Payroll's `stale` is a
*reconciliation-driven materialized* state, and Leave's balance is a projection over an
authoritative ledger.

Recommendation: **derive on read, materialize nothing.** `expiry_date` is the authoritative fact;
`expiring_soon` is `expiry_date <= today + threshold`, answerable by an index on
`(tenant_id, expiry_date) where deleted_at is null`. A materialized status column would need a
scheduled job to stay true, and **`JobPort` has no adapter** — a materialized `expired` flag that
nothing updates is worse than no flag. The expiry *queue* is a bounded query.

Escalating notice thresholds with recipients (AD-004) require both `JobPort` and Communications:
**NOT VERIFIED**. **See D-26.**

---

## 13. Verification

States: `unverified` → `pending_verification` → `verified` / `rejected`.

Upload is never verification. `document_verification` is append-only and records `actor`,
`decided_at`, `decision`, `reason`, and **the `document_version_id` verified** — verification
attaches to a version, so replacing the file returns the document to `unverified` rather than
inheriting a verdict for bytes nobody checked. That is the whole point of versioning here.

`decided_by` comes from the authenticated context, never a request body — Payroll's rule.
`system:auto-approval` must not appear; Compensation and Payroll both assert its absence and
Phase 12 should too.

Whether verification requires a second human (`decided_by <> uploaded_by`, a check constraint as in
Payroll) is **D-6**.

---

## 14. Access control

Proposed, following the repository's naming and Payroll's read/read-result separation:

```
document.type.read            document.type.manage
document.read                 — metadata: that a document exists, its type, status, expiry
document.read-sensitive       — documents whose type is classified confidential
document.download             — obtain a URL for the bytes. Separate from reading metadata
document.manage               — create, replace, archive
document.verify               — decide verification
document.read-own             — the subject's own documents (see §15)
document.audit                — read the access record

letter.template.read          letter.template.manage
letter.read                   letter.manage
letter.generate               letter.issue
letter.read-own
```

**Reading that a document exists is not reading it, and reading it is not downloading it.** AD-007
is explicit: *"Seeing an employee does not imply seeing the employee's medical or disciplinary
attachments."* `employee.read` grants nothing here.

The Letters specification adds AD-005: *a template may not expose salary unless the letter type
permits it **and** the requester holds the permission* — so letter generation is gated twice, by
template declaration and by caller permission. **See D-7.**

---

## 15. Employee visibility

`read-own` is declared in attendance, compensation, leave and payroll — and **enforced by no
handler in any of them.** The permission exists; the mechanism does not.

The data to resolve it exists: `employment_link` maps `membership_id ↔ employment_id` in Identity,
and `identity.describe-member` returns `employments`. But that query takes a **`membershipId`
parameter** and requires `identity.membership.read` — it answers "who is this member", not "who am
I". There is no authenticated-principal resolution, because there is no authentication adapter
(ADR-0032).

So: design the contract, define per-type `employee_visible`, and mark **self-service routing
`NOT VERIFIED`**. Employee identity must never be inferred from a client-supplied employment or
person id — that is an insecure direct object reference wearing a lanyard. **See D-8.**

Defaults to decide: an employee may see their own documents' *metadata*; may download the ones
their type marks employee-visible; may upload where the type permits; may **not** replace a
verified document, and may **not** delete anything.

---

## 16. Manager visibility

**No manager access by default, and none derived from the reporting line.** A manager who can see
that somebody reports to them has no business seeing their passport, medical certificate, salary
certificate or warning letter. If manager visibility is ever wanted it is a per-type
`manager_visible` flag plus an explicit permission, never an inference from
`employment_reporting_line`. **See D-9.**

---

## 17. Audit

The brief says "use the existing audit infrastructure. Do not build a second audit system." The
inspection found that **there is no audit-log system to reuse.** What exists is:

1. **Audit columns** on every row — who created and last updated it. A *read* writes no row, so
   these cannot answer "who downloaded this".
2. **Per-domain append-only event tables** — `recruitment_application_event`,
   `onboarding_task_event`, `attendance_time_event`, `leave_request_event`. This is the established
   shape for domain history.
3. **`DisclosurePort` + `StructuredDisclosureLog`** — People records every read of an identifier
   *value* through the application's structured logger. A log line, not a queryable row.

Document access is exactly the disclosure problem, one step larger. Two honest options:

- **Reuse the disclosure-log pattern.** Consistent with People, no new table, and **not queryable**
   — "who accessed this document last year" becomes a log search, not an API.
- **An append-only `document_access_event` table.** Follows the domain-event-table precedent,
   queryable, and satisfies `document.audit` as an endpoint — at the cost of a write on every read.

Neither is "a second audit system"; both use an existing precedent. Recommendation: **the table**,
because an HR document access trail that cannot be queried cannot answer a subject access request.
**See D-23.**

Never logged: file contents, signed URLs, bytes.

---

## 18. Retention

Phase 12 records `retention_policy_code` (opaque), `legal_hold` (boolean, with actor and reason),
and derives `deletion_eligible`. It defines **no period**: statutory retention is country-pack
content and GRC (Phase 21) owns the framework, as the 4.1 specification's configuration section
states.

**No retention engine exists** and `JobPort` has no adapter: enforcement is **NOT VERIFIED**. A
legal hold must refuse deletion regardless. **See D-11.**

---

## 19. Deletion and archive

| Operation | Position |
| --- | --- |
| Soft delete | The repository-wide `deleted_at` / `deleted_by`, for a mistaken record |
| Archive | A status, not a deletion. The document stays readable to `document.read` holders |
| Verified historical document | **Never deletable through an ordinary DELETE endpoint.** The brief is explicit and this plan agrees |
| Version deletion | Never. Versions are insert-only |
| Legal hold | Refuses deletion of any kind |
| Permanent deletion | A distinct, separately-permissioned, audited operation — or out of scope |
| Tenant offboarding | Phase 24's. Not built here |

Whether permanent deletion exists at all in this phase is **D-10**. Payroll's precedent —
immutability enforced by a database trigger — is available if an issued letter or verified document
must be unalterable at the table (ADR-0066), and is the mechanism to reach for rather than a new
one.

---

## 20. Employee letters

A letter is **not an uploaded PDF**. Per the 5.1 specification and the brief's §44:

```
LetterTemplate (versioned)
      │
      ▼
LetterRequest ──► approval ──► generation ──► IssuedLetter ──► Document + version (the artifact)
```

`IssuedLetter` carries the frozen content, the template version, every substituted value, a
reference number, the issue date, the signatory, the file reference, a verification token and
`superseded_by`.

Letters owns **no business data** (5.1 AD: *"Every value in a letter is read from the domain that
owns it, at the moment of issue, and frozen into the issued document"*).

Standard types — employment certificate, salary certificate, bank transfer letter, experience
certificate, embassy letter, NOC, secondment, promotion, transfer, confirmation, contract renewal,
end-of-service — ship as **default templates**, none hardcoded, none an endpoint of its own.

---

## 21–22. Templates and template versioning

Templates are tenant-configurable, versioned, and authored in **both** languages (5.1 AD-001).

`letter_template` (identity, code, ownership) + `letter_template_version` (body per language,
variable declarations, exposed field set, approval requirement, letterhead reference, status).

**A template version that has issued a letter is immutable.** Editing creates a new version;
historical letters retain the version they used. This is the same shape as Payroll's calculation
version and snapshot digest, and the same mechanism is available to enforce it at the table.

**Variables are a safe substitution model** — a declared allow-list of named fields bound to
published contract reads. No expression language, no SQL, no executable template, nothing
Turing-complete. `LocalizedText` and the kernel's existing `{name}` catalogue interpolation are the
precedent. **See D-13.**

---

## 23. Letter data sources

Every value comes from a published contract under a bounded service grant:

| Source | Contract | Exists |
| --- | --- | --- |
| People | person reads; identifier **value** behind `people.identifier.read-value` + `DisclosurePort` | ✅ |
| Employment | employment, contract, assignment reads | ✅ |
| Organization | legal entity, unit, position reads | ✅ |
| Compensation | `compensation.payroll-period` and the recurring reads | ✅ |
| Payroll | `payroll.results`, `payroll.payslip` — behind `payroll.read-result` | ✅ |

No table of another module is read. No employee or salary data is duplicated into the document
domain **except** as the immutable generated snapshot (§24) — which is the one case the brief
permits and the specification requires.

---

## 24. Generation, issuance and the snapshot

A generated letter must be reproducible, and *"if the employee's salary changes later, an
already-issued salary certificate must not silently change"* (brief §24; AD-003).

On issue, freeze: the template version, the **substituted values** (the snapshot), the locale, the
generated timestamp, the actor, the source references and versions, and the resulting document
version. This is Payroll's ADR-0064 argument applied to letters, and it is the same reason.

Re-issuing produces a **new** letter marked superseding the original; the original is never
overwritten.

`payroll.read-result`-derived figures inside a letter mean the *requester's* permission gates
generation — a letter must not become a way to read a salary the caller could not read directly.

---

## 25. Approval

Letter types declare their approval requirement (5.1 AD-004: *"Approval routes through Workflow"*).
**Workflow is Phase 16 and does not exist.**

Follow Compensation and Payroll exactly: record the decision in the module's own table, with
`decided_by` from the authenticated context, a check constraint refusing self-approval where
required, reversal instead of edit, and **no `system:auto-approval` row**. Publish the integration
point so Phase 16 changes the source and not the contract — Payroll already proved this by shaping
its chain to `ApprovalPort`'s view. Do not build a workflow engine. **See D-14.**

---

## 26–27. PDF and signature boundaries

**No PDF service exists.** No library, no renderer, no headless browser. Phase 12 defines:

```
IssuedLetter ──► render request ──► (nothing) ──► document version
```

and marks **rendering `NOT VERIFIED`**. The letter's *content* — the frozen substituted values and
the template version — is fully owned, testable and reproducible without a renderer; only the
artifact is missing. This is exactly Payroll's payslip position (`ReadPayslip` returns data; no
document exists), and it is consistent.

**No signature infrastructure exists** — no provider, no signing contract, no certificates. A
letter type may *declare* a signature requirement and a letter may record signature *status*, but
signing is **NOT VERIFIED** and nothing may imply a signature occurred. **See D-15, D-16.**

---

## 28. Localization

Both first-class languages, RTL for Arabic, direction following language — the admin convention
already in every module screen.

Template bodies are `LocalizedText`-shaped rather than duplicated templates per language, so a
variable change cannot be applied to English and forgotten in Arabic. `check-localization` gates the
module's own catalogues (11 sets today).

The 4.1 acceptance criteria require **issue and expiry dates in both calendars** and 5.1 requires
letters to *"render correctly RTL and LTR, with both calendars"*. The kernel has calendar support
(`packages/kernel/src/time/calendar.ts`, Hijri-aware). Dual-calendar storage vs. derivation on read
is **D-28**.

---

## 29. Search

Dimensions: owner, title, type, status, expiry window, verification state, document number, date
range, issuing authority.

Every search tenant-scoped, permission-aware, bounded and paginated — default 50, maximum 200, as
Payroll.

**The `ILIKE` trap is real and already present**: `employment_search.ts`, `person-search.ts`,
`unit.repository.ts`, `position.repository.ts` and `business-profile.repository.ts` all use
`ilike '%' || $n || '%'`, which cannot use a B-tree index. At millions of versions this is the
thing that will fail. Options: trigram indexes (`pg_trgm`), a prefix-anchored search, or the unused
`SearchPort`. Benchmark before choosing. **See D-21.**

Expiry and verification queues are *filters*, not text search, and must be plain indexed
predicates — they are the highest-value queries in the domain and must not go through `ILIKE`.

---

## 30. Numbering

Issued letters need a reference (5.1 AD-006: *"a unique reference and, where the tenant enables it,
a verification mechanism allowing a third party to confirm authenticity without seeing employee
data"*).

The convention is a per-module, per-tenant counter table keyed by `series_key`
(`employment_number_sequence`, `recruitment_number_sequence`), and the schema explicitly records
that sharing a counter across modules would couple them. Letters gets its own; Employment's is not
reused; a PostgreSQL sequence is not used because the requirement is tenant-scoped and gapless.

The **verification token** is a separate concern from the reference number: it must be
unguessable, and third-party verification must reveal authenticity **without** employee data.
Documents themselves need no number unless a product requirement appears. **See D-20.**

---

## 31. Reconciliation

Pull-based, following Payroll: correctness never depends on an event arriving.

| Check | Action |
| --- | --- |
| Missing storage object | Report. Never delete metadata |
| Checksum mismatch | Report. Never overwrite |
| Expired document | Derived on read (§12), so nothing to reconcile |
| Verification inconsistency (verified version superseded) | Report |
| Issued letter with no document version | Report — a generation that half-failed |
| Template/version mismatch | Report |
| Orphaned storage reference | Report |
| Duplicate content hash | Report (§10) |

**Reconciliation modifies nothing.** Payroll's reconciliation records findings and repairs nothing,
and that is the precedent. **See D-22.**

---

## 32–38. Module integrations

| Module | Direction | Position |
| --- | --- | --- |
| **People** | Documents → People | Owner resolution and identity-document data (§5.1). No Person data duplicated. No second registry |
| **Employment** | Documents → Employment | Owner resolution, letter data. **No document column added to Employment**; `employment_contract.document_reference` already exists and stays as-is |
| **Organization** | Documents → Organization | Entity-owned documents, letterhead entity, letter data |
| **Compensation** | Letters → Compensation | Salary certificates, via the published contract |
| **Payroll** | Letters → Payroll | Salary/income letters, behind `payroll.read-result` |
| **Recruitment** | Recruitment → Documents | Candidate documents at hire — see below |
| **Onboarding** | Onboarding → Documents | Collected documents — see below |
| **Leave** | Leave → Documents | `leave_request.attachment_reference` already exists |

### 38.1 Recruitment and Onboarding promotion

Both already hold `document_reference` columns. **Do not copy files.** The promotion model is:
create an `employee_document` whose current version carries the **same opaque storage reference**,
recording `source = 'recruitment' | 'onboarding'` and the originating id.

Whether Phase 12 also *changes* those modules to point at the new document (a structural change to
completed phases) or leaves their references untouched and merely references them, is **D-17**.
Recommendation: leave them untouched. Their columns are opaque strings and already correct.

---

## 39. Disciplinary boundary

The competitive gap is real, and **Employee Relations (Phase 5.2) is a separate approved domain**
that owns violations, investigations, warnings, disciplinary actions, grievances and appeals — with
its own immutability, restricted access, due-process enforcement and country-pack constraints.

The Letters specification already draws the line: *"Warning letter — issued from Employee
Relations, rendered here."*

**Phase 12 owns the letter and the document artifact. It does not own the disciplinary record.**
Building a disciplinary domain inside Documents would be a second owner for a legally-weighted
record. **See D-18.**

---

## 40. Country compliance boundary

Nothing country-specific ships: no Jordanian or Saudi retention rule, no residency or work-permit
rule, no country-specific identity-document requirement. Country packs later supply document types,
required categories, retention periods, expiry rules and regulatory requirements — the extension
point is `document_type.country_pack_id` / `country_pack_version`, the same shape Payroll used.
**See D-24.**

---

## 41. Notifications

Not implemented. `NotificationPort` exists with a `RecordingNotificationPort` adapter, but nothing
delivers anything and Communications is Phase 17. Expiry notices, rejection notices and
letter-ready notices are **NOT VERIFIED**.

---

## 42. Events

Post-commit, in-process, at-most-once, no outbox — unchanged. Correctness must not depend on an
event. Expiry, missing verification, pending generation and retention eligibility are all
**queries**, not event consequences. No general event bus is built.

---

## 43. API

`/api/v1/documents` and `/api/v1/letters`. All collections bounded. All downloads authorized
**before** any URL is generated. No raw storage URL ever returned.

Document types · documents (list, read, create) · versions · upload initialization · upload
completion · download authorization · verification · expiry queue · archive · restore · access
audit · letter templates · template versions · letters · generation · issuance · letter register ·
verification token check.

Upload initialization and completion are **declared and `NOT VERIFIED`** until a `StoragePort`
adapter exists; they must not be shipped in the UI as working controls.

---

## 44. Admin UI

Documents · Employee Documents · Document Categories · Verification Queue · Expiring Documents ·
Letters · Letter Templates · Generated Letters · Document Audit.

Read-only, consistent with every module screen. English/Arabic with direction following language.
**No UI for a capability marked `NOT VERIFIED`** — no upload button, no download button, no
"generate PDF" button that cannot work. Where a capability is absent the screen says so, exactly as
the Payroll screens state that nothing is posted or executed.

---

## 45. Employee self-service boundary

Contract designed; **routing `NOT VERIFIED`** (§15). Employee identity is never inferred from a
client-supplied identifier.

---

## 46. Authorization

Per §14. Sensitive operations get their own permissions. Enforcement stays where it is in every
module: the application handler declares the permission and the kernel pipeline enforces it, so the
HTTP edge can neither widen nor narrow access.

---

## 47. Tenant isolation

RLS on every new table — document types, documents, versions, requirements, verifications, access
events, letter templates, template versions, letters, issued letters, and the number sequence —
applied by the creating migration via `app_protect_table` (ADR-0030).

Tested as an **unprivileged role** holding no `BYPASSRLS`, in both directions, exactly as Payroll's
isolation suite does. A cross-tenant identifier is **404, never 403**.

---

## 48. Storage security

- Opaque storage reference, never a path or a URL, never a provider name.
- Short-lived signed URL only, issued **after** the permission check.
- Never a permanent public URL for an HR document.
- Never storage credentials in a response.
- Signed URLs never logged (§17).
- URL lifetime bounded and short; reuse beyond it is the adapter's to prevent.

All of this is design-only until an adapter exists: **NOT VERIFIED**. **See D-19.**

---

## 49. Database design

Every table below must be justified in the final plan revision, and this section is deliberately a
*proposal*, not an approved schema.

| Table | Why it is a table and not a column or projection |
| --- | --- |
| `document_type` | Tenant configuration with its own lifecycle and country-pack origin |
| `document` | The stable identity (§6) |
| `document_version` | Immutable history; a column cannot hold many (§7) |
| `document_verification` | Append-only decisions with actor and reason; more than one per document |
| `document_access_event` | Queryable access trail (§17) — **only if D-23 chooses the table** |
| `document_requirement` | Mandatory rules by population — **only if D-27 includes them** |
| `letter_template` | Identity, stable across versions |
| `letter_template_version` | Immutable once used (§22) |
| `letter_request` | The request lifecycle, distinct from what was issued |
| `issued_letter` | The frozen artifact and its snapshot (§24) |
| `letter_approval_decision` | Named-human decisions, reversal not edit (§25) |
| `letter_number_sequence` | Tenant-scoped gapless counter (§30) |

**Not proposed**: a separate `document_status` table (a column), a separate `document_expiry` table
(derived, §12), a `document_access` ACL table (permissions plus type classification, §14), and a
`letter_register` table (a query over `issued_letter`, per §20 — the specification names it as a
concept, not necessarily a table).

### 49.1 Indexes

`(tenant_id, owner_type, owner_id)`; `(tenant_id, expiry_date) where deleted_at is null`;
`(tenant_id, verification_state)`; `(tenant_id, document_type_id)`;
`(tenant_id, document_id, version_number)` unique; `(tenant_id, content_hash)` for duplicate
detection; letter reference unique per tenant. Text search per D-21.

### 49.2 Uniqueness and immutability

`unique (tenant_id, document_id, version_number)`. `unique (tenant_id, code)` on document types and
letter template codes. `unique (tenant_id, reference_number)` on issued letters. Immutability of an
issued letter and a verified version may use the ADR-0066 trigger mechanism — with the same bar the
architecture doc now sets: application enforcement is insufficient, no declarative constraint can
express it, alternatives compared in an ADR, cost measured.

### 49.3 The foreign-key question the brief raises

Phase 11 found that a cross-module FK does not enforce tenant isolation and dropped
`payroll_group.legal_entity_id`'s FK on the ADR-0042 precedent. The same applies here: **no foreign
key from `document.owner_id` to `person` or `employment`.** A polymorphic owner cannot carry one
anyway, and a per-tenant FK would need a composite `(tenant_id, id)` key that the referenced tables
do not expose. Ownership is validated through published reads.

FKs **within** the phase's own tables (version → document, verification → version, issued letter →
template version) are ordinary and correct. **See D-2, and D-29 if composite tenant-scoped FKs are
wanted repository-wide — that is a change to completed phases and a stop condition.**

---

## 50. Performance

Budgets to be measured as an **unprivileged role under RLS**, at 10,000 and 100,000 employees and
**millions of document versions** — the version table is the one that grows without bound.

| Operation | 10,000 | 100,000 | Millions of versions |
| --- | --- | --- | --- |
| One employee's document list | ≤ 50 ms | ≤ 50 ms | ≤ 100 ms |
| Document metadata read (with current version) | ≤ 30 ms | ≤ 30 ms | ≤ 50 ms |
| Expiry queue, one page | ≤ 100 ms | ≤ 300 ms | ≤ 500 ms |
| Verification queue, one page | ≤ 100 ms | ≤ 300 ms | ≤ 500 ms |
| Document search, one page | ≤ 200 ms | ≤ 500 ms | ≤ 1 s |
| Missing-mandatory scan (if D-27) | ≤ 2 s | ≤ 20 s | — |
| Letter template lookup | ≤ 20 ms | ≤ 20 ms | ≤ 20 ms |
| Letter source-data resolution (one letter) | ≤ 300 ms | ≤ 300 ms | ≤ 300 ms |
| Letter register, one page | ≤ 100 ms | ≤ 200 ms | ≤ 300 ms |

Binary upload and download bandwidth is **not** a domain benchmark and will not be measured as one.
A failing number is reported before it is fixed, the target is not moved, and the first failed
measurement is retained — Phase 10 and Phase 11's discipline.

---

## 51. Concurrency

Two-connection tests against real PostgreSQL: two uploads for the same document; two version
replacements racing for the same version number; two verification decisions; two edits of the same
template version; two generations of the same letter request; duplicate issuance; concurrent
archive and delete; concurrent expiry evaluation. Database constraints remain authoritative.

---

## 52. Idempotency

**No request-level idempotency infrastructure exists**, and none will be claimed. `JobPort` declares
an `idempotencyKey` but has no adapter.

What the domain provides is deterministic convergence or refusal: replacement always creates a new
version (never a duplicate); a repeated verification of the same version is refused by the state
machine; a repeated generation for an issued letter is refused; archive and delete converge. A
retried request receives a refusal, not the original response, and the report will say so in those
words — as Phase 11's did.

---

## 53. Testing

**Domain** — identity stability across versions; version immutability; replacement; verification
attaching to a version; expiry derivation; archive and restore; deletion restrictions; legal hold;
template versioning; template immutability once used; generation; issuance; supersession; duplicate
handling; letter snapshot freezing.

**PostgreSQL** — RLS both directions on every table, unprivileged role; unique constraints;
concurrency; insert-only version tables; immutability of issued letters; tenant isolation of every
read, write and page total.

**Security** — cross-tenant read and write; unauthorized download; sensitive-document access;
manager restriction; employee restriction; download authorized before URL generation; no raw
storage URL in any response; enumeration resistance; no signed URL and no file content in any log.

**Reliability** — lost event; missing storage object; repeated upload; repeated generation;
concurrent verification; concurrent replacement; reconciliation finding rather than repairing.

**Cross-module** — People, Employment, Organization, Compensation, Payroll, Recruitment, Onboarding
through their **real published contracts**. No fake adapter stands in for a production path. Where a
contract genuinely does not exist, the capability is `NOT VERIFIED` rather than faked.

**Final production scenario** — one chain, everything real, following Phase 11's precedent:

```
Person + Employment → document type → document → version → verification →
expiry state → letter template + version → letter request → approval →
generation with frozen snapshot → issuance → artifact reference →
immutable historical letter → supersession
```

---

## 54. Security testing

Every item in the brief's §61 becomes an assertion: cross-tenant reads; insecure direct object
references; public storage URLs; unauthorized downloads; manager access to sensitive documents;
employee access to HR-only documents; document enumeration; signed-URL lifetime; audit-log leakage;
file-content logging. Anything unverifiable is marked `NOT VERIFIED` rather than assumed.

---

## 55. Risks

| Risk | Severity | Mitigation |
| --- | --- | --- |
| **No storage adapter** — the domain's reason for existing is half-absent | **High** | Metadata, versioning, verification, expiry, authorization and issuance are all fully deliverable and testable without bytes. Ship those; mark storage `NOT VERIFIED`; name the exact missing dependency |
| **People / Documents expiry overlap** (§5.1) | **High** | D-1a, decided before any table is created |
| **No PDF renderer** — a letter with no artifact | **High** | The frozen content is the owned, reproducible part. Payroll's payslip precedent exactly |
| Two modules, one phase — largest phase so far | Medium | Documents first, Letters on its published contract; separate budgets |
| `ILIKE` search at millions of versions | Medium | Benchmark before choosing; expiry and verification queues never use it |
| Access-event write on every read | Medium | Measure it; D-23 |
| Scope creep from requirements, notice thresholds, dual calendars (all in the approved spec, none in the brief) | Medium | D-26, D-27, D-28 — decided explicitly, deferred explicitly |
| Self-service demanded before authentication exists | Medium | Contract only; routing `NOT VERIFIED` |

---

## 56. Technical debt

Carried forward from Phase 11 and **not addressed here**: finalization timing and batching, 561 MB
finalization peak, `row-writer.ts` duplication, exact-count cost, `payroll.read-result` withholding
inference.

Newly identified by this inspection, for decision rather than silent fixing:

- `person.photo_document_id varchar(64)` and `leave_request.attachment_reference varchar(512)` do
  not match the 128-character document-reference validator the other three modules share (**D-25**).
- `isDocumentReference` is defined identically in three modules — a seventh instance of the
  copy-rather-than-hoist pattern `row-writer.ts` already carries.
- `read-own` is declared in four modules and enforced in none.
- `DocumentPort` and `StoragePort` are two overlapping abstractions for one concern (**D-3**).

---

## 57. NOT VERIFIED capabilities

Binary storage · signed URL generation · upload and download execution · content hashing verified
at rest · MIME sniffing · malware scanning · PDF rendering · document preview · electronic
signature · notification delivery · expiry notice thresholds and escalation · scheduled evaluation
of any kind (`JobPort` has no adapter) · retention enforcement · employee self-service routing ·
third-party verification portal · country-pack document content · government portal integration.

Each is absent rather than stubbed, and no UI will offer a control for one.

---

## 58. Decisions requiring approval

| | Decision | Recommendation |
| --- | --- | --- |
| **D-0** | Phase numbering: this brief's "12" vs the roadmap's 4.1 + 5.1 (12 is Benefits) | Deliver as 4.1 + 5.1; keep the plan filename as instructed; update `PHASES.md` accordingly |
| **D-1** | Owner types: Person, Employment, Organization entity, Dependent | Person + Employment + Organization entity. **Reserve Dependent and refuse it** — no `Dependent` model exists |
| **D-1a** | **People/Documents identity-document overlap** (`person_identifier` already holds number, issuing country, issue and expiry with an expiry index) | **Documents holds the file and references the identifier; People keeps number and expiry.** Requires a new published People read. The alternative that reads best structurally changes a completed module |
| **D-2** | Document/version aggregate; `current_version_id` denormalization | Stable document + insert-only versions; maintain `current_version_id` in the same transaction, version table authoritative |
| **D-3** | `DocumentPort` (byte-carrying, Phase 1) vs `StoragePort` (key + signed URL) | Build against `StoragePort`'s initialize/complete shape. Decide whether `DocumentPort` is implemented for its five existing consumers, superseded, or left alone |
| **D-4** | Duplicate title | Permit |
| **D-5** | Duplicate content | Permit and flag via reconciliation |
| **D-5a** | Hash algorithm — none exists in the repository | SHA-256, with an explicit `hash_algorithm` column |
| **D-6** | Verification lifecycle; second-human requirement | Four states, attached to a **version**; decide whether `verified_by <> uploaded_by` is constrained |
| **D-7** | Sensitive classification and the read/download split | Per-type confidentiality; `document.read` ≠ `document.download` ≠ `document.read-sensitive` |
| **D-8** | Employee visibility | Per-type `employee_visible`; contract only, routing `NOT VERIFIED` |
| **D-9** | Manager visibility | **None by default and never derived from the reporting line** |
| **D-10** | Deletion and archive; does permanent deletion exist in this phase | Soft delete + archive; verified historical documents never deletable by an ordinary path; legal hold refuses everything |
| **D-11** | Retention metadata | Opaque policy code + legal hold; enforcement `NOT VERIFIED` |
| **D-12** | One module or two | **Two** — `@work/documents`, `@work/letters` |
| **D-13** | Template versioning and the variable model | Immutable once used; declared allow-list of variables; no expression language |
| **D-14** | Letter approval before Workflow exists | Record named-human decisions in-module, publish the Phase 16 integration point, no `system:auto-approval` |
| **D-15** | PDF generation ownership | Not this phase. `NOT VERIFIED` |
| **D-16** | Signature integration | Not this phase. Record requirement and status only |
| **D-17** | Recruitment/Onboarding promotion | Reference the same opaque storage reference; **do not modify those modules** |
| **D-18** | Disciplinary boundary | Phase 12 renders the letter; **Employee Relations (5.2) owns the record** |
| **D-19** | Storage security | Opaque reference, short-lived signed URL after authorization; `NOT VERIFIED` until an adapter exists |
| **D-20** | Numbering | Letters gets its own tenant-scoped `series_key` counter; documents unnumbered unless required; verification token separate and unguessable |
| **D-21** | Search strategy | Benchmark before choosing between `pg_trgm`, prefix-anchored search and `SearchPort`. Queues never use `ILIKE` |
| **D-22** | Reconciliation | Pull-based; reports only; modifies nothing |
| **D-23** | Access audit: disclosure log vs `document_access_event` table | **Table** — an unqueryable HR access trail cannot answer a subject access request |
| **D-24** | Country-pack extension point | `country_pack_id` / `country_pack_version` on document type and letter template |
| **D-25** | `photo_document_id varchar(64)` and `attachment_reference varchar(512)` inconsistency | Note as debt; do not change completed phases in this phase |
| **D-26** | Notice thresholds and escalation (approved spec, absent from the brief) | Model the thresholds; mark firing `NOT VERIFIED` — no `JobPort` adapter |
| **D-27** | `document_requirement` / missing-mandatory detection (approved spec acceptance criterion) | Include or defer — explicitly, either way |
| **D-28** | Dual-calendar issue and expiry dates (approved spec acceptance criterion) | Derive on read from the kernel's calendar support rather than storing twice |
| **D-29** | Composite `(tenant_id, id)` keys so cross-module FKs could enforce tenant isolation | **Out of scope.** A repository-wide change to completed phases |

---

## 59. Stop conditions encountered during planning

Raised here rather than worked around, per the brief's §60:

1. **Binary storage is absent and the domain needs it.** `StoragePort` has no implementer. Named as
   the exact dependency; nothing invented.
2. **PDF rendering is absent and letters need it.** No library, no service. Marked `NOT VERIFIED`.
3. **Signature infrastructure is absent.** Marked `NOT VERIFIED`.
4. **Self-service routing is unavailable** — no authentication adapter, `read-own` enforced nowhere.
   Contract only.
5. **`JobPort` has no adapter**, so nothing scheduled runs — this removes materialized expiry and
   notice escalation from what can honestly be built.
6. **A completed module may need to change** for D-1a option 3 and for D-29. Both are flagged, and
   the recommendation in each case avoids the change.
7. **Disciplinary actions would require a new domain.** Boundary drawn at the letter; Phase 5.2 owns
   the record.
8. **There is no audit-log system to reuse** — the brief assumed one exists. Two honest options
   given in §17 rather than a silent choice.

---

## 60. Definition of Done for the implementation phase

- Every table, aggregate, FK, index, unique constraint, RLS policy and immutable boundary justified.
- RLS proven on every table as an unprivileged role, both directions.
- Download authorized before any URL is generated; no raw storage URL in any response.
- Versions immutable; issued letters immutable; template versions immutable once used.
- Letter snapshots reproducible — a later salary change cannot alter an issued certificate.
- Concurrency, security, reliability and cross-module suites green against real PostgreSQL.
- Performance measured at 10,000 / 100,000 employees and millions of versions, under RLS, with any
  missed budget reported rather than re-budgeted.
- `pnpm verify` green: standards, architecture, localization, dependencies, format, lint, typecheck,
  test, build. No `any`, no `eslint-disable` beyond existing fixture precedent, no `TODO`, no
  `FIXME`, no skipped or disabled test, no cross-module table access, no fake integration.
- Final production scenario green.
- Report at `docs/verification/phase-12-report.md`, with the `NOT VERIFIED` list intact and the
  debt register carried forward.

---

**No code, schema, migration, controller, UI, storage adapter or ADR was created in this
checkpoint.** Awaiting approval of the decisions in §58 — D-0, D-1a, D-3, D-12 and D-23 in
particular, since the rest depend on them.
