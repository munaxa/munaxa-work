# Product Slice #6 — Attendance as Work

Completion record. Read-only throughout: no `POST`, `PUT`, `PATCH` or `DELETE` was added, and no
Attendance domain, application, infrastructure, API or contract file was modified.

---

## A. What shipped

Two routes, replacing one page of ten stacked cards that opened nothing.

| Route | What it answers |
|---|---|
| `/attendance` | The register: today's six counts, **the exception queue**, the days behind it, what is not being recalculated, and the rota, shifts and schedules people are measured against. |
| `/attendance/days/[employmentId]/[attendanceDate]` | One day: what was expected against what happened, what the module flagged, the punches that produced it — superseded included — and the corrections raised against it. |

**Two routes, because the contracts say two.** An attendance day's subject is the pair
`(employmentId, attendanceDate)` — exactly what `attendance.read-day` takes and exactly what
`AttendanceDaySnapshot` answers. Nothing in the contracts supports a month, a week, a shift page or
an exception detail page, so none was built.

Each route carries a `loading.tsx`; the day route carries a `not-found.tsx`. Both set their own
`metadata.title`, so a browser tab reads *Attendance* and *Attendance day* rather than
*Munaxa Work — Administration*.

**Navigation was not changed.** Attendance already sits under *Operations*, and `isCurrent` matches
by prefix, so `/attendance/days/…` keeps *Attendance* marked as the current page. A test asserts it.

---

## B. Backend used

Eleven of Attendance's thirteen `GET` routes, two of which no screen consumed before, plus one
bounded read from Employment. Nothing new was created.

| Route | Query | Permission | Where |
|---|---|---|---|
| `GET /attendance/dashboard` | `attendance.dashboard` | `attendance.read` | register |
| `GET /attendance/exceptions` | `attendance.search-exceptions` | `attendance.read` | register |
| `GET /attendance/days` | `attendance.search-days` | `attendance.read` | register |
| `GET /attendance/corrections` | `attendance.search-corrections` | `attendance.read` | register, day |
| `GET /attendance/reconciliation` | `attendance.days-awaiting-recalculation` | `attendance.read` | register **(new)** |
| `GET /attendance/roster` | `attendance.read-roster` | `attendance.read` | register |
| `GET /attendance/shifts` | `attendance.list-shifts` | `attendance.read` | register, day |
| `GET /attendance/schedules` | `attendance.list-schedules` | `attendance.read` | register |
| `GET /attendance/imports` | `attendance.list-imports` | **`attendance.import`** | register |
| `GET /attendance/days/:employmentId/:attendanceDate` | `attendance.read-day` | `attendance.read` | day **(new)** |
| `GET /employments/:employmentId` | `employment.read-employment` | `employment.read` | day |

**Attendance GET consumption: 9 of 13 → 10 of 13.**

**One route the old screen consumed is deliberately not on the register: `GET /attendance/events`.**
That is a replacement rather than a loss. The screen this replaced showed a page of twenty-five raw
punches drawn from across the tenant, in no context — a list nobody works from. The punches now
appear on the day being examined, every one of them, with their supersession state, from the
module's own composite. The register is the queue; the punches are a day's evidence.

Two routes stay out. `GET /attendance/export` cannot be typed by a screen — its `AttendanceExport`
view is exported from the module root but not from `contracts/index.ts`, and the lint layer
restricts the portal to `@work/attendance/contracts` (§L). `GET /attendance/snapshots` is Payroll's
subject, not Attendance's screen.

**The day is one read, not three.** `attendance.read-day` returns the day, its events and its
exceptions from a single moment; a test asserts structurally that `loadDayDetail` never touches
`/attendance/events` or `/attendance/exceptions`. Rebuilding a day from three lists would be three
permission outcomes and three moments assembled into a page claiming to describe one day — and would
silently drop the superseded punches, which only that read returns.

---

## C. Domain capabilities surfaced

### Verdicts, rendered rather than re-derived

All 15 exception kinds ship a finished sentence in both languages, and the screen presents them as
sentences rather than as codes in a pill: *"Arrived late."* / *"حضور متأخر."* · *"Worked beyond the
expected day."* · *"No departure was recorded."*

Each carries its own `minutes` and its own `severity`, and both are the module's. **The tone comes
from the severity, never the kind** — the same kind can be configured to a different severity by a
tenant's policy, and colouring lateness red regardless would override the customer's own judgement.
A test asserts the sentence, the minutes and the severity all come from the catalogue and the
contract.

