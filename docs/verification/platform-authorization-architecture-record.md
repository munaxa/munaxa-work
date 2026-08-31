# Platform Authorization — grant source and security wiring architecture record

**Investigation only. Nothing was implemented.** No authorization, no authentication, no issuer,
no login, no `/me`, no Self-Service, no Manager Workspace, no product slice, no permission, no
contract, no migration, no Platform change, no completed slice touched. The only repository change
is this file.

One question:

> How does an authenticated Platform identity become an effective authorization grant set inside
> Munaxa Work?

Measured from current source at `6ab35c1` — Work, the `@munaxa/platform` monorepo, and the sibling
ecosystem repositories available here. Where a previous record and current source disagree,
**source wins and the discrepancy is recorded.**

---

## A. Executive conclusion

**Recommended: Option A — the platform resolves grants live, from stores, keyed on the verified
principal and the resolved tenant. Not from token claims.**

The evidence is unusually direct: `@munaxa/rbac`'s `PermissionResolver` already implements exactly
this and says why. It resolves `(tenantId, userId) → { roles, permissions }` from
`RoleRepositoryPort` and `RoleAssignmentPort`, caches the answer briefly, and invalidates
explicitly, because *"a permission cache that only expires by TTL means a revoked role stays
effective for the length of that TTL — which is exactly the window an attacker needs after an
administrator notices something is wrong."* Option B — trusting `perms`/`roles` claims carried in
the token — is refused by that same reasoning: a signed token cannot be un-issued, so grants
inside it are stale by construction.

Three findings qualify the recommendation, and the third is the one that decides the shape of the
work:

1. **Work stores nothing to resolve grants from.** Confirmed against the live database: of Work's
   187 tables, **zero** are role, permission or grant tables, and `ResolvedMembership` carries
   `{ tenantId, membershipId, workforceUserId, platformUserId, status }` — no roles, no
   permissions. Work cannot answer "what may this principal do", and by design should not learn to.
2. **The platform's RBAC stores are product-implemented ports.** `MemoryRoleRepository`'s own
   comment: *"Products back these with their own database."* So "Platform RBAC" is an engine, not
   a service. Adopting it means *something* hosts role definitions and assignments — and if that
   something is Work, Work acquires the authorization storage §16 forbids. **This is the same
   architectural shape the authentication investigation found in `@munaxa/auth`: a library for a
   product that hosts the capability, offered to a product written not to host it.**
3. **The two vocabularies do not currently interoperate.** Work's permission strings are
   dot-separated (`relations.violation.read`); the platform's grammar is `resource:action` with
   colons and a segment character class of `[a-z0-9_-]` that excludes dots. Tested rather than
   eyeballed: **0 of Work's 285 permission strings are valid platform check strings.** A
   mechanical `.` → `:` translation exists, but choosing it is an owner decision with visible
   consequences (it changes what an administrator sees when granting).

So the recommendation is Option A **with an explicit owner decision about who hosts the grant
store**, and that decision — not any Work-side code — is the blocker.

## B. Current state

| Component | State | Owner |
| --- | --- | --- |
| `PermissionChecker` (kernel) | Declared: `holds(permission: string): Promise<boolean>`. One string, no subject, no resource | Work declares, Platform implements |
| `PlatformPermissionChecker` | Real class; **constructed with an empty `ReadonlySet<string>`** at `identity.module.ts:149` | Work (the seam), Platform (the contents) |
| `GrantAwarePermissionChecker` | Real decorator over the above; adds **bounded service grants** (ADR-0043) | **Work-owned** |
| `Dispatcher` | Real: tenancy → **authorization** → validation → handler | Work |
| Permission declarations | **285 constants** across 18 modules, aggregated by `ModuleRegistry.describe()` | Work |
| Role / assignment / grant storage | **None. Zero tables of 187** | — |
| `ResolvedMembership` | `{ tenantId, membershipId, workforceUserId, platformUserId, status }` | Identity |
| `@munaxa/rbac` 2.4.1 | Published: `PermissionResolver`, `RoleHierarchy`, `PolicyEngine`, `Authorizer`, memory stores | Platform |

**The pipeline, with what exists and what does not:**

