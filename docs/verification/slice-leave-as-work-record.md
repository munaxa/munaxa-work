# Product Slice #5 — Leave as Work

Completion record. Read-only throughout: no `POST`, `PUT`, `PATCH` or `DELETE` was added, and no
Leave domain, application, infrastructure, API or contract file was modified.

Attendance was not touched. Its localization defect stays recorded for Product Slice #6.

---

## A. What shipped

Three routes, replacing one page of eleven stacked cards that opened nothing.

| Route | What it answers |
|---|---|
| `/leave` | The register: what leave has been asked for, the balances behind it, what is not being recalculated, and the configuration those balances come from. |
| `/leave/requests/[leaveRequestId]` | One request: the dates the domain decided it covers, who answered it, and the requester's own words. |
| `/leave/balances/[employmentId]` | One employment's standing: every balance it holds, and the ledger that produced it — movement by movement. |

Each carries a `loading.tsx`; the request route carries a `not-found.tsx`. Each sets its own
`metadata.title`, so a browser tab reads *Leave*, *Leave request*, *Leave standing* rather than
*Munaxa Work — Administration*.

**The workflow closes.** A request row opens the request; the request's employment opens that
person's standing with the request's own leave type already chosen; the standing's ledger says why
the balance is the number the request was raised against. Every step is an existing `GET`.

**Navigation was not changed.** Leave already sits under *Operations* in the shell, and
`isCurrent` matches by prefix, so `/leave/requests/…` and `/leave/balances/…` keep *Leave* marked as
the current page. Adding anything would have been change for its own sake.

---

## B. Existing backend capability used

Nine of Leave's fifteen `GET` routes, six of which no screen consumed before this slice, plus one
bounded read from Employment. Nothing new was created.

| Route | Query | Permission | Where |
|---|---|---|---|
| `GET /leave/dashboard` | `leave.dashboard` | `leave.read` | register |
| `GET /leave/requests` | `leave.requests` | `leave.read` | register, standing |
| `GET /leave/types` | `leave.types` | `leave.read` | all three |
| `GET /leave/policies` | `leave.policies` | `leave.read` | register |
| `GET /leave/accrual-runs` | `leave.accrual-runs` | `leave.read` | register **(new)** |
| `GET /leave/requests/:leaveRequestId` | `leave.request` | `leave.read` | request **(new)** |
| `GET /leave/requests/:id/approval-chain` | `leave.approval-chain` | `leave.read` | request **(new)** |
| `GET /leave/entitlements` | `leave.entitlements` | `leave.read` | standing |
| `GET /leave/adjustments` | `leave.adjustments` | `leave.read` | standing |
| `GET /leave/balances` | `leave.balances` | `leave.balance.read` | register, standing |
| `GET /leave/balances/ledger` | `leave.ledger` | `leave.balance.read` | standing |
| `GET /leave/balances/reconciliation` | `leave.balances-awaiting-recalculation` | `leave.balance.read` | register **(new)** |
| `GET /leave/balances/:employmentId/projected` | `leave.projected-balance` | `leave.balance.read` | standing **(new)** |
| `GET /employments/:employmentId` | `employment.read-employment` | `employment.read` | request, standing |

**Leave GET consumption: 9 of 15 → 13 of 15.**

### The ledger, used as published

`LedgerEntryView` carries `balanceBeforeMinutes` and `balanceAfterMinutes` on **every** entry. The
standing page renders all three of before, movement and after as three columns, straight from the
server. It computes nothing: no running total, no sum of a column, no derived opening figure, no
duration from two dates, no working-day count, no accrual, no percentage. `api.test.ts` asserts
structurally that no read is issued inside a `map` over rows and that `total` is never
`items.length`.

### `leave.balance-as-of` was deliberately not used

`GET /leave/balances/:employmentId/as-of` exists and works, but its result type `BalanceAsOfView`
lives in `application/balance-queries.ts` and is **not exported from `contracts/index.ts`**. Using
it would have meant a screen declaring a local shape for an unpublished contract, which the
architecture forbids and the lint layer enforces. The boundaries footnote on the standing page says
so in both languages. This is recorded as a finding in §K rather than worked around.

---

## C. What changed

### New — `apps/admin/src/leave/`

| File | Lines | What |
|---|---:|---|
| `api.ts` (rewritten) | 282 | The reads, with the 404/403 distinction carried out whole |
| `frame.tsx` | 328 | Shared pieces: `Term`, `Duration`, `When`, `Wrote`, `Identifier`, `Named`, `Refused`, `Clear`, `shownOf`, `Boundaries` |
| `exact.ts` | 88 | The values the screens must not alter |
| `tones.ts` | 58 | How Leave's four status vocabularies read at a glance |
| `locale.ts` (rewritten) | 84 | Leave's catalogue and the portal's, resolved segment by segment |
| `register.tsx` | 315 | The register: overview, requests, balances, reconciliation |
| `configuration.tsx` (rewritten) | 206 | Types, policies, accrual runs |
| `request.tsx` | 313 | The request: summary, dates covered, narrative |
| `approval.tsx` | 116 | Who answered it — and the case where nobody had to |
| `standing.tsx` | 316 | Identity, type chooser, balances, projection |
| `movements.tsx` | 234 | Ledger, entitlements, adjustments |
| `leave.fixture.ts` | 370 | Contract-typed fixtures |
| `detail.fixture.ts` | 68 | The two detail pages' compositions |

