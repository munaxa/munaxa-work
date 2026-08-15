# Organization

**Module** `@work/organization` · **Phase** 3 · **Owns** the enterprise's structure

How the enterprise is arranged: the units it is made of, where each sits and since when, the
legally constituted entities it operates through, the roles it staffs, the headcount it budgets
and the calendars it works to.

It owns no people. There is no employee, no manager, no reporting line and no assignment here,
and no place to put one (AD-001, AD-002). Employment references structure; structure never
references Employment. The one number resembling a headcount is the establishment's **budgeted**
figure, and the **filled** count beside it arrives from Employment's assignment events through a
port this module never fills in itself.

---

## The two decisions worth knowing before reading anything else

**There is no table per level.** The specification names nine — company, legal entity, business
unit, branch, division, department, section, team — and AD-003 requires unlimited depth. Nine
tables would be nine levels. So the levels are *tenant data* in `organization_unit_type`, every
node is an `organization_unit`, and the nine ship as a starting set an administrator may adopt or
ignore. [ADR-0034](../adr/0034-hierarchy-as-typed-nodes.md).

**The country is on the legal entity.** An employment resolves its country pack from its legal
entity and never from the tenant, so one customer runs a Saudi company and a Jordanian one at
once (00B). Phase 11.1 depends on this. [ADR-0035](../adr/0035-country-from-legal-entity.md).

---

## The shape

```text
organization_unit_type      The levels this tenant has. Tenant data (ADR-0034).
      │                     code · name · ordinal · allowed parents · carries a registration?
      ▼
organization_unit           Every node, of every level.
      │                     code · bilingual name · status · metadata · existence period
      │
      ├──▶ organization_unit_placement   Where it sat, and from when. Effective dated —
      │                                  a move supersedes, never overwrites.
      │
      ├──▶ legal_entity                  Only where the type says it carries one.
      │                                  ISO country · registration · currency (ADR-0035).
      │
      ├──▶ financial_center              Cost or profit. Reference data, no budget (AD-007).
      │
      ├──▶ position_establishment        Budgeted headcount per position, effective dated.
      │
      └──▶ organization_calendar         Working week and its exception days.
                 └──▶ organization_calendar_day

job_position                The reusable role catalogue. Attached to no unit and no person.
tenant_settings             This tenant's language, calendar, zone, numerals, validity.
```

A unit exists without being placed, and that is a real state rather than a gap: a branch approved
before the group decides which region owns it. `GET /hierarchy` reports those separately as
`unplacedUnitIds` rather than dropping them, because a chart that silently omits a branch is how
one gets forgotten.

---

## History, and the one thing this module refuses to lose

A move closes the period a unit had and opens a new one. Nothing is edited and nothing is
deleted, so:

```text
January ──────────────── June ──────────────▶
   PAYROLL under NORTH  │  PAYROLL under SOUTH
```

*"Which region was payroll under in March?"* — North. Forever. Re-running last year's cost
allocation produces last year's answer rather than today's.

The invariant is the kernel's `Timeline`, used rather than reimplemented: two periods in force at
once throws rather than being stored, and the database keeps at most one *open* period per unit
with a partial unique index. Periods are half-open, so the move date belongs to the new period —
not to both, and not to neither.

Back-dating works and is ordinary. Correcting the record for March on a unit that also moved in
June shortens the January period to March and leaves the June move exactly where it is; the new
March period is bounded by June rather than running through it.

What is **not** effective dated is a rename. A unit renamed is the same unit in the same place,
so a rename records an event carrying the old name and does not create a period. The limitation
that follows is stated in the debt register rather than implied: a structure query as at a past
date shows *today's* names on *that date's* structure.

---

## Application services

| Command | Permission |
| ------- | ---------- |
| `organization.define-unit-type` · `retire-unit-type` | `organization.unit-type.manage` |
| `organization.create-unit` · `rename-unit` · `change-unit-status` · `revise-unit-metadata` | `organization.unit.manage` |
| `organization.place-unit` · `detach-unit` | `organization.hierarchy.manage` |
| `organization.register-legal-entity` · `amend-legal-entity` · `close-legal-entity` | `organization.legal-entity.manage` |
| `organization.open-cost-center` · `close-cost-center` | `organization.cost-center.manage` |
| `organization.open-profit-center` · `close-profit-center` | `organization.profit-center.manage` |
| `organization.define-position` · `revise-position` · `retire-position` | `organization.position.manage` |
| `organization.set-establishment` | `organization.establishment.manage` |
| `organization.approve-establishment` | `organization.establishment.approve` |
| `organization.define-calendar` · `amend-calendar` · `record-calendar-day` · `remove-calendar-day` | `organization.calendar.manage` |
| `organization.configure-tenant-settings` | `organization.tenant-settings.manage` |
| `organization.import-structure` | `organization.import` |

