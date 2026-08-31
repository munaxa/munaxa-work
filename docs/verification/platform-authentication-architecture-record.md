# Platform Authentication — architecture record

**Architecture definition only. Nothing was implemented.** No adapter, no issuer, no login, no
`/me`, no portal, no permission, no contract, no migration, no Platform change. The only
repository change is this file.

This record answers one question with evidence rather than preference:

> Where does Munaxa Work's trust in a caller's identity begin, and who is responsible for
> establishing it?

Everything below is measured from current source at `b3da5d6` — Work, the `@munaxa/platform`
monorepo, and the sibling ecosystem repositories available in this environment. Where the
previous records and current source disagree, **source wins and the discrepancy is recorded.**

---

## A. Executive decision

**Recommended: Model A — Work as a relying party**, with one correction to how that has been
described so far, and one condition that must hold before it is safe.

- Work continues to verify nothing about a credential's *contents* on its own authority. It
  receives a token, hands it to a Platform-supplied verifier, and gets back a principal or
  nothing. This is what the kernel port, ADR-0032 and every module's authorization comment
  already assume, and it is the only model under which Work does not become an identity system.
- **The correction**: the platform's shipped `TokenService.verifyAccessToken` verifies tokens
  against a signer the *verifier* holds — a configured public key, not a fetched key set. The
  platform's own production-readiness audit lists *"JWKS verification for client-supplied id
  tokens"* among capabilities **absent by decision**. So Model A is available today **only with
  statically distributed public keys** (`AsymmetricSigner` in verify-only mode, `RS256`/`ES256`,
  multi-`kid` for rotation). A JWKS-discovery relying party is not a thing this platform can do
  yet, and specifying one would be specifying work nobody has scheduled.
- **The condition**: an issuer must exist. None does (§E). Until one does, Model A is a
  destination, not an implementation.

**Model B — Work hosts login — is recommended against**, on evidence rather than effort (§L): it
requires Work to store credentials it deliberately does not model, and the repository's own
`WorkforceUser` is structurally incapable of holding one without becoming the second identity
system every governing document forbids.

**And the finding that outranks both**: authentication is **not** the last blocker. There are
**two** unimplemented Platform seams, not one, and the second one refuses everything on its own
(§I). This corrects my two previous records, which said the authentication adapter was "the whole
of the Work-side change."

## B. Current state

| Component | State |
| --- | --- |
| `PlatformAuthenticationPort` (kernel) | Declared. `authenticate(credentials) → PlatformPrincipal \| undefined` |
| `UnauthenticatedPort` | The only implementation. Authenticates nobody. Wired at `identity.module.ts:114` |
| `PlatformPermissionChecker` | **Constructed with an empty grant set** at `identity.module.ts:149`. Returns `false` for every permission, for every caller |
| `TenantMembershipDirectory` | **Real.** `PostgresMembershipDirectory` is wired (`identity.module.ts:119`); `DenyAllMembershipDirectory` is the fallback that exists so failure is refusal |
| `AuthenticatedTenantGuard` | Real, global, `@PublicRoute()` is the exemption; health is its only use |
| Tenant resolution | Real, four outcomes, no default (§G) |
| Employment link | Real aggregate, real store, real read |
| Auth configuration in Work | **None.** No `AUTH`, `JWT`, `ISSUER`, `JWKS`, `OIDC` or key variable in `packages/config` or `.env.example` |

So: of the four things a request needs — a principal, a tenant, a membership, and a permission
set — **Work supplies two and stubs two, and both stubs are Platform's.**

## C. Trust boundary

The ten answers §2 asks for, from source:

1. **What enters from outside**: an HTTP request. `credentialsFrom()` reads only the
   `Authorization` header and splits it into `{ scheme, value }` — *"a token this repository can
   decode is a token this repository would eventually be tempted to trust."* An
   `x-munaxa-tenant` header may also arrive.
