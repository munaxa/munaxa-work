# `employment` — the relationship between a person and the workforce

**Phase 5.** Owns employment identity and lifecycle, organizational assignment on a timeline, the
managerial relationship, contracts and probation, and the history that makes all of it answerable as
at a date.

Owns no identity (`people`), no structure (`organization`), no attendance, no leave, no salary and
no exit process. Every later operational phase consumes this module, which makes its boundary the
one that has to hold longest.

## The distinction the whole module rests on

```text
Person ──► Employment ──► Assignment ──► Organization
```

A **Person** is a human being, and permanent. An **Employment** is that person's relationship with
this tenant, and temporary — somebody hired, who leaves, and returns four years later is *one*
Person and *two* Employments (AD-001, AD-004). An **Assignment** is where and how that employment
participates in the organization, and it changes while the employment does not.

Collapsing any two of them is the failure this shape exists to prevent. Person with a department
column cannot answer "where were they in March". Employment with a name column produces a second
answer to "what is this person called". Assignment folded into Employment makes a transfer destroy
its own history.

## Tables

| Table | Holds |
| ----- | ----- |
| `employment` | The relationship: person, number, status, classification, dates, end reason |
| `employment_status_record` | Every transition, appended and never amended |
| `employment_assignment` | Organizational placement, effective-dated |
| `employment_reporting_line` | Who reported to whom, effective-dated |
| `employment_contract` | Contract terms and probation, effective-dated |
| `employment_number_sequence` | The tenant-scoped counter numbers are drawn from |

All six are tenant-first, audited, versioned, soft-deleted and under row-level security applied by
the migration that creates them (ADR-0030).

```text
person ──1:N──► employment ──1:N──► employment_assignment ──► unit / position / cost centre
                     │                                        (organization's, by identifier)
                     ├──1:N──► employment_reporting_line ──► employment (the manager's)
                     ├──1:N──► employment_contract
                     └──1:N──► employment_status_record
```

`employment.person_id` carries a **foreign key** to `person`. It is the only one that crosses a
module's tables, and the reasoning — including why `identity.employment_link` deliberately has none
pointing the other way — is [ADR-0042](../adr/0042-how-employment-references-another-module.md).

## Decisions a reviewer should challenge

**The employment number is generated, and a caller cannot supply one.** Uniqueness within the
tenant, immutability and never being reused are three guarantees a caller-supplied number cannot
give at once. A customer's own reference travels beside it in `external_employee_number`, so a
migration keeps its legacy numbers without either value pretending to be the person's identity.
[ADR-0039](../adr/0039-employment-number.md).

**There is no `on_leave` status.** An employee on annual leave is employed; their leave is Leave's
(Phase 9), and two modules answering "are they on leave" produce two answers. There is no `retired`
either: retirement is an end *reason* with statutory consequences that differ by market, and a
status called `retired` would be a product opinion about labour law.
[ADR-0040](../adr/0040-employment-lifecycle.md).

**There is no work location.** An organizational unit and a physical place of work are different
concepts, and this product holds no authoritative model of the second. A `work_location_id` pointed
at `unit_id` would record a false relationship as a true one — worse than an absent field, because
every later module would rely on it. [ADR-0041](../adr/0041-work-location-is-not-modelled.md).

**A person may hold many employments, and one open at a time.** The schema holds any number, which
is what rehire and history need; a second *open* employment is refused, in the domain and by a
partial unique index. That index is what makes a duplicated create fail deterministically rather
than quietly producing a second employment for one human being — and dropping it is the whole of
what enabling concurrent employments later requires.

**A manager is an employment, not a person.** "Who was this person's manager in March" survives both
of them changing jobs only if the reference is to the *job*.

## The lifecycle

```text
draft ──► pending_approval ──► active ──► suspended ──► ended
  └──────────────────────────────┘            │           ▲
             (activate directly)              └───────────┘
```

`ended` is terminal: a returning employee is a new employment. `pending_approval` is a *state*, not
an approval engine — nothing here routes or escalates, because approvals are Workflow's (Phase 16),
and modelling the state now is what lets Workflow drive it later without reshaping the aggregate.

Ending is a **separate command with a separate permission**. Every other transition is reversible;
this one is not, and it is what final settlement and end-of-service calculations read.

## Effective dating

Three timelines, all built on the kernel's `Timeline`, all non-overlapping by construction:
placement, reporting and contract. A change never edits — it closes the period in force and opens a
new one — so the two questions §13 of the specification asks by name are answerable:

- *Where did this employee belong on a specific historical date?*
- *Who was this employee's manager at that time?*

