# Phase 16C — Checkpoint 10 — Audit

**Audit only.** No domain, application, repository, schema, migration, API, Admin, Identity,
Employment, Organization, Recruitment, kernel, port, adapter or dependency was modified. What changed
is audit tests, the benchmark harness, and this document.

Every count and conclusion below was **recalculated from the delivered tree, the live database or the
compiled package** rather than copied from a checkpoint report. Where a report and the tree disagree,
the tree wins and the disagreement is recorded.

---

## 1. Scope

| Modified | Why |
| --- | --- |
| `apps/api/src/workflow/workflow-audit.routing.spec.ts` *(new, 6 tests)* | The snapshot rule's missing half; the three cross-module query plans |
| `apps/api/src/workflow/workflow-audit.phase-16c.spec.ts` *(new, 21 tests)* | Positive controls for the negative-space scanner; the schema read from the catalogue |
| `scripts/measure-workflow-performance.mjs` | Stale vocabulary (defect B-1 below); `VOCABULARIES` extracted at the line budget |
| `scripts/workflow-benchmark-audit.mjs` | Receives `VOCABULARIES` |
| `scripts/workflow-benchmark-data.mjs` | Seeds manager templates, targets and awaiting instants |
| `scripts/workflow-benchmark-isolation.mjs` | Reads the three 16C columns back through the production mappers |
| `docs/verification/phase-16c-audit.md` | This document |

`PHASES.md`, `RELEASE_NOTES.md` and `DOMAIN_OWNERSHIP.md` are untouched.

**One discrepancy in the checkpoint brief.** It names `1412cbf` as the last implementation commit;
that is Checkpoint 8. Checkpoint 9 is `47484aa`, and the tree audited here includes it. A
documentation discrepancy, not a code one.

---

## 2. Reconciliation and the decision register

The implementation chain is exactly the expected order, one commit per checkpoint, none started
early:

| CP | Commit | |
| --- | --- | --- |
| 1 | `eaf4fd7`, `5a7fb59` | Definition of Ready; register, stopping on six parameters |
| 2 | `8e0b2ba` | Domain |
| 3 | `ea00725` | Schema |
| 4 | `afdd8ca` | Application |
| 5 | `cff5105` | PostgreSQL repositories |
| 6 | `a6cf205` | Identity contract |
| 7 | `e0e28b7` → `d986a4c` → `12ede75` | **Stopped**, blockers approved and recorded, then adapter |
| 8 | `1412cbf` | API |
| 9 | `47484aa` | Admin UI |

Checkpoint 7's shape is worth naming: it stopped before writing the adapter, reported two blockers,
and the approvals were **recorded in the register before implementation** (`d986a4c` precedes
`12ede75`). That ordering is itself evidence that nothing was inferred.

**Register.** `docs/verification/phase-16c-plan.md` §7A carries all fourteen D-16C decisions with
approved outcome and date (2026-08-16); §7B carries all six P-1…P-6 parameters with the declined
alternatives kept beneath each; §7C carries B-1 and B-2 (2026-08-17). Every one states its approved
option, and §7A and §7B each carry their attached standing constraints (seven and fourteen
respectively).

**No mismatch between register and implementation was found.** Spot-checked against the tree: P-3
(primary line only) — the adapter reads `line_type = 'primary'` and a functional line is ignored, with
its own test; P-4 (one level) — no recursion exists anywhere on the path; P-6 (UTC) —
`resolutionDateOf` is `startedAt.toISOString().slice(0, 10)`, the single conversion, and it is the
only one; D-16C-06 (expiry observed, never written) — see §8.

---

## 3. Manager routing

The full path, verified end to end against real PostgreSQL with no fake on it:

```
requester membership
  → identity.primary-employment-for-membership   (employment_link, is_primary, linked)
  → employment.read-employment(asOf)             (employment_reporting_line, primary, in force)
  → identity.active-memberships-for-employment   (employment_link ⋈ tenant_membership, active)
  → resolveManager                               (the four refusals and the self-approval rule)
  → a concrete membership
  → workflow_step.approver_membership_id
```