2. **Where authentication is established**: `TenantMiddleware.use()`, first statement, before any
   context exists.
3. **What is trusted to assert identity**: the implementation behind `AUTHENTICATION_PORT`, and
   nothing else. Not the request, not a gateway, not a header.
4. **What Work may trust from the request**: the *bytes* of the credential (to hand onward), and
   the tenant header **only as a selector over already-computed stored facts**. Nothing else.
5. **What Work must derive from its own database**: tenant membership, workforce user, employment
   link, person, and every permission-relevant fact.
6. **Tenant context**: `resolveForPrincipal()` → `runInContext()`. Never from a request value
   alone.
7. **Membership**: `TenantMembershipDirectory.activeMembershipsOf(platformUserId)` — active
   memberships only; suspended, invited and ended are excluded.
8. **Employment**: *not established at all today.* Identity's `EmploymentLink` maps
   membership → employment, but no request-time resolution uses it (§H).
9. **Authorization begins**: `Dispatcher` — tenancy, then authorization, then validation, then
   handler, *"in that order deliberately — an unauthorized caller learns nothing about whether"*
   their payload was well-formed.
10. **Never accepted directly from a request**: identity, membership, employment, permissions,
    tenant-as-grant, or any `employmentId`/`membershipId` treated as a credential. Workflow's
    queue read states the rule exactly: *"There is no parameter for whose queue to read, and its
    absence is the control… a `?membershipId=` would be an IDOR wearing a permission's name."*

## D. Platform security capabilities (inspected, not inferred)

From `@munaxa/platform`'s `packages/platform/*` source; all six packages are **published at
2.4.1** to the registry Work's parity guard already enforces.

**`@munaxa/auth`** — `TokenService.issueAccessToken` / `verifyAccessToken` / `decodeUnsafe`.
Claims: `sub, tid, sid?, did?, iss, aud?, iat, exp, jti, ver, amr?, mfa?, scope?, roles?, perms?`.
Verification checks, in order: three-part shape; **signature against the signer's own algorithm,
never the header's** (*"A token claiming `alg: none` fails here"*); `exp` with skew; `iat` not in
the future; `iss` exact; `aud` intersection; optional `ver` staleness. Also
`RefreshTokenService` (opaque, hashed at rest, single-use, reuse revokes the family),
`LoginService`, `MfaService`, `PasswordPolicyService`, `machine.ts` (API keys / M2M), and
`OidcProvider` implementing `IdentityProviderPort` — full OIDC with mandatory PKCE,
constant-time `state`, nonce bound to the id token, server-side code exchange.
`bearerToken()` accepts **only** the `Authorization` header; tokens in query strings are rejected
outright. `SESSION_COOKIE`/`REFRESH_COOKIE` are `__Host-`-prefixed, `httpOnly` and `secure`
non-negotiably, `sameSite` narrowable but never widenable past `lax`.

**`@munaxa/crypto`** — `SignatureAlgorithm = 'HS256' | 'HS512' | 'RS256' | 'ES256'`. `Signer` is
`{ algorithm, kid?, sign, verify }`. `HmacSigner` over a `KeyRing`; `AsymmetricSigner(algorithm,
keys[])` where **`privateKey` is optional — "Absent on verify-only nodes"** — holding a `kid`-keyed
map and verifying against the public key alone. Its own comment names Work's exact case: *"Worth
the cost when the verifier is not us… because it can verify without holding anything that lets it
mint tokens."* `KeyRing.rotate()` adds material under a new `kid` while old material still
verifies, and refuses to retire a primary.

**`@munaxa/types`** — `Principal` is a union of `user | service | api-key | system | anonymous`;
`BasePrincipal` requires `tenantId` and may carry `permissions`, `roles`, `claims`.
`SecurityContext` is `{ tenantId, principal, correlationId, sessionId?, deviceId?, ipAddress?,
… }` — with *"Client address as the edge resolved it. Never read straight from
`X-Forwarded-For`"* and `attributes` marked *"never trusted for authorization decisions."*