**Nothing is computed.** Expected 480 minutes sits beside worked 466 as two published figures; the
screen never prints "14 minutes short", and a test asserts that string is absent. No worked hours,
no lateness, no overtime, no attendance percentage, no absence percentage, no daily or monthly
total. A structural test forbids arithmetic on `workedMinutes` and `expectedMinutes` in the API
layer.

### Superseded events

`attendance.read-day` returns superseded events deliberately, "so that somebody reviewing a
corrected day sees what was originally captured". The screen keeps every one and marks it.

The contract states the relation **from one end only**: a *superseding* event carries
`supersedesEventId`; the event it replaced carries no mark of its own. So `replacedIn()` reads the
relation in the direction it was not published in, from the day's own snapshot — which is complete
by construction, because `forDay` returns every event on the day. A replaced punch shows
**Replaced** with the identifier that replaced it; the replacement shows **Current** and what it
supersedes.

**This is not a rule about which punch wins.** The domain already decided, by writing the
replacement. A test asserts both directions of the marking and that the reverse index is empty for
an empty day.

### Leave state — all three, kept apart

`AttendanceDayView.leaveState` is `none | applied | unknown`, decided **server-side**: the
Attendance→Leave adapter is already wired under a bounded service grant naming exactly `leave.read`,
and every failure path answers `known: false`.

`unknown` is never collapsed into `none`. The module's own reason is that collapsing them would
write an absence *without leave* onto somebody's record during a Leave outage — a false statement
about a person produced by a fault they had nothing to do with. The screen renders all three
distinctly, gives `unknown` a warning tone, and says in a footnote that it means nobody could be
asked. Tests assert all three render and are distinct.

**No Leave lookup was created.** `AttendanceDayView` carries no `leaveRequestId`, so the day states
the leave *fact* and does not link to a request. Asking Leave per row would be an N+1 across a page
of days.

### Punch evidence

Each punch keeps its three separate timestamps, its `clockSkewSeconds`, its `capturedOffline` flag,
its source and its opaque `deviceReference`. None is derived.

### Provenance

`calculationVersion`, `inputsDigest`, `calculatedAt` and `inputsChangedAt` are shown together under
*How this figure was reached* — what makes a disputed day explainable rather than arguable.

---

## D. Localization defect

### Root cause

The catalogue stored six keys **flat and containing dots** — the literal string
`"boundary.employment"` nested under `attendance.label`. `scripts/check-localization.mjs` flattens a
catalogue by **joining** nested names with a dot, so it saw `attendance.label.boundary.employment`
as present and passed. Every runtime translator in this repository does the opposite: it **splits**
the requested key on a dot and walks segment by segment, so it looked for a nested `boundary` object,
found none, and returned the key.

**The gate and the resolver disagreed about what a dot means.** Five raw keys reached customers, in
English *and* Arabic, past a green gate.

### The six affected keys

```
attendance.label.boundary.employment      rendered to customers
attendance.label.boundary.leave           rendered to customers
attendance.label.boundary.location        rendered to customers
attendance.label.boundary.money           rendered to customers
attendance.label.boundary.notifications   rendered to customers
attendance.navigation.attendance.daily    unresolvable, not currently requested
```

### Remediation — all three parts

1. **The keys are nested**, in both catalogues, in the shape Leave already uses. Five now resolve to
   the sentences they always held; the navigation key resolves too.
2. **The gate is hardened.** `check-localization.mjs` now rejects any key whose own name contains a
   dot, with an error saying why. That is the smallest change that makes its flattening and the
   runtime's splitting mean the same thing — so the class cannot recur in any module, not only this
   one.
3. **The vocabularies are complete.** Attendance published 13 status vocabularies with no
   translation at all — `EVENT_KINDS`, `EVENT_SOURCES`, `DAY_KINDS`, `SHIFT_KINDS`, `SEGMENT_KINDS`,
   `ROSTER_KINDS`, `DEFINITION_STATUSES`, `EXCEPTION_SEVERITIES`, `EXCEPTION_STATES`,
   `CORRECTION_KINDS`, `CORRECTION_STATES`, `ROUNDING_MODES`, `POLICY_SOURCES`. All 54 values are
   now translated in both languages, so no screen can fall back to a stored code.

The catalogue went from 131 keys to **269**, with exact `en`/`ar` parity, nested throughout.

### Regression test

`apps/admin/src/attendance/localization.test.ts` asserts three things, each closing a different half
of the defect:

