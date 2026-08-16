# Phase 16C — Checkpoint 6 — Identity cross-module contract

**Scope.** One narrow published query on Identity, and nothing else. No schema change, no migration,
no index, no new permission, no Workflow change, no Organization change, no adapter.

---

## 1. What was authorized, and what this checkpoint built

D-16C-04, as approved on 2026-08-16 and recorded in
[`phase-16c-plan.md`](./phase-16c-plan.md) §7A:

> **Authorized.** One narrow Identity contract resolving **employment → active membership**. Identity
> remains the owner of the fact. No broader directory or query capability.

That is exactly what exists now:

```
identity.active-memberships-for-employment { employmentId }
  → readonly TenantMembershipView[]
```

Guarded by `identity.employment-link.read`, which already existed and already means this.

---

## 2. One divergence from the checkpoint brief, stated plainly

The brief's §3 and §8 describe a **single Identity query answering the whole chain** — requester
membership → primary active employment → primary reporting line → manager employment → active
manager membership. That query cannot be Identity's, for a reason that is structural rather than a
preference:

**Identity does not own the reporting line, and cannot read it.** `employment_reporting_line` is
Employment's table (Phase 5). Identity is Phase 2 and depends on `@work/kernel` and
`@work/persistence` and nothing else. To answer the chain it would have to take a dependency on
`@work/employment` — inverting the layering, and breaking the boundary Identity's own contracts file
exists to defend: *"the moment a second module reads `tenant_membership` directly the boundary stops
being a boundary."* Reading another module's tables in the other direction is the same failure.

It is also unnecessary, because **the middle of the chain is already published and already correct**:

| Link | Owner | Status |
| --- | --- | --- |
| requester membership → their employment links, with `isPrimary` and `status` | Identity | published — `identity.describe-member` |
| employment + `asOf` → the **primary** manager employment in force on that date | Employment | published — `employment.read-employment`, resolved through `inForceOn` |
| manager employment → active membership | Identity | **was missing — built here** |

So the chain is composed by the **Workflow adapter in Checkpoint 7** from three published answers,
which is what the Definition of Ready's own checkpoint list says: checkpoint 6 is *"the Identity
query"*, singular, and checkpoint 7 is *"Workflow's port and the adapter in `apps/api`"*.

I implemented the approved decision rather than the brief's wider reading, and flag it here rather
than resolving it silently. Building the chain inside Identity would have been a completed-module
change far beyond the one authorized.

---

## 3. The data path

```
employment_link  (tenant_id, employment_id) ── join ──▶  tenant_membership
   status = 'linked'                                       status = 'active'
   deleted_at is null                                      deleted_at is null
```

One SQL statement, in `TenantMembershipRepository.activeForEmployment`. The tenant comes from
`transaction.tenantId`; the employment is the only bound argument the caller supplies.

**Two predicates that mean different things.** A *linked* link says the job is still theirs. An
*active* membership says they may act at all — `isActingMembership`'s rule, restated in SQL because
that is where the predicate has to run. A suspended or ended member still holds their link, and
returning them would tell a consumer that somebody could sign when they cannot.

---

## 4. Manager semantics, and what Identity deliberately does not know

Identity does not know what a manager is. It resolves no reporting line, walks no chain, takes no
depth and has no `asOf` parameter — because the effective-dated part of the question belongs to
Employment, which already answers it. The negative-space suite asserts that `managerOf`,
`reportingLine`, `reportsTo`, `RoleDirectory`, `ManagerDirectory`, `OrganizationChart`, `recursive`
and `WITH RECURSIVE` appear nowhere in Identity's application source.

**P-1 to P-4 are therefore satisfied elsewhere and unchanged:** the requester (P-1) and their primary
active employment (P-2) come from Identity's existing published data; the primary reporting line
(P-3) and exactly one level (P-4) come from Employment's `read-employment`, which filters
`lineType === 'primary'` and returns a single `managerEmploymentId`.

---

## 5. Effective dating

