# Phase 12 — Employee Documents, Letters & HR Document Management — Verification Report

**Status** Complete · **Date** 2026-08-11 · **Baseline** Phase 11 at `0807b1d` · **Plan**
[`phase-12-plan.md`](phase-12-plan.md)

**Documents says what evidence exists about somebody and who has looked at it. Letters says what
this employer stated about somebody, and freezes it.** Phase 12 built both, and neither holds a
byte of file content — because nothing in this repository can.

---

## 1. What was built

Eleven tables across three migrations, **two modules** (`@work/documents`, `@work/letters`) of 98
source files including 16 test suites, two locale catalogue sets, seven API controllers with two
API security suites, two admin screens, six cross-module adapters, and a benchmark at two
populations.

Every approved decision D-1…D-29 was implemented as approved, or explicitly deferred where the plan
deferred it. None was silently redesigned.

| | Decision | As built |
| --- | --- | --- |
| **D-1** | `dependent` as an owner type | **Refused.** `RESERVED_OWNER_TYPES` names it and the type rejects it. Nothing in this repository models a dependent, and reserving the word without a subject would invite a second person registry inside Documents |
| **D-1a** | Who owns a document's expiry | **People does, where the document evidences an identifier.** A check constraint refuses a document that carries both a `person_identifier_id` and its own `expiry_date`; the view reports People's date and says `expiryOwnedByPeople`. Proved end-to-end: the cross-module suite changes the expiry in People and the document's view moves with it |
| **D-5** | Duplicate content | **Permitted and surfaced.** Two employees legitimately hold the same blank form. `addVersion` returns the other versions holding the same hash; reconciliation reports them |
| **D-5a** | Hash algorithm | SHA-256, with an explicit `hash_algorithm` column and a check constraint. `hash_verified` is **false on every row**: nothing has re-computed a hash against stored bytes, because no storage adapter exists |
| **D-6** | Second-human verification | **Not required**, exactly as approved. A single HR verifier is the ordinary case, and a two-person rule would make the feature unusable for a forty-person customer with one HR administrator. What is not optional is *who*: `decided_by` comes from the authenticated context, and the API refuses a body that carries one |
| **D-7** | The read/download split | Three permissions, deliberately distinct. `document.read` ≠ `document.read-sensitive` ≠ `document.download`, asserted at the HTTP edge |
| **D-9** | Manager visibility | **None by default and never derived from the reporting line.** A check constraint refuses `manager_visible` on a confidential type |
| **D-10** | Permanent deletion | **Does not exist in this phase.** There is no transition to a deleted state and no repository method that could reach one |
| **D-12** | One module or two | **Two.** Letters depends on Documents' *concepts* and on none of its tables |
| **D-13** | The variable model | A declared allow-list of names, `[a-z][A-Za-z0-9]*` with up to three dotted segments. **No expression language, no operator, no function call.** Substitution is a map lookup; the API refuses `person.fullName \|\| salary.monthly` at the DTO |
| **D-14** | Approval before Workflow exists | Recorded in the module's own table, following Compensation and Payroll exactly. `system:auto-approval` appears nowhere. A reversal does not erase what it reverses |
| **D-20** | Numbering | Letters has its own tenant-scoped `series_key` counter. Not a PostgreSQL sequence: a rolled-back issue would burn a number and leave a permanent gap nobody could explain (ADR-0039). The verification token is separate and comes from `randomBytes(32)` |
| **D-21** | Search strategy | The two queues are **plain indexed predicates, never `ILIKE`**. Measured: §7 |
| **D-22** | Reconciliation | Pull-based; reports only; modifies nothing. Asserted by reading both documents back after a duplicate finding |
| **D-23** | The access audit | A **table**, not a disclosure log. An unqueryable HR access trail cannot answer a subject access request |
| **D-25** | The reference-format inconsistency | **Recorded as debt, not fixed.** See §6 |
| **D-26** | Notice thresholds | Modelled as configuration. **Nothing fires them** — `NOT VERIFIED` |
| **D-27** | Mandatory-document detection | **Deferred**, as the plan permitted. No table, no query, no partial implementation |
| **D-28** | Dual-calendar dates | Derived on read from the kernel's conversion. Never stored twice — two stored dates are two things that can disagree |
| **D-29** | Composite tenant keys | Out of scope, as approved |

---

## 2. Quality gates

`pnpm verify` — **PASS**, in full, at the commit this report accompanies.

`check-standards`, `check-architecture` (120 models), `check-localization` (13 catalogue sets),
`check-dependencies` (1,102 source files, no cycles, no unused dependencies, no unreachable files),
`format:check`, `lint`, `typecheck`, `test`, `build`.