| Property | Evidence |
| --- | --- |
| Exactly one resolution at instance start | Three grants counted at the dispatcher per start, and no fourth |
| No later lookup while running | Elevation count unchanged across a decision |
| No lookup while reading | Elevation count unchanged across `read-instance` |
| No browser-side lookup | Admin makes 10 requests and none names a manager, reporting line or employment |
| No manager identifier on the template | `workflow_step_template_approver_check` refuses a `manager` row carrying either identifier |
| Concrete membership on the running step | `workflow_step_approver_kind_check` permits **only** `'membership'` |

**The two approver-kind constraints are the schema's whole statement of manager routing**, and they
are asymmetric on purpose: a template may say `manager`, and a running step cannot. Read from
`pg_constraint` in this audit rather than from a migration file, so a later widening of the step's
list fails here.

**The snapshot rule's missing half — found and closed.** Every checkpoint suite proved that a running
approval keeps the manager it started with when the reporting line moves. None proved that a *newly
started* approval reaches the **new** manager, and the first claim is satisfiable on its own by a
system that has stopped resolving managers altogether. The audit asserts both halves against one
reorganization, in one test, and they genuinely disagree: the running approval names `MANAGER`, the
next names `DEPUTY`. Classified as a **test-coverage gap**, now closed; no production defect —
the behaviour was already correct.

---

## 4. Manager refusals

Five outcomes, every one failing closed. The port's outcome and the domain's refusal are separate
vocabularies and are listed as such, because the second is what reaches a caller:

| Port outcome | Refusal | Cause |
| --- | --- | --- |
| `no-primary-employment` | `manager-no-primary-employment` | No primary active employment (P-2) |
| `no-manager` | `manager-not-assigned` | No manager on the primary line as at the date (P-3) |
| `manager-not-a-member` | `manager-not-a-member` | The manager's employment is held by nobody |
| `resolved`, to the requester | `manager-is-the-requester` | The requester turns out to be their own manager |
| `manager-membership-ambiguous` | `manager-membership-ambiguous` | Two or more members hold that employment (B-1) |

The self-manager case is the one where the *port* resolves successfully and the **domain** refuses,
which is the right division: who holds an employment is Identity's fact, and whether that person may
approve their own request is Workflow's rule.

None skips a step, none creates a partial instance, none leaves a queue row and none writes history —
asserted by a test that starts a doomed approval and finds every table empty afterwards.

**Ambiguity is deterministic**, and the suite reverses the order the two candidate memberships arrive
in and gets the same refusal. It also keeps "nobody holds it" and "two people hold it" apart as
distinct outcomes, which is the point of B-1: they are opposite problems for different people to fix.
The adapter contains no `[0]`, no ordering, no `is_primary` preference and no fallback of any kind.

---

## 5. Effective dating

- **`resolutionDateOf` is the single UTC conversion**, and it is one line:
  `startedAt.toISOString().slice(0, 10)`. Tested around the midnight boundary.
- **No server clock on the path.** `new Date()`, `Date.now`, `now()` and `CURRENT_DATE` appear
  **nowhere** in `domain/service-level.ts`, `domain/manager.ts`, `application/workflow-views.ts`,
  `application/instance-snapshot.ts` or the adapter. The reading instant comes from
  `dependencies.clock.now()`, read once per request.
- **No tenant timezone dependency was invented.** Workflow imports nothing from Organization.
- **The primary line is Employment's own selection**, through its existing contract; a functional
  line never becomes a manager, with its own test.
- **No traversal.** No recursion, no manager-of-manager, no configurable depth anywhere on the path.

*Recorded factually:* the only `now()` in the module's production tree is in
`infrastructure/workflow-seed.ts`, a seeding utility on no read or resolution path. Pre-existing,
unrelated to 16C, and not a finding.

---

## 6. Snapshot

Proven as A → B → C → D in one scenario (§3), plus:

- A membership **ended** after the snapshot does not rewrite the step.
- **No read re-resolves.** Reading an approval enters no service grant at all, which is a stronger
  statement than "returns the same value" — there is no call to be stale.

---

## 7. Service level

Every approved semantic holds:

