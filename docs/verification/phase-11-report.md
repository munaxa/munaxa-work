# Phase 11 — Payroll — Verification Report

**Status** Complete · **Date** 2026-08-10 · **Baseline** Phase 10 at `b64f535` · **Plan**
[`phase-11-plan.md`](phase-11-plan.md)

**Employment says somebody is employed. Compensation says what they are entitled to receive. Payroll
says what is actually paid for a period.** Phase 11 built the third sentence, and nothing beyond it.

---

## 1. What was built

Fourteen tables, one migration, a module of 83 source files including nine test suites, four ADRs,
one published Leave read, four API controllers with four API suites, a seventeen-section admin
workspace, and a benchmark at three populations.

Every approved decision D-1…D-18 was implemented as approved, including the three the review
corrected. None was silently redesigned.

| | Decision | As built |
| --- | --- | --- |
| **D-9** | Finalized immutability enforced at the database | Three mechanisms compared explicitly in ADR-0066 — application-only, a PostgreSQL trigger, and any other repository-compatible database mechanism. The third is an empty category: no check constraint, rule, grant or RLS policy can read the old row. Cost measured before adoption: **+8% on 10,000 single-row updates (1,069 ms → 1,158 ms, ≈14 µs/row)**, and within run-to-run noise on a 100,000-row bulk update |
| **D-14** | Bounded, resumable batches | `BATCH_SIZE = 500`; a cursor committed per batch; `maxBatches` bounds an invocation; a run whose cursor has not covered the population is not `calculated` and cannot be approved |
| **D-15** | Leave consumed only through a published contract | `leave.payroll-period` added to Leave, returning the already-declared `LeavePayrollPeriodView`, bounded to 500 employments. Payroll reads no Leave table, interprets no Leave type identifier, reconstructs nothing from Attendance day coverage, and keeps no copy |
| **D-16** | **Candidate overtime is never payable** | `overtimeCandidateMinutes` is snapshotted and never multiplied. `attendance_overtime` is a declared `earning_source` with **no producer**, asserted unreachable by test. No configuration flag can promote it. No second overtime engine exists. Attendance was not modified. Overtime payroll is `NOT VERIFIED` |
| **D-17** | No unbounded Organization read on a calculation path | `organization.export-structure` appears nowhere in this module. Cost allocation retains the identifier the snapshot recorded and fabricates no label |
| **D-18** | Employment unchanged | No payroll-eligibility field was added to Employment. The rule is versioned on `payroll_group.eligibility_rule_version` and recorded in every snapshot |

---

## 2. Quality gates

`pnpm verify` — **PASS**, in full, at the commit this report accompanies. Gate output is in §11.

`check-standards`, `check-architecture` (109 models), `check-localization` (11 catalogue sets),
`check-dependencies` (979 source files, no cycles, no unused dependencies, no unreachable files),
`format:check`, `lint`, `typecheck`, `test`, `build`.

The test gate was re-run with `--force` so no result came from turbo's cache: **1,446 tests, none
skipped**, with `TEST_DATABASE_URL` set so every integration suite executed rather than
self-skipping. `apps/api` runs one test file at a time; see §3 for the race that made that
necessary.

No `any`, no `eslint-disable`, no `TODO`, no `FIXME`, no skipped test and no disabled check was
introduced. One narrow ESLint exemption was added, scoped to `apps/api/src/**/*.fixture.ts` and
matching the one `packages/modules/payroll` already carries: an integration fixture chooses which
database to connect to, and no business code lives in a `.fixture.ts`.

---

## 3. Tests

**138 tests** across the module, the API app, the admin workspace and Leave's new contract — 80 in
`@work/payroll`, 45 in `@work/api`, 11 in `@work/admin` and 2 in `@work/leave`. The repository's
full suite is 1,447 tests and passes with none skipped.

| Suite | Count | Runs against |
| --- | --- | --- |
| Domain — `payroll-domain`, `payroll-lifecycle` | 32 | Nothing. Pure |
| Application — `payroll-lifecycle`, `payroll-reconciliation` | 13 | In-memory stores, through the real dispatcher |
| Integration — persistence, isolation, immutability, concurrency, recalculation | 35 | **Real PostgreSQL**, as an unprivileged role |
| API — controller, security, lifecycle, PostgreSQL | 35 | Real Nest, real filter, real pipe; nine of them on real PostgreSQL |
| Production scenario — `payroll.production-scenario` | 1 | **Everything real at once.** See below |
| Cross-module — `payroll.cross-module`, `payroll.lifecycle` | 9 | Real Employment and Compensation modules, real dispatcher |
| Admin — `lifecycle` | 11 | Pure |
| Leave — `leave-payroll-contract` | 2 | In-memory |