- **the shape** — no key name anywhere in either catalogue contains a dot;
- **the resolution** — each of the five boundary keys resolves to a real sentence in both languages,
  not to itself;
- **the completeness** — every value of all 13 vocabularies resolves in both languages.

A fourth asserts the translator still returns the key when there genuinely is none — the property
that made the defect *visible* once somebody looked at the rendered page.

---

## E. What changed

### New — `apps/admin/src/attendance/`

| File | Lines | What |
|---|---:|---|
| `api.ts` (rewritten) | 244 | The reads, with the 404/403 distinction carried out whole |
| `frame.tsx` | 344 | `Verdict`, `Term`, `Duration`, `When`, `Wrote`, `Identifier`, `Named`, `Refused`, `Clear`, `shownOf`, `Boundaries` |
| `exact.ts` | 85 | The values the screens must not alter |
| `tones.ts` | 67 | How Attendance's six status vocabularies read at a glance |
| `locale.ts` (rewritten) | 80 | Both catalogues, resolved segment by segment |
| `register.tsx` | 353 | Overview, exception queue, days, reconciliation |
| `configuration.tsx` (rewritten) | 291 | Rota, shifts, schedules, imports |
| `day.tsx` | 278 | Identity, figures, exceptions, provenance |
| `punches.tsx` | 240 | The punches and the corrections — the day's evidence |
| `attendance.fixture.ts` | 365 | Contract-typed fixtures |

`sections.tsx` (197 lines) was deleted, taking its `short()` helper with it.

### Localization

131 → 264 keys per language, nested, exact parity (§D).

### The gate

`scripts/check-localization.mjs` gained a dotted-key rule (§D). No other script was changed.

### Found by running the product, and fixed

Five issues surfaced only once the pages were rendered and read:

1. **Two reads the old screen made that this one had dropped.** `GET /attendance/imports` was no
   longer requested at all — a silent regression in what an operator could see, since a batch's
   counts say how much of a customer's data landed and it carries its own permission. It is back,
   as a third refusal on the register. `GET /attendance/events` is deliberately not back: see §B.
2. **A read the register made and showed nowhere.** `attendance.search-corrections` was fetched for
   the register and rendered on the day page only — a request spent on nothing, which is the sibling
   of a control that does nothing. The register now shows it: an outstanding correction awaiting a
   decision is operational work and belongs beside the exception queue. The same section serves both
   screens and says which it is on, because `correctionFilters` publishes **no date filter** — a day
   cannot narrow corrections to itself, so the day says they are the employment's rather than
   letting a reader assume otherwise.
3. **A column header that was a template string.** The exception tables used
   `attendance.label.minutes` as a heading, which is `{minutes} min` — so the column read
   `{minutes} min`. Now a heading of its own.
4. **Two shift columns both headed "Expected"** — the wall-clock range and the day's expected
   minutes. Now *Hours* and *Expected day*.
5. **Three headings repeating their own section title** — "Attendance day" appeared as both the page
   title and a section, "Calculated" as both a section and its first fact, and "Exceptions" as both
   a section and its first column. Now *Expected and worked*, *How this figure was reached*, and
   *What the module found*.

---

## F. What was deliberately not changed

- **No backend.** No Attendance domain, application, infrastructure, API or contract file. The only
  files touched outside `apps/admin` are the two Attendance locale catalogues and the localization
  gate.
- **No writes.** No `POST`, `PUT`, `PATCH` or `DELETE`; no form, button, input or select on either
  route, asserted by test.
- **ZK / biometric: nothing.** No connector, no vendor SDK, no adapter, no synchronization model,
  and ADR-0057 was not modified. **The product makes no claim about a device.** A test asserts the
  strings *Sync failed*, *Device offline*, *Disconnected*, *Unreachable*, *Last seen* and *ZK* never
  appear, and the boundaries say plainly that a punch that never arrived is indistinguishable from
  one never made.
- **No Leave change.** `attendance.expected-working-days` remains an internal composition query with
  no HTTP route, and no route was created for it. No Leave lookup, no `leaveRequestId` resolution.
- **No cross-module resolver**, lookup service, reference service, cache or aggregation layer. An
  employment stays an identifier; a shift is named only from the list the page already fetched.
- **No contract exports.** `AttendanceExport` and `ExpectedWorkingDaysView` were left where they are.
- **No `notFound()` HTTP fix.** Not attempted, not normalized inside Attendance.
- **No authorization change.** No permission added, broadened, or reinterpreted.
- **No self-service, no manager workspace.** No `/me`, no current-user route, no team query.
- **Completed slices untouched.** Employee Record, Approvals, Hiring, Payroll and Leave were not
  reopened — including the two that still use `short()`.

