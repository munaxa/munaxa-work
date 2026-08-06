# People

**Module** `@work/people` · **Phase** 4 · **Owns** one permanent human identity per human being

Who somebody is: their names over time, the identifiers a government issued them, the citizenships
they hold, how they are reached, where they live, who to call in an emergency, what they can do, and
what they did before they arrived.

It owns no employment. There is no unit, no position, no manager, no cost centre, no shift, no
salary and no attendance here, and no place to put one (AD-002 to AD-005). Employment references
Person; Person references nothing downstream of it. Business relationships change and identity does
not — the same Person may be hired, promoted, made a manager, leave, and return four years later,
and remain one Person throughout (AD-001, AD-006).

---

## The three decisions worth knowing before reading anything else

**A person has no name column.** A legal name changes — marriage, naturalisation, a court correction
— and "what was this person's legal name on the date they signed that contract" has legal force and
exactly one right answer. Names live entirely in `person_name`, on a timeline, and the person row
holds no cached copy, because a cached copy is a second answer.
[ADR-0037](../adr/0037-legal-name-is-effective-dated.md).

**Duplicate detection runs before the write, and merges nothing.** A second Person for one human
being splits their service period, so an end-of-service gratuity computes on four years instead of
eleven; it splits their leave balance and their loan repayments; and it registers one national
identifier twice with a social insurance authority. Every one of those looks like a correct number.
Detection produces *candidates* with a stated reason; a human decides.

**Personal data is protected by mechanism, not by policy document.** Reading a person and reading
their date of birth are different permissions. Reading that an identifier exists and reading its
number are different permissions, and the second is recorded. Matching compares a keyed digest, so
the query that finds who holds a number never reads one. No event, rejection or export carries a
value. [ADR-0038](../adr/0038-personal-data-protection.md).

---

## The shape

```text
person                      One permanent human identity. No name column (ADR-0037).
   │                        number · date and place of birth · gender and marital codes
   │                        status · photo reference · merge redirect · metadata
   │
   ├──▶ person_name                 What they were called, and from when. Timeline.
   │                                legal name · preferred name — both bilingual
   │
   ├──▶ person_identifier           Government and business identifiers.
   │                                type (a code, never our list) · value · keyed match digest
   │
   ├──▶ person_nationality          Citizenships. A row, not a column: dual nationality is ordinary.
   │
   ├──▶ person_contact              How they are reached. Timeline, slotted by channel + purpose.
   ├──▶ person_address              Where they live or receive post. Timeline, slotted by kind.
   ├──▶ person_emergency_contact    Who to call. Timeline, slotted by priority.
   ├──▶ person_preference           What they chose. Timeline, slotted by key.
   │
   ├──▶ person_capability           Languages and skills. Claims — withdrawn, never superseded.
   ├──▶ person_history              Education, experience elsewhere, certifications.
   ├──▶ person_tag                  A tenant's own grouping.
   └──▶ person_note                 Free text about them. Never amended, never deleted.

person_duplicate_candidate  Two records suspected of being one person. The pair, ordered.
```

**Nothing here is ever deleted.** Every child record is withdrawn or superseded; a merge is a
redirect. Historical identity information is never destroyed (AD-009), and everything that ever
referenced a record — an employment, a payslip, a leave balance from six years ago — must still
resolve.

---

## Effective dating, and where it stops

The boundary is drawn on whether yesterday's value has force today.

| Shape | What has it | Why |
| ----- | ----------- | --- |
| **Timeline** (superseded, never edited) | Legal and preferred name; contacts; addresses; emergency contacts; preferences | Read *about a date*. Which name was on the contract; which number did we have on the day of the incident; where was the letter posted; did they consent when the brochure went to print |
| **Corrected in place** | Date and place of birth, gender code, marital status | Nobody's date of birth moves. A timeline of birth dates would model something that cannot happen. The previous value travels in the event |
| **Withdrawn** | Nationalities, capabilities, history, tags, notes | A claim that was made or withdrawn, not a value that had a different value last March |
| **Neither** | An identifier's *value* | A different number is a different document. A renewed passport is a new identifier and a withdrawal of the old one |

A **slot** is which timeline a new record supersedes: a contact by channel *and* purpose, an address
by kind, an emergency contact by priority, a preference by key. Getting a slot wrong is the
characteristic bug of this pattern and it is silent — the record closed by mistake simply stops
being returned — so each one is asserted by test.

A **back-dated** change splits the history rather than discarding what follows it. Recording a June
address on somebody who also moved in September closes June's predecessor at June and bounds the new
record at September. This is the rule Phase 3 arrived at for placements, reused rather than
rediscovered.

---

## Duplicate detection

Three signals, three indexed lookups rather than a scan — comparing a new person against every
existing one would be linear in the size of the register on every create, and the check that becomes
slow is the check that gets switched off.