Back-dating works properly: a March transfer recorded after a June one closes March's predecessor at
March and **bounds the new period at June**, rather than running through the June move and silently
discarding it.

## Permissions

```text
employment.employment.read            employment.employment.manage
employment.employment.status.change   employment.employment.end
employment.assignment.read            employment.assignment.manage
employment.reporting-line.read        employment.reporting-line.manage
employment.contract.read              employment.contract.manage
employment.history.read
employment.import                     employment.export
```

Three separations are deliberate: changing status is not managing a record; **ending** is not
changing status; and **exporting** the workforce is not reading it.

## API

Everything under `/api/v1/employments`, all in OpenAPI, all guarded, all Problem Details.

| Method | Path | Operation |
| ------ | ---- | --------- |
| `GET` | `/employments` | Search by number, status, type, unit, position, cost centre or manager, as at a date |
| `POST` | `/employments` | Create. The number is generated and cannot be supplied |
| `GET` | `/employments/export` | The whole workforce with every timeline. Separately permissioned |
| `POST` | `/employments/import` | Bulk create, bounded and resumable |
| `GET` | `/employments/:id` | One employment as at a date |
| `PATCH` | `/employments/:id` | Amend classification, and correct a start date before it is in force |
| `PATCH` | `/employments/:id/metadata` | Replace the tenant's own metadata |
| `POST` | `/employments/:id/status` | Submit, activate, suspend, reinstate |
| `POST` | `/employments/:id/end` | End: terminal, dated, explained |
| `GET` `POST` | `/employments/:id/assignments` | Placement history; place |
| `POST` | `/employments/:id/assignments/change` | Transfer — unit, position or cost centre |
| `GET` | `/employments/:id/reporting-lines` | Reporting history |
| `POST` | `/employments/:id/manager` | Change who they report to |
| `GET` `POST` | `/employments/:id/contracts` | Contract history; record a contract |
| `POST` | `/employments/:id/contracts/:contractId/probation` | Conclude a probation |
| `GET` | `/employments/:id/history` | All four timelines in one response |

## What it consumes, and how

| Needs | From | Through |
| ----- | ---- | ------- |
| The person exists and is not merged | `people` | `people.read-person`, via `PersonDirectoryPort` |
| A person's legal name for a screen | `people` | the same query, redacted by People's own permissions |
| A unit is real in this tenant | `organization` | `organization.unit-ancestry`, via `OrganizationDirectoryPort` |

Both adapters live in the API's composition root and go through the **shared dispatcher**, so a
reference check meets the same permission rules a human reading that record would. The consequence
is deliberate: creating an employment requires `people.person.read`, and placing one requires
`organization.hierarchy.read`.

**Position and cost-centre references are not verified**, because Organization publishes no
single-entity read for either. They are stored, and row-level security is what makes another
tenant's row unreadable. The gap is recorded rather than worked around — ADR-0042.

## What it supplies

`AssignmentFilledHeadcount` implements Organization's `FilledHeadcountPort`, replacing
`NoAssignmentsYet`. An establishment's `filled` figure stops being zero and its `vacant` figure stops
equalling its budget — the number becoming correct rather than changing. No Organization code
changed, which is the evidence that port was drawn in the right place.

## Events

```text
employment.employment.created         employment.employment.status-changed
employment.employment.activated       employment.employment.ended
employment.employment.amended         employment.employment.metadata-changed
employment.assignment.created         employment.assignment.changed
employment.assignment.closed          employment.reporting-line.changed
employment.reporting-line.closed      employment.contract.recorded
employment.contract.closed            employment.contract.probation-concluded
```

Activation and ending raise a *named* event as well as the generic status change, because those two
are what later modules key off — payroll starts at one and final settlement at the other, and making
every consumer filter a generic event by `to === 'active'` is a condition somebody eventually gets
wrong.

**No event carries personal data or an employment number.** Events fan out to consumers this module
does not know and end up in logs; a consumer entitled to more asks the application service.

## What this module is not

- **Not offboarding.** Ending records the employment's final state. Exit interviews, clearance,
  asset return and final settlement are Phase 11.2's.
- **Not disciplinary action.** Suspension is a status with a reason code; violations, warnings and
  grievances are Workforce Relations' (Phase 5.2).
- **Not documents.** A contract carries a document *reference*; the store is Phase 4.1's.
- **Not compensation or benefits.** No money appears anywhere in this module.
- **Not country law.** Every classification, end reason and contract type is a tenant or
  country-pack code, and nothing here branches on one. An employment's country still comes from its
  legal entity, through its unit (ADR-0035, 00B).
