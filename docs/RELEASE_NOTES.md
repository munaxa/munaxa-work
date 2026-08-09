# Release notes

Newest first. Each entry states what changed, what it means for somebody operating the product,
and what is still missing.

---

## Phase 6 — Recruitment

**2026-08-09** · [Verification report](verification/phase-6-report.md)

Hiring, from the authority to hire to the day somebody becomes an employee. Eleven tables, thirty-six
endpoints, and one decision that changes how modules talk to each other.

### A candidate is not a person, and applying does not create one

Somebody who applies and is never contacted leaves this product no national identifier, no date of
birth and no nationality — not because a rule forbids reading them, but because there is nowhere to
put them. A Person appears at hire, once, through the module built to protect that data.

The corollary is a control a recruiter cannot skip: two candidate records cannot resolve to one human
being, and a create that finds the address already known refuses rather than quietly overwriting the
record it found.

### Recruiters no longer need permission to edit the person register

Hiring creates a Person and an Employment. Until now, a module reaching another inherited its
permission check — which would have made every recruiter hold `people.person.manage`.

Instead, the *module* holds the narrow permission for the duration of one operation, under a grant
that is explicit about what it permits, cannot nest, keeps the acting human's name on every audit
column, and is written to the log every time it is used. A recruiter holds recruitment permissions
only, and `recruitment.hire` is held by fewest people.

### Approving a requisition is a real decision by a named person

Nothing here auto-approves. A requisition records who approved it and when, approving is a separate
permission from raising the request, and a decision is never edited — undoing one writes a new record
naming the one it reverses. Once hiring has started against a requisition, its approval can no longer
be unmade.

### A hire that stops half way is visible

Creating the person, creating the employment and closing the application happen in different modules
and cannot be one transaction. So each step commits what it achieved, the application carries how far
the hire got, and running the hire again continues from there rather than creating a second person or
a second employment.

An unfinished hire is one filter away — `?unfinishedHire=true` — rather than something a customer
discovers. An application never reads *hired* without an employment behind it.

### What is not here

No candidate portal and no public careers pages: every action in this phase is taken by a recruiter.
No CV parsing, scoring or ranking. No background checks, visas or work permits. No onboarding. No
document storage — a résumé or an offer letter is a reference into the document store.

Candidate and interviewer notifications are not delivered either, and the report says so rather than
claiming email works: the notification contract addresses a workforce user, and a candidate is not one.

---

## Phase 5 — Employment

**2026-08-09** · [Verification report](verification/phase-5-report.md)

The workforce. Six tables, sixteen endpoints, and the record every later part of this product will
read before it does anything: *is this person employed, where do they sit, and who do they report
to*.

### A person is permanent; a job is not

Somebody is hired, leaves after three years, and comes back. That is **one person and two
employments**, with two employment numbers and one continuous identity — not a re-created person, and
not an edited old record. Their original hire date travels to the new employment, so the service
their entitlements are measured from is not silently reset to zero.

The product refuses to give one person two employments at the same time. Retry a create that already
succeeded and it fails, by name, rather than quietly producing a second job for one human being.

### The employment number is ours, and it is never reused

`EMP-2026-000123` is generated here — a caller cannot supply one, and no number is ever issued twice,
even after somebody leaves. That is what stops an archived payslip, a bank file and a government
submission resolving to the wrong person years later.

**Your own numbers still travel.** A migration brings its legacy employee numbers in a separate
field, indexed and searchable, without either number pretending to be the other.

### Where somebody worked in March is still where they worked in March

A transfer does not edit a record. It closes the period that was in force and opens a new one, so
the org chart, the department and the manager are all answerable **as at a date** — this year and
last. `GET /api/v1/employments/{id}?asOf=2026-03-01` answers with March's placement and March's
manager, after both have changed twice.

Back-dating works properly. Recording a March transfer for somebody who also moved in June leaves
three periods, in order, with June intact — not a March record that swallowed the summer.

### A manager is a job, not a name

