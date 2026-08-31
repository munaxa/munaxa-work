# Munaxa Work — Security Foundation Owner Decision Record

**Decision form only. Nothing was implemented, and no decision below is approved.** No
authentication, authorization, issuer, token, grant store, migration, permission, contract, route,
module, portal, CI or dependency change. The only repository change is this file.

**Every status in this document is `UNRESOLVED` or `BLOCKED`.** No owner approval exists in this
repository: the word "APPROVED" appears nowhere in the decision package, every commit on this
branch since `bd729c4` is Claude's, and no configuration, key, issuer or grant seed has been
provisioned. A recommendation is not an approval, and neither is a commit that contains one.

Re-derived from current source at `a6d2ab6` rather than copied from the earlier records; the
re-evaluation changed three things, noted in §H and §K.

---

## A. Executive summary

Munaxa Work has a complete authorization pipeline, a real membership and tenant model, 285
declared permissions and nine shipped product slices — and **not one of them can serve a real
customer**, because two Platform-owned seams are unimplemented and either one alone refuses every
request.

The recommended architecture, unchanged and not reopened:

```text
External Munaxa issuer → verified principal → Work membership → Work-held role assignments
    → Platform RBAC resolver → PlatformPermissionChecker → existing Work authorization → handler
```

Work is a **relying party** for identity (it must never host credentials) and a **store** for
authorization assignments (it must never resolve or decide them). Platform owns verification, the
RBAC engine and the permission decision. Grants are resolved live; token-carried grants are
refused because a signed token cannot be un-issued.

**What remains is not engineering — it is five decisions and one operational deliverable.** With
them, the Work-side change is one adapter, one resolved grant set, configuration, and tests; the
`/approvals` screen needs no product change at all. Without them, implementing would require
inventing an issuer, a claim set, a key distribution mechanism and a grant model, which every
prior brief has forbidden.

## B. Current security boundary

| Layer | State today | Owner |
| --- | --- | --- |
| **Principal** | `PlatformAuthenticationPort` declared; `UnauthenticatedPort` is the only implementation and authenticates nobody (`identity.module.ts:114`) | Platform |
| **Membership** | **Real.** `PostgresMembershipDirectory`; `activeMembershipsOf(platformUserId)` returns active memberships only — suspended, invited and ended excluded | Work |
| **Tenant** | **Real.** Resolved from the membership; `x-munaxa-tenant` selects among stored facts and can never grant (ADR-0032) | Work |
| **Grants** | **None.** `PlatformPermissionChecker` is constructed with an empty set (`identity.module.ts:149`); zero role/permission/grant tables among 187 | Platform (engine), unresolved (store) |
| **Permission checker** | Real seam; `holds(permission)`; wrapped by `GrantAwarePermissionChecker` for bounded service grants (ADR-0043) | Platform contract, Work decorator |
| **Module authorization** | **Real.** `Dispatcher`: tenancy → authorization → validation → handler; 285 permissions; deny by default | Work |

Net effect: a request that arrives today establishes no principal, therefore no context, and the
global `AuthenticatedTenantGuard` returns **401** before validation.

## C. Decision 1 — Authorization ownership

**Question.** May Munaxa Work host the role/assignment persistence layer while Platform remains
the sole authorization engine, grant resolver and permission decision authority?

**Evidence.**

- The platform ships **libraries, not a service**: its architecture document describes four layers
  whose point is that *"a product [can] adopt one package without adopting all twelve."* There is
  no authorization service to call, in any repository.
- `MemoryRoleRepository`: *"Products back these with their own database."*
- Threat model, out of scope: *"**Product authorization semantics.** The platform decides whether
  a principal has a permission. What permissions exist, and which resource each guards, is a
  product's design."*
- Threat model, on revocation: *"A product mutating role assignments directly must do the same"*
  (call `invalidateUser`) — a product that never held assignments could not mutate them.
- Work holds **zero** authorization tables today, and `ResolvedMembership` carries no roles or
  permissions, so nothing can resolve a grant from Work's database as it stands.