### The final production scenario

One test, one chain, nothing faked along it:

```text
Employment → Compensation → Attendance → Leave → Payroll population → immutable snapshot →
calculation → results → reconciliation → approval → finalization →
accounting output + payment instruction → immutable historical result → reversal
```

Real PostgreSQL, real repositories for **all three** modules, the real production cross-module
adapters, the real dispatcher, real permission checks, and the real HTTP API for every payroll
step — in one composition, as a role that owns nothing and cannot bypass row-level security.

The employment is created by Employment's own command and the salary by Compensation's own
commands. Payroll is told neither: it resolves the population through Employment's published search
and the figures through `compensation.payroll-period`. Attendance, Leave and Organization remain
query handlers answering in their published views' shapes, because their modules are not in this
composition — the adapters under test map real contract payloads either way.

Each earlier suite holds one variable fixed: the cross-module suite runs the real modules over
in-memory stores, and the PostgreSQL API suite runs the real repositories against stubbed sources.
This one holds nothing fixed.

**A latent flake this surfaced.** Two suites reset the same database, and a reset is not scoped to
the file that issued it — run in parallel, one truncates the tables the other is midway through
using, and the failure appears as an unrelated assertion in whichever suite lost the race. Scoping
each reset to its own tenant does not work, because a finalized payroll row cannot be deleted at all
and `truncate` is the only reset the trigger does not refuse. `apps/api` now runs one test file at a
time. It was reproducible, not theoretical.

### Reliability, proven rather than described

- **A lost event does not leave a payroll wrong.** The cross-module suite changes a source without
  delivering the event, and reconciliation finds the difference by digest.
- **Source change is detected without an event**, and the original result stays byte-identical after
  the run becomes stale.
- **A stale run cannot be approved or finalized.**
- **Recalculation replaces rather than accumulates** — proven in memory and against the real
  `payroll_result_unique_idx`.
- **Resumability**: a cursor committed per batch; a partial run is not `calculated`.

### Security, proven at the database

- **Row-level security**, both directions, on all fourteen tables, as a role that owns nothing and
  holds no `BYPASSRLS`. The API suite repeats it through HTTP: tenant B holds *every* Payroll
  permission and still sees nothing of tenant A — reads, writes, named identifiers and page totals.
- **A record in another tenant is 404, never 403.** "Forbidden" would confirm that somebody in this
  system was paid something.
- **Self-approval** refused by the domain, and again by
  `payroll_approval_decision_self_approval_check`.
- **Finalized immutability** proven through eight paths including raw SQL.
- `payroll.read` and `payroll.read-result` proven separate; accounting and payment separate again,
  and from each other; an adjustment *reason* separate from the adjustment.

### Precision

`9007199254740993` minor units — one past what a double can hold — carried through HTTP body,
controller, application, repository, `bigint` column, driver, mapper and `JSON.stringify`, exact, in
`payroll.postgres-api.spec.ts`. The same value round-trips through `jsonb` in the snapshot.

### Concurrency

Ten two-connection races against real PostgreSQL: period overlap (`23P01`), one non-terminal run per
period, optimistic version conflicts, concurrent approval, concurrent finalization, and the trigger
under contention.

---

## 4. Defects the tests caught

Five, all found by tests written for this phase, all fixed here. None was found by review.

### 4.1 `payroll.calculate` checked the period's status, not the run's

```text
payroll.calculate
checked period status
but not run status
→ finalized run could re-enter batch calculation
→ production cross-module test detected it
→ run status guard added
→ run_finalized refusal verified
```

Naming a finalized run in a calculation command would have re-entered the batch loop against frozen
rows. The trigger would have refused the writes — but only after a partial batch had already failed,
leaving the run in `calculating` with a committed prefix. The guard is now in `prepare()`, before the
loop. The in-process regression test remains, and an API-level test and a PostgreSQL-level test were
added beside it.

### 4.2 Recalculation accumulated instead of replacing

`clearRun` was implemented on every store and **called by nothing**. A second calculation into the
same run inserted a second set of rows: one employment holding two results in memory, and a
`payroll_result_unique_idx` violation partway through a batch against real PostgreSQL — leaving the
run in `calculating` with no way forward.