Reporting lines point at an *employment*. When a manager changes roles or leaves, "who did this
person report to last year" still answers correctly, because the answer was never their name.

### Ending is deliberate, and separately permitted

Ending an employment needs a date and a reason, is terminal, and is guarded by its own permission —
somebody who can suspend a colleague cannot dismiss them. The reason is a code you define:
resignation, dismissal, end of contract and retirement mean different things in different countries,
and this product commits to none of them.

**This is not offboarding.** Exit interviews, clearance, asset return and final settlement are a
later phase. What Employment owns is the relationship and its final state, which is what a
settlement will read.

### Vacancies are real numbers now

Establishment screens have reported `filled: 0` and `vacant = budgeted` since Phase 3, because
nothing had ever been assigned. Assignments now feed that figure. **Expect vacancy numbers to change
the day this ships** — they are becoming correct rather than changing.

### What Employment deliberately does not hold

- **Leave status.** Somebody on annual leave is employed. Leave belongs to the Leave phase, and two
  places holding it would give two answers.
- **Work location.** A department and a place of work are different things, and this product does not
  yet model the second. The field is absent and the screen says so, rather than a unit standing in
  for a site.
- **Salary, attendance, documents, disciplinary records.** Each has an owner, and none of them is
  this one.

### Still missing

Nothing here can be used in a browser yet: every endpoint returns 401 until Platform's authentication
adapter lands, which has been the position since Phase 2. The administration screen reads; every
change goes through the API. Bulk import is bounded at 2,000 rows and is resumable but not atomic.

---

## Phase 4 — People master registry

**2026-08-06** · [Verification report](verification/phase-4-report.md)

The register of who somebody is. Thirteen tables, twenty-nine endpoints, and the first personal
data this product has ever held.

### One person, once

A Person is created once and stays one Person through everything a career does to them — hired,
promoted, made a manager, gone for four years, back again. Every workforce module from here on
references that record; it references none of them.

**Why the product refuses to let you create somebody twice.** A second record for one human being
is not untidy data. It splits their service period, so an end-of-service gratuity computes on four
years instead of eleven; it splits their leave balance and their loan repayments; and it registers
one national identifier twice with a social insurance authority. Every one of those looks like a
correct number on the page it appears on.

So creating a person runs a duplicate check first, and refuses with the candidates rather than
writing. If they really are different people — two brothers, the same name, the same birthday — you
say so and it creates both, and queues the pair for somebody to look at. **Nothing is ever merged
automatically.**

The check finds `أحمد` and `احمد`, and `1234-5678-90` and `1234 5678 90`. One name typed on two
keyboards is one name; one document written three ways is one document.

### Names have a history

A person's legal name changes — marriage, naturalisation, a court correction — and this product
keeps every one of them with the date it took effect. `GET /api/v1/people/{id}?asOf=2026-03-01`
answers with the name that was in force then.

**Operators should know:** that is not a reporting nicety. A settlement letter, a visa application
and a government submission are all documents about a *date*, and a register that overwrote the name
would put the wrong person on all three. Recording a change back-dated in front of a later one
splits the history rather than discarding the later change.

### Personal data, and what protects it

This is the first release holding national identifiers, dates of birth, home addresses, emergency
contacts and notes about people. Six things protect them, and all six are enforced rather than
promised — see [ADR-0038](adr/0038-personal-data-protection.md):

- **Seeing a person and seeing their date of birth are different permissions.** Without the second
  you still get the person; the field is simply absent, and the response says so.
- **Seeing that somebody holds a passport and seeing the number are different permissions.** Without
  the second you get `••••7890`, which is enough to confirm you have the right document and not
  enough to be the document.
- **Every time somebody is shown a full identifier value, it is recorded** — who, whose, and what
  kind. Never the number.
- **The duplicate check never reads a number.** It compares a keyed digest, so the index that makes
  it fast holds nothing worth stealing.
- **No event, refusal or export carries a value.** An export deliberately omits identifiers, notes,
  addresses and dates of birth: a file on a laptop is the one copy this product cannot protect.
