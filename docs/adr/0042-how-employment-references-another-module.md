# ADR-0042 — How Employment references another module: one foreign key, one published query, one gap

**Status** Accepted · **Date** 2026-08-09 · **Author** Phase 5 · **Approval** Approved before implementation

## Context

Employment is the first module that depends on two others. It references a **person** (People's) and
an organizational **unit**, **position** and **cost centre** (Organization's), and §37 of the phase
specification requires that those references be real and belong to the same tenant.

Three rules constrain how:

- A module reads another module's data through its application service, contracts or events — never
  its repositories or its tables (`MASTER_INSTRUCTIONS.md`).
- Completed Phase 0–4 architecture is not modified to satisfy Phase 5.
- Foreign keys and referential integrity are explicitly required (§36, §37).

They do not all point the same way, and Phase 2 had already made a decision that looks contrary:
`identity.employment_link` stores an `employment_id` with a documented, deliberate *absence* of a
foreign key.

## Decision

Three different treatments, one rule each.

**1. `employment.person_id` carries a foreign key to `person`.**

**2. A unit reference is verified through `organization.unit-ancestry`**, a published query, via an
adapter in the API's composition root that goes through the shared dispatcher.

**3. Position and cost-centre references are stored and not verified.** Organization publishes no
single-entity read for either. Their tenant containment rests on row-level security. The missing
reads are recorded as a gap against Organization's contract.

## Reason

**The foreign key and Phase 2's absent one are the same rule, not different ones.** Direction is what
separates them. `identity.employment_link.employment_id` points *forward*, from a module that shipped
first to a table that did not yet exist — a key there would have made Phase 2's schema depend on
Phase 5's, and a module cannot be extracted while it holds a key into a table it will not take with
it. `employment.person_id` points *backward*, to a module Employment already depends on, in the same
schema and the same tenant, enforcing Employment's own invariant. If Employment were ever extracted,
that key goes with the decision to extract it, and the check becomes an application check.

**The unit is verified through a query rather than a key** because a composite key enforcing the
tenant (`foreign key (tenant_id, unit_id)`) needs a new unique index **on Organization's table**, and
Phase 5 does not reshape a completed module's schema.

**The permission consequence is accepted deliberately.** Because the adapters go through the shared
dispatcher, creating an employment requires `people.person.read` and placing one requires
`organization.hierarchy.read`. That is not a leak of one module's permissions into another: attaching
somebody to a person you may not see, or to a department you may not see, is not an operation this
product should offer.

**Position and cost centre are the honest gap.** Organization's `list-positions` is paged and
filtered with no by-identifier read, and financial centres have no published query at all. The three
ways to close it were: reach into Organization's tables (forbidden), add a query to Organization
(modifying a completed module), or state the gap. The third is the only one consistent with the
constraints, and row-level security means the failure mode is a reference to a row the tenant cannot
read — a data blemish, not a disclosure.

## Consequences

- A person that does not exist, is in another tenant, or is one the caller may not read all produce
  the same answer: **not found**. That is correct rather than lossy — distinguishing them would
  disclose that an identifier names a real human being in this system.
- An employment cannot be created against a **merged** person. Phase 4 merges by redirection, so the
  losing record still reads; attaching a job to it would produce an employment that effectively
  belongs to nobody. Phase 4's register asked for this to be revisited here, and this is the answer.
- Employment's reference checks cost one dispatcher round trip each on the write path. Bounded, and
  measured.
- **Recorded as a gap:** Organization publishes no single-entity read for a position or a cost
  centre. Whichever phase next needs one should add it to Organization's contract, and Employment's
  `OrganizationDirectoryPort` is where the checks then go.

## Alternatives considered

**No foreign key anywhere, mirroring Phase 2 exactly.** Rejected: §37 requires that an employment
reference an existing person, and the database is the only place that can be guaranteed under
concurrency.

**Composite foreign keys with new unique indexes on Organization's tables.** The strongest integrity
available, and it modifies a completed module's schema from another module's migration. Rejected on
the standing constraint, and on the boundary: a migration that indexes another module's table is a
migration that owns it a little.

**Adapters reading Organization's and People's tables directly from Employment's infrastructure.**
Simple, fast, and the failure the modular monolith exists to prevent. Rejected outright.
