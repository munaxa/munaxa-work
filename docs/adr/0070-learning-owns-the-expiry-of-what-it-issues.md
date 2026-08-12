# ADR-0070 — Learning owns the expiry of what it issues, and references the document that evidences it

**Status** Accepted · **Date** 2026-08-11 · **Author** Phase 14A · **Approval** Approved as decision D-1 of the Phase 14 Definition of Ready; this records the mechanism and amends a rule the registry had already written

## Context

`DOMAIN_OWNERSHIP.md` carries a rule that was correct when it was written and is not correct any
more:

> **A document's expiry belongs to whoever owns the thing that expires.** … A document with no
> identifier behind it — a signed policy acknowledgement, **a training certificate** — carries its
> own expiry, **because nothing else owns one**.

The premise is the last clause. Nothing else owned a training certificate in Phase 12, so
`documents` kept the date. Phase 14 introduces a module whose whole subject is what somebody has
attained and for how long it stays valid, and the premise stops holding.

There are now three places a date about a qualification could live, and all three already exist or
are about to:

| Place | Holds | Since |
| --- | --- | --- |
| `person_history` where `kind = 'certification'`, column `expires_on` | a qualification the person **brought with them** — pre-employment, external, part of who they are | Phase 4 |
| `document.expiry_date` | a **document**: the scanned artefact, its own validity as a piece of evidence | Phase 12 |
| `learning_certification` | what **this employer's learning issued**, and how long it remains valid | Phase 14 |

Two of them holding the same date is the failure the ownership registry exists to prevent, and it is
not a hypothetical: a safety certificate earned on an internal course, scanned and filed, would have
an expiry in `document` and an expiry in `learning_certification`, and nothing would reconcile them.

## Decision

**Learning owns the lifecycle and expiry of the certifications Learning issues.** The other two
owners keep exactly what they already own, and the boundary is drawn by *what the record is about*
rather than by which module got there first:

- **`person_history.expires_on` remains authoritative** for pre-employment and external
  qualifications recorded as part of a person's background. Phase 14 does not read it, does not
  write it and does not copy it. It answers "what did they arrive with".
- **`document.expiry_date` remains authoritative for the document**, and only for the document. A
  scan can expire as an artefact — a re-issued card, a superseded certificate PDF — independently of
  the qualification it evidences.
- **`learning_certification` is authoritative for the qualification** this employer issued or
  recorded, its validity window, its revocation and its recertification chain.

**Where the same certificate is both, the Learning certification references the Document and stores
no second copy of anything the Document owns.** `learning_certification.evidence_document_id` is an
opaque identifier confirmed to exist through `documents.read-document` under a bounded service
grant. Learning stores no filename, no size, no hash, no URL and no version — Documents owns all of
those, and duplicating any of them would recreate the problem one field further along.

**A certification may exist with no enrolment behind it** (decision D-2). `source` distinguishes
`learning_completion`, `external` and `recorded` so that "where did this come from" is a fact on the
row rather than an inference from which columns are null. No enrolment is manufactured to satisfy a
foreign key.

### Expiry is derived, never stored

Following `documents/src/domain/expiry.ts` exactly, and for the same reason stated there:

> A materialized `expired` column needs something to move it from `valid` on the right morning.
> `JobPort` has no adapter anywhere in this repository, so nothing scheduled runs — and a stored flag
> that nothing maintains is worse than no flag.

So `valid_until` is the only fact, and validity is a function of it and today. The expiring-soon
queue is an indexed predicate over a date, correct at every instant.

## Consequences

`DOMAIN_OWNERSHIP.md` is amended in the same change: the sentence "because nothing else owns one"
now names Learning as the owner for issued certifications, and the three-way split above is written
into the registry rather than left to be rediscovered.

A consumer asking "is this person's forklift certificate valid" asks Learning. A consumer asking
"what qualifications did they have when they joined" asks People. A consumer asking "is the scan on
file still the current one" asks Documents. Three questions, three owners, no duplication — and each
of the three is a different question, which is why three owners is correct rather than one too many.

Reconciliation reports a certification whose evidence document no longer exists. It **reports and
repairs nothing**: a certification is a fact about a person, and deleting one because a scan went
missing would destroy the record of a qualification somebody actually holds.