- **Nothing is deleted.** Records are withdrawn or superseded; a merge redirects. A note is never
  amendable and never deletable — an editable note evidences nothing.

**Operators must set `PII_MATCH_SECRET`.** It is the key the duplicate-match digests are derived
with. A development default ships so a checkout runs, and **startup refuses it when
`NODE_ENV=production`**, because a shipped default is the same key in every deployment. Generate at
least 32 random characters, store it with your other secrets, and do not rotate it casually —
rotating it invalidates every stored match digest, so the duplicate check stops finding existing
records until they are re-recorded.

### What is not here

No employment, no assignment, no unit, no position, no manager, no salary, no attendance. Those are
Phase 5 and later, and they reference this register rather than living in it.

Erasure is not implemented: this release cannot satisfy a right-to-erasure request, and resolving
that against "historical identity information is never destroyed" is a governance decision recorded
for Phase 21. The disclosure record is a structured log rather than a queryable ledger, so "who read
this person's passport this year" is not yet a question the product answers.

---

## Phase 3 — Organization

**2026-08-06** · [Verification report](verification/phase-3-report.md)

The enterprise's structure, and the closure of the tenant-settings limitation Phase 2 shipped
with.

### Every customer gets its own language and calendar

Before this release a deployment had one default language, one calendar, one time zone and one
invitation validity, shared by every tenant in it — so a hosting arrangement containing a Riyadh
customer and an Amman customer had to pick one of them.

Tenants now configure themselves, through `PUT /api/v1/organization/tenant-settings`. A tenant
that has configured nothing behaves exactly as it did before, falling back to the deployment's
values, so nothing changes until somebody chooses to change it.

**Operators should know:** the `DEFAULT_LOCALE`, `DEFAULT_CALENDAR`, `DEFAULT_TIME_ZONE`,
`DEFAULT_NUMERALS`, `INVITATION_VALIDITY_DAYS` and `DEFAULT_PORTALS` variables are unchanged and
still required — they are now the *fallback* for an unconfigured tenant rather than the answer
for every tenant.

### Organization

Eleven tables, thirty-three endpoints, and the structure beneath them:

- **Units of any depth.** The levels of the hierarchy — company, branch, department, or whatever
  a customer calls them — are the tenant's own data rather than a fixed ladder in the schema. A
  retail group with company / region / store defines those three and nothing else; a franchise
  nesting twelve deep simply does. The nine levels the specification names are offered as a
  starting set from `GET /organization/standard-unit-types`, and nothing installs them.
- **Reorganizations that keep their history.** Moving a department records a new period rather
  than overwriting the old one, so "which division was this under last March" keeps its answer
  forever. Every structure endpoint takes `?asOf=` and defaults it to now.
- **Legal entities, each with its country.** A tenant may operate in several countries at once,
  and an employment will resolve its statutory rules from its legal entity rather than from the
  tenant — which is what makes end of service, social insurance and wage protection correct for a
  group operating across borders. `GET /organization/units/{id}/governing-legal-entity` answers
  which one governs a unit on a date.
- **Cost and profit centres**, as reference data finance recognizes. No budgets: financial
  ownership stays with the finance system this product integrates with.
- **A position catalogue** of reusable roles, holding no people, and an **establishment** of
  budgeted headcount per position per unit, effective dated and separately approved.
- **Organizational calendars** — the working week and the dates that are exceptions to it. This
  product knows no country's holidays; they are data a tenant or a country pack loads.
- **Import and export** of a whole structure. Import applies every rule an administrator would
  meet one unit at a time, and can be re-run after a correction without duplicating anything.

### Administration screens

The admin portal gains an organization section: the org chart as at any date, the levels defined,
the legal entities and their countries, and the tenant's settings. Bilingual and bidirectional —
`?lang=ar` switches language and direction together.

**Operators should know:** the portal reads through the API, which returns 401 until Platform's
authentication adapter is supplied. Until then the screens render their empty states, which is
the expected condition rather than a fault.

### Configuration

