# Administrator guide

How to operate Munaxa Work: who can do what, how people get in, and what to check when something
looks wrong.

---

## Getting somebody into the product

There are two routes, and which one applies depends on whether the person already has a Munaxa
Platform account.

**They do not, or you do not know.** Invite them by email address.

```
POST /api/v1/identity/invitations
{ "email": "sara.haddad@example.com", "portals": ["employee", "manager"] }
```

They receive a link, sign into Platform (creating an account there if they need to), and accept.
Munaxa Work learns who they are from the account Platform vouched for — never from the link. An
invitation that reaches the wrong person is therefore worth very little: whoever follows it still
has to be somebody Platform authenticated, and the address on their account still has to be the
address you invited.

Invitations lapse after `INVITATION_VALIDITY_DAYS` (14 by default). Only one can be open per
address per organization; inviting somebody again while one is open is refused, so resend rather
than reissue.

**They already have a Platform account and you know its identifier.** Admit them directly.

```
POST /api/v1/identity/members
{ "platformUserId": "…" }
```

The same call readmits somebody who previously left. It is the same person and the same
membership record, revived — not a second identity, which is what you would otherwise be forced
to create for a rehire.

---

## Removing access

Three different acts, and the difference matters:

| You want to | Do this | Effect |
| ----------- | ------- | ------ |
| Stop somebody working here temporarily | `PATCH /members/:id` with `"transition": "suspend"` | They cannot open any request in this organization. Their other organizations are unaffected. Reversible with `"reinstate"` |
| Record that they have left | `PATCH /members/:id` with `"transition": "end"` | Their portals close and the cover they had arranged is withdrawn, automatically. Their history stays |
| Take away one application | `DELETE /portals/:assignmentId` | Removes an application from their home screen. Does **not** change what they are permitted to do |

Suspending and ending both require a stated reason. Reinstating does not — it restores a state
that already existed, and there is nothing to review later.

**Ending a membership deletes nothing.** Their employment history, their delegations, and every
audit row naming them survive it. That is deliberate: a system that could erase them could not
answer for itself afterwards.

---

## Portals are not permissions

This is the distinction most often collapsed, and it is worth being clear about.

Opening the **manager portal** to somebody says "this organization expects this person to use the
manager application". It says nothing about whether they may approve a particular leave request.
That is a *permission*, and permissions come from Platform's RBAC.

So revoking the manager portal does not revoke anybody's ability to approve anything. If that is
what you need, change their permissions in Platform.

---

## Jobs

A person may hold several jobs here at once — a second contract, a secondment, a role at two
legal entities of the same group. Exactly one is marked as their **main job**, and promoting a
second automatically steps the first down; the database refuses to hold two, so this cannot drift.

Detaching a job never removes the person. Somebody who leaves one of two jobs still works here,
and somebody who leaves their only job still has a leave balance to be paid out.

---

## Cover and delegation

When somebody will be away, record who acts for them:

```
POST /api/v1/identity/members/:membershipId/delegations
{ "delegateMembershipId": "…", "scope": "leave.approve",
  "effectiveFrom": "2026-09-01T00:00:00.000Z",
  "effectiveTo":   "2026-09-15T00:00:00.000Z",
  "reason": "annual leave" }
```

The delegate must be an active member. Nobody may delegate to themselves — it reads in the
register as arranged cover while arranging none.

Cover is in force strictly between its dates: inclusive at the start, exclusive at the end, so two
consecutive arrangements never overlap. Withdrawing it early takes effect immediately. From Phase
16, Workflow routes approvals using this register.

---

## Language, calendar and direction

Every member has their own language, calendar, time zone and numerals, seeded from the
organization's defaults and changed by them, not by you:

```
PUT /api/v1/identity/members/:membershipId/preferences
{ "language": "ar", "calendar": "hijri", "timeZone": "Asia/Riyadh",
  "numerals": "arabic-indic", "expectedVersion": 3 }
```

Reading direction follows the language and is not separately settable — a right-to-left language
rendered left to right is a broken screen, not a preference somebody holds. Arabic with Western
numerals is a legitimate and common combination, so numerals are chosen independently.

A member's **display name is required in both Arabic and English**. This is refused, not warned
about, and it is refused by the database as well as the application. The alternative is an org
chart that reads correctly in English and shows Latin characters in the middle of an Arabic page,
forever, because nobody was ever asked for the second name.

