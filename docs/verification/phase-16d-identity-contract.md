# Phase 16D — The Narrow Identity Contract D-16D-12 Requires

**Investigation and documentation only. No implementation was performed.** No Identity, Workflow,
Prisma, API or Admin file was created or modified. No permission was invented. No query was written.

**D-16D-12 is recorded as `BLOCKED — narrow Identity contract required`.** D-16D-11 remains dependent
on it and unresolved at the implementation level. D-16D-09, D-16D-13, D-16D-14, D-16D-15 and
D-16D-16 remain approved and delivered (`2bbf019`); D-16D-10 remains approved as outside 16D;
D-16D-08 is not reopened.

---

## 1. Commit

`2bbf019` on `claude/phase-5-employment-workforce-xaxasu`. Working tree clean.

## 2. Existing Identity contracts inspected

| Artefact | Finding |
|---|---|
| `domain/identity-vocabulary.ts:42-46` | `MEMBERSHIP_STATUSES = ['active', 'suspended', 'ended']`, and **`isActingMembership(status) => status === 'active'`**, documented as *"A membership that may act now. Everything downstream — portals, delegation — asks this."* |
| `application/identity-queries.ts` | seven registered queries; four are membership-shaped (§3) |
| `application/identity-permissions.ts` | fourteen permissions, read/manage per concern; **no narrower membership permission than `identity.membership.read` exists** |
| `application/identity-ports.ts:42` | `TenantMembershipStore.byId(transaction, id): Promise<TenantMembershipState \| undefined>` — **already exists** |
| `infrastructure/tenant-membership.repository.ts:51` | `byId` delegates to `findRow` |
| `packages/persistence/src/repository.ts:62-74` | `findRow` = `select * from <table> where id = $1 and tenant_id = $2 and deleted_at is null` |
| `prisma/migrations/20260805120000_workforce_identity/migration.sql:293` | `call app_protect_table('tenant_membership')` — RLS enabled and forced |
| `contracts/membership-directory.ts` | `TenantMembershipDirectory.activeMembershipsOf(platformUserId)` — keyed by **person**, answers "which tenants", an infrastructure port and not a query |
| ADR-0043 | `runWithServiceGrant({ module, operation, permits: [...], reason })` — bounded, non-nesting, tenant-required, observable, checked **after** the user's own permission |
| `apps/api/src/workflow/workflow-reporting-line.ts:145,180,205` | the established Workflow → Identity pattern: an adapter in `apps/api` implementing a port declared in the Workflow package, each call wrapped in `runWithServiceGrant` naming an existing permission |

**The smallest data needed to answer "is this tenant membership active?"** is one field —
`tenant_membership.status` — evaluated by `isActingMembership`. Both already exist. **No new domain
logic and no new store method are required.**

## 3. Why no existing contract can serve

| Query | Permission | Why not |
|---|---|---|
| `identity.describe-member` | `identity.membership.read` | *"Everything a portal needs to render one member's page, in one round trip"* — returns `membership`, `profile`, `preferences`, `portals[]`, `employments[]`, `delegations[]`. **A permission does not narrow a payload.** Using it would put a member's delegations and employment links into the escalation write path. Explicitly forbidden. |
| `identity.list-memberships` | `identity.membership.read` | An enumeration. D-16D-16 (A) forbids enumeration. |
| `identity.search-members` | `identity.profile.read` | A directory search, requires a term, returns profiles. |
| `identity.active-memberships-for-employment` | `identity.employment-link.read` | Keyed by **employment**, returns a list. Wrong key. |

**Can an existing query be narrowed or reused?** No. Narrowing `describe-member` would change the
established meaning of a published contract that exists precisely to answer a member's whole page, and
would break its current consumers. Identity's own convention argues against reuse too — the doc on
`primary-employment-for-membership` records why it was added rather than routed through
`describe-member`: *"A consumer that needed one employment identifier would have had to hold the
register to get it."*

**A new query is unavoidable.** But it is unusually cheap: a contract and a handler over an existing
store method and an existing domain predicate.