**Recommended answer.** Yes, with the boundary stated explicitly: **hosting the store is not being
the authority.** Work would persist tenant-scoped role assignments and expose them to
administration; Platform's `PermissionResolver` resolves them and Platform's `PermissionChecker`
contract decides. Work supplies rows and asks yes/no questions. The proposed split:

```text
Work owns:      tenant-scoped role assignments · membership → assignment · the 285-permission vocabulary
Platform owns:  RBAC semantics · grant resolution · permission evaluation · caching and invalidation
```

**This reverses the reading Work has been enforcing** ("Work must never become a second
authorization authority"), which is stricter than the platform intends. The reconciliation must be
deliberate, which is why it is Decision 1.

**Owner:** Security. **Status: `UNRESOLVED`.**

**Required input:** approve, reject, or select the recorded variant in which Work holds
*assignments* while *role definitions* are owned centrally and distributed as configuration.

## D. Decision 2 — Revocation

**Question.** What is the authorization revocation guarantee, and who is responsible for
invalidation?

**Evidence.** `PermissionResolver` resolves live from stores and invalidates explicitly, because
*"a permission cache that only expires by TTL means a revoked role stays effective for the length
of that TTL — which is exactly the window an attacker needs after an administrator notices
something is wrong."* The platform's own residual-risk note: *"The window is the cache TTL — 60
seconds by default — and every mutation path in the platform closes it explicitly."*

**Required guarantee — the owner must state each line:**

| Event | Effective when | Note |
| --- | --- | --- |
| Role removed / permission removed from role | ? | Needs `invalidateUser`; owner names the caller |
| Grant assignment revoked | ? | Same |
| Membership disabled or ended | **Next request** | Already true — `activeMembershipsOf` excludes it, so no context is built |
| Workforce user disabled | **Next request** | Already true, same mechanism |
| Manager-scope change (reporting line) | **Next query** | Already true — resolved live from Employment |
| Tenant membership removed | **Next request → 401** | Already true |

Four rows are already guaranteed by existing code. **Two rows — the ones that depend on the grant
store — have no answer, and no TTL is proposed here.** Whether *any* caching is permitted is the
owner's call; the architecture supports live resolution with no cache at all.

**Owner:** Security. **Status: `UNRESOLVED`.**

**Required input:** the acceptable window (or "no caching"), and who calls `invalidateUser` on
each mutation path.

## E. Decision 3 — Permission vocabulary

**Work's vocabulary:** `resource.action` — dot-separated, three segments typical
(`relations.violation.read`). 285 constants across 18 modules, aggregated by
`ModuleRegistry.describe()`.

**Platform's vocabulary:** `resource:action` — colon-separated, segments matching
`[a-z0-9][a-z0-9_-]*`, **dots excluded**. Wildcards permitted in a grant, rejected in a check.

**Measured, not estimated: 0 of Work's 285 permission strings are valid platform check strings.**
The two express the same conceptual model — hierarchical, deny-by-default, resource-and-action —
and Work's third segment is a sub-resource the platform grammar expresses natively.

| Option | What it means | Consequence |
| --- | --- | --- |
| **A — translate at the seam** | Work keeps its 285 strings; the adapter maps them | Smallest Work change. **Two administrator-visible populations differing only by punctuation** — a support-call generator |
| **B — widen the platform grammar** | Platform accepts `.` in a segment | One Platform change, every product benefits; no Work change; needs a platform release |
| **C — platform aliases** | An explicit alias/normalisation table | Most flexible, most machinery; **no alias hook exists today** |

No mapping was performed, no permission renamed, no dot-to-colon conversion applied.

**Owner:** Platform. **Status: `UNRESOLVED`.**

**Required input:** select A, B or C. If A, confirm which vocabulary an administrator sees when
granting a role.

## F. Decision 4 — Authentication issuer

**Question.** Who owns and operates the issuer, and what exactly does it emit?

| Parameter | Required value | Status |
| --- | --- | --- |
| Issuer owner | — | **BLOCKED** — no issuer exists in any repository |
| Issuer URL | — | **BLOCKED** |
| `iss` | Compared **exactly**; not normalised, not trailing-slash-insensitive | **BLOCKED** |
| `aud` | Must contain Work's audience | **BLOCKED** |
| `sub` | **Must carry the stable `platformUserId`** — immutable for the life of the account (AD-004). Not a membership, not an employment, not an email | Proposed; issuer must confirm |
| Algorithm | `RS256` or `ES256` — asymmetric so a verifier cannot mint | Recommended; **unratified** |
| Key format | PEM public keys, `kid`-addressed | Recommended; **unratified** |
| `kid` | Header carries it; used for **key selection only**, never for algorithm | Settled by platform code |
| Public-key distribution | **Static distribution.** JWKS is listed by the platform's own audit among capabilities *absent by decision* | **BLOCKED** — mechanism undefined |
| Rotation | Multiple `kid`s verifying simultaneously; overlap window; nothing schedules rotation today | **BLOCKED** |
| Token lifetime | Short; Work has no refresh endpoint and would see none | **BLOCKED** |
| Expiry semantics | `exp` enforced with bounded skew (platform default 30s) | Settled by platform code |
| Transport | `Authorization: Bearer` — already what Work reads and what the platform accepts; query-string tokens rejected outright | **Settled** |
| Reverse-proxy / header trust | Whether Work is reachable directly, who terminates TLS, what authenticates an upstream | **BLOCKED — unknown** |

**JWKS must not be assumed.** If the owner selects JWKS, it is **new Platform work** and must be
scheduled as such, not treated as existing.

**Owner:** Platform / Security. **Status: `BLOCKED`.**

## G. Decision 5 — Operations

Nothing in this list was created, and none may be improvised.

| Deliverable | Status |
| --- | --- |
| Production issuer deployment | **BLOCKED** |
| Production public-key distribution | **BLOCKED** |
| Key rotation procedure | **BLOCKED** |
| **Local issuer or approved local authentication mechanism** | **BLOCKED** — `docker-compose.yml` runs PostgreSQL, Redis and Mailpit only |
| Local development credentials/tokens | **BLOCKED** |
| **Development grant seed** | **BLOCKED** — needed even with an issuer, or every authenticated local request returns 403 |
| Secret management mechanism | **BLOCKED** |

The local environment must be a **real issuer with development keys**, so the local path is the
production code path with different data — never a bypass, a fixed user, a default tenant or an
injected grant.

**Owner:** Operations. **Status: `BLOCKED`.**

## H. Non-blocking decisions

Re-verified from source for this record, not carried over:

**1. `read-own` needs no new architecture for the Approvals proof — confirmed.**
`PendingApprovals` declares only `page?` and `size?`; the controller passes only `paged(query)`;
the admin client calls `/approvals/pending?page&size`. The subject comes from
`currentMembership()`. There is no parameter through which a caller could name someone else's
queue, and *"its absence is the control."* **No Self-Service work is required to prove
`/approvals`.**

**2. Membership selection is accepted as-is — confirmed.** `resolveTenant` yields exactly four
outcomes — `no-membership`, `resolved`, `not-a-member`, `ambiguous` — places **exactly one**
membership in the `ExecutionContext`, and has no default (*"picking the first… would put a
consultant's work into the wrong customer's tenant the one time it mattered"*). No code path
unions, flattens or concatenates memberships; verified by search. **Recorded as: existing
mechanism accepted for the Security Foundation.** No source evidence contradicts this.

**3. The Approvals UI already distinguishes refused from empty — confirmed.**
`apps/admin/src/approvals/queue.tsx` renders `<Refused>` when a queue read returned nothing and an
empty state otherwise, and `routes.test.tsx` carries the test *"says the queue was withheld, never
that it is clear."* **The critical invariant — refusal must never render as "nothing is waiting
for you" — already holds.** No UI work is required.

**4. A new observation, surfaced while verifying (3), that the implementation task will need.**
`apps/admin/src/approvals/api.ts` collapses **every** non-OK response into `undefined`:

```ts
if (!response.ok) return undefined;
```

So **401 and 403 render identically** on `/approvals` — both as "withheld". The safety invariant
holds (neither becomes an empty queue), and the API layer distinguishes them correctly per the
guard, but at the UI layer the proof's **Case B (authenticated, no grant)** and **Case C (no
authentication)** are indistinguishable. This is not a blocker and requires no decision now; it
means the implementation task must prove B and C **at the API layer**, or be separately authorized
to make a small change to that composition layer. Recorded so it is not discovered mid-task.

## I. Combined security flow

```text
Authorization: Bearer <token>                    ← bytes only; Work parses nothing
        │
        ▼  Platform verifier            iss · aud · exp · signature by kid        [DOES NOT EXIST]
   PlatformPrincipal { platformUserId, issuer, email?, authenticatedAt }
        │
        ▼  Work · Identity              activeMembershipsOf(platformUserId)       [REAL]
   memberships → x-munaxa-tenant selects → exactly one; no default
        │           tid, if present, must MATCH — it validates, never selects
        ▼
   ExecutionContext { tenantId, userId, membershipId, actor, correlationId }      [REAL]
        │
        ▼  Platform · PermissionResolver over assignments                         [STORE UNDECIDED]
   effective grants — tenant-scoped, expiry-filtered, live
        │
        ▼  PlatformPermissionChecker → GrantAwarePermissionChecker (ADR-0043)     [SEAM REAL, EMPTY]
        ▼  Dispatcher: tenancy → authorization → validation → handler             [REAL]
        ▼  /approvals                                                             [REAL, SHIPPED]
```

## J. Security invariants

Carried forward unchanged; each must survive implementation:

1. Identity is cryptographically verified — signature checked against the **verifier's** algorithm,
   never the token header's.
2. Client input cannot establish identity.
3. Client input cannot establish tenant authority — the header selects among stored memberships.
4. Client input cannot establish employment authority.
5. Token claims cannot establish grants — `perms`/`roles`/`scope` are discarded; *"groups are
   input, not authority."*
6. Grants come from the approved authoritative source, resolved live.
7. Membership determines tenant authority.
8. **`tid` validates, never selects.** Token tenant ≠ membership tenant → **REFUSE**; never switch,
   prefer or ignore.
9. Grants are never unioned across memberships.
10. Cross-tenant authorization is impossible.
11. Revoked authorization becomes ineffective within the approved guarantee.
12. An employee cannot obtain another's access by changing an identifier.
13. A manager cannot obtain another team's access by changing an identifier.
14. Work never becomes a second authentication authority.
15. Work never becomes a second authorization *engine* (it may hold the store if Decision 1
    approves).
16. **Authorization refusal never masquerades as an empty successful result.**
17. Existing module authorization remains intact.

## K. Implementation Definition of Ready

Implementation may begin when **all** of the following hold:

**Approved decisions** — Decision 1 (authorization ownership), Decision 2 (revocation guarantee
and invalidation ownership), Decision 3 (vocabulary option), Decision 4 (complete issuer contract,
every row of §F), Decision 5 (all seven operational deliverables).

**Provided artefacts** — a running issuer (production and local); public keys with `kid`s and a
distribution mechanism; a development grant seed; a secret-management mechanism.

**Explicit sign-off** — the Security owner approves the trust boundary as a whole (§I and §J).

**Two changes from the earlier readiness lists, from this re-evaluation:**

- **`read-own` and membership selection are removed as blockers** for the Security Foundation
  (§H.1, §H.2). Earlier records listed both as unresolved; for the `/approvals` proof
  specifically, neither requires a decision.
- **The development grant seed is promoted to a blocker.** It was previously recorded as a
  local-development nicety; it is not. Without it, an authenticated local caller receives 403 on
  every route and the proof cannot be demonstrated at all.

## L. Owner sign-off table

| Decision | Owner | Status | Required input |
| --- | --- | --- | --- |
| Authorization ownership | Security | `UNRESOLVED` | Approve / reject Work-held assignments with Platform as sole resolver and decider; or select the central-role-definitions variant |
| Revocation | Security | `UNRESOLVED` | Acceptable window (or "no caching"); who calls `invalidateUser`; which events invalidate |
| Permission vocabulary | Platform | `UNRESOLVED` | Option A, B or C; and which vocabulary an administrator sees |
| Issuer contract | Platform / Security | `BLOCKED` | Issuer owner and URL; `iss`; `aud`; `sub` confirmation; algorithm; key format; distribution; rotation; lifetime; proxy trust model |
| Issuer operations | Operations | `BLOCKED` | Production issuer, key distribution, rotation procedure, secret management |
| Local development | Operations | `BLOCKED` | Local issuer or approved mechanism; development credentials; **development grant seed** |

No status may change to `APPROVED` except by explicit owner action. This document does not
constitute approval, and neither does the commit containing it.

---

## Owner decision request

*Copy the section below into the decision meeting. These are the only questions that genuinely
block the Security Foundation; everything else is either settled or not on this path.*

### Security Owner

1. **Authorization ownership.** May Munaxa Work host tenant-scoped role assignments in its own
   database, while Platform's RBAC remains the sole grant resolver and permission decision engine?
   Work would store and administer assignments; it would never resolve, interpret or decide them.
   *(If you prefer, a variant is available in which Work holds assignments while role definitions
   — which permissions a role grants — are owned centrally and distributed as configuration.)*
2. **Revocation.** What is the required revocation guarantee — live resolution with no caching, or
   a bounded window (and how long)? Who is responsible for calling `invalidateUser` when a role or
   assignment changes?

### Platform Owner

3. **Permission vocabulary.** Work declares 285 permissions as `resource.action`; Platform RBAC
   validates `resource:action` and rejects all 285 today. Choose: **(A)** translate at the
   adapter, Work's strings unchanged; **(B)** widen the platform grammar to accept Work's form;
   **(C)** add an explicit alias mapping to the platform. If (A), which form does an administrator
   see when granting a role?
4. **Issuer contract.** Who owns and runs the issuer that mints tokens for Work's users, and what
   are its `iss`, `aud`, `sub` semantics, signing algorithm, public-key format and distribution,
   `kid` rotation procedure, and token lifetime? Confirm whether Work is ever reachable directly
   or always behind an edge, and what authenticates that edge. **JWKS is not an existing platform
   capability — selecting it schedules Platform work.**

### Operations

5. **Infrastructure.** Provision the production issuer, public-key distribution and rotation
   procedure; a **local issuer or approved local authentication mechanism**; local development
   credentials; a **development grant seed** (without which every authenticated local request
   returns 403 and nothing can be demonstrated); and a secret-management mechanism.

**Nothing else blocks.** Once these five are answered and provisioned, the Work-side implementation
is one authentication adapter, one resolved grant set injected at an existing seam, configuration,
and the security test suite — and `/approvals` proves it without a single product change.

---

## Verification

Documentation-only, so the smallest appropriate verification was run rather than the full gate,
per the instruction not to represent a previous run as a new one:

- `git diff --name-only` / `git status` — **one file changed**:
  `docs/verification/security-foundation-owner-decision-record.md`. No production source, package,
  lockfile, environment, migration, CI or generated file.
- `npx prettier --check` on the document — passes.
- No credentials, secrets, tokens, `file:` dependencies, local paths or scratchpad content.

**`pnpm verify --force` was not re-run.** No production code changed, and the full gate last
passed on this exact tree content at commit `a6d2ab6` — standards, parity (5 packages from the
registry, `@munaxa/platform` 1.6.1), format, lint 51/51, typecheck 51/51, test 51/51 against live
PostgreSQL (31 migrations, 187 tables; **471 files, 5,401 tests, 0 failed, 0 skipped**), build
29/29, all forced with 0 cached, exit 0. That is a prior result and is cited as one.
