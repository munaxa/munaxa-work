# Product Slice — Payroll as Work

**Date:** 2026-08-25
**Branch:** `claude/munaxa-product-readiness-audit-8mr34d`
**Preceding review:** [`three-slice-product-coherence-review.md`](./three-slice-product-coherence-review.md) §J
**Kind:** product vertical slice. Not a phase, and not a return to domain-first work.

Payroll published seventeen read routes and consumed fifteen of them behind a screen of eighteen
stacked cards, most of which described a single run the composition had chosen by taking the first
row of a page. An operator could not look at last month's payroll and had nothing telling them they
were not already. This turns that capability into a navigable workflow — payroll → runs → one run →
its results → one employee's result — with **no backend change of any kind**.

---

## A. What shipped

| Route | Files | What it is |
|---|---|---|
| `/payroll` | `page.tsx` (rewritten), `loading.tsx` | The payroll workspace: five server-counted figures, every run as an openable row, then the periods, groups and one group's deduction definitions |
| `/payroll/runs/[payrollRunId]` | `page.tsx`, `loading.tsx`, `not-found.tsx` | One run: its four counts, what it was calculated from and where it stands, what its state permits, its results, exceptions, approvals, adjustments, reconciliation, accounting output and payment instructions |
| `/payroll/results/[payrollResultId]` | `page.tsx`, `loading.tsx`, `not-found.tsx` | One employment's result: the three frozen totals, the period, and both line sets with the module's own explanation of each figure |

Dynamic segments follow **ADR-0075**. Links are plain `<a>` elements, as in all three prior slices.

**Why the result route is flat rather than nested under its run.** `payroll.payslip` is keyed on the
result alone and `PayslipView` carries no run identifier, so `/payroll/runs/x/results/y` would put a
run in the address that no published read could confirm the result belonged to. The period the
payslip *does* publish — its code, its start, its end and its payment date — is the context a
payslip reader needs, and it arrives from the same read. The authorization's own rule decided this:
*"use a nested route only if an existing bounded read supports it."*

---

## B. Existing backend capability used

Every request already existed and was already permissioned. **Nothing was added to the API.**

| Request | Returns | Permission | New to the product? |
|---|---|---|---|
| `GET /payroll/dashboard` | `PayrollDashboardView` | `payroll.read` | no |
| `GET /payroll/runs?page&size` | `{ items, total }` of `PayrollRunView` | `payroll.read` | no |
| **`GET /payroll/runs/:payrollRunId`** | `PayrollRunView`, `notFound` for an unknown id | `payroll.read` | **yes** |
| `GET /payroll/periods?page&size` | `{ items, total }` of `PayrollPeriodView` | `payroll.read` | no |
| `GET /payroll/groups` | `{ items, total }` of `PayrollGroupView` | `payroll.read` | no |
| `GET /payroll/deduction-definitions?payrollGroupId` | `{ items }` | `payroll.read` | no |
| `GET /payroll/runs/:id/results?page&size` | `{ items, total }` of `PayrollResultView` | `payroll.read-result` | no |
| `GET /payroll/runs/:id/exceptions` | `{ items }` | `payroll.read` | no |
| `GET /payroll/runs/:id/adjustments` | `{ items }` | `payroll.read` | no |
| `GET /payroll/runs/:id/approval-chain` | `PayrollApprovalChainView` | `payroll.read` | no |
| `GET /payroll/runs/:id/reconciliation` | `{ items }` | `payroll.read` | no |
| `GET /payroll/runs/:id/accounting-output?page&size` | `{ items, total }` | `payroll.accounting` | no |
| `GET /payroll/runs/:id/payment-instructions?page&size` | `{ items, total }` | `payroll.payment` | no |
| `GET /payroll/results/:payrollResultId/payslip` | `PayslipView`, `notFound` for an unknown id | `payroll.read-result` | no |

Fifteen of seventeen GET routes were already consumed; this consumes **fourteen**, and the change is
not the count but that two of them are now *bounded reads keyed on an identifier the route was
given* rather than the first row of a page. The two routes still unused are
`/runs/:id/adjustment-reasons` (a vocabulary for a write this slice does not make) and
`/results/:id/earnings` + `/deductions` — deliberately, because `PayslipView` returns both line sets
with the totals in one read, and the module returns them together so a screen cannot show one line
set from one state beside a total from another.

**The read model that made this possible without touching the backend**, and each was a decision the
module took for a screen that did not exist:

- **`payroll.run` and `payroll.payslip` both answer `notFound`.** That is what makes a record route
  honest — an identifier the API will not resolve renders not-found rather than a page about
  somebody else's payroll.
- **`PayslipView` carries the period, the payment date, the currency, the three frozen totals and
  both line sets together.**
