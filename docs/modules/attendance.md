# `attendance` — the record of when people actually worked

**Phase 8.** Owns raw time events, schedules, shifts, rosters, attendance policies, the calculated
working day, its exceptions, corrections, and the frozen snapshot Payroll reads.

Owns no identity (`people`), no employment (`employment`), no structure (`organization`), no leave,
no payroll, no work location, no workflow, no notifications and no documents.

## The distinction the whole module rests on

```text
raw time events  ──►  the calculated day  ──►  the frozen snapshot
   (immutable)          (replaceable)             (sequenced)
        ▲                     ▲
  a correction          recalculation, found by asking
  inserts a new              (not by an event)
  event or a tombstone
```

A **time event** is what a reader captured. It is inserted and read, never updated and never deleted
([ADR-0052](../adr/0052-a-raw-time-event-is-immutable.md)).

An **attendance day** is a derivation. It stores the schedule, the shift, the policy, their version
numbers, the calculation version and a digest of everything it read — which is what makes a
recalculation of March reproduce March after somebody edits a schedule in June.

A **payable snapshot** is what Payroll read. It is frozen and sequenced; a correction afterwards
produces the next sequence rather than editing it
([ADR-0054](../adr/0054-attendance-produces-candidate-minutes.md)).

## Tables

| Table | Holds |
| ----- | ----- |
| `attendance_shift` | A pattern of hours: start, end, grace, expected minutes, version |
| `attendance_shift_segment` | Its work and break segments, and which breaks are paid |
| `attendance_schedule` | A cycle, and **the IANA zone its wall-clock times mean** |
| `attendance_schedule_day` | Which shift each cycle position runs. An empty position is a rest day |
| `attendance_schedule_assignment` | Who is on which schedule, from when to when |
| `attendance_roster_entry` | What one person is doing on one date, stated explicitly |
| `attendance_policy` | The tenant's tolerances. Every unconfigured value is inert |
| `attendance_time_event` | One raw punch, exactly as captured. Inserted and read only |
| `attendance_day` | The derived day: expectation, worked minutes, buckets, state, digest |
| `attendance_day_exception` | What the calculation found, and how a human concluded it |
| `attendance_correction_request` | Who asked for a change, who decided, and what it produced |
| `attendance_payable_snapshot` | The frozen figures Payroll reads, by sequence |
| `attendance_import_batch` | What an import run submitted, created, skipped and failed |

All thirteen are tenant-first, audited, versioned, soft-deleted and under row-level security applied
by the migration that creates them (ADR-0030). `employment_id` carries a foreign key on every table
that has one; it points *backward*, to a module Attendance already depends on, which is the rule
ADR-0042 states. There is no `person_id` anywhere, and no column holds money.

## The four properties this module is built around

**Recalculation is found by asking, not by being told**
([ADR-0053](../adr/0053-recalculation-is-found-by-asking.md)). Event delivery here is post-commit,
in-process and at-most-once with no outbox, so every write that moves an input marks the affected
days *in the same transaction*, an idempotent bounded command recalculates what is marked, and a
first-class query names what is still outstanding. That count is on the dashboard because it is the
number that reveals a failure.

**Ingestion is idempotent, and the database decides.** A tenant-scoped partial unique index over a
three-tier deduplication key — client key, then source reference, then a digest of the punch — means
a device retry, a mobile offline queue and a re-run import converge on one row. A repeat is a **200
with `alreadyRecorded: true`**, never a 409: a punch clock retries, and an endpoint whose retry fails
is not idempotent.

**The schedule owns the time zone**
([ADR-0055](../adr/0055-the-schedule-owns-the-time-zone.md)). A civil date is never a truncated UTC
instant. A punch at 02:00 in Riyadh belongs to that date; an overnight shift ends on the next civil
date rather than 24 hours later; a spring-forward day is 23 hours of clock and the shift's expected
figure is unchanged.

**"Leave unknown" is not "no leave"**
([ADR-0056](../adr/0056-leave-unknown-is-not-leave-none.md)). There is no Leave module yet, so the
shipped adapter answers `{ known: false }` and the day says `absence_pending_explanation` rather than
asserting that somebody was absent without leave.

## What it publishes

`@work/attendance/contracts` exports the vocabulary and ten views. Four absences are the design:

- **no employment fact** — no employee number, status, contracted hours, manager or person
  ([ADR-0051](../adr/0051-attendance-owns-no-employment-fact.md));
- **no money** — `overtimeCandidateMinutes` is a candidate, in minutes;
- **no work location** — a punch may carry coordinates a tenant chose to capture; there is no site,
  no geofence and no verdict;
- **no leave** — only what Leave could say, including that it could not be asked.

## Permissions

Fourteen, and six separations are deliberate. Recording an event is not managing attendance — a
turnstile's service account holds one narrow permission and cannot sign a day off. Reading a day is
not reading its raw events, which carry device identifiers and, where enabled, coordinates.
Requesting a correction is not deciding one, and the domain *and* the database refuse self-approval
regardless of who was granted what. Publishing a schedule is not drafting one. Freezing a period is
its own permission, because it is the number Payroll pays. Exporting is held by fewer people than
reading, because attendance data says when a named person came and went.

## What it does not do, and where that is written

| Not here | Where | Why |
| --- | --- | --- |
| Leave balances, entitlements, approvals | Phase 9 | Attendance reads what Leave says; `unknown` is a real answer (ADR-0056) |
| Pay rates, multipliers, amounts | Compensation, Payroll | Minutes are attendance; what they are worth is not (ADR-0054) |
| Work locations, sites, geofences | Not modelled | ADR-0041, and D-4 forbade inventing one here (ADR-0055) |
| Public-holiday calendars | Country packs | A roster entry is the fallback; two owners give two answers (D-2) |
| Approval routing | Phase 16 | `approvalReference` is reserved and null; a human decides directly |
| Notifications, documents | Phases 20/21 | No adapter is wired, and none is claimed |
| Device and biometric integration | An adapter outside this module | A vendor is not a source (ADR-0057); nothing here is verified against a reader |
| Employee and manager self-service, mobile | Phases 18/19 | The admin screen is read-only, and there is no punch button on it |