## 4. Proposed narrow contract

Modelled directly on `identity.primary-employment-for-membership`, which is the closest existing
precedent: membership-keyed, one identifier, at most one result, no tenant argument, no list, no page,
no filter, no search term.

**Name.** Identity's convention is a noun phrase, with `-for-<key>` appended **only** when the key
differs from the subject (`active-memberships-for-employment`, `primary-employment-for-membership`).
Here the key *is* the subject, as with `describe-member`, so no suffix applies. Proposed:

> **`identity.membership-standing`**

Alternative, matching the domain's own word (`isActingMembership`): `identity.acting-membership`.
The name is the one item of this contract with no single forced answer; §12 records it.

**Request**

```
interface MembershipStanding extends Query {
  readonly queryName: 'identity.membership-standing';
  readonly membershipId: string;
}
```

**Response**

```
interface MembershipStandingView {
  readonly active: boolean;
}
```

One field. **No `status`, `linkedAt`, `deletedAt`, `tenantId`, `employmentId` or `personId`** — the
caller needs the predicate, so the contract publishes the predicate.

Publishing the *predicate* rather than the *status* is the substantive choice, not a stylistic one:
returning `'active' | 'suspended' | 'ended'` would make Workflow decide what counts as active, which
is a second definition of `isActingMembership` living in another module. Identity owns the rule and
must apply it.

**Note on convention.** No query in this repository currently returns a bare `boolean`; every one
returns a view, a list, a paged result or `X | undefined`. A one-field view keeps that convention
while exposing nothing beyond the predicate.

## 5. Permission

**`identity.membership.read` — existing, sufficient, and not broadened.**

The fact being read is a membership's own lifecycle field, which is exactly what the member-register
permission covers; unlike the employment-link case, there is no narrower permission that means this
fact, and **none is proposed**. `identity.membership.read` already guards `describe-member` and
`list-memberships`, both of which expose strictly more than this query would.

The Workflow caller never holds it. It reaches the query through ADR-0043, exactly as
`workflow-reporting-line.ts` does today:

```
runWithServiceGrant(
  { module: 'workflow', operation: 'read-membership-standing',
    permits: [MEMBERSHIP_READ], reason: '…' },
  () => asking(dispatcher, { queryName: 'identity.membership-standing', membershipId }),
)
```

The user still holds only `workflow.approval.escalate`; the grant permits one named permission for one
operation, cannot nest, requires a tenant, and is observed.

## 6. Failure semantics

Four outcomes, kept distinct — Identity's conventions already determine three of them.

| Case | Identity answers | Basis |
|---|---|---|
| **A** membership exists, active | `success({ active: true })` | — |
| **B** membership exists, `suspended` or `ended` | `success({ active: false })` | a business fact, not an error |
| **C** membership does not exist in this tenant | **`notFound('membership')`** | `describeMemberHandler` returns `notFound('membership')` for the same key; existence *is* this query's subject, so conflating it with B would lose the distinction |
| **D** infrastructure unavailable | **rejects** | `unitOfWork.execute` propagates; every query in the repository behaves this way, and D-16D-12's approval requires that Identity failure *fail the command* rather than be read as active |

**C is deliberately indistinguishable from "belongs to another tenant."** `findRow` filters
`tenant_id` explicitly *and* RLS filters it again, so a membership identifier from a neighbouring
tenant returns no row and answers `not_found`. That is the correct security property — a caller must
not be able to probe another tenant's register — and it is a consequence of the design rather than a
limitation to work around.

## 7. Bounded Workflow port

Declared in `packages/modules/workflow/src/application/workflow-ports.ts`, implemented by an adapter
in `apps/api`, alongside `ReportingLinePort` and `DelegationPort`. **Not implemented.**