---

## Concurrent edits

Every change to an existing record carries the version you read (`expectedVersion`). If somebody
else changed it in between, your write is refused with **409 Conflict** rather than silently
overwriting theirs. Reload and decide again — that is the intended workflow, not an error to work
around.

---

## What the status codes mean

| Code | Meaning | What to do |
| ---- | ------- | ---------- |
| 400 | The request was malformed | Fix the payload. The response names the field |
| 401 | Not signed in, or no organization resolved for this account | Sign in; if you are signed in, you may not be an active member of the organization you asked for |
| 403 | Signed in, but lacking the permission | Permissions come from Platform |
| 404 | No such record **in this organization** | Indistinguishable from one that never existed, deliberately |
| 409 | Somebody else changed it first | Reload and retry |
| 422 | Well formed, and the business refused it | Read the message. Resending the same request unchanged will always fail |

Every error is RFC 9457 Problem Details and carries a `requestId` and `correlationId`. Quote them
in a support request: they are what turns a conversation into a log query.

---

## Setting up the organization

Everything below is under `/api/v1/organization`, and none of it is about people.

### Levels come first, and they are yours

Before creating a single unit, decide what your levels are called. This product ships **no**
levels — it offers a suggested set at `GET /organization/standard-unit-types` (company, legal
entity, business unit, branch, division, department, section, team) that you may adopt whole,
adopt partly, edit, or ignore entirely.

```
POST /api/v1/organization/unit-types
{ "code": "region", "name": { "en": "Region", "ar": "منطقة" }, "ordinal": 20,
  "allowedParentCodes": ["company"], "allowedAtRoot": false }
```

A structure of company / region / store is as valid as one using all eight suggestions, and a
structure twelve levels deep of the same kind is valid too. `allowedParentCodes` is your rule
about your own shape; leaving it empty means any parent, which is the honest default.

### Units exist before they are placed

Creating a unit does not put it anywhere. That is deliberate — a branch approved before anybody
decides which region owns it is a real state, and forcing a parent at creation would make you
invent one. `GET /organization/hierarchy` reports such units separately as `unplacedUnitIds`
rather than hiding them.

Placing one is a separate act, and it carries a date:

```
POST /api/v1/organization/units/{unitId}/placement
{ "parentUnitId": "…", "effectiveFrom": "2026-06-01T00:00:00Z" }
```

### Moving a unit never erases where it was

A move closes the period the unit had and opens a new one. Ask for the chart as at any date:

```
GET /api/v1/organization/hierarchy?asOf=2026-03-01T00:00:00Z
```

March's answer stays March's answer, permanently. `GET /organization/units/{id}/placements`
shows the whole history. Back-dating a correction works and does not disturb a later move.

Two things are refused, and both are refusals you want: a unit may not be placed beneath itself
(that is a chart that never finishes drawing), and a placement your own level rules forbid is
declined with the two level names in the message.

### The country belongs to the legal entity, not to you

This is the setting most worth getting right, because getting it wrong produces numbers that look
correct.

```
POST /api/v1/organization/units/{unitId}/legal-entity
{ "countryCode": "SA", "currencyCode": "SAR", "registrationNumber": "1010123456",
  "registeredName": { "en": "Munaxa Arabia Ltd", "ar": "مناكسا العربية المحدودة" },
  "effectiveFrom": "2026-01-01T00:00:00Z" }
```

An organization may hold several registrations in several countries at once, and each part of the
structure is governed by the nearest one above it:

```
GET /api/v1/organization/units/{unitId}/governing-legal-entity?asOf=…
```

That is what end of service, social insurance and wage protection will be computed from. If it
answers with nothing, nothing above that unit is registered — fix the structure rather than
assuming a default, because there is deliberately no default to assume.

**The country cannot be changed afterwards.** An entity that changed country is a different
registration under a different law; register the new one and close the old one, and both remain
answerable.

### Positions, and the headcount you budget

A position is a *role*, not a person, and it is attached to no unit. What is per-unit is the
budgeted headcount, which is proposed and then separately approved:

```
POST  /api/v1/organization/establishment            (budgeted, in draft)
PATCH /api/v1/organization/establishment/{id}/approve
GET   /api/v1/organization/units/{unitId}/establishment?asOf=…
```