**`@munaxa/interfaces`** — `UserDirectoryPort` (`findByIdentifier`, `findById`,
`updatePasswordHash`, `incrementTokenVersion`, `setStatus`) over a `CredentialRecord`
(`identifier`, `passwordHash`, `status`, `tokenVersion`, `mfaEnrolled`, …); `SessionStorePort`,
`RefreshTokenStorePort`, `PasswordHistoryPort`, `BreachRegistryPort`, `IdentityProviderPort`.

**`@munaxa/session`** — *"the platform does not treat a signed token as a session. A token cannot
be un-issued, so anything a product promises a user — 'sign out everywhere', 'revoke this
device' — has to be backed by server-side state that is actually consulted."* Two persistence
models: a sessions table, or refresh-token lineage.

**`@munaxa/rbac`** — `Authorizer`/`PermissionResolver`/`PolicyEngine`, taking a `SecurityContext`
whose `principal` is already established. It **consumes** identity; it never establishes it.

**Documented as absent by decision** (platform production-readiness audit §7): SAML (port throws),
passkeys/WebAuthn, hardware keys, magic links, **JWKS verification for client-supplied id
tokens**, KMS/HSM signing, scheduled key rotation (`KeyRing` supports it; nothing schedules it),
SCIM/directory sync. The audit also records `providerPresets.firebase` as a hazard *precisely
because* `OidcProvider.completeAuthorization` does not verify an id token's signature — safe only
when the token comes straight from the token endpoint over TLS.

## E. Issuer investigation

Searched `munaxa-work`, `munaxa-platform`, `munaxa/munaxa-platform`, `munaxa/munaxa-docs`,
`munaxa/munaxa-school` for issuer, identity provider, JWKS, signing key, `iss`, `aud`, OAuth,
OIDC, access/refresh token, session, platform user.

| Question | Answer |
| --- | --- |
| Does an issuer exist that mints tokens for Work's users? | **No.** |
| Where would it run? | Undetermined — no service, no deployment manifest, no configuration anywhere names one. |
| Is one implemented? | **Munaxa Docs implements its own product-local auth** (`POST /api/v1/auth/login`, `/refresh`, `/logout`, `GET /auth/me`, with an OIDC federation module and its own `TOKEN_VERIFIER`). It issues **for Docs**, not for the ecosystem; nothing in it references Work. |
| Is one deployed? | No evidence. Work's `docker-compose.yml` runs PostgreSQL and Redis and states *"Nothing here is a deployment artifact."* |
| Merely planned? | Yes. `docs/security-platform/migration/munaxa-work.md` opens: *"**Nothing in this guide has been executed.** Phase P1 built the platform; migrating Work is a later phase."* Its sequencing note: *"Sequence Work third"* — behind Docs and School, neither of which has migrated. |
| Can Work consume it? | Not today. There is nothing to consume. |
| Is an issuer contract documented? | **Partially, and not for this shape.** The platform documents how a product *issues* its own tokens (developer guide wiring `TokenService` with `config.MUNAXA_TOKEN_ISSUER` / `MUNAXA_TOKEN_AUDIENCE`). No document defines a *shared* issuer that several products verify against. |

Per §4's instruction, the unexecuted migration guide is **not** treated as an existing
implementation.

## F. Token contract (what Model A would require)

Specified only where the platform actually supports it; everything else is an owner decision in
§Q and is marked as such rather than invented.