| Signal | Confidence | Why not more, why not less |
| ------ | ---------- | -------------------------- |
| The same **government identifier** | 95 | An authority took steps to make it unique. A collision is a duplicate or a data-entry error, and either needs a human |
| The same **contact value** | 70 | Strong but not conclusive: a family shares a landline, a site office shares one mailbox across a crew |
| The same **name and date of birth** | 45 | The weakest, and the one that must never auto-merge. In this product's first markets a very large share of the population shares a given name with a patronymic, and twins share a birthday |

Names are compared after collapsing everything that is presentation — the alef forms, the two final
yaa forms, the taa marbuta, the diacritics and the tatweel — so `أحمد` and `احمد` are one name typed
on two keyboards. A matcher that treated them as different would miss precisely the duplicates that
arise here.

Detection runs before a create, before an identifier, before a contact, on every import row, and on
demand (`POST /people/duplicates/rescan/{personId}` — idempotent, and what a background job will
call when Phase 24 provides one). **Nothing merges automatically.** Confirming a candidate records
that two records are one human being; merging them is a separate command with its own permission,
because a merge is effectively irreversible for every module that has since referenced the record
that loses.

---

## Permissions

Twenty-nine, and the fineness is the point rather than an accident. This module holds national
identifiers, home addresses, emergency contacts and free-text notes, and those are not one
sensitivity.

| Permission | Guards |
| ---------- | ------ |
| `people.person.read` / `.manage` | That a person exists, their number, their name |
| `people.person.read-sensitive` | Date and place of birth, gender, marital status |
| `people.identifier.read` | That an identifier exists, its kind, its expiry — and a **masked** value |
| `people.identifier.read-value` | The number itself. Every use is recorded |
| `people.identifier.manage` | Recording, amending and withdrawing identifiers |
| `people.nationality.*`, `.contact.*`, `.address.*` | Citizenships, contact points, addresses |
| `people.emergency-contact.*` | Another human being's data, held about somebody who never consented to this system |
| `people.preference.*`, `.capability.*`, `.history.*`, `.tag.*` | The rest of the profile |
| `people.note.read` / `.write` | Free text an administrator wrote. The highest-risk field |
| `people.duplicate.read` / `.review` | The review queue, and deciding |
| `people.person.merge` | Merging. Separate from reviewing, deliberately |
| `people.import` / `people.export` | Bulk load; taking the register out of the product |

A caller holding `people.person.read` and nothing else gets a **redacted answer, not a 403**. A
picker that refuses everybody who cannot see passport numbers is a picker nobody can use, and the
pressure that creates is to grant everybody the sensitive permission.

A withheld *field* is absent, never null. A withheld *section* is absent from the profile and named
in `withheld` — an empty `identifiers` array would assert this person holds no documents, which is a
different and false statement.

---

## Localization

Both catalogues complete and gated. Every rejection carries a catalogue key rather than a sentence,
so an Arabic-speaking administrator reads a refusal in Arabic.

A person's **name is authored data, not a catalogue key** — it is their own name, not a string this
product ships — so it is bilingual text, and **both languages are required** by the domain and by
the database. That is a real cost at data entry and it is the right one: a registry that accepted an
English name alone produces an Arabic contract, payslip and government submission with Latin
characters in the middle of the person's own name, forever, because nobody was ever asked for the
second form. Addresses carry the same rule for the same reason: an Arabic-speaking courier needs the
Arabic address.

Nothing in this module knows a country, a document type, an address format or a family
relationship. Country codes are validated by *shape* and never against a list; identifier types,
gender, marital status, relationship and tag codes are supplied by the tenant or by a country pack
(00B). There is no `state`, no `county` and no postal-code pattern in the address table, because an
address that fits one country's form does not fit another's.

---

## What this module publishes

Contracts only — `@work/people/contracts`. Its repositories, tables and aggregates are private, and
in this module that is not merely tidiness: the boundary is also where the permission check and the
redaction live, so a consumer that could reach past it would be a consumer reading national
identifiers without one.

Events name what changed and never what it changed to. A rename carries neither name; an identifier
event carries the type, never the number. Events are immutable, fan out to consumers this module
does not know, and end up in logs.

---

## Running it

```bash
DATABASE_URL=… pnpm db:migrate
PII_MATCH_SECRET=… pnpm --filter @work/api dev     # 29 endpoints under /api/v1/people
pnpm --filter @work/admin dev                      # /people, and /people?lang=ar
```

`PII_MATCH_SECRET` is validated configuration. It is the key duplicate-match digests are derived
with, and startup **refuses** the shipped development value when `NODE_ENV=production` — a default
key is the same key in every deployment.

Until Platform's authentication adapter is supplied, every endpoint answers 401 and the screens
render their empty states. That is the intended state, not a misconfiguration.