| Approved | Delivered |
| --- | --- |
| Elapsed time | `HOUR_MS`/`DAY_MS` arithmetic, no calendar consulted |
| Whole integer, ≥ 1 | `Number.isInteger` + `< 1` refusal; `integer` column; `>= 1` check |
| Hours or days only | `SERVICE_LEVEL_UNITS`, mirrored by a database check on **both** tables |
| No fractions | Refused rather than rounded, at domain, DTO and column |
| Configured on the template | `workflow_step_template.service_level_{count,unit}` |
| Copied to the running step | `workflow_step.service_level_{count,unit}` |
| Clock starts when *that* step becomes awaiting (P-5) | `awaiting_at`, stamped only on `awaiting` |
| Parallel steps share an awaiting instant | Each branch step stamps its own when the branch opens |
| Never restarts | Nothing writes `awaiting_at` a second time |
| No business days | Absent from domain, schema check, DTO and locale |

**`dueAt`, `serviceLevelState` and `overdueByMinutes` are derived from exactly three inputs** —
target, `awaitingAt`, and an explicit reading instant — and **none is persisted**. The database has no
`due_at`, `expired`, `breached`, `overdue_at` or `elapsed_minutes` column, verified in this audit by
querying `information_schema.columns` for a pattern covering every one of them and getting an empty
result.

**Boundaries** (`domain/workflow-service-level.test.ts`): boundary − 1 ms → `within`; **exactly at
due → `within`**; boundary + 1 ms → `overdue`; +3 s → **0** minutes; +59,999 ms → **0**; +60,000 ms →
**1**; +1 h → 60; thirty days and twenty-three hours → 44,580, with a trailing half-second truncated
away. `Math.trunc`, never rounding, never a percentage, never a decimal, never negative. The reading
instant is a parameter, so the same step read twice gives the same answer.

**The UI renders and never recalculates.** `apps/admin/src/workflow/service-level.tsx` is scanned
with prose stripped for `Math.`, `toFixed`, `parseFloat`, `parseInt`, `Date.now`, `new Date`, ` / `,
` * `, ` % `, ` - `, ` + `, `width`, `progress`, `setInterval`, `setTimeout` — and contains none. The
fixture's due instant is deliberately *not* `awaitingOn` plus the target, and the day a screen
computing it would print is asserted absent from the page.

---

## 8. Expiry

**There is no approval expiry state in the delivered system.** Verified across every surface:

| Surface | Result |
| --- | --- |
| Domain vocabulary | `ServiceLevelState` has three values; `expired` is not one |
| Prisma / database checks | `workflow_step_status_check` lists five statuses; no `expired`, no `overdue` |
| Columns | No `expired`, `breached`, `due_at`, `overdue_at`, `elapsed_minutes` anywhere |
| Views | `StepServiceLevelView.state` is the three-value union |
| API DTOs | `expired`, `breached`, `expiresAt`, `dueAt`, `overdueByMinutes` each **400** on the wire |
| Admin labels | No `>expired<`, no countdown, no "remaining" |
| History events | Eight events, none about expiry |

The `expired` that remains is `ApprovalPort`'s — one of the **kernel port's** five states, declared
for the whole repository's approval seam and **never produced by Workflow**. It is presented as
exactly that: the Admin status section says in both languages that a step past its target *stays
exactly where it is* and that `expired` is declared in the approval vocabulary and this phase never
produces it. That is the disposition §11 requires.

---

## 9. Escalation boundary

Not implemented, and nothing claims otherwise. The module-wide scan finds no `setTimeout`,
`setInterval`, `JobPort`, `cron`, `enqueue`, `escalate`, `expiresAt`, `businessDay`, `workingDay`,
`roleDirectory` or `externalApprover` in executable code in any of the five layers — and this audit
now proves that scan is capable of finding each of them (§17).

**Escalation remains deferred**, as D-16C-07 defined it: a bounded, idempotent command that would add
an approver, never replace one, never restart a clock. It is not built. Nothing in the tree says
overdue escalates automatically; the Admin notice says the opposite in words, and a test requires
those words rather than merely permitting them.

---

## 10. 16B regression

Every 16B invariant suite passes unchanged in the uncached run. Spot-audited against the tree:

**Groups** — tenant-scoped by policy; explicit membership list; mutable with no lifecycle; snapshot at
instance start; later edits do not alter running approvals; a removed member may still decide a step
already created; a newly added member receives no historical step.

