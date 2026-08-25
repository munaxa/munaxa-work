# Munaxa Work — Next Product Slice Investigation (#2)

Investigation and prioritization only. Nothing in this document was implemented, and no production
code was modified to produce it. The four completed slices — Employee Record, Approvals as Work,
Hiring as Work and Payroll as Work — are treated as finished and are not reopened.

---

## A. Method, and what was actually run

Four sources of evidence, in descending order of authority.

1. **The source tree.** Route, contract, query and permission inventories were rebuilt from
   `packages/modules/*/src/**` on the working tree at `d34b3b6`, not read from any earlier document.
   Where this investigation disagrees with an earlier verification record, the number here is the
   one derived this turn and the disagreement is stated.
2. **The rendered product.** `apps/admin` was built and served, and the current Leave and Attendance
   screens were photographed at 1440 px and 390 px, in English and Arabic, against a stand-in API
   shaped by each module's published contracts. Three data states were exercised: populated, empty,
   and a stand-in that refuses. The stand-in is a scratchpad file, never committed and never
   imported by the product.
3. **Horilla**, cloned and read for the first time in this programme. Previous investigations had to
   record it as unreachable. Nothing was copied — no code, no schema, no module boundary, no
   dependency. It is used here only to ask *what workflow shapes a mature open-source HCM considers
   necessary*, and every answer is filtered through Munaxa Work's own ownership rules.
4. **MenaITech**, from public product positioning only, as a regional-market benchmark.

**Stand-in artefacts are excluded from every finding.** Two things visible in the captures are
faults in the stand-in rather than in the product, and neither is reported as a defect below:
the "Awaiting a decision" card repeating the same rows as "Requests" (the stand-in ignores the
`?state=pending_approval` query string that the real API honours), and the Imports card showing
labels with no values (the stand-in sent `rowsReceived`/`rowsAccepted`/`rowsRejected` where
`ImportBatchView` publishes `rowsSubmitted`/`rowsCreated`/`rowsSkipped`/`rowsFailed`).

---

## B. Route and product inventory, rebuilt from source

18 modules. 186 Prisma models. 31 migrations. 513 HTTP routes, of which **187 are `GET`**.

| Module | GET | All | Screen state |
|---|---:|---:|---|
| assets | 7 | 14 | no screen |
| attendance | 13 | 34 | legacy, one page |
| career | 13 | 40 | legacy, one page |
| compensation | 18 | 36 | legacy, one page |
| documents | 5 | 13 | legacy, one page |
| employment | 7 | 18 | **composed** (directory + record) |
| identity | 4 | 18 | no screen |
| learning | 11 | 38 | legacy, one page |
| leave | 15 | 32 | legacy, one page |
| letters | 7 | 16 | legacy, one page |
| onboarding | 8 | 25 | legacy, one page |
| organization | 12 | 38 | legacy, one page |
| payroll | 17 | 28 | **composed** (workspace + run + result) |
| people | 5 | 30 | legacy, one page |
| performance | 13 | 49 | legacy, one page |
| recruitment | 12 | 42 | **composed** (workspace + requisition + application) |
| relations | 10 | 19 | no screen |
| workflow | 10 | 23 | legacy, one page |

**Correction to earlier records.** Migrations are **31**, not the 32 published in earlier
documents — `migration_lock.toml` was being counted as a migration. Verified independently against
the database: `_prisma_migrations` holds 31 finished rows. Consumed GET routes are **128 of 187**;
the automated extractor undercounted `organization` (whose reads are built from a
`/api/v1/organization/${path}` prefix shape it did not recognise) and `employment` (whose paths nest
a template expression inside a template literal), and both were re-counted by hand.

**The route hierarchy is the clearest single measurement of the composition gap.** The admin app has
22 routes. Six are detail routes, and all six belong to the four composed slices:

```
/approvals/[instanceId]                       /payroll/runs/[payrollRunId]
/employment/[employmentId]                    /payroll/results/[payrollResultId]
/recruitment/requisitions/[requisitionId]     /recruitment/applications/[applicationId]
```

Twelve modules have exactly one route each and no detail route at all; three more — assets,
identity and relations — have no screen at all. Nine route files declare
`export const metadata` and set a page title; all nine belong to the four composed slices. Every
other screen in the product renders in a browser tab labelled "Munaxa Work — Administration",
including Leave, Attendance, Compensation, Performance, Career, Learning and Workflow.

---

## C. Candidate A — Leave

### What the backend already publishes

15 `GET` routes; **9 consumed**, 6 unconsumed. The six unconsumed ones are the workflow:

| Unconsumed route | Query | Permission | 404-capable |
|---|---|---|---|
| `GET /leave/requests/:leaveRequestId` | `leave.request` | `leave.read` | **yes** |
| `GET /leave/requests/:leaveRequestId/approval-chain` | `leave.approval-chain` | `leave.read` | **yes** |
| `GET /leave/balances/:employmentId/as-of` | `leave.balance-as-of` | `leave.balance.read` | no |
| `GET /leave/balances/:employmentId/projected` | `leave.projected-balance` | `leave.balance.read` | no |
| `GET /leave/balances/reconciliation` | `leave.balances-awaiting-recalculation` | `leave.balance.read` | no |
| `GET /leave/accrual-runs` | `leave.accrual-runs` | `leave.read` | no |