`sections.tsx` (237 lines) was deleted. Its `short()` helper — which truncated a UUIDv7 to eight
characters, the top 32 bits of a millisecond timestamp, so every identifier written inside the same
65-second window rendered identically — went with it.

### Localization

**131 new keys in each language**, all nested, all in both catalogues. The Leave catalogue went
from 130 keys in two groups (`label`, `rejection`) to 261 keys in fifteen, with exact `en`/`ar`
parity.

The reason it needed that many: **Leave shipped no translation for any of its status vocabularies.**
There was no `leave.state.*`, no `leave.kind.*`, no `leave.source.*`, no `leave.portion.*`, no
`leave.basis.*`, no `leave.accrual.*`, no `leave.carryOver.*`, no `leave.unit.*`, no `leave.grant.*`,
no `leave.definition.*`, no `leave.decision.*`, no `leave.year.*`. That is why the screen this
replaced rendered `pending_approval`, `working_days`, `carry_in` and `half_morning` raw, in English
*and* in Arabic. All twelve vocabularies now exist in both languages.

**The Attendance defect was not copied.** Attendance stores five of its keys flat and containing
dots — the literal string `"boundary.employment"` under `attendance.label` — which the localization
gate accepts (it flattens by joining with a dot) and the runtime resolver cannot find (it splits on
one). Every key added here is nested, `locale.ts` documents the trap, and a test asserts no raw key
reaches the markup **in either language**.

---

## D. What was deliberately not changed

- **No backend.** No Leave domain, application, infrastructure, API or contract file was modified.
  The only files touched outside `apps/admin` are the two Leave locale catalogues.
- **No writes.** No `POST`, `PUT`, `PATCH` or `DELETE`; no form, button, input or select anywhere on
  the three routes, asserted by test. Raising, submitting, withdrawing, amending, approving,
  rejecting, adjusting and recalculating stay API capabilities.
- **No Workflow integration.** `LeaveApprovalChainView.approvalId` is Leave's own column; no command
  in the module populates it, and Leave records its own decisions rather than consuming
  `ApprovalPort`. It is rendered as an identifier and **never linked** to `/approvals/[instanceId]`,
  with a sentence saying why. Linking it would have invented a relationship the contracts do not
  establish.
- **No cross-module abstraction.** No resolver, no universal lookup, no reference service, no cache.
  An employment stays an identifier on every row. A leave type is named only from the types list the
  page had already fetched for its own chooser — a `Map` built once per render, not a lookup issued
  per row.
- **No authorization changes.** The known findings (`recruitment.offer.read`,
  `employment.reporting-line.read`, `employment.contract.read`) stay open.
- **No Attendance.** Not its localization defect, not its identifiers, not its routes.
- **Completed slices untouched.** Employee Record, Approvals, Hiring and Payroll were not reopened —
  including the two that still use `short()`.

---

## E. Product findings, from running the product

The application was built and served against a stand-in API shaped by the published contracts, and
reviewed at 1440 px and 390 px in both languages. Ten issues were found by looking at the rendered
product; all ten were fixed inside Leave.

**Two were real bidi defects that `<bdi>` alone does not fix.**

1. **A negative duration read as a positive one in Arabic.** A leading minus is a *neutral*
   character, so inside a right-to-left paragraph it takes the paragraph's direction and lands
   after the digits: `-480 دقيقة` rendered as `480- دقيقة`. On a leave balance that is the
   difference between owing days and being owed them. Fixed with a `Duration` component that pins
   its isolate to `dir="ltr"`, so the sign leads and the translated unit still follows the number.
   Every duration goes through it, not only the negative ones — a column whose sign placement
   depended on the value would be a column nobody could scan.
2. **An English note lost its full stop in an Arabic table.** *"Two days granted for the relocation
   weekend."* rendered as *".Two days granted for the relocation weekend"*, because the trailing
   punctuation is neutral and took the paragraph's direction. Free text is the one value on these
   screens whose language is not the page's; a `Wrote` component isolates it so its own first strong
   character decides.

Both are covered by tests that assert the rendered markup, not the intent.

**Three were mislabelled columns I had introduced.** The ledger's `sourceId` sat under a heading
reading *Reason*, its `reversesEntryId` under *Supersedes*, and a leave type's `statutorySourceCode`
under *Reason*. Now *Source reference*, *Reverses* and *Statutory source*.

