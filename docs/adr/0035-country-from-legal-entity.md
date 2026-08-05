# ADR-0035 — A country belongs to a legal entity, never to a tenant

**Status** Accepted · **Date** 2026-08-06 · **Author** Phase 3 · **Approval** Pending phase approval

## Context

`00B_LOCALIZATION_AND_STATUTORY_FRAMEWORK.md` states two rules that together decide where a
country lives in this product:

> A tenant may operate in multiple countries at once.
>
> An employment resolves its country pack from its legal entity, not from the tenant.

Phase 3 is the first phase in a position to honour or break them. Once a country column exists in
the wrong place, every phase after it inherits the mistake, and Phase 11.1 — statutory country
packs, end of service, social insurance, wage protection files — is built directly on top of the
answer.

The temptation to put the country on the tenant is real and cheap: most customers operate in one
country, and `tenant.country_code` would make every lookup a single field read. The failure it
produces is not an error. It is a **plausible wrong number**: a Jordanian employee of a group
whose tenant says `SA` would have their end-of-service gratuity computed under Saudi Labor Law,
and the result would look entirely reasonable on a settlement letter.

## Decision

**`legal_entity.country_code` is where a country enters Munaxa Work, and it is the only place.**

- A legal entity is a companion record on an organization unit whose *type* says it carries a
  registration (ADR-0034). It holds the country, the registered name, the registration number, the
  tax identifier and the currency.
- `GET /api/v1/organization/units/{unitId}/governing-legal-entity?asOf=` answers *which country's
  law governs anybody working in this unit on this date*, by walking up the placement hierarchy to
  the nearest registration in force. It is published as the `GoverningLegalEntity` contract.
- **The country is not amendable.** The domain has no parameter for it and the repository does not
  assign it. An entity that changed country is a different registration under a different law.
- **There is no fallback.** A unit with no registration above it resolves to `undefined`, not to a
  tenant default and not to a deployment default.
- Currency sits beside the country, for the same reason: a group operating in Riyadh and Amman has
  two of each.

## Consequences

- One tenant runs a Saudi company and a Jordanian one at once, with teams under each resolving to
  different law, different currency and different statutory rules — on the same request. This is
  asserted by test, in one tenant, because a suite that registered a single entity would pass just
  as happily for a design that put the country on the tenant.
- Moving a unit between companies changes the law it answers to **from the date of the move**, and
  not before it. The walk is effective-dated, so last March's answer stays last March's answer.
- Phase 11.1 has exactly one input to resolve a country pack from, and no second place to look.
- Nothing in this module knows any country. `country_code` is validated as an ISO 3166-1 alpha-2
  *shape* — `check (country_code ~ '^[A-Z]{2}$')` — and never against a list. Selling into a new
  market is configuration, never a schema change (00B).
- Closing a registration stops it governing anybody for later dates while leaving every past
  answer intact, which is what lets a historical payroll re-run reproduce itself.

**The cost.** Resolving a country is a hierarchy walk rather than a field read. It is one indexed
read of the tenant's placements plus one `unit_id = any(...)` lookup over the ancestor chain, for a
table measured in thousands of rows — and correctness here is not tradeable against a saved join.

**Alternative considered.** *A country on the tenant, with per-entity override.* Rejected: an
override that is usually absent is a default that is usually wrong, and the wrongness is silent.
00B forbids it in as many words.