**Parallel branches** — a repeated ordinal is a branch; `workflow_step_awaiting_idx` is a **plain**
partial index rather than a unique one, which is what permits several awaiting steps on one approval;
one decision per step; branches isolated.

**Tally** — denominator is `assigned`; majority is `floor(assigned / 2) + 1`; a tie is not approval;
quorum gates evaluation without itself approving; first-response deterministic; one delegated decision
is one vote; no weights, no percentages, no fractions. The module-wide audit separately proves no
proportion or floating-point value is computed anywhere in the module.

**Conditions** — `all-of` only; supported operators only; instance context only; a missing key is not
`false`; an unsupported or mismatched operand remains a refusal; an unevaluable condition never
completes an approval.

**Append-only** — `workflow_decision_no_mutation` and `workflow_history_no_mutation` triggers are both
present and both enforced; update, delete and restore are all refused.

---

## 11. Cross-module boundary

**The only new completed-module dependency is the Identity contract D-16C-04 authorized.** Workflow's
package imports nothing from `@work/identity`, `@work/employment`, `@work/organization` or
`@work/recruitment` — verified over the source, so a type-only import would fail too. The adapter in
`apps/api` is the single composition boundary.

The three reads, and the permission each holds:

| # | Query | Permission |
| --- | --- | --- |
| 1 | `identity.primary-employment-for-membership` | `identity.employment-link.read` |
| 2 | `employment.read-employment` | `employment.employment.read` |
| 3 | `identity.active-memberships-for-employment` | `identity.employment-link.read` |

Both Identity queries are guarded by the **pre-existing** `identity.employment-link.read`. **No
permission was added anywhere in 16C.** `identity.membership.read` is not granted, asserted by name
in the composition spec and again in this audit by reading the elevation record: one resolution spends
exactly three elevations carrying exactly two distinct permissions, and `identity.membership.read` is
not among them. No wildcard and no prefix grant exists.

The tenant is **ambient** — no tenant identifier is accepted from any caller, and the adapter refuses
outside a tenant context before asking anybody.

**An infrastructure failure raises; it never becomes a business refusal.** Reporting an Identity
outage as "you have no manager" would send an administrator to fix a reporting line that is correct.
A business *absence* — no link, no manager, no member — is an outcome, because it is a fact about the
organization rather than about the system.

---

## 12. Security and RLS

Audited as `workflow_benchmark_role`, proved `rolsuper = false, rolbypassrls = false` **before any
isolation result was believed**, and separately as the API application role in the cross-module
suites.

All **nine** Workflow tables: RLS **enabled** and **forced**, exactly **one permissive `ALL` policy**
each, `USING (tenant_id = app_current_tenant())` and `WITH CHECK (tenant_id = app_current_tenant())`
— both predicates present on all nine, read from `pg_policies` in this audit.

Cross-tenant invisibility holds at every tier for definitions, versions, instances, steps, decisions,
history, approval groups, group members and step templates, **through the production repositories**
and using identifiers the two tenants deliberately share. Totals are tenant-scoped: the neighbour's
history total is 0 and its subject search returns its own single row rather than both. Composite
tenant-aware foreign keys are intact — a member of tenant B attached to tenant A's list is refused by
`workflow_approval_group_member_group_fk`, and a step template of B naming A's list by
`workflow_step_template_group_fk`.

---

## 13. API

**Recomputed from source, not from the Checkpoint 8 report:**

| | Counted | Expected |
| --- | --- | --- |
| Routes | **22** (10 `@Get`, 11 `@Post`, 1 `@Delete`) | 22 |
| Commands | **12** | 12 |
| Queries | **10** | 10 |
| Permissions | **9** | 9, unchanged |

No route was added in 16C. No actor identity and no tenant is accepted in any body, query or header.
`approverKind` is accepted from nobody: manager routing rides on the boolean
`routeToRequestersManager`, and the server derives the kind.

Every forbidden input is a **400**: fractional count, zero, negative, string count, half-supplied
object, `minutes`, `weeks`, `business-days`, `dueAt`, `expiresAt`, `expired`, `breached`,
`overdueByMinutes`, `escalateAfter`, `businessDays`, `managerEmploymentId`, `managerMembershipId`,
`workforceUserId`, `platformUserId`, `roleId`. Ambiguity is a **422** carrying
`manager-membership-ambiguous`, leaving no instance, step, history row or queue entry.