| Aspect | Shape |
|---|---|
| Input | `membershipId: string` — the only caller-supplied identifier |
| Output | a small union, **separate from `ManagerResolution`**: `{ outcome: 'active' }` · `{ outcome: 'not-active' }` · `{ outcome: 'not-a-membership' }` |
| Authorization | ADR-0043 grant naming `identity.membership.read`; no user-held Identity permission |
| Tenant | ambient, from the request context; **no `tenantId` argument** |
| Failure | infrastructure failure **raises**; the command fails closed rather than defaulting to active |
| Inactive | a normal business result, not an exception |
| Missing | a business result at the port (mapped from Identity's `not_found`), so the domain can refuse by name |

**Naming is constrained by an existing audit, and the audit must not move.**
`workflow-boundaries.test.ts:146` forbids the words `directory` and `search` in the Workflow
application layer, on the stated grounds that *"a directory answers questions about people."* A port
called `MembershipDirectoryPort` would trip it — correctly, because that name would describe something
this contract must never become. **`MembershipStandingPort` with a method such as
`standingOf(membershipId)` keeps the assertion intact**, which is the right outcome: the contract is
named to satisfy the boundary rather than the boundary relaxed to admit the contract.

The domain stays pure. `escalateBranch` receives the resolved outcome as a parameter, exactly as
`resolveManager` receives `ManagerResolution` — no query from the domain, and **no fifth
manager-routing outcome invented**; this is its own union for its own question.

## 8. Identity data ownership

Confirmed. The query reads Identity's own `tenant_membership` through Identity's own store, and
Workflow asks **at command execution time**. Nothing copies, caches, mirrors or infers the status:
there is no Workflow membership table, no foreign key (ADR-0042), no cached flag, and no derivation
from another module. This also matches ADR-0070's rule — *a stored flag that nothing maintains is
worse than no flag* — and the delegation precedent, which asks at the instant rather than reading a
status.

## 9. Performance and query shape

One statement, one row:

```
select * from tenant_membership where id = $1 and tenant_id = $2 and deleted_at is null
```

Primary-key lookup with a tenant predicate, plus the RLS policy. No enumeration, no pagination, no
search, no recursion, no ordering, no N+1 — one call per escalation command, and escalation is a
single human act.

**No index is required.** `tenant_membership.id` is the primary key, so the access path already
exists; the three secondary indexes (`(tenant_id, workforce_user_id)` unique,
`(workforce_user_id, status)`, `(tenant_id, status)`) are irrelevant to a lookup by identifier and
none needs adding. **No schema change is expected**, and none was made.

## 10. Contract boundary test plan

Written now, to be implemented only when the contract is approved.

| Test | Assertion |
|---|---|
| **Active** | an `active` membership answers `{ active: true }` |
| **Inactive** | `suspended` answers `{ active: false }`; `ended` answers `{ active: false }` — **both statuses asserted separately**, so a handler comparing against one of them cannot pass |
| **Missing** | an identifier belonging to no membership answers `not_found`, not `{ active: false }` |
| **Cross-tenant** | tenant A's membership identifier, asked in tenant B, answers `not_found` — and tenant B learns nothing about its status. Run under `rolsuper=false`/`rolbypassrls=false`, as every isolation suite here is |
| **Soft-deleted** | a soft-deleted membership answers `not_found`, matching `findRow` |
| **Permission** | `identity.membership.read` succeeds; **each** of the other thirteen Identity permissions alone is refused, one at a time; `*`, `identity.*` and `identity.membership.*` are refused |
| **Payload** | the serialized response contains only `active` — scanned for `profile`, `preference`, `portal`, `employment`, `delegation`, `role`, `reporting`, `organization`, `workforceuserid`, `tenantid`, `status`, `deletedat` |
| **Determinism** | no clock, no `now()`, no current date, no server timezone; the same database state answers the same twice |
| **Workflow port** | the adapter enters exactly one service grant, naming exactly `identity.membership.read`; and the escalation command fails rather than succeeding when the port raises |

## 11. Audit and negative space

**No existing negative-space assertion may be weakened, and none is moved by this document.**

Preserved intact: membership-directory restrictions, role restrictions, manager restrictions,
organization restrictions, and the broad-Identity-payload restrictions.

The one assertion to watch, recorded now and **not moved**:
`packages/modules/workflow/src/application/workflow-boundaries.test.ts:146` forbids `directory` and
`search` in the Workflow application layer. §7 shows the proposed naming keeps it true, so on current
evidence **nothing needs to move at all**. If an approved name were to collide with it, the correct
response is a different name, not a relaxed assertion.

`apps/api/src/workflow/workflow.routes.spec.ts` will need no change: this contract adds **no route**.

## 12. Unresolved questions

Two, both requiring approval before implementation.

**D-16D-17 — how many escalation refusals does an ineligible membership produce? `OPEN`.**
Identity distinguishes *inactive* (B) from *missing* (C). Workflow may collapse them into one refusal
or keep them apart.
- *One* — e.g. `escalation-approver-not-active`: simpler, and both mean "you cannot ask this person".
- *Two* — e.g. `escalation-approver-not-active` and `escalation-approver-not-a-membership`: they are
  different mistakes for different people — a suspended colleague versus a mistyped identifier — and
  this module's stated principle is that *"a single refusal would send all of them to the same person."*
  The manager path already splits exactly this way (`manager-not-a-member`).

I have not chosen. Note that Identity's contract must distinguish B from C **regardless**, because
collapsing them there would remove the option; §6 keeps them distinct.

**The query name.** `identity.membership-standing` or `identity.acting-membership`. Both fit the
established vocabulary; the first is recommended in §4.

## 13. Expected implementation impact, once approved

| Area | Change |
|---|---|
| **Identity** | one query interface + handler in `identity-queries.ts`; one view in `contracts/views.ts`; dispatcher registration in `identity-module.ts`; tests. **No store method** (`byId` exists), **no domain logic** (`isActingMembership` exists), **no repository change** |
| **Workflow** | one port in `workflow-ports.ts`; one required field in `WorkflowDependencies`; the resolved input threaded through `escalation.use-case.ts`; one predicate and one (or two — D-16D-17) refusals in `escalation.ts`; tests; a fake port in every harness, since `WorkflowDependencies` has no optional field |
| **`apps/api`** | one adapter implementing the port, with one `runWithServiceGrant`; composition wiring; **no new route, no new query, no new permission** |
| **Admin** | **none authorized** |
| **Prisma** | **none** — §9 |

## 14. The exact condition required before implementation can begin

Implementation of D-16D-12 may begin when, and only when, **all four** are true:

1. **The Identity contract is approved** — name, request shape, response shape, and the §6 failure
   mapping, as a completed module's change built and verified on its own side first (the precedent
   `reportingLine` set).