Not this query's, and that is the correct answer rather than an omission. The `asOf` civil date is
consumed by `employment.read-employment`, which already takes `asOf: Date` and resolves the line in
force on it through `inForceOn`. Identity's link status is a lifecycle fact, not an effective-dated
one — `linked` or `unlinked`, with no period to interpret — so there is no date for this query to
honour and none for it to invent. Nothing here reads a clock, calls `now()` or `CURRENT_DATE`, or
consults a server time zone; the same input gives the same result, asserted.

---

## 6. The four refusals remain representable

Workflow's `resolveManager` distinguishes four outcomes. None of them is collapsed by this contract:

| Workflow outcome | Distinguished by |
| --- | --- |
| `manager-no-primary-employment` | Identity's existing published employment links — the requester has no primary active one |
| `manager-not-assigned` | Employment returns no `managerEmploymentId` for the date |
| `manager-not-a-member` | **this query returns an empty list** for an employment that plainly exists |
| `manager-is-the-requester` | the adapter compares the returned membership with the requester's |

"There is no manager" and "the manager cannot sign" arrive from **two different modules**, so they
cannot be confused with one another. And the self-manager case is doubly covered: the database
already refuses one at the employment level —
`employment_reporting_line_not_self_check :: CHECK (manager_employment_id <> employment_id)` — so the
only way to reach it is one person holding two employments, which is exactly the membership
comparison Workflow's domain already performs.

*Note on naming:* the brief's §14 calls this refusal `manager-self-reference`. The name shipped in
Checkpoint 2 and in the locale catalogues is **`manager-is-the-requester`**. I used the name that
exists rather than renaming a shipped refusal.

---

## 7. A list, and never a chosen one

`employment_link` is unique per `(membership, employment)` pair. Nothing prevents one job being
linked to two memberships, and the domain does not refuse it. So the query returns **every** active
holder it finds, in identifier order, and picks none of them.

Collapsing two candidates to the first — a `limit 1`, or an ordering by `linked_at` — would be a
routing rule invented inside a read by whoever wrote it. **If a consumer meets two holders, that is a
decision nobody has taken**, and it is flagged here for Checkpoint 7 rather than answered by this
contract. Both the repository and the in-memory fake return the full set, and a test asserts it.

---

## 8. Authorization

`identity.employment-link.read` — **existing**, and semantically exact: who is linked to what. No
permission was created, none was widened, and nothing named `workflow.*` or `directory.*` was added.

Asserted both ways: a caller holding that permission and the two management permissions the fixture
needs succeeds; a caller holding **every other Identity permission** and not this one is refused.

---

## 9. Tenancy and RLS

The tenant is never a parameter — `activeForEmployment` reads `transaction.tenantId`, and there is no
argument through which a caller could name another tenant. Row-level security refuses the rows a
second time underneath.

Proven under a role asserted in the suite to be `rolsuper = false`, `rolbypassrls = false`:

- a holder in tenant A does not resolve in tenant B;
- **the same employment identifier in both tenants** resolves to each tenant's own holder and neither
  sees the other's — an employment identifier is opaque to Identity and nothing stops two tenants
  recording the same one;
- a link row in tenant A naming a membership row in tenant B resolves to nothing.

No policy was weakened and no bypass added.

---

## 10. Performance

One statement, no pagination, no enumeration, no recursion, no N+1. The plan is taken from the
statement the repository actually issued, **against a table with a few thousand rows in it**:

```
Nested Loop
  ->  Index Scan using employment_link_employment_idx on employment_link el
        Index Cond: ((tenant_id = $1) AND (employment_id = $2))
  ->  Index Scan using tenant_membership_pkey on tenant_membership m
        Index Cond: (id = el.membership_id)
```

**The volume is load-bearing and it caught something.** At fixture size the planner chose
`employment_link_membership_status_idx` instead — reading every linked row in the tenant and
filtering the employment afterwards, which is precisely the tenant-wide read §19 forbids and is
invisible at seven rows. With realistic statistics it drives from the employment index and fetches
the membership by primary key.

**No index was created.** `employment_link_employment_idx` on `(tenant_id, employment_id)` has
existed since Identity's own phase; the reverse direction was already indexed and only the query was
missing. The suite re-analyzes the emptied tables afterwards so it does not leave a later suite
planning against a volume that is no longer there — the leftover-statistics defect Phase 16B's
benchmarks found.

---

