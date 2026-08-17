# Phase 16C — Checkpoint 7 — Workflow reporting-line adapter

**Scope.** The adapter that makes `ReportingLinePort` real, the two approved parameters it needed, and
the production wiring. No schema change, no migration, no API route, no Admin screen, no Organization
change, no Recruitment change.

Migration count unchanged at 23.

---

## 1. The two blockers, approved and recorded

Checkpoint 7 stopped before implementation on two of its own stop conditions
([`phase-16c-adapter-blockers.md`](./phase-16c-adapter-blockers.md)). Both were approved on
2026-08-17 and recorded in [`phase-16c-plan.md`](./phase-16c-plan.md) **§7C before any code was
written**.

**B-1 — an employment with two active holders.** `ManagerResolution` gained a fifth outcome,
`manager-membership-ambiguous`, failing closed. It is deliberately **not**
`manager-not-a-member`: that one means nobody holds the job, this one means two people do, and
reporting the second as the first would send an administrator to link somebody to an employment that
already has two members linked to it. Zero holders keeps the existing semantics, exactly one
resolves, two or more refuses.

**B-2 — requester membership → primary employment.** A second narrow Identity query,
`identity.primary-employment-for-membership`, under the **existing** `identity.employment-link.read`.
Not `identity.membership.read`: reaching the same fact through `identity.describe-member` would have
handed the approvals engine the tenant's member register — profile, preferences, portals, links and
delegations — to read one identifier.

The cross-module read budget was amended from two to three, which is what the chain costs across
three module boundaries.

---

## 2. The adapter

`apps/api/src/workflow/workflow-reporting-line.ts` — `WorkflowReportingLine implements
ReportingLinePort`. One public method, following `WorkflowDelegations` in every respect: dispatcher
through `Asking` (read-only — it cannot send a command), one `runWithServiceGrant` per call with an
explicit `permits` list, ambient tenant, and failures that raise rather than becoming refusals.

```text
requester membership
  → identity.primary-employment-for-membership   P-2: primary, and still linked
  → employment.read-employment(asOf)             P-3, P-4: primary line, one level, on the date
  → identity.active-memberships-for-employment   who may actually sign
  → ManagerResolution
```

**No Identity or Employment internals cross the boundary.** The adapter imports three published view
types and nothing else — no Prisma model, no repository, no SQL, no table name.

---

## 3. Manager semantics

Unchanged, and none of it is decided in the adapter:

- **P-2** is Identity's own `primaryFor` predicate — `is_primary` **and** `status = 'linked'`. A job
  somebody left keeps its flag until another is promoted, so the pairing is one predicate more than
  the name suggests.
- **P-3 and P-4** are Employment's. `EmploymentView.managerEmploymentId` is *"the manager in force on
  `asOf`, by employment"*, resolved from the **primary** lines alone through `inForceOn`. The adapter
  neither re-derives it nor looks past it: reading `reportingLines` and choosing would be a second
  definition of P-3, and following the answer upwards again would be the recursion P-4 forbids. A
  functional line produces no manager at all, asserted end to end.
- **Self-manager** reaches the domain rather than being decided here. `resolveManager` compares the
  resolved membership with the requester's and refuses with `manager-is-the-requester`. Splitting
  that rule across two layers would put half of it where nothing tests it against the approval it
  protects.

---

## 4. Ambiguity

Two holders is a refusal, and the adapter picks neither. There is no ordering in that branch, no
index into the list, no `isPrimary` — which is unique per *membership*, so both holders may carry it
— and no preference of any kind. Asserted three ways: two holders refuse, three holders refuse
identically, and **the same two reversed give the same answer**, which is what "no ordering" means as
an assertion rather than as a comment. A fourth test pins ambiguity and absence apart.

---

## 5. Effective dating

`asOfDate` arrives from `resolutionDateOf`, which pins the approval's own start instant to a UTC
civil date (P-6). The adapter converts it back to an instant at UTC midnight — `Date.parse` of a bare
date string is defined to be UTC, the same convention that produced the string, so the round trip is
exact and no local zone is involved at either end. Nothing here reads a clock.

Asserted over the real timeline: a line beginning after the approval yields no manager, a line that
ended before it yields no manager, and a line whose period contains it resolves.

---

## 6. Snapshot

Resolution happens **once**, when the instance starts. The adapter is not involved afterwards, and
that is asserted rather than argued: after a running approval exists, the reporting line is moved to
somebody else and the step still names the original person; the manager's membership is ended and the
step still names them; and reading the approval enters **no service grant at all**, so neither
Identity nor Employment is consulted.

---

## 7. Authorization

Two permissions, both existing, both employment-scoped: `identity.employment-link.read` (twice, at
the two ends of the chain) and `employment.employment.read`. No permission was created and none was
widened.

The composition audit was rewritten in both directions and now pins **six grants of five
permissions** across three adapters, by exact `permits` list, with no wildcard, no prefix, no grant
permitting two things at once — and an explicit assertion that `identity.membership.read` appears
nowhere. The contract audit pins the six published queries and commands the three adapters may reach,
and its forbidden list gained `identity.describe-member`, `employment.search` and
`employment.export-workforce`.

---

## 8. Tenancy