```text
request                     ✔ exists
  ↓ authentication          ✘ UnauthenticatedPort — no principal is ever produced
  ↓ principal               ✘ never reached today
  ↓ membership              ✔ real, PostgreSQL-backed, active-only
  ↓ tenant                  ✔ real, four outcomes, no default
  ↓ permission grants       ✘ NOTHING PRODUCES THEM — the subject of this record
  ↓ PlatformPermissionChecker ✔ exists, holds an empty set
  ↓ module authorization    ✔ real, 285 declared permissions, deny-by-default
  ↓ handler                 ✔ real
```

Two seams are unimplemented, and **either one alone refuses everything.** Authentication answers
*who*; this seam answers *what*.

## C. The empty grant-set finding

Answering §2's eleven questions from source:

1. **Where is it constructed?** `apps/api/src/identity/identity.module.ts:149` —
   `new GrantAwarePermissionChecker(new PlatformPermissionChecker(), …)`. The inner constructor's
   parameter defaults to `new Set()`, and nothing passes an argument.
2. **Where is it supposed to come from?** The class comment: *"An authenticated context holds only
   what this deployment was configured to grant. The set is empty unless a deployment supplies
   Platform's checker."*
3. **Which component owns it?** Platform. The file's opening line: *"Authorization comes from
   Platform (AD-002, ADR-0001). This is the seam it plugs into, and until it does, the seam
   refuses."*
4. **From the token?** Not per this architecture. The platform's token *can* carry `perms`/`roles`,
   but its own RBAC resolves from stores, and the authentication architecture record already ruled
   that Work discards those claims (§F).
5. **From Work's database?** **It cannot be** — there is no such data (§B).
6. **From Platform RBAC?** That is the only candidate the ecosystem ships, with the ownership
   caveat in §A.2.
7. **Computed dynamically?** Yes under Option A — per request, from live state, with a short cache
   and explicit invalidation.
8. **Is there already an interface for retrieving grants?** **Not in Work.** `PermissionChecker`
   *asks a yes/no question*; nothing in Work fetches a set. On the platform side,
   `PermissionResolver.resolve()` and `RoleAssignmentPort.listForUser()` are exactly that
   interface.
9. **Does Platform provide the capability?** The *engine*, yes. The *store*, no — it ships memory
   reference implementations and expects the product to back them.
10. **Is the empty set deliberate because authentication is absent?** **Only partly, and this is
    worth being precise about.** It is deliberate as a *fail-closed default* — the comment says a
    deployment that forgets to wire authorization "serves 403 to everything, which is noticed on
    the first request, rather than granting everything, which is noticed by an auditor." But it is
    **not** merely waiting on authentication: even with a verified principal, nothing in this
    repository or its dependencies would populate that set. The grant source is independently
    missing.
11. **What must change after authentication exists?** Something must supply the checker with a
    per-request, tenant-scoped grant set for the resolved principal. That is one wiring change at
    one seam — *if* the owner decisions in §Q are made. No module changes; no permission changes.

## D. Platform RBAC — actual capabilities

Inspected from `@munaxa/platform`'s `packages/platform/rbac/src` (published 2.4.1):

- **Permission representation**: strings, `resource:action`, optionally deeper. Wildcards allowed
  **in a grant, never in a check** — *"asking 'does this user have `documents:*`?' is a question
  with no correct answer."* `assertValidGrant` / `assertValidCheck` enforce the grammar; segments
  match `[a-z0-9][a-z0-9_-]*`.
- **Role representation**: `RoleDefinition` per tenant, in a `RoleHierarchy` (roles inherit);
  `system` roles cannot be deleted, because *"deleting one turns a working authorization check
  into a silent denial for everyone who held it."*
- **Grant representation**: a `RoleAssignment` is `{ tenantId, userId, roleId, assignedAt,
  assignedBy?, expiresAt?, scope? }` — **keyed on `userId`, not a membership**, with optional
  expiry and an optional **scope**.
- **Resolution**: `PermissionResolver.resolve(tenantId, userId)` → `{ roles, permissions,
  resolvedAt }`. Assignments are filtered for activity, each role's effective permissions are
  expanded through the hierarchy, and **a scoped assignment narrows each permission to
  `permission:scope`** *"so a course administrator does not become an administrator everywhere."*
  A wildcard that cannot be narrowed is **dropped and reported**, never silently widened.
- **Tenant scoping**: everywhere. The cache key escapes its parts because *"a permission-cache hit
  across tenants is a grant."*