**1,647 tests, none skipped**, with `TEST_DATABASE_URL` set so every integration suite executed
rather than self-skipping.

No `any`, no `eslint-disable`, no `TODO`, no `FIXME`, no skipped test and no disabled check was
introduced. Two narrow ESLint exemptions were added, each scoped to
`src/**/*.integration.test.ts` and `src/**/*.fixture.ts` and each matching the one
`packages/modules/payroll` already carries: an integration fixture chooses which database to
connect to, and no business code lives in either.

---

## 3. Tests

**200 tests** across the two modules and the API app — 92 in `@work/documents`, 77 in
`@work/letters`, 31 in `@work/api`.

| Suite | Count | Runs against |
| --- | --- | --- |
| Documents domain — `documents-domain`, `documents-file` | 31 | Nothing. Pure |
| Documents application — `documents-lifecycle`, `documents-access`, `documents-search` | 31 | In-memory stores, through the real dispatcher |
| Documents integration — persistence, isolation, immutability, concurrency | 30 | **Real PostgreSQL**, as an unprivileged role |
| Letters domain — `letters-domain` | 24 | Nothing. Pure |
| Letters application — `letters-lifecycle`, `letters-issuance` | 27 | In-memory stores, through the real dispatcher |
| Letters integration — persistence, isolation, immutability, concurrency | 26 | **Real PostgreSQL**, as an unprivileged role |
| Cross-module — `phase-twelve`, `phase-twelve-letters` | 11 | The **real adapters**, real bounded service grants, one real dispatcher |
| API security — `documents.security`, `letters.security` | 20 | The **real controllers**, real validation pipe, real global filter |

Every integration suite connects as a role that **owns nothing and holds no `BYPASSRLS`**. A
superuser bypasses every policy, so a suite run as one would report that isolation works without
having checked — and in these modules that would mean claiming one tenant cannot read another's
medical certificates on no evidence.

Every concurrency assertion starts **two real transactions on two real connections** and lets them
race. A suite that awaited one and then the other would prove only that sequential writes work.

---

## 4. Defects found by tests, before the fix

Two, both in the schema this phase had already committed, both found because a suite asserted the
*permitted* case alongside the refusals rather than only the refusals.

### 4.1 `document_version` could not be superseded at all

`20260811120000_documents_letters` made `document_version` refuse every update and every delete.
That is right for the row's content and wrong for exactly one column: `superseded_at` is the stamp
saying a version is no longer current, and replacing a file writes it.

**As shipped, adding a second version to a document was impossible.** The insert succeeded and the
stamp on the previous version raised `document_version_immutable`. Every in-memory suite passed —
the fake permitted the stamp — and the defect only appeared against real SQL.

`20260811140000_document_version_supersede` **narrows** the rule rather than relaxing it. An update
is permitted only when `superseded_at` moves from null to a value **and every other column is
byte-for-byte identical** apart from the three audit columns recording the stamp. A second
supersession, a stamp that smuggles a content change alongside it, clearing the stamp, and every
delete remain refused. Three assertions cover each case.

### 4.2 An issued letter's supersession pointer could be repointed

The original trigger froze the columns saying what a letter *said* and left `superseded_by_id` and
`superseded_at` unguarded so a correction could stamp them. Unguarded means **repointable**: a
pointer that can be moved afterwards lets somebody rewrite which letter replaced which, long after a
bank acted on one of them.

`20260811150000_letter_issued_supersede_once` permits the stamp exactly once, from null to a value.
Repointing it, clearing it, and every content change and delete are refused.

### 4.3 One test-harness defect, worth recording

The first Phase 12 cross-module harness used a plain `PermissionChecker`, and **every cross-module
read was refused**. `GrantAwarePermissionChecker` is what makes a bounded service grant mean
anything; without the wrapper an adapter's grant is inert. The harness now wraps exactly as the
composition root does, so the grants are genuinely exercised rather than assumed.

---

## 5. What is `NOT VERIFIED`

Recorded as absent rather than approximated. Each of these is a **missing dependency**, not a
shortcut taken.