| Element | Requirement | Status |
| --- | --- | --- |
| Transport | `Authorization: Bearer <jwt>`. Already what `credentialsFrom()` reads and what `bearerToken()` accepts; query-string tokens are rejected by the platform outright | **Settled by existing code** |
| Format | Compact JWS, three parts, `kid` in the header — used *for key selection only* | **Settled** |
| Algorithm | `RS256` or `ES256`. Never `HS256` for a verifier that must not be able to mint | **Recommended; owner confirms** |
| Signature | Verified by `AsymmetricSigner.verify` against the algorithm Work configured, never the header's | **Settled** |
| `iss` | Exact match against configured value. Not normalised, not trailing-slash-insensitive | **Value unknown** |
| `aud` | Must contain Work's audience identifier | **Value unknown** |
| `sub` | **Must be the stable Platform user identifier** Work stores as `platformUserId` — immutable for the life of the account (AD-004). Not a membership, not an employment, not an email | **Semantics defined here; issuer must confirm it emits this** |
| `exp` / `iat` | Enforced with a bounded skew (platform default 30s) | **Settled; TTL unknown** |
| `ver` | Optional staleness check; meaningful only if Work stores a token version, which it does not | **Not used under Model A** |
| `tid` | See §G | **Owner decision** |
| `perms` / `roles` / `scope` | **Discarded.** Authentication must not grant authorization (§I) | **Rule defined here** |
| Key distribution | Configured public key(s) with `kid`s. **Not JWKS** — the platform does not implement it | **Mechanism unknown** |
| Rotation | Multiple `kid`s configured simultaneously; overlap window; `KeyRing`/`AsymmetricSigner` support it; nothing schedules it | **Process unknown** |

Minimum claims Work may rely on: **`iss`, `aud`, `sub`, `exp`, `iat`, and the header `kid`.**
Everything else is either unused or explicitly discarded.

## G. Tenant semantics — the `tid` conflict, resolved explicitly

The conflict is real: platform access tokens carry `tid`, `BasePrincipal.tenantId` is required,
and ADR-0032 says the tenant *"is resolved from a **tenant membership** — a row Munaxa Work wrote
when a tenant admitted a person… It is never taken from the request."*

**The rule this record proposes, for owner approval — ADR-0032 is not silently reinterpreted:**

> `tid` is a **validation constraint**, never an authority.
>
> 1. Work resolves the tenant exactly as it does today: `activeMembershipsOf(sub)` → the
>    membership set → the `x-munaxa-tenant` selector, with no default. **ADR-0032 stands
>    unchanged.**
> 2. If the token carries `tid`, and the resolved membership's tenant differs from it, the
>    request is **refused** — not switched, not preferred, not ignored silently. A token minted
>    for tenant A used to act in tenant B is a fault worth surfacing even though the membership
>    lookup already made it harmless.
> 3. `tid` alone never selects a tenant, and never substitutes for a membership. A principal with
>    a valid `tid` and no membership resolves to nothing.

Rationale: ADR-0032's distinction is between a *claim* and a *fact*. A signed `tid` is a
**verified claim about what the issuer believed**, which is strictly better than an unsigned
header and still weaker than a membership row Work wrote itself — and only the membership row
knows whether the person is *still* an active member, which a token minted an hour ago does not.
Constraint-not-authority keeps the stronger fact authoritative while making a genuine mismatch
loud.

## H. Identity chain

```text
credential ──▶ [Platform verifier] ──▶ sub = platformUserId
                                              │
                          activeMembershipsOf(platformUserId)   ← Identity, real, PostgreSQL-backed
                                              │
                                 0 · 1 · many memberships
                                              │  x-munaxa-tenant selects; no default
                                              ▼
                                    membershipId  (ExecutionContext)
                                              │
                            EmploymentLinkStore.forMembership(membershipId)   ← exists, unused at request time
                                              │
                                 0 · 1 · many employment links (one isPrimary)
                                              ▼
                                        employmentId
                                              │  EmploymentView.personId
                                              ▼
                                          personId
```