| Query | Permission |
| ----- | ---------- |
| `organization.list-unit-types` | `organization.unit-type.read` |
| `organization.list-units` | `organization.unit.read` |
| `organization.hierarchy` · `unit-ancestry` · `placement-history` | `organization.hierarchy.read` |
| `organization.list-legal-entities` · `governing-legal-entity` | `organization.legal-entity.read` |
| `organization.list-positions` | `organization.position.read` |
| `organization.establishment-posture` | `organization.establishment.read` |
| `organization.tenant-settings` | `organization.tenant-settings.read` |
| `organization.export-structure` | `organization.export` |

Reading the org chart and *reorganizing the company* are separate permissions, deliberately: they
are held by very different people in every organization with an HR function, and one
`organization.manage` would hand a branch administrator the ability to reparent the group.
Proposing a headcount budget and approving one are separate for the same reason — a recruitment
requisition is validated against the approved figure (Phase 6).

---

## Domain events

`organization.unit.placed` and `organization.legal-entity.registered` are the two later phases
actually wait for: the first is how a reporting projection learns the structure changed, the
second is how the statutory layer learns a new country is in play. The rest exist because a
structure change nobody can subscribe to is a structure change nobody can react to.

Every event is version 1, published after commit, and named in the past tense.

---

## Configuration

Nothing business-specific is hardcoded (00B). In particular:

| Thing | Where it comes from |
| ----- | ------------------- |
| The levels of the hierarchy | `organization_unit_type`, tenant data |
| Which levels carry a registration | `organization_unit_type.carries_legal_entity` |
| Country and currency | `legal_entity`, validated by shape and never against a list |
| The working week | `organization_calendar.working_days`, no default anywhere |
| Public holidays | `organization_calendar_day` rows — this module knows none |
| Language, calendar, zone, numerals | `tenant_settings`, per tenant (ADR-0036) |

---

## Import and export

Import dispatches the **same commands** an administrator would issue one at a time, so every
invariant applies: code uniqueness, the type's parent rule, the bilingual name, the cycle guard.
It is two passes, so a spreadsheet's row order does not matter.

It is **not atomic** — the Unit of Work does not nest — so it is **resumable** instead: a unit
whose code already exists is reused, and placing a unit where it already is from the date it has
been there is a no-op. Fix the bad row, run the same file again, and it completes. Bounded at
`IMPORT_LIMIT` rows, refused above it with the limit named; a genuinely large import is a
background job, which Phase 24 owns.

Export carries **every** placement period, not just the ones in force. An export of today's
structure would be a backup that discarded the history this module exists to keep.

---

## Consuming this module

Through its application services, its public contracts (`@work/organization/contracts`) and its
domain events. Never its repositories, its tables or its aggregates.

The contract that matters most to later phases is `GoverningLegalEntity`, from
`organization.governing-legal-entity`. Ask it which legal entity governs a unit on a date, and it
walks up to the nearest registration in force — so a team under the Jordanian company resolves to
Jordan and its sibling under the Saudi company resolves to Saudi Arabia, in the same tenant, on
the same request. When nothing governs the unit the answer is *nothing*, never a default: a
fallback there would compute somebody's end of service under a country nobody chose and produce a
number that looks right.

### `organization.list-positions` takes an optional `positionId` (Phase 15)

Career confirms an identifier it already holds — a succession plan's position, a career stage's
target, a mobility recommendation's destination — and before this filter existed the only way to do
that was to page the whole catalogue and search it downstream: unbounded work over another module's
data, done once per command.

The filter is an exact-identifier predicate and nothing else. The response is the same
`PagedResult<PositionView>`, the permission is the same `organization.position.read`, the tenant
boundary and the pagination semantics are unchanged, and a caller that omits `positionId` gets
exactly what it got before.

**It does not authorize D-4.** *"List this tenant's critical positions"* needs a `criticality`
filter, and there still is not one. Confirming an identifier a caller already holds is strictly
narrower than what that caller's `organization.position.read` already allowed; discovering which
positions an organization considers critical is a different question, and it remains unanswerable
through this contract.