| Capability | Why | What exists instead |
| --- | --- | --- |
| **Binary storage — upload, download, retrieval** | `StoragePort` has no implementer anywhere in this repository | `storageUnavailable`: `available: false`, no URL. Not a fake — a fake would return a URL. The API reports it honestly and the attempt is still recorded in the access trail |
| **Content inspection, malware scanning, hash verification** | Requires reading the bytes | `hash_verified` is false on every row; `detected_media_type` is absent. The declared type is what a client claimed and the view says so |
| **PDF rendering** | No library, renderer or headless browser exists | An issued letter carries its frozen content and `document_id` is null on every row. The letter's *content* is fully owned and reproducible; only the artefact is missing |
| **Electronic signature** | No provider, signing contract or certificate infrastructure | `signature_state` has no `signed` value. A letter may record that a signature is *required*; nothing claims one occurred |
| **Notice and escalation firing** | `JobPort` has no adapter, so nothing scheduled runs | Thresholds are configured and the expiry state is **derived on read**. A materialized `expired` flag would need something to maintain it, and a flag nothing maintains is worse than no flag |
| **Employee self-service routing** | No authenticated-principal-to-employment resolution (ADR-0032) | `document.read-own` and `letter.request-own` are declared and enforced nowhere. The contract exists; the routing does not |
| **Anonymous third-party letter verification** | Every read resolves a tenant before reaching a row, and row-level security has no anonymous cross-tenant path. `@PublicRoute()` bypasses tenant resolution entirely | The query is built and behaves correctly — it discloses the reference, the issue date and whether the letter was superseded, and **no employee data at all**. It declares `letter.verify` rather than running unauthenticated. Only the anonymous route in front of it is missing |
| **`payroll` as a letter variable source** | Payroll's result reads are scoped to a *run* rather than to an employment, so a variable resolved from one would name a run a template author cannot choose | `payroll` stays in the exposable-field vocabulary with no adapter wired. A template declaring it is refused with `source_not_configured` — reported, never resolved to something adjacent |
| **Reconciliation's two storage checks** | A missing object and a checksum mismatch both require reading bytes | Absent from the reconciliation store entirely, rather than approximated by something that looks similar |
| **Mandatory-document detection (D-27)** | Deferred by the approved plan | No table, no query, no partial implementation |

---

## 6. Technical debt recorded, not fixed

**D-25 — the storage-reference expression.** Employment, Recruitment and Onboarding each carry
`^[A-Za-z0-9][A-Za-z0-9:._/-]{0,127}$`. It permits `:` and `/` because a key may legitimately
contain both, and the consequence is that it also permits `s3://bucket/key` and
`https://host/path` — a value that carries a scheme is one somebody could try to resolve directly
rather than through an authorized, audited download.

Documents adopts the shared expression **and adds the refusal on its own side**, at the domain and
at the DTO. Changing the other three modules is a cross-phase refactor this phase does not make.
The inconsistency is real, is now asserted in a test, and remains theirs to close.

**The seventh and eighth copies of `row-writer.ts`.** Compensation, Leave, Attendance, Onboarding,
Recruitment and Payroll each carry a near-copy; Documents and Letters now make eight. A module may
not reach into another module's internals, and hoisting it into `@work/persistence` is a change to
a package every phase depends on. Restated here rather than made inside a business phase.

---

## 7. Performance

Measured against real PostgreSQL as an **unprivileged role**, because a superuser sees every row
without consulting a policy and would hide exactly the cost row-level security adds.
`pnpm measure:documents`.

**Dataset A — 10,000 documents, 5 versions each** (50,000 versions; seeded in 5.2 s)

| Read | Measured | Rows | Budget | |
| --- | ---: | ---: | ---: | --- |
| Expiry queue | 28.7 ms | 1,000 | 400 ms | within budget |
| Verification queue | 5.8 ms | 1,000 | 400 ms | within budget |
| Access trail (one document) | 4.7 ms | 200 | 200 ms | within budget |
| Reconciliation: duplicate content | 66.6 ms | 200 | 5,000 ms | within budget |
| Reconciliation: stale verifications | 13.9 ms | 200 | 5,000 ms | within budget |

**Dataset B — 100,000 documents** (seeded in 18.4 s)

| Read | Measured | Rows | Budget | |
| --- | ---: | ---: | ---: | --- |
| Expiry queue | 50.0 ms | 10,000 | 1,000 ms | within budget |
| Verification queue | 26.7 ms | 10,000 | 1,000 ms | within budget |
| Access trail (one document) | 4.8 ms | 200 | 200 ms | within budget |
| Reconciliation: duplicate content | 140.8 ms | 200 | 30,000 ms | within budget |
| Reconciliation: stale verifications | 3.1 ms | 200 | 30,000 ms | within budget |

**Every budget met.** The two queues are the point of the exercise: a tenfold increase in the
register costs the expiry queue 21 ms, because it is an indexed comparison on `expiry_date` rather
than a text search. D-21's warning was that `ILIKE '%…%'` cannot use a B-tree index and would fail
first at scale; neither queue goes near one.

---

## 8. The security properties, and where each is proved