---

## 14. Admin

`/workflow` remains server-rendered and read-only: no `use client`, `useState`, `useEffect`,
`useRouter`, `onClick` or `window.`, and no `<form>`, `<button>`, `<input>`, `<select>`,
`<textarea>`, `<dialog>`, `onsubmit` or `href=` in the rendered page. **16 sections**, counted from
source.

Rendered: manager configuration (kind, and two deliberately empty approver cells with a notice
explaining why); the runtime membership in full; the snapshot notice; the service-level target; the
due instant; the state; the overdue minutes; and 16B's groups, branches, tallies, conditions, direct
and delegated decisions, both queues and the timeline.

**No manager resolution request occurs from Admin** — no request path contains `manager`,
`reporting`, `sla`, `service-level`, `routing`, `escalation`, `expiry`, `asOf` or `now=`, and no
request names a person. **No SLA arithmetic occurs in Admin** (§7). **No expiry or automatic-
escalation claim occurs**: one test forbids `remind`, `escalat`, `expire`, `notif`, `automatically`,
`business day` and `continuously` inside the *claims*, and a second **requires** those words inside
the *denials* — without which a catalogue that simply stopped mentioning reminders would pass.

---

## 15. Request budget and N+1

Unchanged and re-proved, now against fixtures that carry manager steps and service levels:

| Tenant | Requests |
| --- | --- |
| Empty | **5** |
| One of everything | **10** |
| Fifty rows in every listing | **10** |
| First service read fails | **1**, and the page reports unavailable |

Manager steps trigger no additional request; service-level fields trigger none; group members are one
detail read for fifty groups; branches are rows of a read that already happened. **No request count
scales with rows.**

---

## 16. Localization and exactness

`?lang=en` → English + `ltr`; `?lang=ar` → Arabic + `rtl`; unknown language → English + `ltr`. No raw
locale key and no hard-coded English survives on the page. All **17** catalogue sets are complete.

Every 16C key carries real Arabic script *and* appears in rendered markup — a key translated but
never rendered fails, and one rendered but untranslated fails. The service-level vocabulary is three
values in both languages (`بلا هدف` / `ضمن الهدف` / `متأخر`) and `approverKind.manager` is
`مدير مقدّم الطلب`.

Identifiers are unchanged between languages, membership UUIDs render in full (asserted alongside the
fact that two fixture UUIDv7s share their first eight characters, which is what made truncation
dangerous), integers stay exact, no Arabic-Indic conversion occurs, and instants are UTC-pinned by one
formatter — with a fixture instant chosen so that a dropped pin would attribute a decision to a
different day.

---

## 17. Negative space

The module-wide scan reads **every** production file of all five layers, discovered from the
filesystem, with block comments, line comments and string literals stripped. It finds none of:
scheduler, timer, cron, `JobPort`, worker, outbox, broker, `enqueue`, notification delivery,
automatic escalation, automatic expiry, business-day calculation, role directory, dynamic group
directory, external approver, analytics, portal, live manager resolution or recursive traversal.

**And the scanner is now proved capable, which it was not before.** This audit feeds each forbidden
term to the same strip in three positions — as code, inside a comment, inside a string — and requires
that it be found in the first and lost in the other two. That is the exact discrimination the real
audit depends on, and a careless regex loses it in either direction. Two further controls: the file
list is non-empty and the stripped text still contains `managerOf` and `serviceLevelState` while
containing none of this module's voluminous prose; and the same pass that finds no `escalate` **does**
find `resolveManager`, `overdueByMinutes`, `awaitingAt` and `dueAt` — which is how "the capability is
absent" is distinguished from "the audit read nothing".

---

## 18. Performance

Real PostgreSQL, an isolated database, the production repositories and mappers, the unprivileged
`workflow_benchmark_role` (`rolsuper=false`, `rolbypassrls=false`), RLS enabled and forced, two
tenants at every tier sharing membership identifiers, `vacuum analyze` before measuring, no sleeps and
no fake timers. Budgets are Phases 13–15', unchanged; **no budget was invented or moved.**

