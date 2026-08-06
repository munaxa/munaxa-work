# ADR-0038 — How personal data is protected in People

**Status** Accepted · **Date** 2026-08-06 · **Author** Phase 4 · **Approval** Pending phase approval

## Context

Phase 3's verification report could write, honestly, **PII: none** — Organization holds structure,
and no person's name appears in any of its tables.

Phase 4 cannot. The People registry holds national identifiers, passport and residency-permit
numbers, dates and places of birth, nationalities, home addresses, personal telephone numbers, the
names and numbers of family members who never consented to this system, and free-text notes an
administrator wrote about a colleague.

Three things about that data are different in kind from anything the product held before:

- A national identifier **cannot be rotated after a leak**. It is the key to somebody's credit,
  their medical record and their immigration status for the rest of their life.
- An emergency contact is **a third party's data**. They are not a user of this system and cannot
  ask it what it holds about them.
- A note is **written about somebody by somebody else**, and it is read in a disciplinary case.

"Every table has `tenant_id` and a policy" was a sufficient answer for a hierarchy. It is not a
sufficient answer for this.

## Decision

Six mechanisms, each enforced rather than documented, and each with a test.

### 1. Reading a person and reading their sensitive fields are different permissions

`people.person.read` returns the person with the date of birth, place of birth, gender code and
marital status **absent**; `people.person.read-sensitive` returns them.

Holding the first grants a **redacted answer, not a refusal**. A picker that 403s for every user who
cannot see dates of birth is a picker nobody can use, and the pressure that creates is to grant
everybody the sensitive permission — which is how a permission model becomes decoration.

A withheld field is **absent from the response, never null**, and the response says
`sensitiveWithheld: true`. A consumer receiving `dateOfBirth: null` cannot tell "we do not know"
from "you may not see it", and the two lead to different behaviour: one prompts for the value, the
other must not.

### 2. Reading that an identifier exists and reading its value are different permissions

`people.identifier.read` returns the kind, the issuing country, the expiry and a **masked value** —
the last four characters, and never fewer than four mask characters regardless of length, so a
short value does not reveal itself and the mask does not report the length.

`people.identifier.read-value` returns the number. That an employee holds a residency permit is an
ordinary administrative fact; the number on it is not.

### 3. Every disclosure of an identifier value is recorded

Through `DisclosurePort`, whose shipped adapter writes a structured record carrying the tenant, the
actor, the person and the **kind** of identifier — never the value, because a disclosure log holding
the numbers would be a second copy of the thing it exists to protect, in the one place nobody thinks
to secure.

### 4. Duplicate detection never reads a plaintext identifier

`person_identifier.match_key` is an **HMAC** over the identifier's type and its normalized value,
keyed with `PII_MATCH_SECRET`. Matching, the unique index that enforces AD-001, and search all
compare the key.

**Keyed, not hashed.** A national identifier space is small — Saudi Arabia's is ten digits with a
known leading digit — so an unkeyed SHA-256 of one is recoverable from a rainbow table in minutes. A
plain hash of a national identifier *is* the national identifier, wearing a hat. Recovering an HMAC
requires the key, which is not in the database and not in a backup of it.

The type is inside the digest, so a passport and a national identifier that share a number produce
different keys.

Startup **refuses** the shipped development key when `NODE_ENV=production`, because a default key is
the same key in every deployment.

### 5. No personal data appears in an event, a rejection or an export

- **Events** carry the person's identifier and the *kind* of thing that changed. A rename event
  carries neither the old name nor the new one; an identifier event carries the type, never the
  number. Events are immutable, fan out to consumers this module does not know, and end up in logs —
  which makes an event payload the easiest place to leak a national identifier permanently.
- **Rejections** name the kind that clashed, never the value. A refusal echoing a national
  identifier would put it into a browser's history and a support ticket.
- **Search** digests an identifier and normalizes a contact value *before* the query is issued, so
  neither reaches a query plan, a slow-query log or a monitoring trace.
- **Export** is deliberately narrower than a profile: no identifier values, no notes, no addresses,
  no emergency contacts, no dates of birth. A file on somebody's laptop is the one copy this product
  cannot protect.

### 6. Nothing is deleted

Every child record is withdrawn or superseded; a merge is a redirect. A note is neither amendable
nor deletable — an editable note cannot be relied on in a disciplinary case, and a deletable one is
a record somebody can make disappear. A note that was wrong is superseded by a further note.

## Consequences

- The permission set is finer than any previous module's — twenty-nine permissions — and that is the
  point rather than an accident. Read and manage per concern would have put a passport number behind
  the same permission as a person's existence.
- Assembling a profile costs one permission check per section. Measured in microseconds against an
  in-process checker; a remote one would make this the dominant cost of the endpoint, and the answer
  then is to batch the check rather than to widen the permission.
- **Encryption at rest is the database's, not this module's.** Column-level encryption without a key
  management service is theatre: the key would live beside the data, in the same backup. What this
  module does instead is ensure the *index* holds nothing worth stealing and the *plaintext* is
  reachable only through a permission check that is recorded.
- **A durable, queryable disclosure ledger does not exist.** A log is a stream, and "who read this
  person's passport in the last year" wants a table. That belongs to Phase 21, which owns temporal
  audit, and it is in the debt register rather than implied by the presence of `DisclosurePort`.
- **Erasure is not implemented.** A right-to-erasure request cannot be satisfied by this module
  today, and AD-009 — historical identity information is never destroyed — is in genuine tension
  with it. Resolving that tension is a governance decision with a legal input, and it belongs to
  Phase 21. Stated in the debt register rather than quietly absent.

**Alternative considered.** *One `people.read` permission, with redaction driven by a field-level
policy engine.* Rejected for this phase: the product has no policy engine, Platform owns
authorization, and inventing a second one here would be exactly the duplication the master
instructions forbid. The permissions this module declares are what Platform grants.
