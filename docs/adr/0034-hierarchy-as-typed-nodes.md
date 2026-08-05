# ADR-0034 — The organizational hierarchy is one node table, not nine

**Status** Accepted · **Date** 2026-08-06 · **Author** Phase 3 · **Approval** Pending phase approval

## Context

`04_PHASE_3_ORGANIZATION.md` lists nine organizational entities as aggregate roots — Company,
Legal Entity, Business Unit, Branch, Division, Department, Section, Team — and draws them as a
ladder: Tenant → Company → Legal Entity → Business Unit → Branch → Division → Department →
Section → Team.

The obvious reading is nine tables and nine aggregates. The same specification then says, as a
mandatory decision:

> **AD-003** — The hierarchy must support unlimited depth. The implementation must not assume a
> fixed number of levels.

and, of the ladder:

> Each level is configurable. Tenants may use only the levels they require. The hierarchy engine
> must not require every level to exist.

Nine tables is nine levels. Every claim above would then be false in the schema, however carefully
the code was written around it.

Three real customer shapes make this concrete rather than theoretical:

- A retail group whose structure is **company → region → store**. None of *division*, *section* or
  *team* exists for them, and two of the nine they do use are called something else.
- A holding company with a **legal entity under a legal entity**. A ladder in which legal entity
  appears exactly once cannot express it at all.
- A franchise business nesting **the same kind of unit twelve deep**. Any fixed ladder is too
  short for it, and lengthening the ladder is a migration.

## Decision

**The levels of a hierarchy are tenant data, and every node is one kind of thing.**

- `organization_unit_type` holds the levels: a code, a bilingual name, a display ordinal, the type
  codes that may parent it, whether it may sit at the root, and whether units of it carry a legal
  registration. A tenant defines the levels it has.
- `organization_unit` holds every node, of every level, in one table.
- `organization_unit_placement` holds where each unit sits and from when, as an effective-dated
  adjacency (`parent_unit_id`, nullable for a root).
- Aggregates that carry level-specific *data* are companions keyed on the unit, not separate
  nodes. `legal_entity` is the only one Phase 3 needs.

The nine names the specification lists ship as **`STANDARD_UNIT_TYPES`**, published from the
module's contracts and served by `GET /api/v1/organization/standard-unit-types`. Nothing installs
them. An administrator adopts the ones their organization has, edits them, or defines their own.

## Consequences

**What this buys**

- Unlimited depth is true by construction rather than by a branch. There is no level count in the
  schema, in the domain, or in the read models — `OrganizationTree` deliberately publishes no
  depth field, so a consumer cannot come to rely on a maximum.
- "Tenants may use only the levels they require" needs no code: a level a tenant never defines
  simply does not exist for them.
- Inserting a level is a row, not a migration.
- One set of rules — audit, soft delete, effective dating, optimistic concurrency, metadata,
  tenant isolation (AD-005, AD-004) — applies to every node, written once. Nine tables would be
  nine chances to omit one of them.

**What it costs, stated plainly**

- *"May a department sit under a branch?"* has no answer in code. It is
  `organization_unit_type.allowed_parent_codes`, which is the tenant's own rule about its own
  shape; empty means any parent, because a tenant that has not stated a rule does not have one.
- The type system cannot distinguish a branch from a team. A caller wanting only branches filters
  by `unitTypeId`. In exchange, a caller wanting *everything under this node* does not have to
  know which nine tables to union.
- A cycle becomes representable in principle, so it is refused explicitly:
  `wouldCreateCycle` checks the ancestor chain **as of the effective date** before every
  placement, the database forbids the one-step case with a check constraint, and both the ancestor
  walk and the tree assembly stop on a repeat rather than looping.

**Alternatives considered**

*Nine tables, one per level.* Rejected: it contradicts AD-003 outright, cannot express a legal
entity under a legal entity, and would duplicate the AD-005 column set nine times.

*One table with a `depth` or `level` integer.* Rejected: a depth column is a ladder with extra
steps. It also has to be rewritten for every descendant whenever a subtree moves.

*Materialized path instead of adjacency.* Rejected for the same cascade reason — one
reorganization becomes an unbounded number of writes — and because a path column encodes depth,
which is what AD-003 forbids. The ancestor walk lives in the application layer over adjacency
rows, which also keeps it testable without a database.

*Closure table.* Rejected as premature: it optimizes descendant queries at the cost of O(depth ×
descendants) rows per move, for a table whose largest realistic size is a few thousand rows. If
structure queries ever become a bottleneck, the projection store Phase 20 owns is the answer, not
a second write model here.
