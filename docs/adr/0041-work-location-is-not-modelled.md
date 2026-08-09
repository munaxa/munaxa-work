# ADR-0041 — Work location is not modelled, and no false relationship stands in for it

**Status** Accepted · **Date** 2026-08-09 · **Author** Phase 5 · **Approval** Approved before implementation

## Context

Phase 5's specification lists **work location** twice: as something an assignment references (§14)
and as something the domain must support (§18), with the instruction to "use the existing
organization/location model" and not to duplicate addresses inside Employment.

**There is no existing organization/location model.** Phase 3 built organizational *units* of
unlimited depth, legal entities, financial centres, positions, establishment and calendars. None of
them is a physical place. A unit may be named "Riyadh Branch", and a unit may also be named "Finance"
— the model does not distinguish, because it was not built to.

## Decision

**Employment models no work location in Phase 5.** There is no `work_location_id` column, no
location code, and no location entity.

Specifically:

- `unit_id` is **not** treated as a work location.
- No location entity is added to Organization.
- No location hierarchy is created inside Employment.
- The extension point is named: a future `work_location_id` on `employment_assignment`, referencing
  an authoritative model owned by Organization when one exists.

## Reason

**A unit and a place of work are different concepts.** An employee in the Finance department works
somewhere; the department is not that place. A remote employee has a unit and no site. A site hosts
several units. A field engineer has one unit and many locations. Every one of those is ordinary, and
none of them is expressible by pointing a work-location field at a unit.

**A false relationship recorded as a true one is worse than an absent field.** The moment
`workLocationId === unitId` exists, Attendance geo-fences against it, Payroll resolves a location
allowance from it, and a statutory filing reports it as a place of work. Removing it afterwards means
correcting all three. An absent field is a gap somebody notices; a wrong field is one nobody does.

**Adding a location model to Organization was out of scope**, and rightly. It is a real modelling
question — is a location a unit of a particular type, a separate entity, or an attribute of a legal
entity's registration? — with statutory consequences in several markets, and answering it inside
Employment's phase would settle Organization's design by side effect.

## Consequences

- The employment screen shows work location as **not modelled in this phase**, in both languages,
  rather than an empty field that reads as missing data.
- Any later domain needing a place of work — Attendance most immediately — must either wait for the
  model or supply its own concept and own it. This ADR is where that conversation starts.
- This is recorded as an **architectural gap**, not as technical debt inside Employment: nothing here
  is unfinished, and the missing piece is Organization's to build.

## Alternatives considered

**`unit_id` as the work location.** Rejected above.

**A free-text `work_location` on the assignment.** Rejected: uninterpreted text that later modules
would inevitably start interpreting, and it would be a location model — a bad one — grown inside
Employment.

**A `work_location_code`, tenant-supplied and uninterpreted.** The closest call. Rejected because the
same argument applies one step later: the first consumer to join on the code makes it authoritative,
and it would then be an authoritative location model with no owner, no validation and no history.