| Transition | Existing API / query | Contract | Permission | Owner | Cardinality | Failure behaviour |
| --- | --- | --- | --- | --- | --- | --- |
| principal → membership | `TenantMembershipDirectory.activeMembershipsOf` | `ResolvedMembership` | none (pre-context infrastructure) | Identity | one-to-many | none → `no-membership`; several + no selector → `ambiguous`; wrong tenant → `not-a-member`. All → no context → 401 |
| membership → employment | `EmploymentLinkStore.forMembership`; published as `GET /identity/members/:membershipId` (`identity.describe-member`) | `EmploymentLinkView[]` | `identity.membership.read` — **an administrator grant** | Identity | **one-to-many**, `isPrimary` flags one, links have `linked`/`unlinked` status | undefined today: no request-time resolution exists |
| employment → person | `GET /employments/:id` | `EmploymentView.personId` | `employment.read` | Employment | one-to-one | 404 / 403 as normal |

**Two findings that matter more than the diagram.** First, the only published way to read a
membership's employment links is guarded by `identity.membership.read` — a grant a self-service
employee must not hold, so "resolve my own employment" has **no published read today**. Second,
the relationship is genuinely one-to-many (AD-005/AD-006: a person may hold two jobs), so
"the caller's employment" is not well-defined without a rule — `isPrimary`, or an explicit
selection. Both are owner decisions, and neither was implemented.

## I. Authorization — the second seam, and a correction

**`PlatformPermissionChecker` is constructed with an empty set:**

```ts
new GrantAwarePermissionChecker(new PlatformPermissionChecker(), …)   // identity.module.ts:149
```

Its own comment: *"An authenticated context holds only what this deployment was configured to
grant. The set is empty unless a deployment supplies Platform's checker, so a deployment that
forgets to wire authorization serves 403 to everything."*

Identity reaches authorization through `currentContext()` inside `PermissionChecker.holds()`,
which the `Dispatcher` calls before validation for every command and query. That is the
integration point, and it needs no change.

**The correction to my own previous records.** Both the direction investigation and the adapter
readiness record stated that the authentication adapter was the whole of the Work-side change,
and that Workflow's two self-scoped queues would go live *"with zero product code"* once a
principal existed. **That is wrong.** With a perfect authentication adapter and an empty grant
set, `workflow.pending-approvals` fails its permission check and returns 403. Authentication
answers *who*; this seam answers *what*; **both are Platform's, both are stubs, and neither
alone unlocks anything.** Nothing in Work compensates for that, and nothing should: Work
*declares* the 285 permissions its handlers require so Platform has something to grant, and this
record proposes no change to any of them.

## J. Self-Service implications

The semantic must be *"the caller's own record, derived from context"* — never *"the record whose
identifier the caller supplied."* Workflow already demonstrates the safe shape: no parameter for
whose queue to read.

Minimum required, none of it implemented here:

1. Authentication (§A) and a non-empty grant set (§I).
2. A **request-time membership → employment resolution** that does not require
   `identity.membership.read` — today's only published read is administrator-scoped (§H).
3. A rule for the one-to-many case (`isPrimary`, or explicit selection).
4. Per-module own-reads. 15 `-own` permissions are declared; **two are wired** (`workflow.
   approval.read-own` on two queue reads; `onboarding.task.complete-own` on a read and a
   command). Thirteen are declared over nothing — Learning's and Career's authorization files say
   *"`read-own` … is enforced nowhere for the same reason."*
5. **Payroll cannot participate at all**: all 17 payroll GETs are run-, result-, group- or
   period-scoped; none accepts an employment and none derives a subject from the caller. "My
   payslip" remains unbuildable without a Payroll contract change nobody has authorized.

No `/me` was created, and none is proposed: `/me` is a route; what is missing is a *resolution
rule*, and adding a route would not supply it.

## K. Manager implications

Performance already built this and then disabled the unsafe half: `reviewScopeFor` resolves a
team through Employment's published contract under a bounded service grant (ADR-0043), bounds the
query *before* the store *"because a count of what was then removed is itself a disclosure"*, and
answers 404 rather than 403 outside scope. Then: *"A `read-team` caller reads nothing, whatever
they name… Nothing can check the claim until a principal resolves to an employment, so the claim
is not accepted."* Workflow refuses a manager queue for the same reason (D-14).