Rows per tenant at tier C: 100,000 instances · 220,000 steps · 140,000 decisions · 320,000 history ·
36 templates · 40 groups · 200 members.

| Workload | Budget | A (500) | B (10k) | C (100k) |
| --- | --- | --- | --- | --- |
| definition listing (active) | 100 | 24.2 | 15.7 | 15.2 |
| definition lookup by id / code | 100 | 2.3 / 2.0 | 1.7 / 1.8 | 1.4 / 1.5 |
| versions for one definition | 100 | 4.2 | 3.1 | 2.5 |
| current published version | 100 | 1.9 | 1.5 | 1.6 |
| step templates for one version | 100 | 2.7 | 2.4 | 1.8 |
| **instance listing (all)** | 100 | 6.3 | 15.9 | **124.0 — MISSED** |
| instance listing (running) | 100 | 4.0 | 4.0 | 13.8 |
| instances by subject | 100 | 2.9 | 2.6 | 2.3 |
| open approval for a subject | 100 | 1.9 | 1.6 | 1.5 |
| instance lookup by id | 150 | 1.6 | 1.5 | 1.3 |
| instance detail (4 reads) | 150 | 4.2 | 4.0 | 4.5 |
| steps for one approval | 150 | 1.7 | 1.6 | 1.6 |
| timeline for one approval | 150 | 3.1 | 2.4 | 3.0 |
| **pending queue for one member** | 100 | 2.5 | 4.3 | **3.8** |
| decided approvals for one member | 100 | 2.4 | 3.3 | 6.8 |
| approval status (3 reads) | 150 | 3.2 | 3.2 | 3.3 |
| approval group listing | 100 | 5.4 | 2.9 | 3.7 |
| group lookup by code / id | 100 | 1.8 / 3.1 | 1.4 / 1.3 | 1.7 / 2.3 |
| members of one group | 100 | 2.4 | 2.2 | 2.6 |
| **`membersOfAll`** (one statement) | 100 | 4.3 | 5.0 | **3.2** |
| steps of a branched approval | 150 | 2.0 | 3.3 | 2.0 |
| branched approval detail (3 reads) | 150 | 3.6 | 4.0 | 2.8 |
| queue for a branch approver | 100 | 2.4 | 5.9 | 4.9 |
| cohort: 200 subjects | 2k / 10k / 60k | 126.9 | 149.9 | 112.2 |

**One miss: the unfiltered instance listing at tier C, 124.0 ms against 100 ms.** It counts the whole
tenant to produce an exact total. This is the **same workload 16B recorded at 91.4 ms** and flagged as
debt item 3 — "met, but only just". It is not caused by 16C: `workflow_instance` gained no column this
phase, and the reads that *do* carry 16C's columns are the queue (3.8 ms) and the detail read (4.5 ms)
at a hundred thousand approvals. Recorded as **technical debt**, unfixed, per §21's instruction.

**16C's own cost is not visible at any tier.** The three columns ride on rows the same reads already
fetched, and manager resolution does not happen during listing — the membership is already on the step.

---

## 19. Query plans

**The manager path had no plan coverage at all**, in any module: Workflow has a plan suite for its own
reads, and neither Identity nor Employment plans this path because in neither module is it a path
anybody walks. A resolution happens on every approval that starts, so a sequential scan on the way
would be paid by every requester in the tenant. Now captured, as the unprivileged role, on a
connection genuinely inside the tenant:

| Read | Plan |
| --- | --- |
| Requester's primary employment link | `Index Scan using employment_link_one_primary_key`, `Index Cond: (tenant_id = … AND membership_id = …)` |
| Primary reporting line in force on the date | Index scan with the tenant inside the index condition |
| Who holds the manager's employment (the one join) | Index scan on both sides; tenant inside the driving condition; no `Materialize` |

All three: index reached, **tenant inside the index condition** rather than filtered above the scan,
no `Seq Scan`, and — the assertion that makes the rest mean anything — no node reads `never executed`.
That last one is a trap this audit fell into and corrected: a plan captured without
`set_config('app.tenant_id', …)` collapses the policy to a false `One-Time Filter`, and every node is
skipped. Such a plan describes a query that touched no page, and would have passed the other three
assertions.