- **Revocation**: explicit `invalidateUser` / `invalidateTenant`; TTL is a backstop, not the
  mechanism.
- **Static or dynamic**: dynamic, per request, cached briefly.
- **External store expected?** **No — a product-backed store.** `MemoryRoleRepository` and
  `MemoryRoleAssignments` are reference implementations; *"Products back these with their own
  database."*
- **Policies**: a deny-overrides ABAC layer (`PolicyEngine`) taking a `SecurityContext`, a concrete
  `permission`, and an optional `PolicyResource { type, id, ownerId?, attributes? }` — the layer
  that exists for *"not the requester's own record"* questions.

## E. Grant source — where effective grants should come from

**Option A** (recommended):

```text
verified principal (sub → platformUserId)
        ↓  Identity: activeMembershipsOf, x-munaxa-tenant selects
resolved membership → { tenantId, workforceUserId }
        ↓  PermissionResolver.resolve(tenantId, workforceUserId)   ← live, from stores
effective grants (tenant-scoped, expiry-filtered, scope-narrowed)
        ↓
PlatformPermissionChecker(grants)  →  GrantAwarePermissionChecker  →  Dispatcher  →  handler
```

Two mappings this makes concrete, and both are clean:

- **`userId`**: RBAC's assignment key maps to Work's `workforceUserId` — already in the
  `ExecutionContext`, already the audit actor (`user:<workforceUserId>`), and already tenant-less
  by ADR-0033, which is right because the assignment carries its own `tenantId`.
- **`tenantId`**: the resolved membership's tenant, never the token's (§H).

**Option B** (token → grants) is refused: revocation. Also, Work's own authentication record
already rules that `perms`/`roles`/`scope` claims are discarded — authentication answers who, not
what.

**Option C, and it deserves naming**: an external Platform *authorization service* Work calls per
request. Nothing in the ecosystem implements one, and `PermissionChecker.holds()` is a per-check
call, so a naive remote implementation would issue one round trip per permission check. If the
owner chooses a service, the seam should be fed a resolved *set* per request rather than made to
call out per check. Recorded as a decision, not a recommendation.

**What must not happen** (§16, and this record agrees): Work must not gain a role engine, a
permission engine, a grant table it owns, a token permission parser, or a duplicated role mapping.
The open question in §A.2 is precisely whether "implementing `RoleAssignmentPort` over Work's
database" is one of those things. **This record's reading: it is.** Work would then own role
definitions, assignments, their administration UI and their lifecycle — which is an authorization
authority in everything but name. If Platform RBAC is adopted, its store should be Platform's or
an operations-owned service's, not Work's.

## F. Authentication relationship

The boundary, per §11's options, is unambiguous in source:

```text
authentication  →  principal        (PlatformAuthenticationPort — who)
                       ↓
authorization   →  grants           (PermissionChecker — what)
```

Two ports, two questions, two owners' implementations, wired independently at two DI tokens
(`AUTHENTICATION_PORT`, `PERMISSION_CHECKER`). The kernel's `PermissionChecker.holds()` reads
`currentContext()` and returns `false` when there is none or when it is a machine context, so
authorization is downstream of authentication and fails closed without it. **Neither port grants
the other's answer**, and the architecture record's rule stands: the adapter must never derive
permissions from claims.

## G. Membership semantics

`ResolvedMembership` = `{ tenantId, membershipId, workforceUserId, platformUserId, status }`.
`activeMembershipsOf(platformUserId)` returns **active memberships only** — *"a suspended member
is a member, but not one who may open a request."*

So membership carries **tenant, platform user, workforce user and status — and no roles,
permissions, employment, effective dates or primary indicator.** Employment lives in a separate
aggregate (`EmploymentLink`, one-to-many, with `isPrimary`), and roles live nowhere.