`leave.request` returns `notFound('leave request')` at `request-queries.ts:96`; `leave.approval-chain`
does the same at `:129`. A detail route that can answer "no such request in this tenant" is the
precondition every composed slice needed, and Leave has two.

### The contract quality is the strongest in the product

Four shapes stand out, all already published in `packages/modules/leave/src/contracts/views.ts`:

- **`LedgerEntryView`** carries `balanceBeforeMinutes` and `balanceAfterMinutes` on every entry, plus
  `sourceKind`, `sourceId` and `reversesEntryId`. A leave balance is therefore *explainable* without
  a single arithmetic operation in the UI: every movement states what it was, what caused it, and
  what the balance was on either side of it. No other module in this product publishes a running
  balance.
- **`LeaveBalanceView.inputsChangedAt`** is documented as "present means a recalculation is
  outstanding and this figure may be behind the ledger". A stale figure that is *visibly* stale is a
  commercial differentiator, not a technicality.
- **`ProjectedBalanceView`** extends the balance with `projectedAvailableMinutes`, `projectionBasis`
  and the literal-typed `assumesContinuedEmployment: true`. The contract makes the projection
  label itself non-optional.
- **`LeaveApprovalChainView.approvalRequired`** is `false` for a policy needing no approval, and the
  contract's own comment says the screen must then say "no approval was required" rather than naming
  a system approver. That is the refused-≠-empty discipline written into the backend.

### Filters and totals

`request-queries.ts:32` accepts `employmentId`, `leaveTypeId`, `state`, `fromDate`, `toDate`,
`limit`, `offset`, and every one of them is reachable from the API — `search-filters.ts:17` lists
them and `request.controller.ts:54` spreads them. `RequestsView` returns `{ items, total }` where
`total` is the store's count, so a "shown / total" ratio needs no invention. The same holds for
balances, the ledger, entitlements and adjustments.

### What is missing

Nothing. Every read a leave workflow needs already exists, is reachable, is permissioned, and — for
the two that matter — distinguishes "not found" from "refused".

---

## D. Candidate B — Attendance

### What the backend already publishes

13 `GET` routes; **9 consumed**, 4 unconsumed: `/reconciliation`, `/snapshots`, `/export`, and

| Unconsumed route | Query | Permission | 404-capable |
|---|---|---|---|
| `GET /attendance/days/:employmentId/:attendanceDate` | `attendance.read-day` | `attendance.read` | **yes** |

`attendance-queries.ts:126` returns `notFound('attendance day')`. It answers with
`AttendanceDaySnapshot` — the day, **its events including superseded ones**, and its exceptions, in
one read. That is a complete drill-down target in a single round trip.

### The decisive finding: late, early and overtime are already sentences

`attendance-vocabulary.ts:111` defines `EXCEPTION_KINDS` including `late_arrival`,
`early_departure`, `overtime_candidate`, `undertime`, `missing_clock_in`, `missing_clock_out`,
`absent_unexplained`, `rest_day_work`, `holiday_work`, `duplicate_punch`, `clock_skew` and
`late_event_after_approval`. `AttendanceExceptionView` publishes `kind`, `severity`
(`information` | `warning` | `blocking`), `state` (`open` | `resolved` | `waived` | `superseded`)
and an optional `minutes`.

Both catalogues already translate every kind into a finished sentence. Rendered, they read:
"Arrived late." · "Left early." · "Worked beyond the expected day." · "No departure was recorded." ·
"Absent, with no leave approved." · "Two punches of the same kind, moments apart."

This matters because it removes the single largest risk in an attendance screen: a UI that computes
lateness. Lateness is a domain verdict here, carrying its own minutes, its own severity and its own
translated sentence. A screen can present it with zero calculation.

### `AttendanceDayView` is 40 published fields

Among them `expectedStartAt`/`expectedEndAt`, `expectedMinutes`, `firstInAt`, `lastOutAt`,
`workedMinutes`, `breakMinutesTaken`, `paidBreakMinutes`, `regularCandidateMinutes`,
`overtimeCandidateMinutes`, `unpaidMinutes`, `absenceMinutes`, `leaveState`, `leaveMinutes`,
`approvedAt`/`approvedBy`, `lockedAt`, `calculationVersion`, `inputsDigest` and `inputsChangedAt`.
`DAY_STATES` is `pending` → `calculated` → `under_review` → `approved` → `locked`, and the current
screen already renders those as words.

### A genuine withheld state exists