---

## G. States verified

Exercised against the running product, one stand-in mode per state, and asserted in tests.

| State | What the product does |
|---|---|
| **Loading** | A skeleton on both routes, holding the layout still and carrying **no text at all** — asserted: the loading markup's text content is empty. |
| **Not found** | `attendance.read-day` is the module's only 404-capable read. A day it will not resolve renders `not-found.tsx`: *No attendance day with this employment and date was returned.* Verified live on a date the stand-in does not hold. |
| **Refused ≠ not found** | A 403 on the same route renders the withheld state **on the day page**, verified live in the rendered body. A caller lacking `attendance.read` is never told the day does not exist. Asserted through the route. |
| **Refused (whole register)** | *Nothing in the attendance register could be read*, said **once**. Never "no attendance day has been calculated". |
| **Empty** | Each section its own sentence: *Nothing is flagged on any day.* · *No attendance day has been calculated.* · *Every day is up to date with its inputs.* · *Nobody is rostered in this range.* · *No shift has been defined.* · *No schedule has been defined.* · *No correction has been requested.* · *Nothing has been imported.* Eight sections, eight different sentences. |
| **Populated** | Rows with the server's total beside them as `N / M`. |
| **Withheld** | **Three permissions, three different refusals.** `attendance.read` gates the register; `attendance.event.read` separately gates the punches, which carry the device reference and, where a tenant enabled capture, coordinates; `attendance.import` separately gates the batches, whose counts say how much of a customer's data landed. Each says which one happened to it. A day whose snapshot carries no punches renders *No punch was recorded on this day.* rather than an empty table — verified live. |

Domain states, all from published values: `pending` (ingestion created it, nothing calculated),
`missing_clock_in` / `missing_clock_out` as blocking exceptions, `inputsChangedAt` for a figure that
may be stale, `requested` for a correction awaiting a decision, and all four exception states.

**One state was deliberately not built:** a synchronization or device failure. Attendance publishes
none, and inferring one from missing punches would assert a device fault the product has no evidence
for.

---

## H. English / Arabic / RTL

Both languages render fully; `?lang=ar` switches language and direction together on the element
wrapping the page.

- All 13 status vocabularies and all 15 exception sentences are translated (§D).
- **No catalogue key reaches the markup in either language** — asserted in both, because a key
  missing from Arabic alone is the one a reviewer reading English never sees, and the defect that
  shipped was visible in both.
- Every identifier, civil date, instant, wall clock, count and ratio is `<bdi>`-isolated. A
  shown-of-total ratio is **one** isolated run, so `6 / 9814` does not render as `9814 / 6` in
  Arabic.
- **Durations are isolated and pinned `dir="ltr"`**, carried forward from the defect Leave found: a
  leading minus is a neutral character that otherwise lands after the digits, turning a signed
  figure into its opposite. Asserted.
- **Free text is isolated** so its own language decides its direction — a correction's justification
  is a person's own words, and an English sentence in an Arabic table otherwise loses its full stop
  to the front. Asserted with the fixture's English justification inside an Arabic render.
- An employment renders in full, monospaced, muted, never truncated. Three employments sharing a
  UUIDv7 timestamp prefix stay three.

---

## I. Desktop / mobile

**1440 px.** Three columns of facts in the raised blocks; tables at full width; the exception queue
above the register behind it.

**390 px.** Verified on both routes, in both languages. Measured directly:
`document.documentElement.scrollWidth === window.innerWidth === 390` on the register, the day, and
the day in Arabic — **no page-level horizontal scroll anywhere.** Tables scroll inside the design
system's own container; facts stack into one readable column; the verdict sentences wrap as
sentences.

---

## J. Tests

**59 tests, 169 assertions**, across five files.