**Five were layout.** A truncated KPI label at 1440 px (*Balances awaiting rec…*) got its own
shorter caption; dates broke across two lines as `2026-01-` / `01` until numeric and date cells took
`whitespace-nowrap`; status badges wrapped inside themselves until their text did too; a named leave
type wrapped character by character in a narrow mobile column; and a redundant scroll wrapper was
removed once it turned out the design system's `Table` already brings its own — which is precisely
why the old screen collapsed at 390 px, because it used a bare `<table>` instead.

**Two were noise rather than information.** An approved request showed *Cancelled —* and *Cancelled
by —*; a non-hourly request showed three rows of dashes under *From* and *Until*. Both now render
only when there is something to say.

### Excluded as stand-in artefacts, not product defects

The standing page's Requests section shows requests belonging to other employments — the stand-in
ignores the `employmentId` filter the real API honours. And one request's summary reports an
approval time while its approval section says nobody had to decide: the stand-in hands a
no-approval chain to a request whose `approvalsRequired` is 1. Neither is reported as a finding.

---

## F. States verified

Exercised against the running product, one stand-in mode per state, and asserted in tests.

| State | What the product does |
|---|---|
| **Populated** | Rows, with the server's total beside them as `N / M`. |
| **Empty** | Each section its own sentence: *No leave has been requested.* · *No balance has been calculated.* · *Nothing has moved this balance.* · *No entitlement has been granted.* · *No balance has been adjusted by hand.* · *Every balance is up to date with its ledger.* · *No leave type has been configured.* · *No policy has been published.* · *No accrual has been run.* Nine sections, nine different sentences — never nine repetitions of "No data". |
| **Refused (whole page)** | *Nothing in the leave register could be read*, said **once**, with the unauthenticated notice. Never "no leave has been requested". |
| **Withheld (`leave.balance.read` refused, `leave.read` held)** | Verified live at `dashboard=200 balances=403`: the balances, ledger, projection and reconciliation say *"Balances, the ledger and projections answer to a separate permission from the requests: a caller may hold one and not the other."* The requests still render and still open. |
| **Withheld (`leave.read` refused, `leave.balance.read` held)** | Verified live at `dashboard=403 balances=200`: the affected sections say *This section was withheld*, and the balances still render. |
| **Not found** | `leave.request` answers 404 for a request in another tenant — deliberately, so a refusal cannot confirm somebody asked for leave. The route renders `not-found.tsx`: *No leave request with this identifier was returned.* |
| **Refused ≠ not found** | A 403 on the same route renders the withheld state **on the request page**, not the not-found page. Every route before this slice collapsed both into one absent value and would have told a caller who merely lacks a permission that the request does not exist. Asserted through the route in `routes.test.tsx`. |
| **Loading** | A skeleton on each of the three routes, holding the layout still and carrying **no text at all** — so it can carry no placeholder figure. Asserted: the loading markup's text content is empty. |

---

## G. English / Arabic / RTL

Both languages render fully. `?lang=ar` switches language and direction together on the element
wrapping the page; direction is never a separate control.

- Every one of Leave's twelve status vocabularies is translated. No raw enumeration value reaches
  either page.
- No catalogue key reaches the markup **in English or in Arabic** — tested in both, because a key
  missing from Arabic alone is the one a reviewer reading English never sees.
- Every identifier, civil date, instant, count and ratio is `<bdi>`-isolated. A shown-of-total ratio
  is **one** isolated run, not two: isolating only the total leaves the page count as a second
  left-to-right run, and inside an Arabic paragraph the later run comes first, so `3 / 268` would
  render as `268 / 3`.
- Durations are isolated **and** pinned `ltr`, so a sign leads (§E).
- Free text is isolated so its own language decides its direction (§E).
- An employment renders in full — 36 characters, monospaced, muted — and is never truncated. Three
  employments sharing a UUIDv7 timestamp prefix stay three.

---

## H. Desktop / mobile

**1440 px.** Three columns of facts in the raised summary block; tables at full width; the type
chooser on one line.

**390 px.** Verified on all three routes. Tables scroll inside their own container — the design
system's `Table` brings it — so the page never scrolls sideways and no column's values interleave.
The KPI grid drops to two across. The projection's facts stack into one readable column. The type
chooser wraps as links. Named leave types stay on one line with their identifier beneath.

For contrast, the screen this replaced squeezed the same data into unreadable strings at 390 px:
`2026-2026-1440`, `09-0109-03min`, `-5402026-02-6600`.

---

## I. Tests

**71 tests, 194 assertions**, across five files.