The `filled` and `vacant` figures read zero and equal-to-budget today. That is not a bug: filled
counts employment assignments, this product has no employment module yet, and Organization does
not count people. It becomes real in Phase 5 with no change to what you configure.

### Calendars know no holidays

Define the working week — this product has no default, anywhere:

```
POST /api/v1/organization/calendars
{ "code": "CORP", "name": { "en": "Corporate", "ar": "المؤسسي" },
  "timeZone": "Asia/Riyadh", "workingDays": [7, 1, 2, 3, 4],
  "effectiveFrom": "2026-01-01T00:00:00Z" }
```

Weekdays are ISO: Monday is 1, Sunday is 7. Holidays and other exception dates are rows you add:

```
POST /api/v1/organization/calendars/{calendarId}/days
{ "onDate": "2027-03-20", "kind": "holiday",
  "name": { "en": "Eid al-Fitr", "ar": "عيد الفطر" } }
```

Dates are civil dates in the calendar's own time zone, not moments — a holiday is a day in a
place. Recording a date twice replaces the entry rather than adding a second.

### Your organization's own defaults

```
PUT /api/v1/organization/tenant-settings
{ "language": "ar", "calendar": "hijri", "timeZone": "Asia/Riyadh",
  "numerals": "arabic-indic", "invitationValidityDays": 14,
  "defaultPortals": ["employee"] }
```

Submitted whole, because that is what a settings screen sends and a half-applied set is a state
nobody chose. Until you submit it, your organization uses the deployment's defaults — and `GET`
returns nothing rather than those defaults, so you can always tell which of the two you are on.

### Loading a structure you already have

```
POST /api/v1/organization/import
```

The rows may be in any order — a department may appear above the division it belongs to. Every
rule that applies when you create a unit by hand applies here too, so a name missing its Arabic
is refused in an import exactly as it is at the keyboard.

**If an import fails partway, fix the row and run the same file again.** Units that already exist
are reused rather than duplicated, and a unit already sitting where the file says it sits is left
alone. Imports are limited to 2,000 rows; beyond that the request is refused and says so.

`GET /organization/export` returns the whole structure including **every** placement period, not
just today's — an export of only the current shape would be a backup that threw the history away.

### Names are always in two languages

Every name you author — a level, a unit, a legal entity, a centre, a position, a calendar, a
holiday — is required in Arabic *and* English, and is refused without both. This is not
bureaucracy: a name entered once in one language is a name that stays wrong on half your screens
forever, because nobody is ever asked for the other one again.

---

## The people register

### One person, once — and why the product argues with you about it

A Person is a human being, not a job. The same record follows somebody through being hired,
promoted, made a manager, leaving, and coming back four years later.

Creating somebody who looks like an existing record is **refused**, with the candidates. That is
deliberately in your way, because a second record for one human being does not look like an error
afterwards — it looks like a shorter career:

- an end-of-service gratuity computed on four years instead of eleven,
- half a leave balance,
- a loan repaid twice,
- one national identifier registered twice with a social insurance authority.

If they genuinely are different people — two brothers, the same name, the same birthday — re-send
with `acknowledgedDuplicates`, and both are created *and* the pair is queued for review. Nothing is
merged automatically, ever.

The check recognises `أحمد` and `احمد` as one name, and `1234-5678-90` and `1234 5678 90` as one
document.

### The review queue

`GET /api/v1/people/duplicates?status=pending` is the work list. Each entry says *why* the system
suspects a match and how strongly — a shared government identifier is near-certain, a shared mobile
number is strong but families share landlines, a shared name and birthday is the weakest and never
enough on its own.

Deciding is `PATCH /api/v1/people/duplicates/{id}` with `confirmed` or `dismissed`. **Confirming
does not merge them.** Merging is a separate operation with its own permission, because it is
effectively irreversible for every module that has since referenced the record that loses.

A merge is a redirect, not a deletion: the losing record stays, points at the survivor, and refuses
further changes. Everything that ever referenced it still resolves, which is the whole reason a
merge is not a delete.

### Names are dated, and you should date them

A legal name change — marriage, naturalisation, a court correction — is recorded with the date it
took effect, not the date you typed it. `POST /api/v1/people/{id}/names` takes `effectiveFrom`.