So the `employmentId=B` attack §8 asks about is **already refused today** — not by luck, but
because `read-team` is inert. Making it live requires exactly one thing beyond authentication:
**the caller's own employment, resolved server-side from context** (§H). With that, the existing
filters are safe to switch on unchanged. Without it, any "manager scope" is a caller-supplied
claim. Leave, Attendance, Assets, Relations and Payroll publish **no team-scoped read at all**,
so a Manager Workspace also needs per-module reads that do not exist — separate work, separately
authorized. Nothing was implemented.

## L. Hosted-login comparison (Model B, considered fairly)

What it would require, from the platform's own migration guide and interfaces: a credential store
implementing `UserDirectoryPort` (identifier, `passwordHash`, `status`, `tokenVersion`,
`mfaEnrolled`), `SessionStorePort` and `RefreshTokenStorePort` (*"likely new tables"*),
`LoginService`, `SessionManager`, `TokenService` **with private key material in Work**,
`RefreshTokenService`, password policy, reset flows, MFA, account recovery, and lockout — plus
login/refresh/logout endpoints and the client work the guide says must precede the server work.

Against it, from Work's own source:

- `WorkforceUser` is `{ id, platformUserId, status, version }` — **no credential field exists,
  and `platformUserId` is immutable by design (AD-004)**. Model B does not extend this aggregate;
  it replaces its reason for existing.
- The kernel port states the opposite as a structural fact: *"No password, no token format, no
  signature, no key material appears anywhere in this repository."*
- ADR-0033 makes the workforce user deliberately tenant-less and credential-less.
- Work would hold password hashes and signing keys for an ecosystem whose stated principle is
  *"no Munaxa product should implement any of this again."*

**Conclusion: Model B would create a second identity system.** Not because it is more work —
because the identifier it would authenticate (`platformUserId`) is *by definition* issued by
something else, so Work would be authenticating a credential for an account it does not own.
Choosing it would require rewriting ADR-0001, ADR-0033 and the kernel port first.

**A third shape exists and should be named**: Work using `OidcProvider` to federate to a customer's
IdP directly. It is still Model B in the only way that matters — Work would run the callback,
mint its own session, and hold session state — so it inherits Model B's objection while adding
per-tenant IdP configuration. Recorded, not recommended.

## M. Threat model — required invariants

Each is stated as a property the implementation must hold, not as code:

| Threat | Invariant |
| --- | --- |
| Forged identity header | No header ever asserts identity. `x-munaxa-tenant` selects among stored memberships only; there is no `x-user-id` path and none may be added |
| Unsigned / `alg:none` token | Signature verified against the **verifier's** configured algorithm; header `alg` used for nothing |
| Algorithm confusion | Asymmetric verification only; a verify-only node holds no key that can mint |
| Issuer confusion | `iss` compared exactly against one configured value |
| Audience confusion | `aud` must contain Work's audience |
| Tenant confusion | Membership is authoritative; `tid` mismatch refuses (§G) |
| Membership substitution | No request field names a membership; it is derived from `sub` |
| Employment substitution | The caller's employment must be derived server-side; an `employmentId` parameter is a filter under an admin grant, never a credential |
| Token replay | Short TTL; server-side session state is what makes revocation real (`@munaxa/session`) — under Model A, revocation is the issuer's responsibility and Work's exposure is bounded by TTL |
| Expired token | `exp` enforced with bounded skew; expiry is 401, never an empty result |
| Key rotation | Multiple `kid`s verify simultaneously; retiring a key must not invalidate live tokens mid-flight |
| Stale / disabled membership | Membership is re-read **per request** — a token minted before a suspension must not outlive it. This is why membership, not `tid`, is authoritative |
| Disabled employee | Same: `activeMembershipsOf` excludes suspended, invited and ended |
| Cross-tenant access | Row-level security plus membership resolution; both must fail closed |
| Manager reading another team | Scope resolved from the caller's own employment, bounded before the store |
| Employee reading another employee | Own-reads derive the subject from context; no caller-supplied identifier |