2. **D-16D-17 is decided** — one refusal or two.
3. **The permission is confirmed as `identity.membership.read`**, reached through an ADR-0043 grant,
   with no new permission and no user-held Identity permission.
4. **Authorization to modify Identity is given** — this checkpoint's boundary forbids it, and no
   amount of Workflow-side work can substitute.

Until then the escalation command enforces six of the seven approved eligibility rules, and **rule 5
(active membership) is not enforced**. That gap is recorded in
[`phase-16d-eligibility-implementation.md`](phase-16d-eligibility-implementation.md) §13 and is the
single remaining piece of approved-but-undelivered Phase 16D work.

## 15. Stop conditions

Checked against §14 of the instruction:

| Condition | Triggered? |
|---|---|
| A new permission appears necessary | **No** — `identity.membership.read` suffices |
| A schema change appears necessary | **No** — primary-key lookup, §9 |
| A new completed-module dependency beyond the bounded Identity contract | **No** |
| The contract cannot distinguish inactive from missing | **No** — §6 distinguishes them |
| Existing Identity authorization cannot safely cover the query | **No** — §5 |
| The query requires enumeration | **No** — one row |
| The query requires a broad member payload | **No** — one field |
| Any approved invariant must change | **No** |

**None triggered.** The single blocker is the one already known and already reported: the contract
does not exist, Identity may not be modified under this instruction, and creating it requires the
approval named in §14.