| Property | Proved by |
| --- | --- |
| One tenant cannot read another's documents, versions, verifications or access trail | `documents-isolation.integration.test.ts`, as an unprivileged role, both directions |
| One tenant cannot read another's letters, and **cannot verify one by token** | `letters-isolation.integration.test.ts`. A token that verified across tenants would let one customer confirm — or repudiate — another's letters |
| A confidential document is **not found**, never forbidden | `documents.security.spec.ts`. "Forbidden" on a document identifier confirms a document of that kind exists for that employee, which in this module is itself the disclosure |
| A withheld confidential document is not counted either | The predicate is in the SQL, so the row never leaves the database and the total agrees with the rows. A count is itself a disclosure |
| Reading metadata is not downloading | `document.download` is a separate permission, refused at the edge for a caller holding `document.read` |
| Reading the access trail is its own permission | `document.audit`, refused at the edge |
| A version and an access event cannot be rewritten | Four layers: the port offers no method, the repository implements none, a trigger refuses raw SQL, and the permitted stamp still works. `documents-immutability.integration.test.ts` |
| An issued letter cannot be rewritten | `letters-immutability.integration.test.ts`, including the supersession pointer |
| A verifier cannot sign off in somebody else's name | `decided_by` comes from the context, and the API **refuses a body carrying `decidedBy`** rather than ignoring it |
| A requester cannot approve their own letter | Refused by the domain, by a check constraint, and asserted at the edge |
| A letter cannot state a salary the caller could not read directly | Two gates: the template's `exposedFields` and the issuer's `letter.include-salary`. `letters.security.spec.ts` |
| Documents never reads a passport number | The grant is `people.identifier.read` and **never** `people.identifier.read-value` |
| A tenant-authored template cannot execute anything | Variables are names, not expressions; the DTO refuses an operator; substitution is a map lookup |
| A storage reference cannot be a URL | Refused at the DTO (400) and again in the domain |
| The verification token is unguessable | `randomBytes(32)`, hex-encoded. Never the reference number, which is sequential and printed on the letter |

---

## 9. Cross-module integration

Six adapters, all reading through **published queries** under **bounded service grants** (ADR-0043).
No adapter writes anything; there is no method on any of them that could change a fact in another
module.

| Adapter | Reads | Grant |
| --- | --- | --- |
| `DocumentsOwnerDirectory` | `people.read-person`, `employment.read-employment`, `organization.list-legal-entities` | One permission each |
| `DocumentsPersonIdentifiers` | `people.read-profile` | `people.person.read` + `people.identifier.read`. **Never** `read-value` |
| `LetterPersonSource` | `people.read-person` | `people.person.read` |
| `LetterEmploymentSource` | `employment.read-employment` | `employment.employment.read` |
| `LetterOrganizationSource` | `employment.read-employment` → `organization.governing-legal-entity` | Both reads, one grant |
| `LetterSalarySource` | `compensation.payroll-period` | `compensation.read` |

The employer is resolved by walking **up from the unit the employment is assigned to**, because an
employment carries no legal entity. There is **no tenant-level fallback**: that is exactly the
mistake 00B names, and here it would print the wrong employer's name on a letter a bank acts on.

The salary figure is summed as `bigint` minor units and formatted with the currency block's own
exponent, **never through a double**. An employment paid in two currencies is refused rather than
silently halved: a letter states one figure, and Compensation never sums across currencies.

### The lost-event scenario

**There is no scenario.** Neither module publishes an event and neither subscribes to one. Every
cross-module fact is pulled at the moment it is needed (ADR-0064), so there is no delivery to lose.
The cross-module suite asserts it directly: an upstream change nobody announced is found by the next
read, and an already-issued letter does not move.

---

## 10. What a reader should be sceptical of

Three things this phase claims that are worth checking rather than believing.

**"It holds no bytes."** There is no upload route, no multipart body, no base64 field, no download
route and no `Buffer` anywhere in either module. `storage_reference` is validated as a key and
refused if it is a URL. The one method that reaches toward storage returns `available: false`.

**"The letter snapshot is frozen."** The cross-module suite issues a certificate, then changes the
salary *and* the person's legal name upstream, then re-reads the issued letter. Both original values
are still there. A second letter issued afterwards carries the new ones.

**"Nothing fires a notice."** `JobPort` has no adapter. The expiring queue is a screen somebody
opens and the notice under it says so. If a customer expects an email, they will not get one, and
this report is where that is written down.

---

## 11. Documentation

- `docs/modules/documents.md`, `docs/modules/letters.md` — the module guides
- `docs/PHASES.md` — Phase 12 marked complete
- `docs/DOMAIN_OWNERSHIP.md` — the two modules' tables and the D-1a boundary
- `docs/foundation/architecture.md` — the new triggers added to the invariants the database enforces
- `docs/RELEASE_NOTES.md` — what a customer gets, and what they do not

---

## 12. Phase 12 — COMPLETE