**Plans are audited for reachability, not for which index wins.** That is
`workflow-schema-boundaries`' own written rule: at fixture size two indexes that can both answer a
predicate cost the same, and naming one pins a tie-break rather than a property. Workflow's own eight
plan assertions pass unchanged: the queue index, the status search, the subject index, the
definition-by-code lookup, the published-version choice, the timeline order, the decider index, and
the tenant policy visible in every plan. Pagination pushes `LIMIT`, and counts use the same predicate
as the rows. **No index is reachable but unused**, so nothing is recorded as index debt.

---

## 20. Database and mapper parity

**9 tables. 23 migrations. Recomputed from the live catalogue.**

| Table | 16C columns |
| --- | --- |
| `workflow_step_template` | `service_level_count` (integer), `service_level_unit` (varchar) |
| `workflow_step` | `service_level_count`, `service_level_unit`, `awaiting_at` (timestamptz) |

A template has **no** `awaiting_at`, because nothing waits on a template.

**Absent, verified by pattern rather than by list**: querying every Workflow column matching
`due|expir|breach|escalat|manager|employment|overdue|elapsed|business|notif|schedul|job|cron|timer`
returns **nothing**. So there is no `due_at`, no `expired`, no escalation column and no
`manager_employment_id`.

Constraints: both `*_service_level_check`s enforce both-or-neither, `count >= 1`, and a unit in
`('hours','days')` with no business day; both counts are `integer`, never `numeric` or `real`, so no
rounding rule is implied by the storage.

**Mapper parity** is Checkpoint 5's four-direction audit, passing: every domain column the database
has is mapped, and the three 16C columns are mapped on both tables that carry them. This audit adds
the opposite direction — that a column the phase *refused* to create was never created — and a live
round-trip through the production mappers under benchmark load: a manager template comes back naming
nobody, its running step comes back naming a person, and the target comes back a whole number with the
awaiting instant a `Date`.

---

## 21. Concurrency

Real PostgreSQL races, no sleeps and no fake timers: same-step decision race, parallel decisions on
one approval, duplicate group member, group code race, **manager snapshot versus a reporting-line
change**, decision versus cancellation, duplicate subject, and tenant-isolated concurrent writes. All
pass. Append-only behaviour holds for decisions and history under concurrency, enforced by trigger
rather than by convention.

---

## 22. Test reconciliation

Uncached, serial, whole repository:

| Package | Tests |
| --- | --- |
| kernel · config · persistence · testing | 150 · 20 · 20 · 23 |
| identity | 171 |
| employment | 132 |
| recruitment | 74 |
| **workflow** | **672** |
| organization · people · career · learning | 141 · 168 · 294 · 235 |
| performance · compensation · payroll · leave | 127 · 122 · 80 · 71 |
| attendance · documents · onboarding · letters | 95 · 92 · 46 · 77 |
| **api** | **690 → 717** |
| **admin** | **246** |

**Change from the Checkpoint 9 baseline: +27, all in `@work/api`, all added by this audit** — 6 in
`workflow-audit.routing.spec.ts` and 21 in `workflow-audit.phase-16c.spec.ts`. No other count moved,
which is the expected result of an audit that changed no production code.

**0 failed · 0 skipped · no `.only` · no `any`.** The only `it.only` and `describe.only` strings in the
repository are inside the two suites that *forbid* them.

---

## 23. Defect classification

| # | Finding | Class |
| --- | --- | --- |
| B-1 | `measure-workflow-performance.mjs` declared the template approver-kind vocabulary as `['membership','group']`; the database says `['membership','group','manager']`. The harness refused to run. | **Benchmark defect** — fixed |
| B-2 | The benchmark seeded no manager template, no target and no awaiting instant, so it measured a schema as it stood before this phase and never read the three new columns back. | **Benchmark defect** — fixed |
| T-1 | The snapshot rule's second half — a newly started approval resolves to the **new** manager — was asserted nowhere. | **Test defect** (coverage gap) — closed |
| T-2 | The negative-space scanner had no positive control: a broken strip or an empty file list would have made every absence assertion pass forever. | **Test defect** — closed |
| T-3 | The manager path — three cross-module reads on every approval start — had no query-plan coverage in any module. | **Test defect** — closed |
| D-1 | The Checkpoint 10 brief names `1412cbf` (Checkpoint 8) as the last implementation commit; it is `47484aa`. | **Documentation defect** — recorded, not corrected here |
| L-1 | Tier C unfiltered instance listing, 124.0 ms against a 100 ms budget. Same workload 16B recorded at 91.4 ms and flagged. Not caused by 16C. | **Technical debt** — unfixed |
| L-2 | A two-day target elapses across a weekend. Stated consequence of D-16C-05. | **Expected limitation** |
| L-3 | A "one day" target is twenty-four hours, not the same clock time tomorrow; across a daylight-saving change these differ by an hour. | **Expected limitation** |

