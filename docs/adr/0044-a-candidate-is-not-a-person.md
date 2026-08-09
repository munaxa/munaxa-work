# ADR-0044 — A candidate is not a Person

**Status** Accepted · **Date** 2026-08-09 · **Author** Phase 6 · **Approval** Approved before implementation (A-2)

## Context

Phase 4 built People as the master registry of human identity, with nine tested protections around
government identifiers, a keyed digest for matching, and a disclosure record for every read of an
identifier's value (ADR-0038).

Recruitment holds people too — but people who do **not** work for the customer, who did not consent to
being in a personnel system, and most of whom will never join. The obvious question is whether an
applicant should be a Person from the moment they apply.

## Decision

A candidate is a **separate aggregate in a separate table**, and no Person exists until hire.

- `recruitment_candidate` holds a name, an email address, a telephone number, a source and what the
  candidate says about themselves. It has **no column** for a national identifier, a passport number,
  a date of birth, a nationality or a photograph.
- `person_id` is null for a candidate's whole life until they are hired. It is written **exactly
  once**, and a partial unique index makes two candidate records for one Person impossible.
- At hire, Recruitment resolves a Person through **People's own application service** — reusing a
  single unambiguous match, and creating one otherwise. It writes no row in `person` and duplicates
  none of People's matching logic or identity-document protection.
- Matching is a **suggestion for a human**, never an automatic link.

## Reason

**The strongest privacy guarantee available is not holding the data.** A speculative applicant who is
never contacted leaves this product no identifier, no birth date and no nationality — not because a
policy forbids reading them, but because there is nowhere to put them.

**A candidate and an employee are different things with different lifecycles.** A candidate is
archived, anonymized and eventually forgotten under a retention policy. A person on the register is
kept for as long as the employment record requires. Modelling both as one row means one lifecycle for
two obligations, and the stricter one loses.

**Automatic matching attaches careers to the wrong people.** Two people share a family email address
more often than a product designer expects. A system that linked on one would attach somebody's
application history to their spouse, and the mistake is invisible until it matters.

**Recruitment refuses rather than merges.** Creating a candidate whose address is already known
returns a conflict rather than quietly updating the record it found — a create that silently became an
update is how a name gets overwritten.

## Consequences

- Recruitment reports on candidates; People reports on people. Neither number is the other, and a
  funnel that counted people would count the wrong thing.
- A hire is a **transition between two aggregates in two modules**, which cannot be one transaction —
  see ADR-0046.
- Identity-sensitive data is collected once, by the module built to protect it, from somebody who has
  agreed to join.
- Anonymizing a candidate is Recruitment's own operation and deletes nothing: the record survives so
  applications, interviews and offers still resolve, and what goes is the name, the address and the
  telephone number.