## N. Local development

Today: no authentication locally, and every business route answers 401 — which is honest, and is
why all nine slices were verified against scratchpad stubs.

**No local issuer exists in the ecosystem.** What must *not* be built, and is not: a dev user, a
bypass flag, a fixed membership, a default tenant, a static token, or any header-trusting path
that could reach production. The only acceptable shape is a **real issuer running locally** —
same algorithm, same claim set, same verification path, different keys — supplied as an
operations artifact (a container in `docker-compose.yml` and a development key pair), so that
local verification is genuinely the production code path. That is a Platform/operations
deliverable, and §Q records it as one.

## O. Environment configuration

Names follow this repository's convention (`SCREAMING_SNAKE`, validated in
`packages/config/src/environment.ts`, the only place `process.env` may be read). Marked by
confidence, as §14 requires:

| Variable | Purpose | Status |
| --- | --- | --- |
| `AUTH_ISSUER` | Expected `iss`, compared exactly | **Required**; value unknown |
| `AUTH_AUDIENCE` | Work's `aud` | **Required**; value unknown |
| `AUTH_PUBLIC_KEYS` | `kid`-keyed PEM public keys for verification | **Required**; format and delivery are an owner decision |
| `AUTH_ALGORITHM` | `RS256` \| `ES256` | **Required**; default recommended `RS256` |
| `AUTH_CLOCK_SKEW_MS` | Verification tolerance | Optional; platform default 30 000 |
| `AUTH_JWKS_URL` | Key discovery | **Unknown / not currently supported** — the platform does not implement JWKS verification |

No variable was added to any schema or `.env.example` in this task.

## P. Failure semantics

Distinct outcomes, never collapsed — and specifically never rendered as an empty product state:

| Condition | Outcome | Why |
| --- | --- | --- |
| No credential | **401** | Guard: *"No principal is 401 — sign in"* |
| Malformed credential | **401** | Indistinguishable from unauthenticated, deliberately |
| Invalid signature / wrong `iss` / wrong `aud` | **401** | Not authenticated; the reason is logged, never returned |
| Expired token | **401** | Distinct from 403; the client refreshes, it does not sign out |
| Unknown principal (no workforce user) | **401** | No context established |
| Disabled principal / disabled membership | **401** | *"A person who is a member of nothing has nothing to be forbidden from"* |
| Member of nothing | **401** | Existing `no-membership` outcome |
| Several memberships, none selected | **401** | `ambiguous` — refused, never guessed |
| Requested a tenant they are not a member of | **401** | `not-a-member` — refusing rather than confirming the tenant exists |
| Authenticated, lacks the permission | **403** | The permission pipeline, unchanged |
| Authenticated, permitted, record absent | **404** | The module's own semantics |
| Authenticated, permitted, nothing to show | **empty** | A product state, and the *only* one of these that may render as "nothing" |
| No employment resolvable | **owner decision** | Not defined today; must not silently become "you have no approvals" |

The screens already keep this line — every slice distinguishes withheld from empty — and the
Payroll screen says the current state in the customer's own words: *"Sign-in is not available in
this deployment, so payroll data cannot be shown."* **An authentication failure must never render
as "you have no assets."**

## Q. Owner / platform decisions

**Resolvable from existing evidence — no decision needed:**