| File | Tests | What it guards |
|---|---:|---|
| `api.test.ts` | 15 | Which requests exist and no others; no method and no body; no caller, actor or membership sent; no `items[0]`; no request inside a `map` over rows; server total never `items.length`; refused/missing/empty survive the round trip apart; one projection at most and none until a type is chosen; the requester read once by identifier; `no-store` |
| `register.test.tsx` | 13 | Every request opens; every balance opens at its own leave type; the server's total; the refusal said once; the balance permission named when only balance reads were refused; each empty section its own sentence; every vocabulary translated; no catalogue key in either language; identifiers whole and isolated; the ratio as one run; no control |
| `request.test.tsx` | 13 | The domain's day rows rather than an expanded range; the published total rather than a sum of the rows; *no approval was required* rather than a named system approver; withheld ≠ nobody-decided ≠ nobody-yet; the approval reference never linked; the requester links to their balance; a name not invented; no catalogue key; no control |
| `standing.test.tsx` | 18 | Server-published before/after on every movement; what moved it and what caused it; no projection until a type is chosen; a projection marked as one; refused ≠ missing projection; a stale balance said rather than shown as a time; a negative balance not clamped; **the sign in front of a negative duration in Arabic**; **an English note keeping its full stop**; a leave type named from the page's own read; both permissions apart; the chooser as real addresses; no control |
| `routes.test.tsx` | 12 | Parameters read; the subject resolved first; **404 throws not-found while 403 renders withheld**; no projection without a choice; an employment Leave holds nothing for is not a 404; direction follows language; the loading skeleton carries no text; the shell keeps *Leave* current |

Assertions are anchored to findings from the second slice investigation and to defects found by
running the product, so none can come back quietly.

---

## J. Full gate

Run on the finished tree. **No result below is a cache replay** — every task was forced, and the
test task ran against a live PostgreSQL 16 with all 31 migrations applied, so nothing was skipped.

| Gate | Result |
|---|---|
| `pnpm standards` | pass — `check-standards`, `check-architecture` (186 models), `check-localization` (20 catalogue sets complete), `check-dependencies` (no cycles, no unused, no unreachable) |
| `pnpm format:check` | pass |
| `lint` · `typecheck` · `test` · `build` | **116 successful, 116 total; 0 cached**, 12m 47s (`turbo --force`) |
| Tests | **5,174 passed, 0 skipped, 0 failed** across 24 packages — `@work/admin` 573, `@work/api` 827 |

The admin build emits all three leave routes:

```
├ ƒ /leave
├ ƒ /leave/balances/[employmentId]
├ ƒ /leave/requests/[leaveRequestId]
```

---

## K. Remaining findings — recorded, not fixed

1. **`BalanceAsOfView` is not exported from Leave's contracts.** `GET /leave/balances/:employmentId/as-of`
   is served and is the read that re-derives a balance independently of the projection — the one
   that makes a wrong projection *detectable* rather than merely unlikely. Its view type lives in
   the application layer, so no consumer can type it. Exporting it is a one-line contracts change
   and is the single highest-value addition to this screen; it is a change to a module this slice
   was directed not to modify. The boundaries footnote says so to the customer.
2. **`notFound()` renders with HTTP 200.** A missing leave request renders `not-found.tsx` correctly
   but the response status is 200. This is **not introduced here**: `/payroll/runs/nope` behaves
   identically, and so do the Approvals and Employee Record detail routes. An unrouted path still
   answers 404. Fixing it in Leave alone would make Leave the one route whose status differs from
   the other four, so it belongs to a separate piece of shell work.
3. **Two identifier idioms remain in the product.** Employee Record (slice #1) and Approvals (slice
   #2) still call `short()`; Hiring, Payroll and now Leave render identifiers whole. 108 `short()` call
   sites remain across 34 files. This is the cross-module reference investigation's, not
   this slice's.
4. **Leave publishes no read of one leave type by identifier.** Naming a type means fetching the
   whole configured list. It is small, cached by nothing, and fetched once per page — but it is why
   the request page issues a list read to name a single value.
5. **`leave.calendar` remains unconsumed**, along with `leave.approved-leave-for`,
   `leave.approved-leave-affecting` and `leave.payroll-period`. The first is an administrative
   who-is-away calendar and is a screen of its own rather than a section of these three; the other
   three are consumer contracts for Attendance and Payroll rather than screens.

---

## L. Git state

- Branch: `claude/munaxa-product-readiness-audit-8mr34d`
- Commit: `45716fd`
- Working tree clean after the commit.
- **No local registry workaround committed.** The seven `pnpm.overrides` entries that point
  `@munaxa/*` at a source build in this environment are reverted before every commit, so CI's
  `--frozen-lockfile` is unaffected. `git diff` on `package.json` and `pnpm-lock.yaml` is empty.
- The stand-in API used for the visual review lives in the session scratchpad. It is never
  committed and never imported by the product.

---

# SLICE COMPLETE — AWAITING OWNER REVIEW