The tenant is ambient and there is no argument through which a caller could supply one — `managerOf`
takes a membership and a date. `runWithServiceGrant` refuses a grant entered without a tenant
**before either module is asked**, asserted directly rather than left as something the other tests
happen to satisfy.

End to end, under a role asserted `rolsuper = false`, `rolbypassrls = false`: two tenants naming the
**same** employment identifier each resolve their own holder, and tenant B fails closed rather than
reaching across to find A's manager.

---

## 9. Performance

At most three cross-module reads, and fewer when an earlier answer settles it:

| Case | Reads |
| --- | --- |
| resolves | 3 |
| no primary employment | **1** |
| no manager on the line | **2** |

Short-circuiting is asserted by counting the recorded queries, not inferred. Asking a later question
after an earlier one has failed is how a chain acquires a fallback nobody approved — and the second
Identity read would otherwise be asking who holds employment `undefined`. No loop, no pagination, no
enumeration, no recursion, and a test that pins the query count at exactly three when it resolves.

---

## 10. Production composition

`workflow.composition.ts` supplies `reportingLine: new WorkflowReportingLine(reader)` — the same
read-only `Asking` the delegation adapter gets, so this seam cannot write to anything.

**`WorkflowDependencies.reportingLine` is now required**, as Checkpoint 4's own comment said it would
be. `WorkflowDependencies` has no optional field again, which is the property the composition doc has
relied on since 16A: a dependency cannot be forgotten quietly. Processes with no manager step are
unaffected and make no cross-module call at all, asserted.

The two Checkpoint 4 tests that built an unwired composition were **rewritten rather than deleted** —
the case they described can no longer occur, which is a stronger guarantee than the refusal they
asserted. `manager-not-resolved` itself is untouched and still covered in the domain suite, where it
belongs: it is the caller defect of planning a manager step without reading the chain.

---

## 11. Files

**New (4)** — `workflow-reporting-line.ts` (the adapter), `workflow-reporting-line-adapter.spec.ts`
(17), `workflow-manager.cross-module.spec.ts` (18), `workflow-manager-refusals.cross-module.spec.ts`
(split at budget).

**Changed** — Identity: `identity-queries.ts`, `identity-module.ts` (B-2). Workflow:
`domain/manager.ts` (B-1), both locale catalogues, `workflow-dependencies.ts`,
`workflow-test-harness.ts`, `index.ts`, and two test suites. `apps/api`: `workflow.composition.ts`,
`workflow.composition.spec.ts`, and the three cross-module fixtures.

---

## 12. Regressions

**Recruitment untouched.** No file under `src/recruitment` changed, and its cross-module seam suites
pass unchanged. The manager suite deliberately uses the **unadopted** subject type: routing to a
manager and delivering a terminal decision are two different seams, and using a requisition would
have made every decision in the file depend on Recruitment having a matching row.

**Organization untouched.** No calendar, time-zone or business-day query exists or was added — the
UTC rule is exactly why none is needed.

---

## 13. Negative space

The Workflow module audit and the composition audit both still forbid `RoleDirectory`,
`GroupDirectory`, `ManagerDirectory`, `OrganizationChart`, `WITH RECURSIVE`, `JobPort`, `scheduler`,
`cron`, `setTimeout`, `setInterval`, `outbox`, `notify`, `escalat`, `expiresAt`, `businessDay`,
`workingDay`, `roleId`, `reportsTo`, `roleDirectory` and `externalApprover`. Nothing left those lists
in this checkpoint. No Organization dependency, no Platform authentication dependency, no schema
change, no migration.

---

## 14. Tests

| Suite | Tests |
| --- | --- |
| `workflow-reporting-line-adapter.spec.ts` | 17 — composition, order, arguments, short circuits, ambiguity, self-manager, failure semantics, tenancy |
| `workflow-manager.cross-module.spec.ts` | 8 — resolves, queue, decision, two snapshot cases, no re-resolution, tenant boundary, unprivileged role |
| `workflow-manager-refusals.cross-module.spec.ts` | 10 — five refusals, functional line ignored, nothing written, three effective-dating cases, same-identifier isolation |
| Domain and application | ambiguity added to the refusal tables; the pair kept explicitly distinct |

Nothing skipped, no `.only`, no `any`, no `eslint-disable`, no test deleted or weakened.

---

## 15. Gates

| Gate | Result |
| --- | --- |
| `pnpm standards` | no violations · 176 models · 17 catalogues · 1,701 files, no cycles |
| `pnpm format:check` | clean |
| `pnpm lint` | 47/47 |
| `pnpm typecheck` | 47/47 |
| `pnpm build` | 27/27 |
| `pnpm prisma validate` | valid |
| `pnpm prisma migrate status` | 23 migrations, up to date |
| `turbo run test --force --concurrency=1` | uncached, serial, 0 failed, 0 skipped |

---

## 16. NOT VERIFIED

Automatic expiry, escalation execution, business-day SLA, role approvers, external approvers,
notifications, analytics, portals, and any scheduler, job, outbox, worker or timer. No API route or
Admin screen exposes the manager approver yet — that is Checkpoint 8.

---

**Phase 16C Checkpoint 7 is complete. Checkpoint 8 has not started.**