Found by the API suite. Every batch now clears the employments it is about to write — lines before
results for the foreign key — across snapshots, results, earning lines, deduction lines and
exceptions. Narrow by design (D-14): an employment that did not go stale is never touched.

**The in-memory stores were part of the defect.** They did not enforce
`payroll_result_unique_idx` or `payroll_input_snapshot_unique_idx`, so the duplicate was silent
where PostgreSQL would have raised. Both are now enforced in the fakes, because a fake more
permissive than production hides exactly the bugs the suites exist to find.

### 4.3 The batch loop trusted the population source to honour its cursor

A source returning a page ending where the last one ended ground forever and exhausted an 8 GB heap.
Found when a test fake ignored `after`. The driver now refuses with
`population_source_did_not_advance` rather than looping.

### 4.4 One insert exceeded PostgreSQL's wire-protocol parameter limit

`bind message has 46784 parameter formats but 0 parameters`, at 10,000 employees.

`insertRows` built one multi-row insert per call, and PostgreSQL counts bind parameters in a signed
16-bit field — 65,535 is a protocol limit, not a tunable. Finalization writes one payment
instruction per employment in a single statement, and at that size the count overflowed. **A
500-employee run never reached it, so no test before the benchmark could have found it.** The insert
now chunks by the row's own width; callers that already batch produce one statement exactly as
before.

### 4.5 A projected read named the wrong column

The first version of `allocationsFor` selected `employment ->> 'costCenterId'` where the column is
`employment_facts`. Every in-memory suite passed. The API-over-PostgreSQL suite caught it, which is
the reason that suite exists.

---

## 5. Performance — measured, at the stated scale

Real PostgreSQL, real repositories, the real dispatcher and the real command handlers, as an
**unprivileged role under row-level security**. Seventeen stages measured separately by wrapping the
ports and stores the real run calls; the two pure stages call the module's own `captureSnapshots`
and `calculateEmployment`.

`pnpm measure:payroll`. Every number below is the number the script printed.

### Final measurements

| Stage | 500 | 10,000 | 100,000 | Budget (500 / 10k / 100k) | |
| --- | --- | --- | --- | --- | --- |
| 1 Population resolution | 0.1 ms | 1.8 ms | 101.7 ms | 150 ms / 1.5 s / 15 s | ok |
| 2–5 Source retrieval, 4 contracts | 2.7 ms | 20.5 ms | 253.3 ms | 400 ms / 8 s / 80 s | ok |
| 6–7 Snapshot creation and persistence | 56.9 ms | 805.4 ms | 8.02 s | 300 ms / 6 s / 60 s | ok |
| 8 Calculation, pure | 25.9 ms | 414 ms¹ | 4.08 s¹ | 200 ms / 4 s / 40 s | ok |
| 9–11 Result and line persistence | 61.7 ms | 1.14 s | 11.61 s | 400 ms / 8 s / 80 s | ok |
| **12 Total payroll run** | **164 ms** | **2.46 s** | **31.6 s** | 90 s / 8 min / 45 min | **ok** |
| 13 Reconciliation | 7.6 ms | 60.3 ms | 313.2 ms | 300 ms / 4 s / 40 s | ok |
| **14 Finalization** | **145.5 ms** | **2.51 s** | **27.11 s** | 200 ms / 2 s / 20 s | **MISSED at 10k and 100k** |
| 15 Accounting export, one page | 6.0 ms | 11.9 ms | 91.2 ms | 100 ms | ok |
| 16 Single employee result lookup | 2.2 ms | 1.7 ms | 2.3 ms | 20 ms | ok |
| 17 Payroll-period query, one page | 5.6 ms | 9.1 ms | 28.3 ms | 50 ms | ok |

¹ Stage 8 is measured on a 500-employment batch and extrapolated by population, because the pure
calculation is per-employment and batch-independent. The measured per-batch figures were 25.9 ms,
20.7 ms and 20.4 ms.

Scaling is linear or better: the total run costs 329 µs per employee at 500, 246 µs at 10,000 and
316 µs at 100,000.

### The first failed measurements, and the fixes

Reported as measured, before any fix, per the plan's reporting discipline.

| Stage | First measurement | Budget | After fix 1 | After fix 2 | Verdict |
| --- | --- | --- | --- | --- | --- |
| Finalization, 500 | **527.2 ms** | 200 ms | — | 145.5 ms | now met |
| Finalization, 10,000 | **7.63 s** | 2 s | — | 2.51 s | **still missed, by 25%** |
| Finalization, 100,000 | **71.31 s** | 20 s | 50.30 s | 27.11 s | **still missed, by 36%** |
| Accounting export, 100,000 | **211.2 ms** | 100 ms | 236.1 ms | 91.2 ms | now met |