| File | Tests | What it guards |
|---|---:|---|
| `api.test.ts` | 15 | Which requests exist and no others; **the day comes from the one bounded read, never from the list endpoints**; no method and no body; no caller sent; no `items[0]`; no read inside a `map`; server total never `items.length`; **no arithmetic on attendance figures**; refused/missing/empty apart; the employment read once by identifier; the list window derived from the date given |
| `register.test.tsx` | 17 | Every exception and every row opens its day; the server's total; **the module's own sentence, minutes and severity**; all three leave states distinct; the refusal said once; each empty section its own sentence; every vocabulary translated; **no catalogue key in either language**; identifiers whole and isolated; the ratio as one run; no control; **no claim about a device or synchronization**; **every read it makes is a read it shows** |
| `day.test.tsx` | 14 | **A superseded punch stays visible and is marked from both ends**; the relation read from the snapshot rather than a rule; punch evidence as published; **expected beside worked without comparing them**; the verdict as the module's; an absent minutes figure absent; all three leave states; a name not invented; corrections withheld ≠ none; a requester's words isolated; no catalogue key; durations pinned `ltr`; no control; provenance shown |
| `localization.test.ts` | 4 | **No dotted key in either catalogue**; every boundary key resolves to a sentence in both languages; every value of all 13 vocabularies resolves; a genuinely missing key still returns itself |
| `routes.test.tsx` | 9 | Both parameters read; the day resolved first; **404 throws not-found while 403 renders withheld**; direction follows language; the loading skeleton carries no text; the shell keeps *Attendance* current on the day route |

Assertions are anchored to the third investigation's findings and to defects found by running the
product, so none can come back quietly.

---

## K. Full gate

Run on the finished tree. **No result below is a cache replay** — every task was forced, and the
test task ran against a live PostgreSQL 16 with all 31 migrations verified applied, so nothing was
skipped.

| Gate | Result |
|---|---|
| Migrations | `_prisma_migrations` holds **31** finished rows; `prisma/migrations` holds 31 directories |
| `pnpm standards` | pass — `check-standards`, `check-architecture` (186 models), `check-localization` (20 catalogue sets complete, **and now rejecting dotted keys**), `check-dependencies` (1,998 files, no cycles, no unused, no unreachable) |
| `pnpm format:check` | pass |
| `lint` · `typecheck` · `test` · `build` | **116 successful, 116 total; 0 cached**, 13m 18s (`turbo --force`) |
| Tests | **5,233 passed, 0 skipped, 0 failed** across 24 packages |

The admin build emits both attendance routes:

```
├ ƒ /attendance
├ ƒ /attendance/days/[employmentId]/[attendanceDate]
```

---

## L. Remaining findings — recorded, not fixed

1. **The contract-export gap, with a third instance.** `AttendanceExport` and
   `ExpectedWorkingDaysView` are exported from Attendance's module root but not from
   `contracts/index.ts`, so no screen may type them — which is why `GET /attendance/export` stays
   unconsumed. With Leave's `BalanceAsOfView` this is now three instances across two modules. The
   separate investigation's question stands: must a served read always publish its view, and should
   a gate enforce it?
2. **`notFound()` renders with HTTP 200.** Re-measured this turn on the new route: a missing day
   renders the correct not-found page with status 200, exactly as the seven pre-existing detail
   routes do. Not introduced here and not normalized here.
3. **The cross-module reference pattern, with one new instance.** `AttendanceDayView` carries no
   `leaveRequestId`, so a day can state that leave applied but cannot link to the request — now that
   `/leave/requests/[id]` exists, that is the one link missing. Closing it in the UI would be an
   N+1; closing it properly is one optional contract field. Organization references (unit, position)
   remain unresolvable for the same reason as everywhere else.
4. **Authorization, unchanged.** `attendance.read-day` returns the day's **events** under
   `attendance.read`, while `attendance.search-events` requires `attendance.event.read` — a
   composite-read bypass the module documents deliberately, and one with a real product
   consequence: the day screen shows punches to a caller who could not read them through `/events`.
   Raised, not resolved. `attendance.read-own` and `attendance.event.record-own` remain declared and
   unreferenced — correct declarations awaiting a self-service surface, not defects. The three
   previously identified findings (`recruitment.offer.read`, `employment.reporting-line.read`,
   `employment.contract.read`) remain open.
5. **Two identifier idioms remain.** Employee Record and Approvals still use `short()`; Hiring,
   Payroll, Leave and now Attendance render identifiers whole. 100 call sites remain across 32
   files, for the shared design-system investigation.

---

## M. Git state

- Branch: `claude/munaxa-product-readiness-audit-8mr34d`
- Commit: `5e6fb60`
- Working tree clean after the commit.
- **No local registry workaround committed.** The `pnpm.overrides` entries that point `@munaxa/*` at
  a source build in this environment are reverted before every commit; `git diff` on `package.json`
  and `pnpm-lock.yaml` is empty.
- The stand-in API used for the visual review lives in the session scratchpad. It is never committed
  and never imported by the product.

---

# SLICE COMPLETE — AWAITING OWNER REVIEW