`attendance.read` gates days and exceptions; **`attendance.event.read` separately gates the punches**,
and `TimeEventView` is where `latitude`, `longitude` and `locationAccuracyMetres` live. A caller
holding the first and not the second must see the day and the exceptions with the punch list
explicitly *withheld* — not empty. That is the withheld-≠-empty case the Employee Record slice
established, and Attendance is the only remaining module where it is a security-relevant
distinction rather than a stylistic one.

### What is missing

Nothing for a day-centred workflow. A *person-centred* attendance workflow ("this employee's
month") would want a per-employment day list, and `dayFilters` already accepts `employmentId`,
`fromDate` and `toDate` — so that too is composable.

---

## E. Candidate C — Self-Service

**Blocked, and the blocker is now precisely located.** This is a refinement of the previous
investigation's finding, not a repeat of it.

What exists:

- `currentMembershipId()` **does exist**, at `packages/kernel/src/tenancy/tenant-context.ts:175`. It
  returns `undefined` under a machine context. `workflow` is the only module that uses it.
- `MemberDescription` (`identity-queries.ts:192`) **does include** `employments: EmploymentLinkView[]`,
  alongside `membership`, `profile`, `preferences`, `portals` and `delegations`, under
  `IdentityPermissions.membershipRead`.

What does not exist: **no `/me` route anywhere in 513 routes.** A portal has no way to learn its own
`membershipId`, and every read that would serve a self-service screen is keyed by `employmentId`.
The chain "authenticated principal → membership → employment" is therefore unstartable from a
browser.

The 14 unreferenced `*-own` permission constants (§H) are the shadow this casts. They are not
defects. They are permissions correctly declared for a self-service surface that was never built,
exactly as the task's own warning describes.

**Classification: D — blocked.** Unblocking it means one new route, which this programme's slice
model does not permit inside a composition slice. It is a separate, small, backend-first piece of
work and is recorded as such in §O.

---

## F. Candidate D — Manager Workspace

**Partly composable, partly blocked, and the two halves must not be confused.**

A *manager portal* is blocked by exactly the §E blocker: `apps/manager-portal/src` contains four
files (`layout.tsx`, `page.tsx`, `manifest.ts`, `globals.css`) and no product surface, and a manager
cannot learn their own employment.

A *team lens inside the admin app* is not blocked. `SearchEmployments`
(`employment-queries.ts:52`) accepts `managerEmploymentId`, `search-filters.ts:19` makes it
reachable from the API, and `EmploymentSnapshot` already resolves `reportingLine` for a date. The
Employee Record slice already reads the manager's employment at `record-api.ts:189`. So "the
employments reporting to this one, as at a date" is a composition, not a new capability.

But its *value* is thin on its own. A team list whose rows are employment numbers and statuses adds
little that the workforce directory does not already give. A team lens becomes valuable only when
there is something team-shaped to show *through* it — this team's open leave requests, this team's
blocking attendance exceptions — which makes it a natural second lens on whichever of Leave or
Attendance is built, rather than a slice of its own.

**Classification: C — composable but low standalone value; better as a follow-on.**

---

## G. Candidate E — Cross-module references

**Real, measured, partly already known inside the repository, and larger than the part that is
known.** It is a defect class, not a missing abstraction.

### What the repository already says

This is not a discovery. `apps/admin/src/workflow/exact.ts:65` defines `short()`, and its own
doc-comment already reasons about the failure mode:

> Every other identifier on this screen is shortened to eight characters for the width of a cell.
> … That is tolerable for a row identifier nobody compares. It is not tolerable here, because this
> is the module where two memberships appear side by side and the whole point is that they are two.

`apps/admin/src/approvals/queue.test.tsx:130` states it flatly: *"A membership is never shortened:
eight characters of a UUIDv7 are the same for a whole afternoon."* The Approvals slice therefore
identified this, fixed it where two identifiers sit side by side (`member()` renders in full), and
made a deliberate judgement that truncation is acceptable elsewhere.

**The finding here is that the stated tolerance condition — "a row identifier nobody compares" —
does not hold on Leave or Attendance.** On those screens the truncated value is not an incidental
row key; it is the *subject* of every row of every section. Seven Leave sections and five Attendance
sections each render a column of `employmentId`, and the whole reason to read the page is to compare
them across sections: is the employment on this pending request the same one on that negative
balance, on that blocking exception, on that correction? Truncation makes exactly that comparison
impossible. The judgement was right for Workflow and is wrong for these two modules.

### Measured, not asserted

Identifiers are UUIDv7 (`packages/kernel/src/identity/uuid-v7.ts`), whose first 48 bits are a
millisecond timestamp occupying the first 12 hex characters. `slice(0, 8)` keeps 8 of those 12,
leaving 16 bits to vary — so **every identifier created within the same 65,536 ms window renders as
the same string**. The repository comment's "a whole afternoon" is a conservative gloss; the precise
figure is 65.5 seconds, which is worse than it sounds, because the rows that share a window are
exactly the ones written together: an import batch, an accrual run, a seeded tenant. The captures
show this directly — six distinct employments across five sections, every cell reading
`01900000…`.

In Arabic it is also mis-shaped. Without bidi isolation the ellipsis leads rather than trails, so
the Arabic capture renders `…01900000`.

### The scale, and the two idioms now in the product

`short()` is called **114 times across 35 files in 14 modules**, defined near-identically in each
module's screen folder:

```ts
export const short = (id: string | undefined): string =>
  id === undefined ? '—' : `${id.slice(0, 8)}…`;
```

The four completed slices do **not** all avoid it. Employee Record (slice #1) and Approvals
(slice #2) still use it — `employment/sections.tsx:45`, `employment/record-locale.ts:108`,
`approvals/queue.tsx:5`, `approvals/detail.tsx:10`. Hiring (#3) and Payroll (#4) use neither: zero
`short()` calls between them. They introduced `apps/admin/src/payroll/frame.tsx:197`:

```tsx
export const Identifier = ({ value }: { readonly value: string }): ReactNode => (
  <TD className="whitespace-nowrap font-mono text-xs text-muted-foreground">
    <Isolated>{value}</Isolated>
  </TD>
);
```

Monospaced, muted, bidi-isolated, never shortened. So the product currently carries two idioms for
the same thing, split by when the slice was built. That is worth recording as a coherence finding in
its own right: the idiom improved mid-programme and the earlier slices were not brought forward.

### Where a name is genuinely available

`EmploymentView.personName` is published, "present only when the caller may read the person; absent
is meaningful" (`views.ts:39`). `employment.search` already resolves it through People once per
page, bounded by page size, with the resolver inheriting People's own redaction. Resolving an
`employmentId` to a name on a Leave or Attendance page is therefore a *repetition of an existing,
reviewed pattern*, page-bounded — not a new lookup service.

`organization.cost-center.read` and `organization.profit-center.read` are declared permissions for
reads that do not exist — `centers.controller.ts` has no `@Get` at all — while Payroll's accounting
output carries `costCenterId`. That single fact links this candidate to §H: some references cannot
be resolved because the owning module publishes no read, and that is a backend gap, not a screen
gap.

**Classification: B — composable, and best carried *inside* the next slice rather than run as a
product-wide sweep.** A 114-site refactor across 14 modules with no accompanying workflow is a large
diff that improves no customer's day. Applied inside one slice it is free.

Per the task's constraint, no generic resolver, universal lookup service, reference service or
cross-module cache is proposed. The pattern is per-page resolution against the owning module's own
published query, exactly as Employment already does it.

## H. Candidate F — Authorization consistency

Reported, not fixed, per §14. 23 permission constants are declared and never referenced by any
handler. They fall into three classes, and conflating them is the mistake the task warns against.

**Class 1 — `*-own` self-service permissions (14). Not defects.** `attendance.read-own`,
`attendance.event.record-own`, `letter.request-own`, `payroll.read-own`,
`performance.review.read-own`, `performance.feedback.read-about-self`, `career.plan.read-own`,
`career.development.read-own`, `compensation.read-own`, `leave.read-own`, `leave.request-own`,
`learning.assignment.read-own`, `learning.certification.read-own`, `document.read-own`. Self-service
is simply not built (§E). These are correct declarations awaiting a surface.

**Class 2 — composite-read bypass (3, plus 2 invisible to the sweep).** `recruitment.offer.read`,
`employment.reporting-line.read` and `employment.contract.read` are declared, but the data they
gate is *also* served inside a composite view under a broader permission — an offer inside the
application snapshot, a reporting line and contract inside `EmploymentSnapshot` and
`EmploymentHistoryView`. Two more instances exist that this sweep structurally cannot see because
the permission *is* used elsewhere: `attendance.event.read` is bypassed by `attendance.read-day`,
whose snapshot includes the events — and the module documents this as deliberate — and
`leave.balance.read` is bypassed by `LeaveRequestView.balanceAtRequestMinutes`, a balance figure
served under `leave.read` at `views.ts:175`.

This is an owner decision, and the decision is genuinely open: a composite read is faster and
avoids rendering a record assembled from four inconsistent moments, which is precisely why
`EmploymentHistoryView` exists. Naming the five instances is the deliverable here; choosing between
"narrow the composite" and "retire the finer permission" is not this document's call.

**Class 3 — permissions for reads that do not exist (6). The genuine gap.** `identity.user.read`,
`identity.user.manage`, `identity.portal.read`, `performance.summary.read`,
`organization.cost-center.read`, `organization.profit-center.read`. Verified by inspection: Identity
publishes no portal `@Get`; `organization/src/api/centers.controller.ts` contains no `@Get`. These
declare authority over reads nothing can perform.

**Classification: D as a slice — this is a governance finding, not a product workflow.** It should
be resolved by owner decision and a small backend change, not by a composition slice. Recorded in
§O.

---

## I. Classification and scoring

Classification per §9: **A** = ready now, no backend change; **B** = ready, small known caveat;
**C** = composable but low value or better as a follow-on; **D** = blocked or not a slice.

| # | Candidate | Class | Backend change needed | Unconsumed reads it lights up | Distinguishes refused/empty/withheld | Detail route available | Customer-recognisable workflow |
|---|---|---|---|---|---|---|---|
| A | **Leave as Work** | **A** | none | 6 of 15 | yes — `leave.read` vs `leave.balance.read` | 2, both 404-capable | yes — "who is off, on what, and does the balance hold" |
| B | **Attendance as Work** | **A** | none | 4 of 13 | yes — `attendance.read` vs `attendance.event.read` | 1, 404-capable, returns day + events + exceptions | yes — "what happened on this day, and what is wrong with it" |
| D | Manager team lens | C | none | 0 | inherits | reuses `/employment/[employmentId]` | thin on its own |
| E | Cross-module references | B | none for names; a read is missing for cost/profit centres | 0 | n/a | n/a | invisible as a slice; valuable inside one |
| C | Self-service | D | **one new route** | 0 | n/a | n/a | high value, but not composable today |
| F | Authorization consistency | D | owner decision + backend | 0 | n/a | n/a | not a workflow |

Only A and B are class A. The rest are either not slices or are best carried inside one.

---

## J. Leave versus Attendance, directly

Per §11, these are compared on the smallest complete workflow with the greatest customer value —
not on feature count.

### Where Attendance is stronger

- **One drill-down read returns everything.** `AttendanceDaySnapshot` is day + events + exceptions in
  a single 404-capable call. Leave needs two calls for the equivalent (`leave.request` and
  `leave.approval-chain`).
- **The withheld state is security-relevant.** Punch coordinates sit behind their own permission.
  Rendering "withheld" rather than "empty" there protects something real.
- **The exception vocabulary is pre-translated into sentences**, which removes all calculation risk
  from the hardest part of an attendance screen.
- **It feeds Payroll.** `PayableSnapshotView` publishes `daysUnapproved` and `blockingExceptions`
  "so a consumer decides visibly instead of being handed a silently incomplete month". The slice
  just completed reads exactly this shape.

### Where Leave is stronger

- **The workflow is a complete arc a customer already has words for.** Request → its days → its
  approval chain → the requester's balance → the ledger entries that moved it. Every step is an
  existing GET. Attendance's arc is day → its punches → its exceptions, and it stops there: the
  correction workflow (`CorrectionView` with `requestedBy`/`decidedBy`) is a write path, and this
  programme's slices are read-only.
- **The ledger makes a number explainable.** `balanceBeforeMinutes` / `balanceAfterMinutes` on every
  entry means a disputed balance can be walked, movement by movement, with the cause of each named
  (`sourceKind`, `sourceId`, `reversesEntryId`). Nothing else in this product can do that. In a
  region where leave entitlement is statutory and disputed, this is the single most commercially
  valuable read the backend holds and it is currently rendered as a flat, unexplained list.
- **Two 404-capable detail routes, not one**, and both under a permission the screen already needs.
- **The projection is contractually honest.** `assumesContinuedEmployment: true` is a literal type.
  A screen that shows a projected balance beside an actual one, with the assumption stated, is
  something an HR manager acts on weekly.
- **`approvalRequired: false` connects to the Approvals slice.** Leave records its own decisions
  today, in `ApprovalPort`'s shape, and the contract says the *source* changes to Workflow later
  while the contract does not. A Leave slice therefore renders an approval chain that already
  matches the vocabulary the Approvals slice established — the second module in the product to
  share it.
- **It reaches further into the product.** `LeavePayrollPeriodView` is what Payroll reads;
  `AttendanceDayView.leaveState` is what Attendance reads. Leave sits upstream of both.

### The comparison that decides it

Both are class A and both are buildable. The question §11 poses is which is the *smallest complete
workflow with the greatest customer value*.

Attendance's smallest complete workflow is "one day, examined". It is genuinely useful and it is
smaller. But it stops short of an answer: having examined the day, the only remaining move is a
correction, and a correction is a write this programme's slices may not make.

Leave's smallest complete workflow is "one request, examined, and the balance it moved". It is
slightly larger — five reads instead of three — and it *closes*: the answer to "why is this balance
what it is" is fully derivable from reads that already exist, and it is the question customers
actually escalate. It also carries the ledger, which no other module can offer and which no amount
of later work makes cheaper to expose.

Attendance's advantages are real but they are advantages of *shape*, not of *value*: one snapshot
read instead of two, and a withheld state that is security-relevant. Leave's advantages are
advantages of value: an explainable number, a statutory subject, and a workflow whose last step is
an answer rather than a write.

**Leave first. Attendance immediately after, as slice #6.** They are not alternatives; the ordering
is the recommendation. Attendance's snapshot read and withheld state make it the natural next slice,
and building Leave first means Attendance inherits an established treatment for balances, minutes
and cross-module references rather than inventing one.

---

## K. What the rendered product shows today

The current Leave and Attendance screens were built and photographed. What follows is observed, not
inferred. Stand-in artefacts are excluded as stated in §A.

### One defect is a real, shipped, English-language bug

**The Attendance screen renders five raw catalogue keys to the customer, in both languages:**

```
attendance.label.boundary.employment
attendance.label.boundary.money
attendance.label.boundary.location
attendance.label.boundary.leave
attendance.label.boundary.notifications
```

Root cause, located exactly. `attendance/locales/{en,ar}.json` store these as **flat keys containing
dots** — the literal string `"boundary.employment"` nested under `attendance.label`. The runtime
translator (`apps/admin/src/attendance/locale.ts:36`) splits the requested key on `.` and walks
segment by segment, so it looks for a nested `boundary` object that does not exist and returns the
key — which the translator does deliberately, because "a blank label looks like a design choice and
survives review". Meanwhile `scripts/check-localization.mjs:43` *flattens* the catalogue by joining
nested keys with `.`, so `attendance.label` + `boundary.employment` flattens to exactly the string
the screen asks for. **The gate sees the key as present and passes while the screen renders the raw
key.**

This is a class defect: the gate and the runtime disagree about what a dot means. Blast radius,
measured across all 36 module catalogues: **6 keys, in `attendance` only** — the five above plus
`attendance.navigation.attendance.daily`, which nothing currently requests. No other module has a
flat dotted key.

I have not fixed it, per §14. It belongs to whichever slice takes Attendance, and it is named in §O.

### The rest is the composition gap, rendered

At 1440 px, English:

- **Eleven stacked cards on Leave, ten on Attendance** — one card per API read, in read order, plus
  a boundaries card. The page has no hierarchy, no entry point and no destination.
- **Every reference is a truncated identifier.** Seven sections on Leave and five on Attendance
  render a column of `01900000…`, and across the six distinct employments the stand-in used, every
  one of those cells reads the same (§G).
- **Raw enumeration values leak in English**: `pending_approval`, `working_days`, `calendar_days`,
  `half_morning`, `carry_in`, `missing_event`, `amend_event`, `void_event`, `warning`,
  `information`, `blocking`, `shift`, `rest`, `device`, `import`, `manual`, `published`, `fixed`.
- **No totals anywhere.** The stand-in reported 268 requests, 9,814 attendance days, 19,422 punches
  and 1,204 ledger entries. The screens show five or six rows of each with no indication that
  anything was omitted, because `itemsOf()` in both `api.ts` files discards `total` and keeps only
  `items`.
- **No links at all.** `grep -c '<a '` returns 0 for all four screen files. Two 404-capable detail
  reads on Leave and one on Attendance have no way to be reached.
- **Two date formats on one row**: `2026-08-24` beside `24/08/2026, 05:00:00`.
- **An unlabelled timestamp** floats beneath the Leave ledger card.
- **"What Leave does not hold" is a full-size card of six bullets**, the treatment the composed
  slices reduced to a quiet footnote.
- **The same unit is abbreviated differently in the two modules' Arabic.** `leave.label.minutes` is
  `{minutes} دقيقة`; `attendance.label.minutes` is `{minutes} د`. Minor on its own, and exactly the
  kind of drift that a per-module screen folder produces and a shared idiom prevents.

At 1440 px, Arabic:

- The five leaked keys appear identically.
- `warning`, `information`, `blocking`, `requested`, `approved`, `rejected`, `in`, `out`, `shift`,
  `rest`, `device`, `web`, `import`, `manual`, `published`, `fixed` are all untranslated English
  inside the Arabic page.
- Identifiers render as `…01900000` — the ellipsis leading rather than trailing, from missing bidi
  isolation.
- A punch row renders `2026/8/24، 5:00:00 ص` beside the ISO date with no isolation between them.

At 390 px:

- **The tables do not degrade; they collapse.** Headers touch with no separation
  ("EmploymentFromTo TotalState"). Values from three columns interleave into unreadable strings:
  `2026-2026-1440` / `09-0109-03min`, and in the ledger `-5402026-02-6600`. A policy name wraps to
  seven lines, roughly one word per line. There is no horizontal scroll container; the content is
  simply squeezed.

Empty state, all lists returning `{ items: [], total: 0 }`:

- **Eight identical "Nothing recorded yet." messages** stacked down the Attendance page — precisely
  the pathology the Payroll brief forbade.
- The dashboard card above them still reports 412 expected, 41 open exceptions and 6 awaiting
  recalculation. The counts and the lists contradict each other and nothing explains why.

Refusal state:

- Indistinguishable from empty, by construction. Both `api.ts` files reduce every per-list outcome
  to `[]` (`itemsOf(await read(...))` where `read` returns `undefined` on any non-`ok` response) and
  every page-level outcome to a single `unavailable: boolean` that merges "unreachable" with
  "refused". A 403 on `/events` renders the Punches card as "Nothing recorded yet."

That last point is the strongest argument that Leave and Attendance are composition work rather than
cosmetic work: the backend distinguishes these states carefully — the CQRS pipeline checks
permission before the handler (`packages/kernel/src/cqrs/pipeline.ts:102`), so a refusal is
genuinely a different event from an empty result — and the screen throws that distinction away.

---

## L. External benchmarks

### Horilla

Read for the first time in this programme. Nothing was copied: no code, no architecture, no
database model, no UI, no module boundary and no dependency. Munaxa Work's architecture remains
authoritative.

| | Horilla | Munaxa Work |
|---|---:|---:|
| Leave URL patterns | 202 | 15 GET routes |
| Leave templates | 165 | 1 screen |
| Attendance URL patterns | 218 | 13 GET routes |
| Attendance templates | 142 | 1 screen |

The route counts are not comparable directly — Horilla is a server-rendered Django application where
every form, modal and filter is its own URL, which inflates the count severalfold. The *template*
counts are the meaningful figure, and they say the same thing the §B route hierarchy says: a mature
HCM's leave module is many screens, and Munaxa Work's is one.

Three structural observations, taken as ideas rather than designs:

1. Horilla separates an administrative dashboard from an employee dashboard, and both from a
   **single request's own page**. That third surface is exactly the drill-down Munaxa Work's Leave
   lacks and already has two queries for. It corroborates §J's recommendation without contributing
   a line of design.
2. Horilla's attendance carries a **grace-time** configuration and a validation-condition record
   with overtime thresholds. Munaxa Work's equivalent is `ShiftView.graceInMinutes` /
   `graceOutMinutes`, already published and already consumed by the domain when it raises a
   `late_arrival` exception. The capability exists; only its presentation is missing.
3. Horilla has concepts Munaxa Work does not — leave allocation requests, compensatory leave — and
   **these must not be imported.** They are Horilla's product decisions, not gaps in Munaxa Work,
   and adding a domain concept is outside every slice in this programme.

### MenaITech

**Weaker evidence than the rest of this document, and marked as such.** No MenaITech material was
fetched this turn; this rests on general knowledge of the regional market rather than on anything
verified here, and should carry correspondingly less weight than §B–§K.

On that basis, one observation only, and it is a market observation rather than a design one: in the
Middle East market MenaITech serves, **leave and end-of-service entitlement are headline, statutory,
dispute-prone subjects** rather than configuration tucked behind payroll. That is consistent with
§J's ordering. It is corroboration, not a reason: if the owner discounts this section entirely, the
recommendation in §M does not change, because it rests on §C, §J and §K.

Nothing is taken from its UI, its architecture, or its product decomposition. In particular, Payroll
remains a first-class Munaxa Work domain and is not split into a separate product because MenaITech
separates it, and no product is created merely because MenaITech has one.

---

## M. Recommendation

**Slice #5: Leave as Work.** Class A. No backend change. Six unconsumed reads, two of them
404-capable detail routes. A workflow that closes in an answer rather than in a write.

**Slice #6: Attendance as Work.** Class A. No backend change. Inherits Leave's treatment of minutes,
balances and cross-module references, and adds the one genuinely security-relevant withheld state
left in the product.

Ranked in full:

1. **Leave as Work** — recommended next.
2. **Attendance as Work** — recommended immediately after.
3. Manager team lens — as a follow-on to whichever of the two is built, not as a slice.
4. Cross-module references — carried inside slice #5, not run as a sweep.
5. Self-service — blocked; needs one new route first (§O).
6. Authorization consistency — owner decision, not a slice (§O).

---

## N. Draft Definition of Ready — Leave as Work

Offered for the owner to accept, amend or reject. It is not authorization and nothing here has been
built.

**Route hierarchy** — three routes, mirroring the shape the last two slices established:

```
/leave                                  the register and its state
/leave/requests/[leaveRequestId]        one request: its days, its approval chain
/leave/balances/[employmentId]          one employment's balance, its projection, its ledger
```

**Reads, all existing.** `leave.dashboard`, `leave.requests`, `leave.types`, `leave.policies` on the
workspace. `leave.request` + `leave.approval-chain` on the request. `leave.balances` +
`leave.balance-as-of` + `leave.projected-balance` + `leave.ledger` on the balance. Nine of the
fifteen, six of them currently unconsumed.

**Non-negotiables carried from the four completed slices.**

- Refused ≠ empty ≠ withheld ≠ populated, per read, not per page. The two permissions
  (`leave.read`, `leave.balance.read`) make this observable and it must be observable.
- Server totals only. `total` is on `RequestsView` and every sibling; `items.length` is never a
  total. The whole "N / M" ratio inside one `<bdi>`.
- Nothing computed in the UI. No minutes summed, no balance derived, no leave date inferred.
- `<bdi>` isolation of every Latin run inside Arabic text.
- No control that does nothing. Read-only throughout: no request form, no approve button, no
  recalculation trigger.
- Boundaries as a quiet footnote, not a card.
- 1440 px and 390 px, English and Arabic, all four data states.
- A page title per route.

**Two questions the owner should settle before authorization.**

1. **Minutes.** Leave publishes minutes and the current screen renders "9600 min". `LeaveTypeView.unit`
   is `'day'`, and `LeavePayrollPeriodView` publishes a `days` figure with its
   `conversionBasisHoursPerWeek` stated — so a day figure exists in the product but *not* on the
   balance view. Converting minutes to days in the screen would be UI computation and is forbidden.
   Rendering "9600 min" to an HR manager reading an annual-leave balance is not a product. My
   recommendation is to render minutes exactly as published and place the leave type's own `unit`
   beside it as a label, deciding nothing — but this needs an owner ruling, because the alternative
   readings lead to materially different screens.
2. **Cross-module references.** §G recommends resolving `employmentId` to `personName` via
   `employment.search`, page-bounded, exactly as Employment already does — replacing `short()` on
   the Leave screens only. This is a repetition of a reviewed pattern rather than a new abstraction,
   but it does add a read to a page, and that is the owner's call.

**Not in scope, explicitly:** any write; any accrual or carry-over rule; self-service; a manager
lens; the `*-own` permissions; the composite-read decisions of §H; anything in Attendance; anything
in Payroll.

---

## O. Separate investigations, and what was deliberately not done

Four items are recorded here rather than acted on. Each is a separate piece of work needing its own
authorization.

1. **The `/me` route.** One route, returning the authenticated principal's `membershipId` and its
   `employments`. It unblocks self-service, the manager portal, the mobile app and 14 correctly
   declared `*-own` permissions. It is the highest-leverage backend change available and it is
   small. It is not a composition slice and should not be smuggled into one.
2. **The Attendance catalogue-key defect (§K).** Six flat dotted keys, five of them rendered to
   customers in both languages, passing a green gate. Two parts: correct the keys, and close the
   gap between `check-localization.mjs`'s flattening and the runtime translator's splitting so the
   class cannot recur. The second part is the one that matters.
3. **Class 3 authorization gaps (§H).** Six permissions governing reads that do not exist —
   `identity.user.read`, `identity.user.manage`, `identity.portal.read`, `performance.summary.read`,
   `organization.cost-center.read`, `organization.profit-center.read`. `organization.cost-center.read`
   is the one with product consequences: Payroll's accounting output carries `costCenterId` and no
   read exists to resolve it.
4. **Class 2 composite-read decisions (§H).** Five instances where a finer permission is bypassed by
   a broader composite view. An owner decision, not a defect to fix unilaterally.

**Not done, per §14.** No product slice was implemented. No production code was modified. Nothing
was fixed: not the organization references, not the Payroll period references, not any authorization
finding, not Recruitment's authorization, not existing Payroll, not existing Hiring, not existing
Approvals. No backend capability was created. No new phase was created. No slice was selected for
implementation — §M is a recommendation awaiting authorization.

**Payroll was not reopened.** Additional payroll capability exists and is deliberately left alone.
No payroll redesign, no writes, no calculation, no accounting, no bank transfers, no tax
configuration, no country rules. The Payroll slice is complete.

**Nothing was copied.** Not from Horilla — no code, architecture, model, UI, module boundary or
dependency. Not from MenaITech — no UI, no architecture, no product decomposition. Payroll remains a
first-class Munaxa Work domain. Munaxa Work's architecture remains authoritative.

**No speculative abstraction was proposed.** §G explicitly does not propose a generic resolver, a
universal lookup service, a reference service or a cross-module cache.

---

## Gate

Run this turn, on the tree carrying this document. **No result below is a cache replay.**

| Gate | Result |
|---|---|
| `pnpm standards` | pass — `check-standards`, `check-architecture`, `check-localization`, `check-dependencies` |
| `pnpm format:check` | pass — all matched files use Prettier style |
| `lint` · `typecheck` · `test` · `build` | **116 successful, 116 total; 0 cached**, 13m 48s (`turbo --force`) |

The first run left 517 API tests and several package suites skipped, because the integration suites
skip when no database is reachable. That is not a complete gate, so PostgreSQL 16 was started, all
**31 migrations** were confirmed applied (`_prisma_migrations` holds 31 finished rows — the
independent check behind §B's correction), and the whole test task was re-run:

| Re-run with a live database | Result |
|---|---|
| `TEST_DATABASE_URL=… turbo run test --force` | **51 successful, 51 total; 0 cached**, 11m 39s |
| Tests | **5,103 passed, 0 skipped, 0 failed** across 24 packages |
| `@work/api` | 827 passed, 0 skipped — previously 310 passed / 517 skipped |

Working tree: this document only. `package.json` carries seven local `pnpm.overrides` while the
platform packages are built from source in this environment, and those are reverted before the
commit so CI's `--frozen-lockfile` is unaffected.

Commit carrying this document: `81b01aa`, on `claude/munaxa-product-readiness-audit-8mr34d`.

---

# INVESTIGATION COMPLETE — AWAITING OWNER REVIEW AND SLICE AUTHORIZATION