Work's database therefore **cannot** answer "what permissions does this authenticated principal
currently have." The exact missing capability is a grant store plus a resolver over it — `@munaxa/
rbac`'s `RoleRepositoryPort` + `RoleAssignmentPort` + `PermissionResolver`, hosted per §E.

## H. Tenant semantics

The authentication record's settled rule is preserved unchanged: **`tid` is a validation
constraint, never an authority.** Its authorization equivalent:

- **Which tenant evaluates permissions?** The tenant of the **resolved membership**, from the
  `ExecutionContext`. ADR-0032 is untouched.
- **Where does it come from?** `activeMembershipsOf` + the `x-munaxa-tenant` selector. No default,
  ever — *"picking the first would work for most people most of the time, and would put a
  consultant's work into the wrong customer's tenant the one time it mattered."*
- **Can `tid` select a tenant?** No.
- **Must `tid` match?** Yes — a mismatch refuses the request (the settled rule).
- **Are grants tenant-scoped?** Yes, structurally: `RoleAssignment.tenantId`, and the resolver's
  cache key is tenant-escaped.
- **Can one principal hold memberships in several tenants?** Yes (AD-005).
- **Can one principal hold grants in several tenants?** Yes — and they must never be combined
  (§I).

## I. Multiple memberships

Repository evidence: `activeMembershipsOf` returns a **list**; `resolveTenant` handles zero
(`no-membership`), one (resolved), several-with-selector (resolved), several-without
(`ambiguous`), and wrong-tenant (`not-a-member`). Exactly one membership is ever placed in the
`ExecutionContext`.

**Required semantics, and this is the sharp edge §8 asks about:**

```text
principal → the ONE resolved membership → grants for that membership's tenant     ✔ required
principal → all memberships → union of all grants                                 ✘ forbidden
```

A union would let a person's administrator role at customer A grant them access inside customer B
— a cross-tenant escalation dressed as convenience. The architecture makes the safe version the
easy one: resolution already yields a single membership, and `PermissionResolver.resolve` already
takes exactly one `tenantId`. **The invariant to state and test is that the grant set is resolved
for the request's resolved tenant and no other**, and that an `ambiguous` outcome resolves *no*
context rather than a merged one.

## J. Permission model — the census, re-derived

| Measure | Count | Note |
| --- | --- | --- |
| Declared permission constants | **285** | across 18 modules, aggregated by `ModuleRegistry.describe()` |
| Valid as platform RBAC *check* strings | **0** | dot-separated vs `resource:action`; tested, not eyeballed |
| `-own` permissions | **15** | |
| `read-own` permissions | **11** | matches the brief exactly |
| `-own` actually wired to a handler | **2** | `workflow.approval.read-own` (two queue reads), `onboarding.task.complete-own` (a query and a command) |
| Constants never referenced in non-test production source | **23** | |

**One discrepancy with the brief, recorded rather than smoothed over**: the brief states 22
unreferenced permissions; a constant-reference measure over non-test production source finds
**23**. Of those: 13 are `-own`, one is `performance.feedback.read-about-self`, and nine are
ordinary reads/manages with no handler yet (`employment.contract.read`,
`employment.reporting-line.read`, `identity.portal.read`, `identity.user.read`,
`identity.user.manage`, `organization.cost-center.read`, `organization.profit-center.read`,
`performance.summary.read`, `recruitment.offer.read`). This is **not** a cleanup task and none was
changed; the figure matters only because it sizes what a grant source must eventually express.

**The interoperability finding, stated plainly**: Work declares its permissions in a vocabulary
Platform RBAC cannot currently parse. A `.` → `:` translation at the seam is mechanical and
lossless in both directions, and is the obvious candidate — but it is an owner decision, because
the strings appear in administration surfaces, in every module's declaration, and in whatever
Platform artifact an administrator uses to build roles. The alternative — widening the platform's
segment grammar to admit dots — is a Platform change. **Work's 285 permission strings must not
change** (§16 and the brief's own instruction), and this record proposes no change to them.

## K. `read-own` — future self-service implications

`PermissionChecker.holds(permission: string)` takes **one string and nothing else** — no subject,
no resource, no owner. So the checker **cannot express ownership by itself**: `holds('leave.read-
own')` answers "may this caller read their own leave in principle", never "is this row theirs."

The intended shape, from the two grants that are actually wired, is therefore two-part:

```text
grant:      the caller holds `x.read-own`                    ← permission checker
predicate:  the resource's subject IS the caller's own       ← the handler, from context
```

Workflow demonstrates it exactly: `pending-approvals` is guarded by `approval.read-own` **and**
derives the subject from `currentMembership()`, with *"no parameter for whose queue to read, and
its absence is the control."* Ownership is established **server-side from context**, never from a
caller-supplied identifier, and it is *not* encoded in the grant.

Platform RBAC offers a second, different mechanism that must not be confused with this: a **scoped
assignment** narrows a permission to `permission:scope`, and `PolicyResource.ownerId` exists for
owner-conditioned policies. Either could express ownership — but both would require the check site
to know the scope or the resource, which Work's one-string seam cannot pass. **Choosing between
"handler-side predicate" (today's shape, no seam change) and "scope-encoded grant" (platform
shape, seam change) is an owner decision**, recorded in §Q.

Three dependencies remain independent of any of this, carried forward unchanged:

1. Membership → employment resolution is required for every `read-own` outside Workflow's
   membership-only queues, and **the only published read is guarded by `identity.membership.read`,
   an administrator grant** — an employee must not receive it merely to resolve themselves.
2. That relationship is **one-to-many** with an `isPrimary` flag and no selection rule.
3. **Payroll publishes no employee-scoped read at all**, so `payroll.read-own` has nothing to
   guard even with perfect authorization.

## L. Manager authorization

From source, manager access today is **not** an ordinary permission and **not** encoded in grants:

- Permissions exist (`performance.review.read-team`, `goal.read-team`) but they gate a *query
  shape*, not a team.
- Scope is **enforced by the query**: `reviewScopeFor` resolves the team through Employment's
  published contract under a **bounded service grant** (ADR-0043), bounds the store call *before*
  it runs *"because a count of what was then removed is itself a disclosure"*, and answers 404
  outside scope.
- Manager employment is established **from a caller-supplied `managerEmploymentId`** — and is
  therefore honoured **only** beside `read-all`, where it narrows someone who could already read
  everything. A `read-team`-only caller reads nothing: *"Nothing can check the claim until a
  principal resolves to an employment, so the claim is not accepted."*
- Workflow refuses a manager queue for the same reason (D-14): *"a caller-supplied manager
  identifier is a filter and never a credential."*

**So the answer to §10's question is yes, safely reusable — with exactly one addition**: the
caller's own employment, resolved server-side from context. With that, `reviewScopeFor` needs no
change; without it, any manager scope is a claim. Grants alone cannot express "this manager's
team", because the team is a query over live reporting lines, not a static scope string — and
`PolicyEngine` conditions could express it only if the resource and the caller's employment both
reached the check site, which today's seam does not carry.

Leave, Attendance, Assets, Relations and Payroll publish **no team-scoped read at all**, so a
Manager Workspace additionally needs reads that do not exist. Nothing was implemented.

## M. Failure semantics

Distinct outcomes, never collapsed, and — the point §12 insists on — **an authorization failure
must never render as "you have no approvals" or "you have no assets."**

| Condition | Outcome | Source of the rule |
| --- | --- | --- |
| Missing / malformed credential | **401** | `AuthenticatedTenantGuard` |
| Valid authentication, no Work membership | **401** | Guard: *"a person who is a member of nothing has nothing to be forbidden from"* |
| Several memberships, none selected | **401** (`ambiguous`) | Refused, never merged |
| Requested a tenant they are not a member of | **401** (`not-a-member`) | Refusing rather than confirming the tenant exists |
| Disabled platform principal | **401** | No principal → no context |
| Disabled / suspended Work membership | **401** | `activeMembershipsOf` excludes it; the request has no context at all |
| Valid membership, permission not held | **403** | `Dispatcher`, before validation |
| Permission revoked after token issuance | **403 on the next request** | Only under Option A. Under Option B it would remain **allowed** until expiry — the decisive argument |
| Membership changed after token issuance | **401/403 on the next request** | Membership is re-read per request |
| Valid permission, resource absent | **404 / empty**, per module | e.g. Relations answers `not_found` for another tenant's identifier deliberately |
| Valid permission, nothing to show | **empty** | The only one of these that may render as "nothing" |

The screens already hold this line — every slice distinguishes withheld from empty — and the UI
vocabulary for it exists (`withheld.*` keys naming the missing grant). The risk this record flags
is the *reverse* direction: with an empty grant set and a real principal, **every** section would
render "withheld", which is honest but indistinguishable from a deployment with no grants
configured at all. That is an operations-visibility concern, not a product defect, and it is why
§C.10 matters.

## N. Security invariants

| Threat | Required invariant |
| --- | --- |
| Forged grant claims | Grants are never read from the token. `perms`/`roles`/`scope` claims are discarded at the authentication seam |
| Stale grants | Resolution is per request from live state; caches invalidate explicitly, TTL is a backstop and kept short |
| Cross-tenant grants | Grants are resolved for the request's **one** resolved tenant; cache keys are tenant-escaped and collision-proof |
| Grant union across memberships | **Forbidden.** One resolved membership → one tenant → one grant set. `ambiguous` yields no context, never a merge |
| Role escalation | Role definitions and assignments are administered outside Work; Work declares permissions and never grants them |
| Membership substitution | No request field names a membership; it is derived from `sub` |
| Principal substitution | Identity comes only from the verified principal |
| Disabled membership | Excluded by `activeMembershipsOf` on every request, so a token outliving a suspension still fails |
| Revoked permission | Explicit invalidation on the resolver; Option A makes revocation effective on the next request |
| Token replay / stale session | Bounded by token TTL; revocation is server-side state (`@munaxa/session`), owned by the issuer |
| Confused deputy | Bounded service grants (ADR-0043) widen *what* is permitted, never *who* acts; they cannot nest — *"Authority is not composed"* — and every elevation is logged with the operation and the human it was for |
| Manager scope bypass | Team membership resolved server-side from the caller's own employment; queries bounded before the store, never filtered after |
| Own-resource scope bypass | Subject derived from context; no caller-supplied identifier is ever a credential |
| Wildcard-in-check | Platform refuses wildcards in checks; Work's seam passes concrete strings only |

## O. Ownership

| Capability | Owner | Evidence |
| --- | --- | --- |
| Token verification | **Platform** | `PlatformAuthenticationPort`; Work parses nothing |
| Authentication issuer | **External / operations** | None exists (previous record) |
| Public-key distribution | **External / operations** | Configured PEMs; JWKS unimplemented |
| Principal identity | **Platform** | `platformUserId`, immutable (AD-004) |
| Membership resolution | **Work** | Identity module, real, PostgreSQL-backed |
| Role definitions | **Platform or operations — UNRESOLVED** | RBAC ships the engine; the store is product-backed (§A.2) |
| Role assignment | **Platform or operations — UNRESOLVED** | same |
| Grant resolution | **Platform** | `PermissionResolver` |
| Permission *vocabulary* | **Work** | 285 declarations; `ModuleRegistry.describe()` aggregates them |
| Authorization decision | **Platform** | `PermissionChecker` contract |
| Bounded service grants | **Work** | `GrantAwarePermissionChecker`, ADR-0043 — the one authorization-adjacent thing Work legitimately owns |
| Manager scope | **Work (query-enforced)**, given a Platform-resolved employment | Performance's `reviewScopeFor` |
| Own-resource scope | **Work (handler predicate)**, given a Platform-resolved principal | Workflow's queues |

Nothing was moved to Work for convenience. The two UNRESOLVED rows are the heart of §Q.

## P. Local development

Today a developer gets no principal and no grants; every business route answers 401, which is why
all nine slices were verified against scratchpad stubs.

**Nothing in the ecosystem provides development authorization infrastructure.** `@munaxa/rbac`
ships `MemoryRoleRepository` / `MemoryRoleAssignments` and `defaultRoles()`, which are reference
implementations for tests — not a development environment.

What must **not** be built, and was not: hardcoded grants, a fixed administrator, a fixed
membership, a default tenant, an authorization bypass, or any flag that could reach production.
The acceptable shape mirrors the authentication record's: a **real grant store running locally**,
seeded with real role definitions, resolved through the same `PermissionResolver` the production
path uses — so local authorization is genuinely the production code path with different data.
That is an operations/platform deliverable, recorded as a dependency (§Q.12).

## Q. Owner decisions

**Resolvable from existing evidence — no decision needed:**

- Grants must be resolved live, not read from token claims (revocation; §E).
- The evaluating tenant is the resolved membership's, never `tid` (§H).
- Grant sets must never be unioned across memberships (§I).
- Authentication and authorization are two ports with two owners; neither grants the other's
  answer (§F).
- Work must not host a role engine or permission engine (§E, §16).
- Bounded service grants stay Work's (§O).
- Manager and own scope are enforced at the query/handler, not encoded in grants (§K, §L).

**Requires a Platform / Security owner decision:**

1. **Grant source** — Platform RBAC engine, an authorization service, or another mechanism.
2. **Who hosts the role/assignment store**, given that Platform ships product-backed ports and
   Work must not become the authority (§A.2). *The single most consequential decision here.*
3. **Grant representation and vocabulary translation** — `.` → `:` at the seam, a widened platform
   grammar, or something else. Work's 285 strings do not change.
4. **What the checker's input becomes** — a resolved set injected per request (recommended), or a
   remote call per check (and if so, how the per-check cost is bounded).
5. **Role/membership model** — RBAC assigns to `userId`; confirmation that this maps to
   `workforceUserId` and that roles are per-tenant, not per-membership.
6. **Grant freshness and revocation** — cache TTL, and who calls `invalidateUser` when an
   administrator changes a role.
7. **Multiple-membership semantics** — ratification of the no-union rule (§I).
8. **`read-own` mechanism** — handler predicate (no seam change) vs scope-encoded grant (seam
   change) (§K).
9. **Manager scope authority** — ratification that a caller's employment must be resolved
   server-side before `read-team` is enabled (§L).
10. **Employee-safe self-resolution read** — membership → employment without an administrator
    grant; one-to-many rule (`isPrimary` or explicit).
11. **Who administers roles** — Work has no role administration UI and should not grow one; where
    does a customer's administrator grant `relations.violation.read`?
12. **Local development authorization** (§P).
13. **Security owner approval of the whole boundary.**

## R. Implementation Definition of Ready

§22's fourteen conditions:

| # | Condition | Status |
| --- | --- | --- |
| 1 | Grant source defined | **NOT MET** — recommended (§A/E); unratified |
| 2 | Grant representation defined | **NOT MET** — 0/285 strings currently interoperate |
| 3 | Membership/role semantics defined | **PARTIAL** — membership real; role model unowned |
| 4 | Tenant scope defined | **MET** — resolved membership's tenant; `tid` constrains only |
| 5 | Multiple-membership behaviour defined | **PARTIAL** — rule proposed (§I); unratified |
| 6 | Grant freshness / revocation defined | **NOT MET** — mechanism exists, policy undecided |
| 7 | Authentication → authorization boundary defined | **MET** (§F) |
| 8 | `PlatformPermissionChecker` input defined | **NOT MET** — the core gap |
| 9 | `read-own` semantics defined | **NOT MET** — two candidate mechanisms (§K) |
| 10 | Manager scope semantics defined | **PARTIAL** — enforcement exists; principal→employment missing |
| 11 | Disabled-membership behaviour defined | **MET** — excluded per request (§M) |
| 12 | Local development authorization defined | **NOT MET** |
| 13 | Platform/Work ownership explicit | **PARTIAL** — two rows unresolved (§O) |
| 14 | Security owner approves | **NOT MET** |

**Four met, four partial, six unmet. Implementation must not begin.** Per §22, this is a STOP —
and it compounds with the authentication record's eleven-of-nineteen unmet, since a grant source
without a principal grants nothing to nobody.

## S. Verification

`pnpm verify` with every cache cleared and PostgreSQL 16 live (`TEST_DATABASE_URL` set; **31
migrations applied; 187 tables** — of which zero are role, permission or grant tables, verified by
query for this record). As in the preceding tasks, the chained script forwards `--force` only to
its final command, so each turbo stage was forced explicitly and tests ran with the script's own
`--concurrency=1`:

- `pnpm standards` — engineering standards; architecture (186 models); localization (20/20);
  dependencies (2028 files, no cycles, no unused, no unreachable); **platform parity: 5 packages =
  lockfile, all `registry`, `@munaxa/platform` 1.6.1**.
- `pnpm format:check` — clean.
- lint **51/51 tasks, 0 cached** — 1m40.542s.
- typecheck **51/51 tasks, 0 cached** — 37.809s.
- test **51/51 tasks, 0 cached** — 7m23.801s: **471 test files passed, 5,401 tests passed, 0
  failed, 0 skipped** — unchanged from baseline, as an investigation requires.
- build **29/29 tasks, 0 cached** — 1m3.822s. **Exit 0.**

No production code, package version, lockfile entry, permission, contract, migration or CI file
changed. Working tree clean; the only addition is this document.