## 11. Boundaries held

- **Workflow** — untouched. `git status` shows no file under `packages/modules/workflow` or
  `apps/api/src/workflow`. `ReportingLinePort` remains unwired,
  `WorkflowDependencies.reportingLine` remains optional, and `workflow.composition.ts` is unchanged.
  Workflow's 669 tests pass without modification.
- **Organization** — untouched. No calendar, time-zone or business-day query exists or was added.
- **Schema** — untouched. No table, column, index, constraint or migration. `prisma/` unchanged;
  `prisma validate` passes and `migrate status` reports 23 migrations, up to date.
- **Identity itself** — the membership model, employment-link model, delegation semantics, tenant
  resolution and authorization architecture are all unchanged. Nothing was refactored or renamed.
- **API** — no controller, route or DTO. The query is reachable through the dispatcher Checkpoint 7's
  adapter will use, exactly as `identity.active-delegations-for` already is.

---

## 12. Files

| File | Change |
| --- | --- |
| `application/identity-ports.ts` | `TenantMembershipStore.activeForEmployment` |
| `infrastructure/tenant-membership.repository.ts` | the one join |
| `application/in-memory-stores.ts` | the fake, now able to see both tables |
| `application/identity-queries.ts` | the published query and handler |
| `application/identity-module.ts` | registration |
| `application/identity-employment-membership.test.ts` | new — 10 tests |
| `infrastructure/identity-employment-membership.integration.test.ts` | new — 10 tests |

Nothing crosses the boundary that should not: the handler returns `TenantMembershipView`, already
exported from `contracts/`. No Prisma model, row type, repository class or aggregate is reachable
from a consumer.

---

## 13. Tests

**Application (10)** — returns the holder · nothing for an employment nobody holds · nothing for an
unknown identifier · stops after unlinking · excludes an ended membership while its link survives ·
two holders returned in stable order and neither chosen · determinism · guarded by the exact
permission · refused for a caller holding every other permission · the query interface takes one
field and no other · no directory, chain, scheduler or timer anywhere in the source.

**PostgreSQL (10)** — the role cannot bypass RLS · returns the holder · excludes unlinked, suspended
and ended · two holders in order · determinism · three tenant-isolation shapes · exactly one
statement with two parameters and no `limit`/`ilike`/`recursive` · the plan at realistic volume.

**Identity total: 13 files, 171 tests, all passing.** No test was deleted, skipped or weakened; no
`.only`; no `eslint-disable`; no `any`.

---

## 14. Defects

None found in Identity. One latent risk was caught and designed out rather than shipped: the query's
access path is only correct once the planner has real statistics, so the plan test seeds volume
rather than asserting against an empty table (§10).

---

## 15. NOT VERIFIED

The manager chain end to end. Nothing composes the three published answers yet, and nothing in
Workflow calls this query — that is Checkpoint 7. Also unchanged and still absent: automatic expiry,
escalation, business-day targets, role routing, external approvers, notifications, analytics,
portals, and any scheduler, job, outbox, worker or timer.

---

## 16. Open question for Checkpoint 7

**What should happen when one employment has two active holders?** §7 explains why Identity does not
choose. Workflow's `ManagerResolution` carries exactly one `managerMembershipId`, so the adapter will
meet a case the approved decisions do not cover. Fail-closed is consistent with D-16C-10 and with
16B's empty-group precedent — but it is a decision, and I am flagging it rather than assuming it.

---

## 17. Gates

| Gate | Result |
| --- | --- |
| `pnpm standards` | no violations · 176 models · 17 catalogues · 1,697 files, no cycles |
| `pnpm format:check` | all files clean |
| `pnpm lint` | 47/47 |
| `pnpm typecheck` | 47/47 |
| `pnpm build` | 27/27 |
| `pnpm prisma validate` | schema valid |
| `pnpm prisma migrate status` | 23 migrations, database up to date |
| `pnpm verify --force --concurrency=1` | exit 0 |
| `turbo run test --force --concurrency=1` | 47/47 tasks, 0 cached, 0 failed, 0 skipped, 0 `.only` |

---

**Phase 16C Checkpoint 6 is complete. Checkpoint 7 has not started.**