**No production defect was found.** B-1 and B-2 are in the benchmark harness, which §1 places in
scope; T-1 to T-3 are audit tests verifying behaviour that was already correct; nothing in the domain,
application, repository, schema, API, Admin, Identity or Employment was changed.

*Worth naming:* B-1 is the harness's parity check working exactly as designed. It refused to run
against a database whose vocabulary had moved under it — which is what a parity check is for, and the
reason the drift was found here rather than shipped.

---

## 24. Gates

| Gate | Result |
| --- | --- |
| `pnpm standards` | no violations · 176 models · 17 catalogues · 1,710 files, no cycles |
| `pnpm format:check` | clean |
| `pnpm lint` | 47/47 |
| `pnpm typecheck` | 47/47 |
| `pnpm build` | 27/27 |
| `prisma validate` | valid |
| `prisma migrate status` | **23 migrations**, up to date |
| `turbo run test --force --concurrency=1` | uncached, serial, **47/47**, 0 failed, 0 skipped |

0 `.only` · 0 `any` · 0 disabled lint rules · 0 unhandled errors.

---

## 25. NOT VERIFIED

Unchanged from Checkpoint 9, and asserted as absences rather than assumed:

Automatic escalation · scheduler · `JobPort` adapter · worker · cron · timer · queue · outbox ·
broker · notification delivery · automatic approval expiry · expiry timer · countdown · business-day
targets · Organization calendar dependency · role approvers · role directory · external approvers ·
dynamic group directory · multi-level manager chains · configurable manager depth · functional
reporting lines as approvers · automatic delegation expiry · analytics · self-service portals ·
Phase 16D.

No employment identifier, reporting-line identifier, department, organizational unit, manager chain,
role or directory information reaches any API response or any screen, and no endpoint publishes one.

---

## 26. Technical debt

1. **Tier C unfiltered instance listing: 124.0 ms against 100 ms.** Carried from 16B, where it
   measured 91.4 ms. The cost is the exact total over the whole tenant. Two ways out exist and both
   are decisions rather than fixes — keyset pagination, or an approximate total for an unfiltered
   listing — so neither was taken here.
2. **The cohort read has no cohort filter.** Two hundred subjects cost two hundred lookups; the
   benchmark measures what the absence costs rather than pretending a filter exists. Carried from 16B.
3. **`infrastructure/workflow-seed.ts` uses `now()`** and sits in the production file list although it
   is a seeding utility. Harmless — it is on no read or resolution path — but it is the one place the
   module's "no clock in production" claim needs a footnote.
4. **The benchmark and the repository plan suites must not share a database.** `vacuum analyze` writes
   statistics that `truncate` does not remove. This audit used a separate `work_bench` database for
   exactly that reason; the constraint is documented in the harness and is still a manual one.

---

## 27. Remaining Phase 16C closure

Not started, and deliberately out of this checkpoint's scope:

- The Phase 16C final report.
- Updating `docs/PHASES.md` — including C-5, the contradiction Checkpoint 1 recorded, where the
  document over-states 16C's scope.
- Updating `RELEASE_NOTES.md` and `DOMAIN_OWNERSHIP.md`.
- Amending AD-005 and the specification for D-16C-03, which approved role approvers remaining
  `NOT VERIFIED` **and** the documentation being reconciled to say so. The code side is done; the
  documentation side is closure work.
- Phase 16D — Time in Workflow, which D-16C-14 holds until 16C is complete and closed.

---

**Phase 16C Checkpoint 10 is complete. No production defect was found. Phase 16C closure has not
begun, and Phase 16D has not begun.**
