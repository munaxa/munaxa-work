# ADR-0056 — "Leave unknown" is not "no leave", and Attendance refuses to collapse them

**Status** Accepted · **Date** 2026-08-11 · **Author** Phase 8 · **Approval** Approved before implementation

## Context

There is no Leave module in this repository. Phase 9 builds one.

An attendance calculation has to say something about a scheduled day nobody worked. The convenient
default is "absent without leave", and the convenient implementation is a stub adapter answering "no
leave approved". Both are the same mistake: the product would be asserting, on a named person's
record, that they were absent without leave — when the system has no way to know whether leave was
approved, because there is nowhere to look.

That statement reaches a manager's screen, a payroll deduction and a disciplinary conversation.

## Decision

**Leave has three answers, and the module distinguishes all three.**

| What Leave says | Day's `leaveState` | Exception raised |
| --- | --- | --- |
| `{ known: true }`, and leave covers the day | `applied` | `undertime` (information) |
| `{ known: true }`, and no leave covers it | `none` | `absent_unexplained` |
| `{ known: false }` — nobody can be asked | `unknown` | `absence_pending_explanation` |

**`{ known: false }` must never be read as "no leave exists".** It means the question is open. The
day still counts the absence *minutes* — the hours were not worked, which is true either way — and
the exception beside them says plainly that nobody could check.

**The adapter this repository ships is `leaveUnavailable`, and it answers `{ known: false }`.** It is
wired in the composition root, exported by name, and covered by a test asserting exactly that. A stub
answering "no leave" would be the fake completeness this phase refuses.

**Attendance implements no Leave.** No balance, no entitlement, no accrual, no leave record. The port
is a read with three possible answers, and Phase 9 supplies the adapter behind it.

## Consequences

- Until Phase 9, every unexplained absence in this product reads as *pending explanation*. That is
  the honest state, and the screen says so in both languages.
- The `leaveState` field is on the published contract as a three-valued enum. A consumer that treats
  `unknown` and `none` alike will be wrong, and the contract's documentation says so.
- Phase 9 replaces one line in the composition root. Nothing in the domain, the calculation or the
  database changes.

## Alternatives considered

**Default to `none` and "fix it in Phase 9".** Rejected. The wrong records would already have been
written, read and acted on, and no later correction reaches the manager who read the screen.

**Omit the leave state entirely until Leave exists.** Rejected. Consumers would each invent their own
default, and at least one would invent `none`.
