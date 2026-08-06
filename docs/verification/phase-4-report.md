# Phase 4 — People Master Registry

**Date** 2026-08-06 · **Verdict** Pass, with the limitations stated below

The enterprise's register of human identity, and the first personal data this product has ever held.

Every claim here is evidenced by a command that was run. Where something could not be verified in
this environment it says so rather than being marked pass.

---

## 1. What changed, and the three decisions worth challenging

Thirteen tables, twenty-nine endpoints, twenty-nine permissions, one module. The rest of this
section is the part a reviewer should argue with.

### A person has no name column (ADR-0037)

Phase 3 recorded, honestly, that a unit's *attributes* are not queryable as at a past date and
assigned that to Phase 21. Phase 4 was told to check inherited deferrals before deepening them, and
this one does not transfer.

A department renamed is the same department in the same place. A person's **legal name** is the
thing their signature, their identity documents and their statutory filings are matched against, and
it changes for reasons the law recognises. "What was this person's legal name on the date they
signed that contract" is asked by a settlement dispute, a visa application and a government
submission, all of them months after the change.

So `person` has no name column at all, and no cached copy of one — a cached copy is a second answer.
Names live in `person_name` on the kernel's `Timeline`.

Asserted rather than argued (`people-registry.test.ts`):

```
a legal name, which has a history
  ✓ keeps the old answer and gains a new one, rather than rewriting the contract that was signed
  ✓ leaves exactly one answer at the instant of the change itself
  ✓ records both periods, so the history is readable rather than merely implied
  ✓ splits the history at a back-dated correction instead of discarding the later change
  ✓ answers with the earliest recorded name for a date before the record began
```

The fourth is the one that matters most, and it is the bug Phase 3 found the expensive way for
placements: a certificate arriving late names a date in *front* of a change already recorded, and a
naive implementation runs the correction straight through the later change and discards it. The
correction splits the history instead.

The fifth is the one a migration produces. Dating every name from the day the import ran, then
asking about last year, would otherwise render a person with a blank name — which reads as corrupt
data rather than as a question about a date before the record began.

**What this does *not* close.** A person's other attributes, and an organizational unit's, are still
not queryable as at a past date. The debt is narrowed, not struck off, and it stays in the register
below.

### Duplicate detection refuses before the write, and merges nothing (AD-001)

A second Person for one human being is not untidy data. It splits their service period, so an
end-of-service gratuity computes on four years instead of eleven; it splits their leave balance and
their loan repayments; and it registers one national identifier twice with a social insurance
authority. Every one of those looks like a correct number.

Three signals, three indexed lookups rather than a scan — comparing a new person against every
existing one would be linear in register size on every create, and the check that becomes slow is
the check that gets switched off.

```
creating somebody who may already exist
  ✓ is refused before the second record is written, not discovered after payroll ran twice
  ✓ is allowed when the caller acknowledges it, because twins are two people
  ✓ queues the pair for a human rather than merging anything by itself
  ✓ does not flag two people who share a name and were born on different days

the identifier, which is where a duplicate is usually found
  ✓ refuses a number another person already holds, without echoing the number back
  ✓ recognizes one document typed with different separators as one document
  ✓ does not clash a passport against a national identifier that shares a number
  ✓ stops flagging a withdrawn document, so a renewal does not flag its own holder
  ✓ flags a shared mobile number, which is weaker evidence than a document and still evidence
```

The matcher is tested **in Arabic first** (`duplicate-matching.test.ts`), because a suite written in
English would pass for an implementation that never normalizes Arabic at all — and this product's
first markets are exactly where the two duplicate-producing spellings of one name come from:

```
normalizing a name
  ✓ treats the alef forms as one letter, because they are one keyboard away from each other
  ✓ strips the diacritics a keyboard may or may not produce
  ✓ treats the two final yaa forms and the taa marbuta as one letter each
  ✓ collapses case, punctuation and runs of whitespace in Latin script
  ✓ does not collapse two genuinely different names
```

**A real bug this caught.** The first normalizer ran `NFKD` before folding the alef forms.
Decomposition splits `أ` into a bare alef and a combining hamza, and the punctuation pass then turned
that hamza into a **space** — so `أحمد` became two words and stopped matching `احمد`, which is the
one case the function exists for. The fix composes first (`NFKC`), folds the Arabic letters, and only
then decomposes for Latin diacritics.

