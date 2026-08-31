# Munaxa Work — Security Architecture Decision Package

**Consolidation only. Nothing was implemented.** No authentication, no authorization, no issuer,
no grant service, no RBAC tables, no `/me`, no Self-Service, no Manager Workspace, no slice, no
permission, contract, route, module, migration, portal, CI or package change. The only repository
change is this file.

This package consolidates three investigations into one decision set for the Platform/Security
owner:

- `docs/verification/platform-authentication-adapter-record.md` (readiness, commit `b3da5d6`)
- `docs/verification/platform-authentication-architecture-record.md` (commit `6ab35c1`)
- `docs/verification/platform-authorization-architecture-record.md` (commit `211500a`)

Re-verified against current source at `211500a` — Work, the `@munaxa/platform` monorepo, and the
sibling ecosystem repositories. Where a record and source disagree, source wins and the
discrepancy is recorded. **Two new pieces of platform evidence surfaced during this consolidation
and both are load-bearing** (§F, §G).

---

## A. Executive decision

> **Recommendation: Option B — Work-owned authorization storage behind Platform RBAC's engine —
> and it requires the Security owner to relax one rule that this repository has been enforcing.**

That is the opposite of what the authorization record leaned toward, and the reversal comes from
evidence found while answering §2 of this brief rather than from a change of preference. Three
platform statements settle it:

1. **The platform is a library set with no hosted service anywhere.** Its architecture document
   describes four layers of packages and says the point is that *"a product [can] adopt one
   package without adopting all twelve."* **Option A — a Platform-hosted authorization service —
   does not exist and is not on any roadmap in this ecosystem.** Recommending it would be
   recommending that Platform build a new product.
2. **The platform explicitly assigns authorization *semantics* to the product.** Its threat model
   places out of scope: *"**Product authorization semantics.** The platform decides whether a
   principal has a permission. What permissions exist, and which resource each guards, is a
   product's design."* Work already does exactly this — 285 declarations, one per handler.
3. **The platform expects products to mutate role assignments.** Same document, on the revocation
   window: *"A product mutating role assignments directly must do the same"* (call
   `invalidateUser`). A product that never held assignments could not mutate them.

So the ecosystem's intended shape is: **Platform owns the decision engine and the identity;
the product owns the permission vocabulary and the assignment store.** Work has been reading its
own rule — "Work must never become a second authorization authority" — more strictly than the
platform intends, and the two now have to be reconciled deliberately rather than by drift.

**The distinction that makes this safe**, and the one this package asks the Security owner to
ratify:

> Hosting the *store* is not being the *authority*. Work would persist role definitions and
> assignments and expose them to administration; it would **not** decide, resolve, or interpret
> them. `PermissionResolver` (Platform) resolves; `PermissionChecker` (Platform's contract)
> decides; Work supplies rows and asks yes/no questions. Work already holds far more sensitive
> data — payroll, disciplinary case files, national identifiers — than a table of role names.

**Both seams remain blocked, and neither is blocked on Work.** Authentication has no issuer;
authorization has no ratified store owner. **Eleven of nineteen** authentication conditions and
**six of fourteen** authorization conditions are unmet (§P). This package does not authorize
implementation.

## B. Authentication decision

Unchanged from the authentication record, and re-verified:

- **Model: Work is a relying party.** It verifies nothing on its own authority; a
  Platform-supplied verifier turns a credential into a `PlatformPrincipal` or nothing.
- **Work must not host credentials.** `WorkforceUser` is `{ id, platformUserId, status, version }`
  — no credential field — while the platform's `UserDirectoryPort` requires a `CredentialRecord`
  with `passwordHash`, `status`, `tokenVersion`. Hosting login would mean Work authenticating a
  credential for an account it does not own.
- **Shape: statically distributed public keys, not JWKS.** The platform's production-readiness
  audit lists *"JWKS verification for client-supplied id tokens"* among capabilities **absent by
  decision**; `AsymmetricSigner` supports verify-only nodes with multi-`kid` rotation, and that is
  the supported shape.
- **Blocked**: no issuer exists, and therefore no `iss`, `aud`, key distribution, or local
  authentication environment.

## C. Authorization decision

- **Grants are resolved live from stores, never trusted from token claims.** The platform's
  `PermissionResolver` implements this and explains why: *"a permission cache that only expires by
  TTL means a revoked role stays effective for the length of that TTL."* **Option D is refused.**
  A second, independent platform statement says the same thing about federated identity:
  *"Groups are input, not authority. Map a provider's groups to platform roles in your product;
  never hand them to `Principal.permissions` directly. A misconfigured group in an external
  directory should not be able to grant `tenant:delete`."*
- **Option A** (Platform-hosted authorization service) — does not exist (§A.1). Recorded as
  available only if Platform chooses to build it.
- **Option C** (externally hosted authorization store) — no such store exists either; it is
  Option A with a different deployment boundary and the same precondition.
- **Option B** (Work-owned storage, Platform engine) — **recommended**, conditional on §A's
  ratification.
- **Option E**: one variant deserves recording. Work could host the assignment store while the
  *role definitions* — the mapping from role to permission set — are owned centrally and
  distributed as configuration. This keeps "which permissions a role grants" outside Work while
  "who holds which role in this tenant" stays where the tenant's administrators are. It is a
  reasonable middle and is offered to the owner, not chosen here.

## D. Combined trust boundary

```text
                    ┌──────────────────── outside the trust boundary ────────────────────┐
credential  ───────▶│ bytes only; parsed by nothing in Work                              │
x-munaxa-tenant ───▶│ a selector over stored facts; never a grant                        │
                    └───────────────────────────────────────────────────────────────────┘
        │
        ▼  Platform verifier (does not exist yet)
   PlatformPrincipal { platformUserId, issuer, email?, authenticatedAt }      ← trusted: identity only
        │
        ▼  Work · Identity · PostgreSQL          activeMembershipsOf(platformUserId)
   one ResolvedMembership                                                     ← authoritative: tenant
        │
        ▼  ExecutionContext { tenantId, userId, membershipId, actor, correlationId }
        │
        ▼  Platform · PermissionResolver over a store (owner undecided)
   effective grants, tenant-scoped, expiry-filtered                           ← authoritative: what
        │
        ▼  PlatformPermissionChecker  →  GrantAwarePermissionChecker (Work, ADR-0043)
        ▼  Dispatcher: tenancy → authorization → validation → handler
```

**Everything above the first two arrows is unimplemented. Everything below the third is real,
tested and unchanged by this package.**

## E. Identity chain

| Arrow | Owner | Input | Output | Trust | Failure |
| --- | --- | --- | --- | --- | --- |
| credential → principal | **Platform** (absent) | `{ scheme, value }` verbatim | `PlatformPrincipal` \| `undefined` | The only source of identity | `undefined` → no context → **401** |
| principal → memberships | **Work** (real) | `platformUserId` | `ResolvedMembership[]`, active only | Stored fact, re-read per request | none → **401** |
| memberships → one membership | **Work** (real) | list + `x-munaxa-tenant` | one membership | Selector narrows, never grants | ambiguous / not-a-member → **401** |
| membership → grants | **Platform engine, store owner undecided** | `(tenantId, workforceUserId)` | permission set | Live, cache-invalidated | empty set → **403** on every check |
| grants → decision | **Platform contract** | one permission string | boolean | Deny by default | false → **403** before validation |
| service grant | **Work** (ADR-0043) | open grant + permission | boolean | Widens *what*, never *who*; cannot nest | absent → no elevation |
| membership → employment | **Work** (data exists, no request-time rule) | `membershipId` | 0..n links, one `isPrimary` | Administrator-guarded read only | undefined today |

## F. Grant source

**Recommended**: `PermissionResolver.resolve(tenantId, workforceUserId)` over
`RoleRepositoryPort` + `RoleAssignmentPort`, backed by Work-owned tables, injected into
`PlatformPermissionChecker` as a resolved set **once per request**.

Evidence for the ownership reversal, gathered for this package:

| Platform statement | Consequence |
| --- | --- |
| *"a product [can] adopt one package without adopting all twelve"* (architecture) | The platform is libraries; there is no service to call |
| *"Products back these with their own database"* (`MemoryRoleRepository`) | Stores are product-implemented by design |
| *"A product mutating role assignments directly must do the same"* (threat model) | Products are expected to hold and mutate assignments |
| *"What permissions exist, and which resource each guards, is a product's design"* (threat model) | Work's 285 declarations are correctly Work's |
| *"Groups are input, not authority"* (extension guide) | Grants are never taken from a token or directory claim |

**Mapping**: RBAC keys assignments on `(tenantId, userId)`. Work's `workforceUserId` is the
natural `userId` — it is already in the `ExecutionContext` and already the audit actor
(`user:<workforceUserId>`), and it is tenant-less by ADR-0033, which is correct because the
assignment carries its own `tenantId`. **Assignments are keyed on the workforce user, not the
membership**, so a person with memberships in two tenants has two assignment sets, isolated by
`tenantId` — which is exactly the isolation §I requires.

## G. Permission vocabulary

Work: `relations.violation.read` (dots). Platform grammar: `resource:action` with segments
matching `[a-z0-9][a-z0-9_-]*` — **dots excluded**. Tested rather than eyeballed: **0 of 285 Work
strings are valid platform check strings.**

Answering §3 from evidence:

- **Intentionally different?** No evidence of intent either way. The vocabularies were designed
  independently, and the platform's threat model explicitly leaves permission design to the
  product — so divergence was permitted rather than planned.
- **Same conceptual model?** **Yes.** Both are hierarchical, deny-by-default, string-identified
  permissions over a resource and an action. Work's third segment is a sub-resource
  (`relations` · `violation` · `read`), which the platform's grammar expresses natively as
  `relations:violation:read`.
- **Is mapping documented?** No.
- **Can it be mechanical?** Structurally yes — `.` → `:` is lossless and reversible, since no Work
  permission contains a colon and none contains a wildcard. **But this package does not perform or
  presume it**, per the brief.
- **Does it change the administrator-visible vocabulary?** **Yes, and this is the substance of the
  decision.** The strings appear in Work's declarations, in `ModuleRegistry.describe()`, and in
  whatever artifact an administrator uses to build roles. A translation at the seam keeps Work's
  strings and shows platform-shaped strings to whoever administers roles; the two populations then
  differ by punctuation, which is a support-call generator.
- **Are aliases supported?** **No.** `assertValidGrant` / `assertValidCheck` validate one grammar;
  there is no alias table and no normalisation hook.
- **Can the platform checker accept Work's strings today?** **No** — `assertValidCheck` rejects
  them.

Three candidate resolutions, for the owner: (i) translate at the seam, Work's strings unchanged;
(ii) widen the platform's segment class to admit `.` — a Platform change affecting every product;
(iii) an explicit alias/normalisation layer in the platform. **Work's 285 permissions do not
change under any of them.**

## H. Tenant semantics

Preserved verbatim from the authentication record and extended to authorization:

- **`tid` is a validation constraint, never authority.** The tenant is the resolved membership's.
- **If the token says tenant A and membership resolves to tenant B: REFUSE.** Not switch, not
  prefer, not silently ignore.
- **Grants belong to the tenant of the authoritative membership** and are resolved for that tenant
  alone. `RoleAssignment.tenantId` makes this structural, and the resolver's cache key is
  tenant-escaped because *"a permission-cache hit across tenants is a grant."*
- **No union across tenants, ever.**

## I. Multiple memberships

Current behaviour, from source: `activeMembershipsOf` returns a list; `resolveTenant` yields
`no-membership`, `resolved`, `ambiguous` or `not-a-member`; **exactly one membership reaches the
`ExecutionContext`**, and there is deliberately no default — *"picking the first would work for
most people most of the time, and would put a consultant's work into the wrong customer's tenant
the one time it mattered."*

**Required rule:**

```text
principal → the ONE resolved membership → grants for that tenant      ✔
principal → all memberships → union of grants                          ✘ forbidden
```

**Unresolved and needing an owner** (§O): whether one token represents one membership or a
principal across all of them; whether membership/tenant selection is external (issuer-side) or
stays Work's header selector; and whether switching membership requires a new token. Today the
selector is Work's and needs no token change — that is the cheapest answer and the one consistent
with ADR-0032, but it is a decision, not a finding.

## J. Revocation and freshness

| Change | Effective when | Under which model |
| --- | --- | --- |
| Role removed / permission removed from a role | Next request after `invalidateUser`, else within cache TTL | Live resolution only |
| Grant assignment revoked | Same | Live resolution only |
| Membership disabled or ended | **Next request** — `activeMembershipsOf` excludes it, so no context is built at all | Already true today |
| Workforce user disabled | Next request, same mechanism | Already true today |
| Manager scope changed (reporting line) | Next query — resolved live from Employment | Already true today |
| Tenant membership removed | Next request → 401 | Already true today |
| **Under Option D (token-carried grants)** | **Not until the token expires** | The reason D is refused |

**Required guarantee**: authorization state is re-derived per request from live sources; caching
is an optimisation with explicit invalidation, and the platform's own residual-risk note names the
window — *"the window is the cache TTL — 60 seconds by default — and every mutation path in the
platform closes it explicitly."* **The owner must set the acceptable window and name who calls
`invalidateUser` when an administrator changes a role.** No caching was implemented.

## K. `read-own`

`PermissionChecker.holds(permission)` takes one string — no subject, no resource, no owner — so
**the checker cannot establish ownership by itself.** The architecture must be two-part, and the
only two wired `-own` grants already demonstrate it:

```text
grant:      caller holds `x.read-own`                       ← permission checker (Platform decides)
predicate:  the resource's subject IS the caller's own      ← handler, derived from context (Work)
```

Workflow: `pending-approvals` is guarded by `approval.read-own` **and** derives the subject from
`currentMembership()`, with *"no parameter for whose queue to read, and its absence is the
control."*

The alternative — encoding ownership in a scoped grant (`permission:scope`, which Platform RBAC
produces natively) — would require the check site to know the scope, which today's one-string seam
cannot carry. **Choosing between handler-predicate (no seam change) and scope-encoded grant (seam
change) is an owner decision.**

Three dependencies stand regardless: the only published membership → employment read is guarded by
`identity.membership.read`, **an administrator grant an employee must not hold**; the relationship
is **one-to-many** with `isPrimary` and no selection rule; and **Payroll publishes no
employee-scoped read at all**, so `payroll.read-own` has nothing to guard even with perfect
authorization.

## L. Manager scope

Authoritative today in the **query**, not in grants: `reviewScopeFor` resolves the team through
Employment's published contract under a bounded service grant (ADR-0043), bounds the store call
*before* it runs *"because a count of what was then removed is itself a disclosure"*, and answers
404 outside scope. The unsafe half is deliberately inert: *"A `read-team` caller reads nothing,
whatever they name… Nothing can check the claim until a principal resolves to an employment."*

- **Where authoritative**: the query predicate, fed by the caller's own employment.
- **In grants?** No — a team is a live query over reporting lines, not a static scope string. A
  grant can carry `read-team` as a *capability*; it cannot carry *which* team.
- **Both required?** Yes: the grant permits the shape, the predicate bounds the rows.
- **How changes take effect**: immediately, since reporting lines are read live.
- **Cross-team prevention**: the bound goes into the store call; nothing is filtered after
  retrieval, and out-of-scope answers 404 rather than 403.
- **Attendance** publishes no equivalent manager filter — nor do Leave, Assets, Relations or
  Payroll. A Manager Workspace needs reads that do not exist; that is product work, separately
  authorized.

## M. Security invariants

Non-negotiable, each traceable to source:

1. **No unsigned identity.** Signature verified against the verifier's configured algorithm, never
   the token header's.
2. **No client-controlled identity.** Identity comes only from the verified principal.
3. **No client-controlled tenant authority.** The header selects among stored memberships; `tid`
   constrains and never selects.
4. **No client-controlled employment authority.** An `employmentId` parameter is a filter under an
   administrator grant, never a credential.
5. **No grant authority from token claims.** `perms`/`roles`/`scope` are discarded; groups are
   input, not authority.
6. **No stale authorization beyond the agreed window.** Live resolution, explicit invalidation.
7. **No grant union across memberships.** One resolved membership, one tenant, one grant set.
8. **No cross-tenant grants.** Tenant on every assignment; tenant-escaped cache keys.
9. **No employee access to another employment via an arbitrary `employmentId`.** Ownership is a
   server-side predicate over context.
10. **No manager access outside scope.** Bounded before the store; never filtered after.
11. **No Work-owned second identity system.** Work stores no credential and no key material.
12. **No Work-owned authorization *authority*.** Work may host the store **only if the owner
    ratifies §A**; it never resolves, interprets or decides.
13. **Authorization failure is never an empty success.** 401 ≠ 403 ≠ 404 ≠ empty, per read.

## N. Platform / Work ownership

| Capability | Platform | Work | External/Ops | Owner decision |
| --- | --- | --- | --- | --- |
| Authentication issuer | | | ✔ | **Yes — who runs it** |
| Token signing | | | ✔ | Issuer-side |
| Token verification | ✔ (library) | | | No |
| Public key distribution | | | ✔ | **Yes — mechanism** |
| Principal identity | ✔ | | | No |
| Membership | | ✔ | | No — real today |
| Tenant context | | ✔ | | No — ADR-0032 |
| Role definitions | ✔ (engine) | ? | ? | **Yes — §A / Option E** |
| Permission definitions | | ✔ | | No — *"a product's design"* |
| Grant assignments | | ? | ? | **Yes — the core decision** |
| Grant resolution | ✔ | | | No |
| Revocation | ✔ (mechanism) | ✔ (must call it) | | **Yes — window** |
| Manager scope | | ✔ (query) | | No |
| Own-resource scope | | ✔ (predicate) | | **Yes — mechanism (§K)** |
| Authorization audit | ✔ (`@munaxa/audit`) | ✔ (service-grant elevations) | | **Yes — role-change trail** |
| Local development identity | | | ✔ | **Yes** |
| Local development grants | | | ✔ | **Yes** |

## O. Owner decisions

Only what cannot be resolved from evidence. Kept deliberately short.

### Security Owner

1. **Ratify or refuse §A**: may Work host the role/assignment store while Platform remains the
   sole resolver and decider? *Everything else in authorization waits on this.*
2. **Approve the trust boundary as a whole** (§D), including the `tid`-as-constraint rule and the
   no-union rule.
3. **`read-own` mechanism**: handler-side predicate (recommended, no seam change) or scope-encoded
   grant.
4. **Acceptable revocation window**, and who calls `invalidateUser`.

### Platform Owner

5. **Permission vocabulary** (§G): translate at the seam, widen the grammar, or add aliases.
6. **Whether Platform will build an authorization service** — if yes, Option A supersedes B and
   this package should be re-decided.
7. **Issuer ownership**, and with it `iss`, `aud`, `sub` semantics, signing algorithm, key
   distribution and rotation, token lifetime.
8. **Whether the token or Work selects the membership/tenant** (§I).

### Operations / Infrastructure

9. **Run the issuer**, distribute public keys, operate rotation.
10. **Local development issuer and grant seed** — a real issuer and a real store with development
    data, so the local path is the production code path (§P).

### Work Product Owner

11. **Employee-safe self-resolution read**: membership → employment without an administrator
    grant, and the one-to-many rule (`isPrimary` or explicit). *Prerequisite for any Self-Service.*
12. **Who administers roles in the product**, given that Work has no role-administration UI and
    §A determines whether it should grow one.

## P. Implementation Definition of Ready

### Authentication

| Requirement | Status |
| --- | --- |
| Issuer exists | **NOT MET** |
| `iss` | **NOT MET** |
| `aud` | **NOT MET** |
| `sub` semantics | Proposed (immutable `platformUserId`); unconfirmed |
| Signing algorithm | Recommended `RS256`/`ES256`; unratified |
| Key distribution | **NOT MET** |
| Key rotation | **NOT MET** |
| Token lifetime | **NOT MET** |
| Transport | **MET** — bearer on `Authorization` |
| Reverse-proxy / header trust | **NOT MET — unknown** |
| Local development | **NOT MET** |

### Authorization

| Requirement | Status |
| --- | --- |
| Grant source | **NOT MET** — recommended (§A/F); unratified |
| Grant representation | **NOT MET** |
| Permission vocabulary | **NOT MET** — 0/285 interoperate |
| Membership semantics | **MET** |
| Tenant semantics | **MET** |
| Multiple-membership semantics | **PARTIAL** — rule proposed, selection mechanism undecided |
| Revocation / freshness | **NOT MET** — mechanism exists, window undecided |
| `read-own` semantics | **NOT MET** — two candidate mechanisms |
| Manager scope | **PARTIAL** — enforcement exists; principal→employment missing |
| Platform/Work ownership | **NOT MET** — the §A ratification |
| Local development grants | **NOT MET** |

### Approval

| Requirement | Status |
| --- | --- |
| Security/Platform owner approval of the complete trust boundary | **NOT MET** |

**Authentication: 1 met of 11. Authorization: 2 met, 2 partial, 7 unmet of 11. Approval: unmet.**
**Implementation is not authorized and must not begin.**

## Q. Future implications

- **Nothing ships to a customer until both seams close.** All nine slices have only ever rendered
  production data through scratchpad stubs; every business route answers 401, and all 326 write
  routes are unreachable from every portal.
- **Order matters, and it is not the obvious one.** Authentication first is necessary but yields
  *nothing observable* on its own — an authenticated caller with an empty grant set gets 403
  everywhere, which looks identical to a broken deployment. **The first genuinely demonstrable
  milestone is authentication *plus* a grant source**, and it should be planned as one deliverable.
- **The first thing that works will be Approvals.** `workflow.approval.read-own` guards two
  membership-derived queue reads on a screen that already exists — no product code required, once
  a principal and a grant exist.
- **Self-Service still needs three things beyond both seams**: an employee-safe self-resolution
  read, the one-to-many employment rule, and a Payroll contract change nobody has authorized.
- **Manager Workspace needs the caller's employment plus team-scoped reads in five modules that
  publish none.**
- **If §A is refused**, authorization has no available implementation at all until Platform builds
  a service (Option A) or an operations-owned store appears (Option C) — and that should be stated
  plainly in the decision meeting rather than discovered afterwards.

## R. Verification

`pnpm verify` with every cache cleared and PostgreSQL 16 live (`TEST_DATABASE_URL` set; **31
migrations applied; 187 tables**, of which zero are role, permission or grant tables). As in the
preceding tasks, the chained script forwards `--force` only to its final command, so each turbo
stage was forced explicitly and tests ran with the script's own `--concurrency=1`:

- `pnpm standards` — engineering standards; architecture (186 models); localization (20/20);
  dependencies (2028 files, no cycles, no unused, no unreachable); **platform parity: 5 packages =
  lockfile, all `registry`, `@munaxa/platform` 1.6.1**.
- `pnpm format:check` — clean.
- lint **51/51 tasks, 0 cached** — 1m47.082s.
- typecheck **51/51 tasks, 0 cached** — 37.247s.
- test **51/51 tasks, 0 cached** — 7m37.861s: **471 test files passed, 5,401 tests passed, 0 failed,
  0 skipped** — unchanged from baseline, as a consolidation requires.
- build **29/29 tasks, 0 cached** — 1m6.088s. **Exit 0.**

No production behaviour changed. No production code, package version, lockfile entry, environment
file, permission, contract, migration or CI file changed. Working tree clean; the only addition is
this document.