Get that date right. A settlement letter, a visa application and a government submission are
documents *about a date*, and they resolve the name in force then. A certificate that arrives three
weeks late is recorded with the date on the certificate, and doing so splits the history correctly
rather than discarding anything recorded since.

`GET /api/v1/people/{id}?asOf=2026-03-01` answers with the name as it stood.

### Who can see what

Permissions here are finer than anywhere else in the product, and that is deliberate. Seeing that
somebody exists, seeing their date of birth, and seeing the number on their passport are three
different permissions.

| If a user lacks | They see |
| --------------- | -------- |
| `people.person.read-sensitive` | The person, with date of birth, place of birth, gender and marital status **absent** — and a flag saying fields were hidden |
| `people.identifier.read-value` | `••••7890` — enough to confirm the right document, not enough to be it |
| `people.identifier.read` | No identifiers section at all, and `withheld` says so |
| `people.note.read` | No notes section at all |

A missing field is **absent**, not blank and not zero. If a screen shows nothing where a date of
birth should be, that is either "not recorded" or "not yours to see", and the response distinguishes
them — check `sensitiveWithheld` and `withheld` before assuming data is missing.

**Grant `people.identifier.read-value` to very few people.** Every use of it is recorded.

### Metadata is not a place for personal data

The `metadata` field on a person is yours: stored, returned, never interpreted. It is also
**excluded from the redaction above**, because the product cannot know what is in it. Do not put a
national identifier, a medical detail or anything else sensitive there — it will be visible to
everybody who can read the person.

### Bulk load

`POST /api/v1/people/import` takes up to 2,000 rows and sends each through the same command a person
would. Two consequences you should plan for:

- **It is not atomic.** A bad row leaves everything before it written. It is, however, *resumable* —
  a person number that already exists is skipped rather than failed — so fix the file and run it
  again.
- **It refuses matches by default**, reporting them rather than writing them. Review those before
  re-running with `acknowledgedDuplicates`, or you will import the duplicates you are trying to
  avoid.

Names are required in Arabic *and* English on every row, exactly as they are on a screen.

### The secret you must set

`PII_MATCH_SECRET` is the key the duplicate check derives its digests from — the reason the product
can find who already holds a national identifier without ever reading one.

- At least 32 characters, random, stored with your other secrets.
- A development default ships so a checkout runs. **Startup refuses it when `NODE_ENV=production`.**
- **Do not rotate it casually.** Rotating invalidates every stored match digest, so the duplicate
  check stops finding existing records until each is re-recorded. Treat it as a long-lived key.

### What the register does not hold

No unit, position, manager, cost centre, shift, salary or attendance. If you are looking for where
somebody works, that is Employment — a different module, referencing this one.

### What it cannot do yet

- **Erasure.** A right-to-erasure request cannot be satisfied by this release. Identity records are
  never destroyed by design, and reconciling that with erasure is a governance decision recorded for
  Phase 21.
- **Answering "who read this person's passport last year".** Each disclosure is written to the
  structured log, so it is alertable, but it is not yet a queryable ledger.
- **A scheduled duplicate sweep.** `POST /api/v1/people/duplicates/rescan/{personId}` re-runs the
  check on demand and is safe to repeat; running it on a timer waits for Phase 24.

---

## Operational checks

| Endpoint | Question it answers | Who asks |
| -------- | ------------------- | -------- |
| `/health/live` | Is the process running? | The orchestrator, to decide whether to restart it |
| `/health/ready` | Can it serve traffic? | The orchestrator, to decide whether to route to it |
| `/health` | What is the state of it and its dependencies? | A person |

These are unauthenticated by design and expose no configuration. They are also unversioned, so an
orchestrator's probe URL survives an API version bump.

**If every business endpoint returns 401,** the most likely cause is that Platform's
authentication adapter has not been configured for this deployment. That is the intended failure
direction — a deployment that forgets it serves nothing rather than serving everything — but it
looks alarming the first time.

**If the application refuses to start** citing row-level security, it is connected as a database
role that could bypass tenant isolation, usually the migration role or a superuser. Connect as
the unprivileged application role. The check exists because that single misconfiguration disables
every tenant policy while every screen keeps working.