Nothing merges automatically. Confirming a candidate records that two records are one human being;
merging is a separate command with its own permission, because a merge is effectively irreversible
for every module that has since referenced the record that loses.

### Personal data is protected by mechanism (ADR-0038)

Phase 3's report could write **PII: none**. This one cannot, so it says what is held, why, and what
protects it — and every protection is enforced and tested rather than promised.

| Mechanism | What it stops |
| --------- | ------------- |
| `people.person.read` returns the person **without** date of birth, place of birth, gender, marital status; `people.person.read-sensitive` returns them | A directory read from being a data-protection event |
| A withheld field is **absent**, never null, and `sensitiveWithheld` says so | A consumer confusing "we do not know" with "you may not see it" |
| Redaction, not refusal | The pressure to grant everybody the sensitive permission because the picker 403s |
| `people.identifier.read` returns `••••7890`; `people.identifier.read-value` returns the number | A passport number behind the same permission as a person's existence |
| Every value disclosure is recorded — actor, person, **kind**, never the value | An investigation that cannot say who read one |
| `match_key` is an **HMAC** keyed with `PII_MATCH_SECRET` | A ten-digit national identifier being recoverable from a hashed column by rainbow table |
| Search digests and normalizes **before** the query | A number reaching a query plan, a slow-query log or a trace |
| No event, rejection or export carries a value | The single easiest place to leak one permanently |
| A withheld *section* is absent from the profile, not empty | An empty `identifiers` array asserting the person holds no documents |
| Nothing is deleted; a note is neither amendable nor deletable | A record somebody can make disappear before a disciplinary hearing |

Proven at the application layer (`people-privacy.test.ts`, 14 tests) and again **through HTTP**
(`apps/api/src/people/people-privacy.controller.spec.ts`, 6 tests), because the redaction has to
survive serialization:

```
a caller who may read the register but not its sensitive fields
  ✓ gets the person with the date of birth absent, not null, and is told so
  ✓ is not refused outright, because a picker that 403s for everybody is a picker nobody uses
  ✓ gets the same redaction from a search as from the person itself

a government identifier
  ✓ is masked for a caller who may see that it exists but not what it is
  ✓ is shown in full only to a caller holding the value permission
  ✓ records who was shown it, and records the kind rather than the number
  ✓ records nothing when the caller was only shown the mask
  ✓ never reaches the search predicate in plaintext — the query compares a digest
  ✓ masks a value too short to mask, rather than revealing it

a profile section the caller may not read
  ✓ is absent rather than empty, because an empty list asserts something false
  ✓ is not read from the database at all, so a withheld section leaks nothing to a log

an export
  ✓ carries no identifier, no note, no address and no date of birth out of the product
```

**The search test is the one that would matter most if it were missing.** A module that masked an
identifier on the detail endpoint and forgot to on the list endpoint would have masked nothing, and
a list endpoint is the cheaper of the two to scrape.

---

## 2. The aggregate, and where effective dating stops

| Shape | What has it | Why |
| ----- | ----------- | --- |
| **Timeline** — superseded, never edited | Legal and preferred name; contacts; addresses; emergency contacts; preferences | Read *about a date*: which name was on the contract, which number did we have on the day of the incident, where was the letter posted, did they consent when the brochure went to print |
| **Corrected in place** | Date and place of birth, gender code, marital status | Nobody's date of birth moves. A timeline of birth dates models something that cannot happen. The previous value travels in the event |
| **Withdrawn** | Nationalities, capabilities, history, tags, notes | A claim that was made or withdrawn, not a value that had a different value last March |
| **Neither** | An identifier's *value* | A different number is a different document. A renewed passport is a new identifier and a withdrawal of the old |

A **slot** is which timeline a new record supersedes: a contact by channel *and* purpose, an address
by kind, an emergency contact by priority, a preference by key. Getting one wrong is the
characteristic bug of this pattern and it is silent — the record closed by mistake simply stops
being returned — so each is asserted:

```
✓ supersedes the same channel and purpose, keeping the old number answerable
✓ does not close a personal mobile when a work email is recorded
✓ does not close a mailing address when a residential one changes
✓ keeps a second emergency contact open when a first is recorded
✓ supersedes the same priority, so who to call first has one answer per date
✓ keeps one preference key from closing another
✓ evidences what somebody consented to on a date, rather than only what they consent to now
```