- **Four permissions gate the reads**: `payroll.read` (a run's shape and counts), `payroll.read-result`
  (what a named person was paid), `payroll.accounting` (the journal), `payroll.payment` (the
  instructions). The module's own comment says why: collapsing them *"would make every payroll
  administrator a reader of every salary in the company"*.
- **`MoneyAmountView` publishes exact minor units, the decimal rendering, the currency code and its
  exponent** — so an amount can be displayed correctly without ever being parsed.

---

## C. What changed

### Composition — `apps/admin/src/payroll/`

| File | Lines | What it holds |
|---|---:|---|
| `api.ts` (rewritten) | 190 | `loadPayrollWorkspace`, `loadRun`/`loadRunDetail`, `loadPayslip`. One `read` that fails closed; `Listing<T>` carrying items **and** the server's total together |
| `frame.tsx` | 239 | `Money`, `Term`, `Fact`, `Facts`, `PayrollSection`, `Refused` (with a per-permission reason), `Clear`, `Rows`, `Cell`, `Identifier`, `Reference`, `Isolated`, `shownOf`, `Boundaries` |
| `exact.ts` | 78 | `day`, `instant` (UTC-pinned), `count`, `reference`, and `amountOf` — the published amount split into its figure and its currency |
| `tones.ts` | 47 | Four status vocabularies' tone maps |
| `workspace.tsx` | 163 | The five overview figures, the runs table, `answeredNothing`, the boundaries |
| `configuration.tsx` | 199 | Periods, groups, one group's deduction definitions |
| `run.tsx` | 253 | The run's counts, its summary, what its state permits, its exceptions |
| `results.tsx` (rewritten) | 111 | The results table, keyed and linked by employment |
| `outputs.tsx` (rewritten) | 314 | Approvals, adjustments, reconciliation, accounting output, payment instructions |
| `payslip.tsx` | 216 | The result record: totals, period, earnings, deductions |
| `locale.ts` (rewritten) | 71 | Merges the portal's catalogue with Payroll's; `nameIn` |
| `lifecycle.ts` | 119 | **Unchanged.** Which actions a run's state permits — now rendered as a statement rather than as chips on a card |
| `payroll.fixture.ts` | 311 | A tenant's payroll as the module would answer it |

`sections.tsx` (378 lines) was deleted; what it did lives in `workspace.tsx`, `configuration.tsx`
and `run.tsx`, in the design language.

### Navigation

**Unchanged.** `/payroll` is already in the shell's Operations group and the two new routes are
records opened from it — the same shape as the other three slices. A standing test asserts the
destination is still there.

### Localization

`packages/modules/payroll/locales/{en,ar}.json`, kept in step and gated:

- **124 label keys**, up from 66.
- **Two keys added that were missing and leaking**: `decidedAt` and `note`. They were caught by a
  test asserting no `payroll.label.*` key reaches the markup **in either language** — the English
  render leaked them silently, and only the Arabic assertion exposed it. That assertion now runs for
  both languages.
- **Nine keys removed** because nothing references them any more: `actions`, `dashboard`,
  `exceptionCount`, `overview`, `reports` (headings from the card wall), `notice.empty` (the single
  generic sentence the coherence review criticized), `notice.error` and `notice.loading`.
- **Four existing keys put back to work**: `attendance`, `compensation`, `leave` and `employment` are
  Payroll's own four declared stale sources, so reconciliation now reads *"Compensation"* rather
  than `compensation`.

### Tests

**64 tests, 178 assertions**, in four suites, each anchored to a finding rather than to coverage:

| Suite | Tests | What it proves |
|---|---:|---|
| `api.test.ts` | 14 | The exact request literals; that none names a caller; that **no page is indexed** — neither `runs[0]` nor `results.items[0]` survives; four refusals kept apart; explicit paging; no write composed |
| `workspace.test.tsx` | 14 | Every run opens, not just the first; refused ≠ empty; each empty section has its own sentence; server totals; the period identifier stays off the list; `<bdi>` isolation; Arabic |
| `record.test.tsx` | 21 | The four counts are the run's own; three separate withheld sentences; a specific result opens; no column is totalled across currencies; an amount renders as two published halves; posture on stale, reversed and blocked runs; the label-leak check in both languages |
| `routes.test.tsx` | 15 | All three routes end to end; the subject resolved first; not-found rather than a page of refusals; a loading skeleton carrying no text at all; the navigation destination; no write in any of ten source files |

---

## D. What was deliberately not changed

**No file under `packages/modules/payroll/src/` was touched.** The only module files in this commit
are the two locale catalogues.

- No route, query handler, command, permission, contract view, Prisma model, column, migration,
  domain event, port or configuration key.
- **`lifecycle.ts` and its eleven tests were kept and are unchanged.** Deleting them would have
  discarded tested behaviour that is genuinely useful — what a finalized run's remedy is — and would
  have left the file unreachable, which `check-dependencies.mjs` would have caught.
- No write of any kind: no calculation, approval, finalization, reversal, adjustment, payment,
  posting, payslip generation, export or configuration change. **513 routes, 0 forms** remains true.
- **The authorization findings from the coherence review were not touched**: `recruitment.offer.read`,
  `employment.reporting-line.read` and `employment.contract.read` are outside this slice, and no
  permission sweep was performed.
- **No Organization work, no generic resolver, no lookup service.** An employment, a period, a group
  and a cost centre stay the identifiers Payroll stores.

---

## E. Product findings

Found by running the product and looking at it. All seven were fixed inside this slice.

**P1 — The runs list carried a column of period identifiers.** Thirty-six unreadable characters
repeated down every row, and the widest column on the table. *Fixed:* dropped from the list and kept
on the run record, where there is one of it — the same call the employee directory and the hiring
workspace both made. See K1 for why it is an identifier at all.

**P2 — Three rows in the results table each read "Open".** The link carried no identity while the
column that did — the employment — sat beside it doing nothing. *Fixed:* the employment identifier
*is* the link, and the "Result" column is gone. One column fewer and the row is identifiable.

**P3 — A whole sentence was rendered inside a `Fact` value.** "No country pack is configured, so no
statutory line is calculated" wrapped to two lines in a grid cell and made the summary ragged. *Fixed:*
the fact shows a dash and the sentence moved to the run's boundaries note, where the other boundaries
already are.

**P4 — The posture section was titled "Calculation".** That names the domain, not the section.
*Fixed:* "What this run's state permits" — and the explanatory sentence beneath, which had begun by
repeating that clause, now starts after it.

**P5 — The approval table's comment column was headed "Reason".** `PayrollApprovalStepView`
publishes a `comment`, and there is no reason code on it. *Fixed:* "Note".

**P6 — A deduction definition's rate was published and not shown.** The table showed `percentage` as
the basis with nothing saying what the percentage was, while `basisPoints` sat unrendered in the
contract. *Fixed:* a "Rate (basis points)" column showing the module's own integer. Not converted to
a percentage — that would be arithmetic on a published figure.

**P7 — Two catalogue keys were missing and leaking into the markup.** `payroll.label.decidedAt` and
`payroll.label.note` rendered as their own key names. *Fixed:* both added in both languages, and the
test that caught it now runs for English as well as Arabic, because English is where a raw key is
least likely to be noticed.

---

## F. States verified

Each produced against a fixture API answering the real contract shapes, and inspected as rendered
HTML.

| State | How | What the product does |
|---|---|---|
| **Populated** | every read answers | Five overview figures, four openable runs, a run with eight sections, a payslip with two line sets |
| **Empty** | every read answers `{items: [], total: 0}` | Four *different* sentences — "No payroll has been run", "No payroll period has been opened", "No payroll group has been configured" — and the deduction section correctly gives the group's absence as its reason |
| **Refused** | every read answers 401 | **One sentence, once**: *"Nothing on this screen could be read"* over *"Sign-in is not available in this deployment…"*. The eighteen-card wall is gone |
| **Withheld** | the run answers; results, accounting and payments answer 403 | Three sections, **three different sentences**, each naming which permission — beside a run whose own tile still reports 1,398 results. This is the defect the coherence review named, inverted |
| **Loading** | `loading.tsx` rendered directly | A skeleton whose text content is empty, asserted by test: no placeholder figure where a net pay will be |
| **Not found** | the subject read answers 401/403/404 | The run's page says the API returned nothing for this identifier; the result's page additionally names the separate figures permission, because that is the likeliest of its three causes |

---

## G. English / Arabic / RTL

- All three routes render in `en` and `ar`; `?lang=` switches language and direction together.
- Arabic renders from Payroll's own catalogue throughout — asserted by a test that no
  `payroll.label.` key reaches the markup, **in both languages**.
- **An amount is one isolated run, not two.** The figure and its currency code are rendered as
  separate tokens inside a single `<bdi>`, so Arabic cannot put the currency before the figure for
  one amount and after it for the next. Verified in the rendered Arabic payslip.
- The page-count-over-total ratio is a single isolated run, so `4 / 26` cannot render as `26 / 4` —
  the defect the coherence review found on the Employee Record, avoided here by construction.
- Every code, identifier, digest, date and instant is `<bdi>`-isolated.
- Codes are never translated: `regular`, `monthly`, `half_up`, `pre_tax`, `bank_transfer`,
  `full_period`, `percentage_of_basis` are tenant and country-pack values.

---

## H. Desktop / mobile

Verified at **1440 px** and **390 px**, in both languages.

- The five overview tiles sit in one row at desk width and stack two-by-two on a phone; the run's
  four counts do the same.
- Every table scrolls inside its own container; the page body never scrolls horizontally at 390 px.
- Run selection stays usable on a phone: the run number is the first column and the link.
- Amounts stay legible — the figure is tabular and the currency is a muted adjacent token, so a
  column of them lines up rather than wrapping.
- No identifier is truncated to make a column fit.

One honest limitation, recorded rather than fixed: in the results table the column order is
employment → gross → deductions → **net**, which is the order a payslip is read in, and at 390 px net
is the third horizontal scroll. Reordering for one viewport would need client code and would put the
figures out of their domain order on the desktop.

---

## I. Tests

**64 tests, 178 assertions**, all passing, none skipped. The admin suite as a whole: **40 files, 502
tests**, up from 36 files and 438.

```
✓ src/payroll/api.test.ts        (14 tests)
✓ src/payroll/workspace.test.tsx (14 tests)
✓ src/payroll/record.test.tsx    (21 tests)
✓ src/payroll/routes.test.tsx    (15 tests)

Test Files  40 passed (40)
     Tests  502 passed (502)
```

Three assertions are worth naming because they guard properties no rendered output reveals:

- **No page is indexed.** The composition's source is scanned *with its comments stripped* — the
  prose in that file explains the very defect being asserted against, and an earlier version of the
  test failed on its own explanation.
- **Four refusals stay four answers.** A single stub refuses results, accounting output and payment
  instructions while answering everything else, and all three come back `undefined` while the
  exceptions come back populated.
- **No write is composed anywhere.** Ten source files — three routes and seven composition modules —
  are read with comments stripped and asserted to contain no `method: 'POST'`, no form, button or
  input, and no `'use client'`.

---

## J. Full gate

`pnpm verify` = `standards && format:check && lint && typecheck && test && build`.

**Passed — exit 0, 51 tasks successful.**

```
Engineering Standards: no violations.
Architecture: 186 model(s) checked, no violations.
Localization: 20 catalogue set(s) complete.
Dependencies: 1963 source file(s), no cycles, no unused dependencies, no unreachable files.
prettier --check  — all matched files use Prettier code style
eslint .          — clean across every package
tsc --noEmit      — clean across every package
vitest run        — 3479 passed, 1624 skipped, 0 failed
next build / tsc -p tsconfig.build.json — every app and package built
```

The 1,624 skipped are the repository's standing behaviour: integration suites skip themselves when
`DATABASE_URL` is unset for the test run. The payroll suite runs **502 tests, 0 skipped**.

**Migrations:** PostgreSQL 16 started locally; `prisma migrate deploy` reports **no pending
migrations**, with **31 of 31 applied**. This slice adds none.

---

## K. Remaining findings, recorded and not fixed

1. **Payroll publishes no read of a period by identifier.** `ListPeriods` accepts only paging, and
   `PayrollRunView` carries `payrollPeriodId`. So a run cannot name its own period: the run record
   shows the identifier, and the workspace's period table shows codes that cannot be joined to it
   without guessing from a page. This is the **same class of gap as the Organization one** the
   coherence review scoped — a bounded read by identifier that is missing — but it sits *inside*
   Payroll rather than across a module boundary, which makes it a smaller and more clearly owned
   question. The result record is unaffected: `PayslipView` publishes the period code and dates
   directly.
2. **`payroll.read-own` is declared and used by no query.** Noted in the coherence review as expected
   while self-service is unbuilt; unchanged here.
3. **`/payroll/runs/:id/adjustment-reasons` remains unconsumed.** It is the vocabulary for recording
   an adjustment, which is a write.
4. **Nothing renders a payslip document.** Payroll owns the figures; rendering, storage and delivery
   belong to a Document domain that does not exist and `StoragePort` still has no adapter and no
   owning phase. Stated on the record rather than left as an absence.
5. **No country pack is configured**, so no statutory line is calculated anywhere. This is the
   commercial gap the audit and the coherence review both name; it is domain work, not composition.
6. **The mobile column-order limitation** in H.

---

## L. Git state

- **Commit:** `9c27a54` — *Product Slice — Payroll as Work*, which carries every file listed
  above. (A commit cannot record its own identifier; the hash is filled in by the small follow-up
  commit directly after it, as the two previous slices did.)
- **Branch:** `claude/munaxa-product-readiness-audit-8mr34d`, pushed to `origin`
- **27 files changed**: 25 under `apps/admin`, 2 locale catalogues. `sections.tsx` deleted.
- **Working tree:** clean.
- **No local registry workaround committed.** The `@munaxa/*` packages live in GitHub Packages and
  this session's token carries no `read:packages` scope, so the platform packages were built from
  public source in the scratchpad and linked through seven `pnpm.overrides` entries in the root
  `package.json` for the duration of the work. Those entries were reverted before the commit —
  committing them would break CI's `--frozen-lockfile` install. `git diff HEAD -- package.json
  pnpm-lock.yaml` is empty.