| Variable | Default | What it sets |
| -------- | ------- | ------------ |
| `WORK_API_URL` | `http://127.0.0.1:3000` | Where the portals reach the API |

---

## Phase 2 — Workforce Identity

**2026-08-05** · [Verification report](verification/phase-2-report.md)

The first business module, and the closure of the security risk Phase 1.1 named as the largest
one open.

### The tenant no longer comes from a header

Before this release the API believed an `x-tenant-id` header, which meant any caller could act as
any tenant, and every audit row recorded `user:anonymous`. Both are gone.

A request's tenant is now resolved from a **tenant membership** — a row this product wrote when a
tenant admitted a person — keyed on the principal Platform authenticated. A caller may still say
*which* of their tenants they mean, using `x-munaxa-tenant`, because people genuinely belong to
several; naming one they are not an active member of resolves to nothing, and nothing means the
request runs with no tenant and every tenant-scoped operation refuses.

**Operators should know:** the API now returns 401 to every business endpoint until Platform's
authentication adapter is supplied. This repository contains no authentication implementation and
will not acquire one. Health probes are unaffected.

### Workforce Identity

Eight aggregates, an API, and the persistence beneath them:

- **Workforce user** — one per Platform account, spanning every tenant that person belongs to.
- **Tenant membership** — admission, suspension, reinstatement, departure and rejoining.
- **Invitations** — issued, withdrawn, accepted or lapsed. They carry no token: the invited
  person signs into Platform first, and accepts as an authenticated principal whose address must
  match the one invited.
- **Portal access** — which of the employee, manager and admin applications a tenant has opened
  to a member. Business configuration, not permission.
- **Employment links** — the jobs a member holds, several at once, with exactly one marked as
  their main job. Detaching a job never removes the person.
- **Delegation** — who acts for whom, for a stated period and scope. Recorded now; Workflow
  consumes it from Phase 16.
- **Business profile** — the member's name and title in both first-class languages. A profile
  missing one is refused by the domain *and* by the database.
- **User preferences** — language, calendar, time zone and numerals, seeded from the tenant's
  defaults and changed by the member themselves.

### Configuration

New environment variables, all with defaults, all applying deployment-wide until Phase 3 can
store them per tenant:

| Variable | Default | What it sets |
| -------- | ------- | ------------ |
| `DEFAULT_NUMERALS` | `western` | Western or Arabic-Indic digits |
| `INVITATION_VALIDITY_DAYS` | `14` | How long an invitation stays open |
| `DEFAULT_PORTALS` | `employee` | Which portals open when somebody joins |

`DEFAULT_LOCALE`, `DEFAULT_CALENDAR` and `DEFAULT_TIME_ZONE` already existed and now have a
consumer.

### Migration

One forward-only migration adds eight tables, each with row-level security enabled and forced by
the same migration that creates it. It also installs `app_uuid_v7()`, so rows written by a script
or a data fix carry time-ordered identifiers like the ones the application mints.

There is no data to migrate: this is the first business module.

### Known limitations

Stated here as well as in the report, because a release note that omits them is worse than none:

- Tenant settings are deployment-wide, not per tenant. Phase 3 owns that.
- Nothing sweeps elapsed invitations or delegations yet, so an invitation past its expiry still
  reads `pending`. Behaviour is already correct — acceptance refuses it, and delegation is
  computed from its period — but the register looks stale.
- No bulk import or export. Deferred deliberately rather than half-built: a bulk path that
  bypassed the application service would bypass the invariants with it.
- The portal screens are not built. The API, contracts and translations they need are complete.
- The authenticated request path has never run outside a test, because there is no authentication
  adapter to run it with.

### Tests

379, up from 208, including tenant isolation proven per entity against a real PostgreSQL.

---

## Phases 0, 1 and 1.1 — Foundation

**2026-08-05** · [Verification report](verification/phase-1.1-report.md)

Engineering standards enforced by tooling, the pnpm/turbo workspace, the NestJS API, both
portals, the Flutter application with its Android host, the shared kernel, and tenant isolation
enforced by PostgreSQL row-level security. No business functionality.