Deliberately **not** a boundary this module crosses: a person's *application* preferences — language,
calendar, numerals, time zone — remain `identity`'s `user_preference`, defaulted from the tenant
(ADR-0036). `person_preference` holds dietary requirement, uniform size, consent to a directory
photograph. Two modules holding a language preference produce two answers on the first screen that
reads the wrong one.

---

## 3. Verification

### Repository and architecture

```
Engineering Standards: no violations.
Architecture: 31 model(s) checked, no violations.
Localization: 4 catalogue set(s) complete.
Dependencies: 352 source file(s), no cycles, no unused dependencies, no unreachable files.
```

Module-first per ADR-0023: `packages/modules/people/{domain,application,infrastructure,contracts,
api}`. The domain and application layers import no framework, no ORM and no transport.

**Findings the gates caught, not the author:**

- **Seven file-budget breaches**, each split rather than waived — two controllers, one DTO file, one
  use case, two test files and one repository.
- **Three complexity breaches** in repositories, whose budget is five rather than ten. The mapping
  for a table with eleven optional columns exceeds it by construction, so it moved to `person-row.ts`
  — the budget exists so that a repository which needs *branching* gets looked at, and mapping is
  not branching.
- **A static method named `apply`**, which shadows `Function.prototype.apply` and produced an
  override error rather than a runtime surprise. Renamed to `record`, matching every other aggregate.

The kernel was **not** modified. `Timeline`, `DateRange`, `LocalizedText`, `AggregateRoot`,
`Dispatcher` and `PagedResult` are used as they are.

### Persistence

Thirteen tables applied to a fresh database, then inspected as the application role:

```
           table            | rls | forced | policies
----------------------------+-----+--------+----------
 person                     | t   | t      |        1
 person_address             | t   | t      |        1
 person_capability          | t   | t      |        1
 person_contact             | t   | t      |        1
 person_duplicate_candidate | t   | t      |        1
 person_emergency_contact   | t   | t      |        1
 person_history             | t   | t      |        1
 person_identifier          | t   | t      |        1
 person_name                | t   | t      |        1
 person_nationality         | t   | t      |        1
 person_note                | t   | t      |        1
 person_preference          | t   | t      |        1
 person_tag                 | t   | t      |        1
```

Every one carries `tenant_id`, the audit columns, `deleted_at` / `deleted_by`, `version` and a
UUIDv7 identifier. There is no tenant-less table in this module — `workforce_user` remains the only
one in the product (ADR-0033).

Constraints the database enforces rather than the application, each with a test:

```
✓ refuses a legal name missing a first-class language
✓ refuses two open name periods for one person, which would be two answers
✓ refuses a period that ends before it begins
✓ refuses the same person number twice in a tenant, case-insensitively
✓ permits the same person number in a different tenant, because it is the customer's own
✓ refuses two live holders of one identifier digest — the constraint AD-001 rests on
✓ permits the same identifier in a different tenant, because two customers may employ one person
✓ refuses a date of birth in the future, at the database as well as in the domain
✓ refuses a merged status with nothing to redirect to
✓ refuses a duplicate candidate whose pair is the wrong way round
✓ refuses a decided candidate with nobody named as the reviewer
✓ refuses an expiry on a degree, because only a certification lapses
✓ refuses a language capability carrying a name, and a skill without one
✓ refuses a stale write, so two administrators cannot silently overwrite each other
```

**A real bug the integration suite caught, which no unit test could have.** The capability
constraint was first written as
`check ((kind = 'language' and title is null) or (kind = 'skill' and title ? 'en' and title ? 'ar'))`.
For a skill with **no title at all**, `title ? 'en'` is NULL, the whole expression is NULL — and a
check constraint **passes** when its result is NULL. The obvious spelling of the rule silently
admitted exactly the row it existed to refuse. It is now a `case` returning a definite boolean on
every branch, and the finding is in the developer guide so the next module does not rediscover it.

**A second real bug, in the repository.** Building a `where` clause from a fixed placeholder list
and passing `null` for unused filters fails with `could not determine data type of parameter $2`
when every filter is absent — which is the *ordinary* case for the first page of the register. The
clause and its parameters are now built together (`person-search.ts`).

### Tenant isolation, per entity

Against a real PostgreSQL, as an unprivileged role that cannot bypass row-level security:

```
another tenant's person, by exact identifier                      → not found ✓
another tenant's person by number, which a caller might guess     → not found ✓
name, identifier, nationality, contact, address, emergency        → not found ✓
  contact, preference, capability, history, tag, note — by
  exact identifier, all twelve child tables
another tenant's identifier digest (what duplicate detection reads) → no match ✓
another tenant's contact value                                    → no match ✓
every person in the tenant, and a search                          → empty ✓
insert into another tenant                                        → policy violation ✓
no tenant set                                                     → 0 rows (fails closed) ✓
```

The digest assertion is the one that would matter most if it were wrong: a policy missing from
`person_identifier` would tell one customer that another employs a particular human being, from a
number alone.

### Tests

**719 tests**, up from 531.

| Suite | Tests |
| ----- | ----- |
| `@work/people` | **168** (12 files) |
| `@work/identity` | 151 (unchanged) |
| `@work/kernel` | 139 (unchanged) |
| `@work/organization` | 136 (unchanged) |
| `@work/api` | 62 (was 46) |
| `@work/testing` | 23 |
| `@work/config` | 20 (was 16) |
| `@work/persistence` | 20 |

Covering the matrix `00A_PHASE_SPECIFICATION_TEMPLATE.md` requires: domain invariants and value
objects; every command and query through the real pipeline; repositories including tenant scoping;
every endpoint including authorization failures; permissions granted **and** denied; tenant isolation
per entity; effective dating and history; concurrency; and localization.

The permission tests are written as **granted and denied for the same call**, twelve operations
each way, because a suite that only asserted the granted case would pass for a handler declaring no
permission at all.

The module's own tests run with **Arabic names throughout** — the search tests, the duplicate tests
and the name-history tests all use them. Testing in English would let a register that is broken for
half this product's users pass the entire suite.

The integration suites refuse to skip in CI and run serially against one database, matching the
convention Phase 2 established.

### Quality gates

| Gate | Result |
| ---- | ------ |
| Standards, architecture, localization, dependencies | Pass |
| Format, lint, typecheck | Pass |
| Tests (719) | Pass |
| Production build (15 packages) | Pass |
| Migration validation | Pass — applied to a fresh database |
| Prisma schema validation | Pass |
| Flutter analyze, test, APK build | **Not verifiable here** — no Flutter toolchain on this machine. Unchanged by this phase |

`pnpm verify` passes end to end.

### API

**29 People paths** published in OpenAPI, all under `/api/v1`, verified against the running
application:

```
$ curl -s -i http://127.0.0.1:3998/api/v1/people
HTTP/1.1 401 Unauthorized
{"type":"about:blank","title":"Unauthorized","status":401,
 "detail":"Not authenticated.","instance":"/api/v1/people",
 "requestId":"9b269c8a-…","correlationId":"9b269c8a-…"}
```

Refused before anything else, as every business endpoint is until Platform's adapter lands.

**A routing bug the API tests caught.** `GET /people/duplicates` and `GET /people/export` are each
one segment after `/people`, which is also the shape of `GET /people/{personId}` — and Nest resolves
by controller declaration order. Declared the natural way round, the review queue answered *no such
person*. The module now declares the specific controllers first, and a test asserts both resolve to
the collection, so a reordering is a failing test rather than a 404 somebody finds in production.

### Administration UI

The admin portal gains `/people`, rendered server-side and verified running:

```
$ curl -s "http://127.0.0.1:3999/people"          → dir="ltr"  "People"  "Possible duplicates"
$ curl -s "http://127.0.0.1:3999/people?lang=ar"  → dir="rtl"  "الأشخاص"  "تكرارات محتملة"
```

Language and direction switch together — direction follows language and is never a separate control,
which is how the two drift apart.

**Nothing sensitive is on the screen.** No date of birth, no identifier — not even the masked form —
and no note. A register listing is a screen somebody leaves open on a shared desk. Where a field was
withheld, the page says so rather than rendering a blank that reads as missing data.

The screens read through the API, which returns 401 today, so they render their empty states.

### Performance

Measured on this machine against a real database seeded with **50,000 people**, through the
unprivileged application role with row-level security in force — which is how the application
actually runs:

| Operation | Median | Worst of 10 | Budget |
| --------- | ------ | ----------- | ------ |
| Read one person | 0.4 ms | 3.3 ms | < 300 ms |
| Read a person's name timeline | 0.5 ms | 1.4 ms | — |
| Search by **identifier digest** | 0.7 ms | 2.2 ms | < 500 ms |
| Duplicate candidates by date of birth (bounded 200) | 0.4 ms | 0.9 ms | — |
| Count the register (a page total) | 8.8 ms | 9.7 ms | — |
| Search by **Arabic name**, either language | 97.6 ms | 116.5 ms | < 500 ms |

**The last row is the one worth explaining, and the explanation is a finding.**

A name search is a substring match, which wants a `pg_trgm` index. Four were built and benchmarked.
Without row-level security the planner uses them and the query runs in **5 ms**. With row-level
security in force it **will not use them at all** and falls back to a sequential scan:

```
->  Seq Scan on person_name n  (actual time=77.265..90.506 rows=1 loops=1)
      Filter: (… ((legal_name ->> 'ar') ~~* '%…%'))
      Rows Removed by Filter: 49999
```

`ilike` is not a leakproof operator, so PostgreSQL refuses to evaluate it as an index condition ahead
of the security qual — doing so could disclose rows the policy would have hidden. That is the
database protecting tenant isolation, and it is the right trade.

Four GIN indexes the application can never use are pure write amplification on every name change, so
**they are not shipped**. The measured cost is 98 ms at 50,000 people, inside the budget, and the
answer when it stops being inside it is the Phase 20 projection store rather than an index the
planner declines to read. This is the same conclusion Phase 3 reached about its hierarchy walk, for
a different reason.

The **authenticated request path remains unmeasured**, for the same reason as in Phases 2 and 3: it
requires Platform's authentication adapter. Carried in the debt register.

### Localization

Both catalogues complete, checked by gate. Every rejection the domain can produce carries a
catalogue key rather than a sentence.

A person's name is **authored data, not a catalogue key**, and **both languages are required** by
the domain *and* by the database (`check (legal_name ? 'en' and legal_name ? 'ar')`) on names,
addresses, emergency contacts, skills and history records.

Nothing in this module knows a country, a document type, an address format or a family relationship.
Country codes are validated by *shape* and never against a list; identifier types, gender, marital
status, relationship and tag codes are tenant or country-pack data. There is no `state`, no `county`
and no postal-code pattern in the address table, because an address that fits one country's form
does not fit another's — and the test asserts a Jordanian address alongside a Saudi one.

Nationality is recorded and **never interpreted**: nothing in this module branches on a country
code, and a person's country of employment still comes from their legal entity (ADR-0035), never
from their passport.

### Security

| Check | Result |
| ----- | ------ |
| Authentication | Platform's, through a port. This repository authenticates nobody |
| Authorization | 29 permissions, declared by every handler, checked centrally, refused by default |
| Separation of duties | Reading a person ≠ reading their date of birth ≠ reading their passport number; reviewing a duplicate ≠ merging; reading ≠ exporting |
| Tenant validation | RLS-enforced and proven per entity, all thirteen tables |
| Order of checks | Authorization before validation, in the pipeline and at the transport |
| **PII** | **National identifiers, passport and permit numbers, dates and places of birth, nationalities, home addresses, personal telephone numbers, third parties' names and numbers, and free-text notes.** Protected by nine mechanisms, each tested — ADR-0038 |
| Problem Details | Every error path; no stack trace, SQL or environment detail |
| Audit | Actor written by infrastructure from the context; a caller cannot supply or omit it |
| Secrets | `PII_MATCH_SECRET` validated at startup; the shipped development default **refused** in production |

The author on a note and the reviewer on a duplicate are taken from the authenticated context, never
from the command — a caller who could name their own author could write a note as somebody else.
Both are asserted by test with a request that tries.

**The known residual from Phase 2 is unchanged and re-asserted here:** an *authenticated member of
the tenant* who lacks a specific permission and sends a malformed body still gets 400 rather than
403, because Nest runs the global `ValidationPipe` before the CQRS pipeline's permission check. An
unauthenticated caller gets 401 regardless.

---

## 4. Technical debt

The register carried forward. Nothing has been quietly dropped.

