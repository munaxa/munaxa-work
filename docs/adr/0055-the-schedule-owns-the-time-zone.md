# ADR-0055 — The schedule owns the time zone, and a punch coordinate is evidence rather than a work location

**Status** Accepted · **Date** 2026-08-11 · **Author** Phase 8 · **Approval** Approved (D-4) before implementation

## Context

Two questions look related and are not.

**Which civil date does a punch belong to?** A punch at 02:00 in Riyadh is 23:00 the previous day in
UTC. Filing it under the UTC date puts it on somebody else's shift, in the wrong week and in the
wrong payroll period — and no amount of correct arithmetic afterwards recovers from it.

**Where was the person standing?** This product has no authoritative work-location model. ADR-0041
decided that deliberately: no false relationship stands in for one, and an organizational unit is not
a place. Phase 8 was explicitly forbidden (D-4) from inventing one.

The temptation is to solve the first with the second — to attach a location to an employment and read
its zone. That is how a location model gets invented inside a business phase.

## Decision

**The schedule carries the IANA zone, and it is required.** `attendance_schedule.zone` has no
default; a schedule cannot be defined without one, and the domain refuses a zone the runtime does not
know. A shift's `08:00` is a wall-clock time, and the schedule says what it means. Ingestion resolves
the attendance date through the assigned schedule's zone, falling back to the tenant's only for an
employment with no schedule at all.

Everything follows from that: overnight shifts end on the next civil date rather than 24 hours later;
a spring-forward day is 23 hours of clock but the shift's authored expectation is unchanged; a local
date is never a truncated UTC instant. Conversion is `Intl.DateTimeFormat` with an explicit
`timeZone`, solved in two passes so a non-whole-hour offset and a DST gap both converge. No zone
table, no hardcoded offsets.

**A punch may carry location evidence, and that is all it is.** Where a tenant enables capture, an
event may hold a latitude, a longitude and the device's accuracy estimate. Beside them there is:

- no site identifier, because there is no site model;
- no geofence and no geofence verdict, because a verdict with nothing behind it is a claim;
- no sequence of positions anywhere, because a sequence is a track and nobody asked for one;
- no coordinate on any list screen or in the export.

Three things are distinct and stay distinct: **punch location evidence** (this), **an authoritative
work location** (does not exist in this product), and **continuous employee location tracking**
(explicitly not built).

**The extension point is preserved and unowned.** When this product does model physical work
locations, permitted sites, geofences, site assignments and mobile verification, an event's
coordinates are evidence a real model can be checked against. Which phase owns that is not decided
here, and Phase 8 does not assume Manager Self-Service does.

## Consequences

- A rostered day that moves somebody to a different zone for one night is not modelled; the schedule's
  zone applies. It is recorded as a gap rather than guessed at.
- Geofence enforcement is **NOT VERIFIED** and is not implemented. Enforcing one would need both an
  authoritative location model and a mobile client whose coordinates can be trusted, and this
  repository has neither.
- Attendance builds no calendar. A public holiday is a roster entry until a country pack supplies a
  calendar (the approved D-2 fallback), because two owners of "is the 23rd a holiday" produce two
  answers.

## Alternatives considered

**Take the zone from the employment's location.** Rejected: there is no such field, and adding one
would be inventing the model ADR-0041 declined to invent.

**Take the zone from the tenant.** Rejected as the *primary* rule — a tenant with sites in two
countries has two zones — but kept as the fallback for an employment with no schedule, because
ingestion needs an answer before it knows which schedule applies.