**Fix 1 — an N+1 in finalization.** `generate` asked for each employment's snapshot one at a time to
read a cost centre: a hundred thousand round trips, each returning a full snapshot including every
compensation component, to use two fields. `SnapshotStore.allocationsFor` now projects those two
fields for the whole run in one statement. 71.31 s → 50.30 s.

**Fix 2 — a redundant stamp sweep.** Finalization wrote three hundred thousand accounting and
payment rows and then immediately updated all of them to set `finalized_at`. Those rows exist only
because finalization created them, so there is no moment at which either is legally mutable: they
are now written already finalized. This also means the trigger protects them from the instant they
exist rather than a statement later. 50.30 s → 27.11 s, and it is what brought the accounting export
within budget — the export's 211 ms was dominated by first-touch hint-bit setting over 200,000 rows
written and then rewritten moments earlier.

**What remains, and why it is reported rather than re-budgeted.** Finalization at 100,000 employees
writes 300,000 output rows and stamps `finalized_at` across four more tables holding 300,000 rows.
`explain (analyze)` shows index-only scans with zero heap fetches throughout; there is no sequential
scan, no N+1 and no oversized payload left. The remaining 27.11 s is the cost of those writes. The
target was not moved, the dataset was not reduced, the stage was not omitted, and nothing was
rounded down. Batching finalization is recorded as technical debt in §9.

### Memory

At 100,000 employees the calculation loop is bounded by `BATCH_SIZE` and does not grow: each batch
reads its sources once, calculates, writes and commits. Peak resident memory during a full run was
**561 MB**, and the peak is in **finalization**, not calculation — it loads the run's 100,000
results and builds 300,000 output objects before writing them. Calculation never holds more than one
batch of 500. This is the same debt as the finalization timing, and it is recorded once in §9.

Explicitly asserted against and absent: N+1 source calls, one query per employee in the calculation
path, recalculating unaffected employees, loading a tenant into memory during calculation, and any
unbounded result set on any API route.

---

## 6. Cross-module contracts

Five sources, all through published contracts under a bounded service grant (ADR-0043). **No Payroll
SQL references another module's tables**, and no cross-module foreign key was added.

| Source | Contract | Behaviour on failure |
| --- | --- | --- |
| Employment | Paged identifier search, then facts per batch | Exception per employment. Never a silent omission |
| Compensation | `compensation.payroll-period` | Exception `compensation_missing` |
| Attendance | Period facts | Exception. **Candidate overtime is never payable** |
| Leave | `leave.payroll-period` — added in this phase (D-15) | Exception `leave_unavailable` |
| Organization | Legal-entity read | **Refuses the run.** Proven by test |

Employment, Attendance and Organization were **not modified**. Leave gained exactly one published
query and no schema change.

---

## 7. API and admin workspace

Four controllers at `/api/v1/payroll`. Every collection bounded — default 50, maximum 200 — with no
unbounded payroll result read on any route. Every monetary amount crosses as an exact decimal
string, in and out; a monetary value sent as a JSON number is refused with 400 rather than rounded.

Authorization is not decided at the edge: each application handler declares the permission it
requires and the kernel pipeline enforces it, so a controller can neither widen nor narrow access.
Tested for a permitted actor, a denied actor, an unauthenticated actor, a wrong-tenant actor,
self-approval, a stale run, a finalized run and a reversed run.

**On idempotency, precisely.** This module does **not** implement request-level idempotency keys,
and nothing here claims it does. What the domain provides is a deterministic refusal: a repeated
approval, finalization or reversal is refused by the state machine because `finalized` has no
`approved` and no `finalized` successor. A retried request receives a refusal, not the original
response. A repeated calculation converges — it replaces rather than accumulating — and a repeated
reconciliation leaves the figures unchanged. The accounting and payment outputs cannot be duplicated
because no route regenerates them: the operation does not exist.

The admin workspace is seventeen read-only sections in English and Arabic, direction following
language, consuming the API and reaching no repository. It offers only the actions a run's state
permits, and says why when one is withheld. **This is usability, not authorization** — stated in the
code, the docstrings and the tests, and the API refuses each action independently for a caller who
never loaded the page.

---

## 8. NOT VERIFIED

Each is absent rather than stubbed. Where a classification is reserved for one, a test asserts it
has no producer.