| Item | Impact | When it must be addressed |
| ---- | ------ | ------------------------- |
| No projection store | Queries read the transactional tables | Phase 20. Measured above at 50,000 people; the 98 ms name search is the first number that will need it |
| The rule engine has no arithmetic | It decides, it does not compute | Phase 11.1 |
| `@work/contracts`, `@work/sdk`, `@work/country-packs` are empty | Placeholders | The phases that own them |
| Cache health is `not-configured` | Redis declared, unused | Whenever the first cache consumer arrives |
| No rate limiting | An unauthenticated endpoint could be hammered | Before production exposure, Phase 24 at the latest |
| The Android release build signs with debug keys | A release artefact is not distributable | Phase 19.1 |
| The authenticated request path is unmeasured | The < 300 ms budget is argued structurally for that path | When Platform's authentication adapter lands |
| No scheduled sweep for invitation and delegation expiry | An elapsed invitation still reads `pending` | Phase 24 |
| Portal screens for Workforce Identity are not built | The admin portal does not render the member register | Phase 18/19 |
| **Attribute-level as-of history** | *Narrowed by this phase.* A person's **legal name** is now fully historical (ADR-0037). Their other attributes, and an organizational unit's, still are not | Phase 21 |
| Bulk import is not atomic | A file with one bad row leaves everything before it written | Phase 24. Mitigated: import is *resumable* — an existing person number is skipped rather than failed — with a test |
| Import and export are synchronous and bounded | Beyond 2,000 rows the command refuses, by name | Phase 24 |
| The admin portal's document shell is still `lang="en" dir="ltr"` | The people *section* mirrors correctly; the `<html>` element carries the Phase 0 placeholder | Phase 18/19 |
| The establishment's `filled` count is always zero | Vacancy figures equal budgeted figures | Phase 5 |
| No administration screens for writes | The screens read; every mutation goes through the API | Phase 18/19 |

New in this phase:

| Item | Impact | When it must be addressed |
| ---- | ------ | ------------------------- |
| **Erasure is not implemented** | A right-to-erasure request cannot be satisfied. AD-009 — historical identity information is never destroyed — is in genuine tension with it, and resolving that is a governance decision with a legal input rather than a coding one | Phase 21 (governance, risk, compliance). Stated rather than quietly absent: this is the most consequential gap in the phase |
| **The disclosure record is a log, not a ledger** | "Who read this person's passport in the last year" is not a question the product answers. Each disclosure *is* written, structured and alertable | Phase 21, which owns temporal audit. `DisclosurePort` is the seam; only the adapter changes |
| **A merge redirects but does not consolidate** | Merging points the losing record at the survivor. It does not move the loser's identifiers, contacts or history onto the survivor | Deliberately, not deferred: this module cannot know what every later module recorded against the losing identifier, so a merge that copied People's rows and left the rest would be half a merge that looks complete. Consolidation is a reviewed, per-record operation. Revisit when Employment exists (Phase 5) |
| **The weakest duplicate signal is bounded at 200 same-birthday candidates** | In a register beyond roughly 70,000 people, name-and-date-of-birth matching stops being exhaustive. The two stronger signals are unbounded | Phase 20 or a background sweep in Phase 24. The bound is stated in code rather than silently true, because the alternative is the slowest write in the product |
| **Name search does not use an index** | 98 ms at 50,000 people, inside budget, growing linearly. Row-level security prevents the planner from using a trigram index for a substring match | Phase 20's projection store. Measured both ways above rather than assumed |
| **`PII_MATCH_SECRET` cannot be rotated without re-recording identifiers** | Rotating invalidates every stored match digest, so duplicate detection stops finding existing records until each is re-recorded | Whenever key rotation becomes an operational requirement. Documented in the administrator guide rather than discovered |
| **Column-level encryption at rest is not implemented** | Identifier values are stored in plaintext columns; the *index* holds only digests | When a key management service exists. Column encryption with the key beside the data in the same backup is theatre, and stating that is more honest than shipping it |

---

## 5. Risks

1. **Platform's authentication adapter still does not exist.** The API serves 401 to every business
   endpoint, including all 29 added here. That is the correct failure direction, and it also means
   the authenticated path — and therefore every redaction decision in production — has never run
   outside a test.
2. **The duplicate matcher's confidences are a judgement call.** 95 / 70 / 45 are evidence weights,
   not thresholds, and nothing in the module compares them to a cutoff. But a customer will read
   them as a score and ask why 45 is not 60. They are offered as *reasons* with numbers attached for
   exactly that reason, and the reason is shown before the number on the screen.
3. **`acknowledgedDuplicates` is a flag an integration will learn to always send.** It defaults to
   absent and the refusal is explicit, but a badly written import client that sets it unconditionally
   turns the check into a review queue nobody reads. The queue is the mitigation, and it is
   permissioned separately so that somebody owns it.