- Transport is a bearer token on `Authorization` (existing code on both sides).
- Verification belongs to a Platform-supplied verifier; Work parses nothing itself.
- Algorithm must be asymmetric so Work cannot mint (crypto package's own reasoning).
- Membership stays authoritative for tenant (ADR-0032, unchanged).
- `perms`/`roles` claims are discarded (§I).
- Model B creates a second identity system (§L).

**Requires an owner / platform / security decision:**

1. **Issuer ownership** — which service issues tokens for Work's users, and who runs it.
2. **Issuer URL and `iss` value.**
3. **`aud` value for Work.**
4. **`sub` semantics** — confirmation that it carries the immutable `platformUserId`.
5. **Signing algorithm and key distribution** — configured PEMs today; JWKS would be new platform
   work.
6. **Key rotation process** — overlap window and who schedules it (`KeyRing` supports rotation;
   nothing schedules it).
7. **Token lifetime and whether Work sees refresh at all** (Work has no refresh endpoint).
8. **`tid` rule** — approval of the constraint-not-authority rule in §G.
9. **Membership → employment resolution** — the successor to ADR-0032, including the
   one-to-many rule and a read an employee may perform (§H).
10. **Header/gateway trust** — whether Work is ever reachable directly, whether an edge terminates
    TLS, and what authenticates the upstream if one exists. **Unknown today; recorded as a
    blocker per §12.**
11. **Local development issuer** — an operations artifact (§N).
12. **The authorization grant source** — what supplies `PlatformPermissionChecker`'s set (§I).
    Without this, authentication unlocks nothing.

## R. Implementation Definition of Ready

§21's nineteen conditions, assessed:

| # | Condition | Status |
| --- | --- | --- |
| 1 | Model selected | **Recommended (A); owner must ratify** |
| 2 | Issuer identified | **NOT MET** |
| 3 | `iss` defined | **NOT MET** |
| 4 | `aud` defined | **NOT MET** |
| 5 | `sub` semantics | Proposed (§F); issuer must confirm |
| 6 | Algorithm | Recommended `RS256`/`ES256`; **not ratified** |
| 7 | Key distribution | **NOT MET** |
| 8 | Key rotation | **NOT MET** |
| 9 | Token expiration | **NOT MET** |
| 10 | Tenant semantics | Rule proposed (§G); **not approved** |
| 11 | Membership mapping | **Met** — exists and is wired |
| 12 | Employment mapping | Exists as data; **no request-time rule** |
| 13 | Transport | **Met** — bearer on `Authorization` |
| 14 | Reverse-proxy / header trust | **NOT MET — unknown** |
| 15 | Local development auth | **NOT MET** |
| 16 | Failure semantics | **Met** — §P, consistent with existing guard |
| 17 | Disabled-user semantics | **Met** — `activeMembershipsOf` excludes them |
| 18 | Authorization integration point | **Met** as a seam; **its grant source is NOT MET** (§I) |
| 19 | Security owner approves the trust boundary | **NOT MET** |

**Eleven of nineteen are unmet. Implementation must not begin.** Per §21, this is a STOP.

## S. Verification

`pnpm verify` with every cache cleared and PostgreSQL 16 live (`TEST_DATABASE_URL` set; **31
migrations applied; 187 tables**). As in the two preceding tasks, the chained script forwards
`--force` only to its final command, so each turbo stage was forced explicitly and tests ran with
the script's own `--concurrency=1`:

- `pnpm standards` — engineering standards; architecture (186 models); localization (20/20);
  dependencies (2028 files, no cycles, no unused, no unreachable); **platform parity: 5 packages
  = lockfile, all `registry`, `@munaxa/platform` 1.6.1**.
- `pnpm format:check` — clean.
- lint **51/51 tasks, 0 cached** — 1m45.037s.
- typecheck **51/51 tasks, 0 cached** — 36.885s.
- test **51/51 tasks, 0 cached** — 7m34.85s: **471 test files passed, 5,401 tests passed, 0
  failed, 0 skipped** — unchanged from baseline, as an architecture-only task requires.
- build **29/29 tasks, 0 cached** — 1m8.74s. **Exit 0.**

No production code, package version, lockfile entry, environment file, permission, migration or
CI file changed. Working tree clean; the only addition is this document.