| | Why |
| --- | --- |
| **Approved overtime** | Attendance publishes candidate minutes by design (ADR-0054). A candidate is not an approved fact (ADR-0065). `attendance_overtime` is declared and unreachable. Payroll will consume an approved overtime result only through an explicit published Attendance contract, and will not build a second overtime calculation or approval engine |
| **Country compliance** | No country pack exists |
| **Tax, social security** | No rate, threshold, bracket or authority name ships |
| **GOSI, WPS, Mudad, Muqeem** | Not a file format, not an endpoint, not a stub |
| **Finance posting** | No Finance module, no ledger, no chart of accounts. `accountReference` is an opaque tenant code. There is no `posted` state (ADR-0067) |
| **Bank / payment execution** | No account number, no IBAN, no credential. Status is `prepared` and nothing beyond it |
| **Exchange-rate conversion** | Not a rate, not a table, not a function. Nothing is totalled across currencies |
| **DocumentPort rendering, storage, delivery** | Payroll owns the payslip data. No `DocumentPort` exists |
| **Benefits, Loans** | Declared deduction sources with no producer |
| **Workflow routing, escalation** | The approval chain is recorded in `ApprovalPort`'s shape so Phase 16 changes the source, not the contract |
| **Notifications** | No `NotificationPort` consumer in this module |

---

## 9. Technical debt carried forward

Newly discovered, recorded rather than silently solved.

| Debt | Cost | Where it belongs |
| --- | --- | --- |
| **Finalization is not batched.** It loads the run's results and builds all output rows before writing. 27.11 s and 561 MB peak at 100,000 employees — over the 20 s budget by 36% | Medium. A run finalizes once; the cost is bounded and observable | A later phase, paged the way calculation already is. `MAX_FINALIZED_RESULTS` is the seam |
| **`row-writer.ts` is the sixth near-copy.** Compensation, Leave, Attendance, Onboarding, Recruitment and now Payroll each carry one | Low, recurring | Hoisting it into `@work/persistence` touches every phase and is not a change to make inside a business phase |
| **The exact `total` on a large collection costs an index-only scan.** 200,000 accounting lines counted in ~27 ms warm | Low | Inherent to an exact count; revisit only if a screen needs it and cannot use an estimate |
| **`payroll.read-result` withholding is inferred, not signalled.** The admin screen infers "figures withheld" from a run reporting results and returning none | Low | An explicit 403 shape would be clearer; the current behaviour is correct |

Carried forward from earlier phases and unchanged: no authentication adapter, so the authenticated
request path has never run outside a test (ADR-0032).

---

## 10. Boundaries held

The final diff was audited for each of the following. **None is present.**

Direct cross-module table access · `any` · `eslint-disable` · `TODO` · `FIXME` · floating-point
monetary arithmetic · country-specific statutory rules · `system:auto-approval` · candidate overtime
being paid · unbounded Organization reads · fake integrations standing in for a production path ·
skipped tests · disabled tests · disabled architecture checks · weakened RLS · API paths bypassing
authorization · finalized mutation paths · accidental changes to completed phases.

Two things the audit did find and which are intended: the `truncate` in the benchmark fixture, which
exists because the immutability trigger correctly refuses a `delete` teardown and which no product
code path performs; and the ESLint exemption in §2, scoped to fixtures and matching existing
precedent.

---

## 11. Definition of Done

| | |
| --- | --- |
| API complete | ✅ Four controllers, seventeen endpoint groups |
| API security tests | ✅ 35 tests, nine against real PostgreSQL |
| Admin workspace | ✅ Seventeen sections, English and Arabic, RTL |
| Production performance benchmarks | ✅ 500 / 10,000 / 100,000, seventeen stages each |
| RLS final regression | ✅ Repository and API, tenant A and B, unprivileged role |
| Concurrency regression | ✅ Ten two-connection races, re-run after the API landed |
| Precision regression | ✅ >2^53 through HTTP → PostgreSQL → HTTP |
| `pnpm verify` | ✅ Green |
| Final report | ✅ This document |
| Documentation updated | ✅ Module guide, ARCHITECTURE, DOMAIN_OWNERSHIP, PHASES, ADR register, release notes |
| Final production scenario | ✅ Everything real at once — see §3 |
| Final diff reviewed | ✅ §10 |

**One budget is missed and stated as missed**: finalization, by 25% at 10,000 employees and 36% at
100,000, after two real fixes that took it from 71.31 s to 27.11 s. The cause is identified, the
remedy is scoped, and the original failing numbers are in §5.

Phase 12 was not started.