4. **A person's name being a join is a performance shape every later module inherits.** Employment,
   payroll and letters will all resolve names, and each will pay the join. The contract makes it
   unavoidable to get wrong; it does not make it free.

---

## 6. Recommendations

1. **Wire Platform's authentication adapter.** It was Phase 2's first recommendation, Phase 3's
   first recommendation, and it now blocks the verification of a privacy model rather than of a
   screen.
2. **Never add a `name` column to `person`, and never cache one.** It is the natural thing to reach
   for the first time somebody profiles a search, and it reintroduces the second answer ADR-0037
   exists to remove. If the join costs too much, the answer is the projection store.
3. **Resolve a person's name through the contract with an `asOf`.** A consumer that omits it gets
   *today's* name, which is correct for a screen and wrong for a document about a date.
4. **Decide erasure before Phase 21 builds against AD-009.** The tension is real and the answer is
   legal rather than technical; discovering it while implementing temporal audit would be the
   expensive order to discover it in.
5. **Set `PII_MATCH_SECRET` from a secret manager, and treat it as long-lived.** It is not a
   credential that benefits from rotation — rotating it silently degrades duplicate detection.

---

## 7. Production readiness

**Ready for the next phase to build on. Not ready for production exposure**, for the same single
reason as Phases 2 and 3: there is no authentication implementation. Everything else the
production-readiness criteria ask for is in place — invariants in the domain, transactional writes
with events after commit, optimistic concurrency on every mutable aggregate, tenant isolation proven
per entity across thirteen tables, Problem Details throughout, structured logs, OpenAPI current, ER
diagram current in the module document, ADRs written for every decision, and the limitations above
stated rather than omitted.

One production-readiness item deserves naming rather than ticking: **PII identified and protected**
is met by nine tested mechanisms, and is *not* met by encryption at rest, which is stated as debt
with the reason.

**Rollback path.** The phase is additive: thirteen new tables, one new package, one new portal route,
one new required-with-default environment variable, and no change to any existing table or module.
Rolling back means reverting the commit and dropping the tables — no existing data is migrated or
reshaped, and `identity` and `organization` are untouched. The one change outside the new module is
`PII_MATCH_SECRET` in `@work/config`, which has a development default and so does not break an
existing deployment on the way in or the way out.

---

## 8. Acceptance criteria

✓ One permanent identity per person, created once, surviving archive and return (AD-001, AD-006)
✓ Duplicate prevention before create, before import, and on demand — government identifier, contact,
name with date of birth — with candidates requiring human review
✓ Government identifiers, personal information, contacts, addresses, emergency contacts, languages,
skills, education, experience, certifications, preferences, notes, tags, profile photo, metadata
✓ Versioned Child Entity pattern reused from Phase 1 for names, contacts, addresses, emergency
contacts and preferences; historical records immutable
✓ Historical identity information never destroyed — no delete anywhere in the module (AD-009)
✓ Person holds no department, company, branch, division, section, team, position, manager, cost
centre, shift or supervisor (AD-003); no payroll (AD-004); no attendance (AD-005)
✓ Employment references Person; Person references no future domain (AD-002)
✓ Every Person belongs to one tenant (AD-007)
✓ Audit, soft delete, optimistic concurrency, effective dating and metadata on every entity (AD-008)
✓ Future modules consume Person through public contracts only (AD-010)
✓ Search — quick, advanced, by government identifier, email, phone, skill, certification, tag
✓ Import and export, bounded and resumable
✓ REST API — 29 paths, all in OpenAPI, all guarded
✓ Administration UI, bilingual and bidirectional, holding nothing sensitive
✓ Every table tenant-first, audited, versioned, soft-deleted, UUIDv7, snake_case
✓ Row-level security on all thirteen new tables, applied by the migration that creates them (ADR-0030)
✓ Nationality recorded and never interpreted; country of employment still from the legal entity (00B)
✓ Arabic and English complete; both directions verified against the running portal
✓ 719 tests including tenant isolation per entity, permissions granted and denied, effective dating,
concurrency, privacy and localization
✓ Production build passing, `pnpm verify` green
✓ Documentation, module guide, two ADRs, release notes, administrator guide and the debt register
updated

**Phase 4 passes.** Awaiting approval before Phase 4.1.
