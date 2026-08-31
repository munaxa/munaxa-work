# Platform Authentication Adapter — implementation-readiness record

**No authentication was implemented, and that is the finding, not a shortfall of effort.** This
task was authorized to replace `UnauthenticatedPort` with the real Platform authentication
adapter. Investigating the external contract first — which §4 of the brief requires before any
implementation — established that the decision needed to build a *secure, real* adapter has not
been made by anyone yet, and that making it here would mean choosing between two architectures
this ecosystem's own governing documents each mandate in opposite directions.

The brief anticipates this exactly, in three places, and all three fire:

- **§4** — *"If the repository does not contain enough information to implement a secure real
  adapter, STOP. Do not create a guessed protocol. Document the exact missing owner/platform
  decision."*
- **§23** — *"If the correct implementation belongs in the Munaxa Platform repository … rather
  than `munaxa-work`: STOP. Do not fake the implementation inside Work."*
- **§24** — *"If the repository only provides `UnauthenticatedPort` and no actual provider
  credentials/configuration/protocol exist, do NOT invent a production authentication
  implementation. Instead produce an implementation-readiness record."*

This is that record. Nothing in `munaxa-work` was changed except this file.

---

## A. Objective

Make the existing identity/principal architecture work with a real authenticated caller, without
weakening any security boundary — by supplying the missing implementation of
`PlatformAuthenticationPort` at the existing DI seam, and then verifying (not building) what
already-shipped capability the real principal reaches.

## B. Starting architecture

Measured from source at `35ce806`, not from the investigation document.

```text
credentials on the request
        │
        ▼  apps/api/src/tenancy/tenant.middleware.ts
PlatformAuthenticationPort.authenticate()        ← the seam. Only UnauthenticatedPort exists.
        │
        ▼  PlatformPrincipal { platformUserId, issuer, email?, authenticatedAt }
resolveForPrincipal(TenantMembershipDirectory, principal, x-munaxa-tenant)
        │                                          ← header selects among stored memberships
        ▼  ExecutionContext { tenantId, userId, membershipId, actor, correlationId }
runInContext(...)  →  currentMembershipId()  →  handlers, permissions, row-level security
```

Everything below the seam exists and is tested. Above it, nothing does.

## C. Existing authentication port

`packages/kernel/src/ports/authentication.ts`:

```ts
interface PlatformAuthenticationPort {
  authenticate(credentials: PresentedCredentials | undefined): Promise<PlatformPrincipal | undefined>;
}
interface PlatformPrincipal { platformUserId: string; issuer: string; email?: string; authenticatedAt: Date }
interface PresentedCredentials { scheme: string; value: string }   // verbatim, unparsed
```

Its own words: *"Munaxa Work never verifies a credential… No password, no token format, no
signature, no key material appears anywhere in this repository, which is what makes
'authentication belongs to Platform' a structural fact rather than a statement of intent."*
`platformUserId` is immutable for the life of the account (AD-004). Returning `undefined` rather
than throwing is deliberate: not-authenticated is an ordinary outcome.

`credentialsFrom()` in the middleware splits `Authorization` into scheme and value and
**deliberately parses no further** — *"a token this repository can decode is a token this
repository would eventually be tempted to trust."*

## D. Existing unauthenticated provider

`UnauthenticatedPort` — *"the default, and the only implementation this repository will ever
contain: it authenticates nobody."* Wired at `apps/api/src/identity/identity.module.ts:113`:

```ts
{ provide: AUTHENTICATION_PORT, useFactory: (): PlatformAuthenticationPort => new UnauthenticatedPort() }
```

One provider, one line. Replacing it is genuinely the whole Work-side change — which is why the
blocker is not Work-side effort.

## E. External authentication contract — what actually exists

The investigation document assumed the adapter simply did not exist yet. **Current source says
something more specific, and the discrepancy is recorded here as §2 requires**: the ecosystem
*does* contain a complete shared security platform, and it is not shaped the way Work's port is.

**Found** (`/home/user/munaxa-platform`, the `@munaxa/platform` monorepo — the same repository
that publishes the 1.6.1 design system Work already consumes):

- `docs/security-platform/` — thirteen packages owning *"every cross-cutting security concern in
  the Munaxa ecosystem"*, with the stated principle: *"no Munaxa product should implement any of
  this again."*
- **`@munaxa/auth` 2.4.1, published to the same registry** (verified with `npm view`), alongside
  `@munaxa/types`, `@munaxa/interfaces`, `@munaxa/crypto`, `@munaxa/session`, `@munaxa/rbac`, all
  at 2.4.1.
- A real, reviewed token implementation: `TokenService.issueAccessToken` / `verifyAccessToken`,
  JWT access tokens with `sub/tid/sid/iss/aud/exp/jti/ver`, signature verified against **the
  signer's own algorithm rather than the header's claim** (closing `alg:none` and
  algorithm-confusion), expiry with clock skew, issuer and audience checks, token-version
  staleness; opaque refresh tokens, hashed at rest, single-use, with reuse detection revoking the
  family. `AsymmetricSigner` explicitly supports **verify-only nodes** (*"PEM-encoded private
  key. Absent on verify-only nodes."*).
- `docs/security-platform/migration/munaxa-work.md` — a migration guide for this very product,
  opening with: *"**Nothing in this guide has been executed.** Phase P1 built the platform;
  migrating Work is a later phase."*

**Not found, anywhere in the ecosystem** — and each of these is required before a secure adapter
can exist:

| Required | Present? |
| --- | --- |
| An issuer that mints tokens for Work's users | **No.** No service in any repository issues tokens Work could verify. |
| Issuer URL / `iss` value for Work | **No.** |
| Audience (`aud`) value for Work | **No.** |
| Public key, JWKS endpoint or key id for verification | **No.** No key material, no distribution mechanism. |
| Any authentication configuration in Work | **No.** `packages/config/src/environment.ts` and `.env.example` contain no `AUTH`, `JWT`, `ISSUER`, `JWKS`, `OIDC` or `PLATFORM_*` variable of any kind. |
| A deployed identity service in Work's compose/infra | **No.** `docker-compose.yml` runs PostgreSQL and Redis only, and says *"Nothing here is a deployment artifact."* |
| ADR-0001 itself | **Not in this repository.** `docs/adr/` starts at 0021; `docs/ROADMAP_ANALYSIS.md` records that *"the ADR document defines ADR-0001…0020"* — an ecosystem-level document held outside `munaxa-work`. The kernel and PHASES.md cite ADR-0001 as binding; its text cannot be read here. |

So the platform supplies **libraries for a product that hosts its own login**. It does not supply
**an issuer for a product that only verifies**. Work is written as the second thing.

## F. Adapter implementation — why none was written

Two integration shapes are possible. Each is mandated by a different governing document, they are
mutually exclusive, and choosing between them is an owner decision — not a coding decision.

### Shape A — Work as a relying party (matches Work's own architecture)

Work verifies a token some external Munaxa issuer signed, and holds only a public key.

- **Fits**: the kernel port verbatim; ADR-0032's step 1; the middleware's refusal to parse;
  ADR-0001 as quoted throughout Work.
- **Work-side change**: small — one adapter calling `TokenService.verifyAccessToken` with an
  `AsymmetricSigner` in verify-only mode, mapping `claims.sub → platformUserId`,
  `claims.iss → issuer`, plus config for issuer, audience and key rotation.
- **Blocked by**: the issuer does not exist. There is nothing to verify against, no key to verify
  with, and no configuration naming either. **This is the missing external dependency.**

### Shape B — Work hosts its own login (what the migration guide's Step 3 describes)

*"Implement `UserDirectoryPort` over the Work user table. Add `tokenVersion`… Implement
`SessionStorePort` and `RefreshTokenStorePort` — likely new tables. Wire `LoginService`,
`SessionManager`, `TokenService`."*

- **Requires Work to become a credential store.** The platform's `CredentialRecord` demands
  `identifier`, `passwordHash`, `status`, `tokenVersion`, `mfaEnrolled`. Work's `WorkforceUser`
  aggregate is `{ id, platformUserId, status, version }` — **no credential, no password, no
  token version, by design** (AD-004, ADR-0033).
- **Directly contradicts** the kernel port (*"no key material appears anywhere in this
  repository"*), and the brief's own §3 (*"The adapter must NOT become a second identity
  system"*) and §29 (no new migrations).
- Would need new tables, new migrations, key material in Work, and a login endpoint — i.e. a
  phase of its own, explicitly out of scope here.

**A third, discovered discrepancy that either shape must resolve — the tenant.** The platform's
`Principal` requires `tenantId`, and its access tokens carry `tid`. Work's `PlatformPrincipal` is
deliberately **tenant-less**, because ADR-0032 states the tenant is resolved *"from a **tenant
membership** — a row Munaxa Work wrote when a tenant admitted a person… It is never taken from
the request."* A verified `tid` claim is still a value arriving *in* the request. Someone must
decide whether Work ignores `tid` and keeps membership resolution (which preserves ADR-0032 and
is what this record recommends), or honours it (which replaces ADR-0032). Related: platform
tokens may carry `perms`/`roles`; Work's §17 forbids authentication granting authorization, so
the adapter must discard those claims — an explicit integration rule, not an implementation
detail.

Writing an adapter without these answers would mean inventing an issuer, inventing claim
semantics, and inventing key distribution — precisely the guessed protocol §4 forbids.

## G–H. Principal and membership resolution — verified, and already built

Traced in source; no duplicate mapping was created and none is needed:

1. **principal → membership**: `resolveForPrincipal()` asks `TenantMembershipDirectory` for the
   *active* memberships of an *active* workforce user; `x-munaxa-tenant` narrows that set and can
   do nothing else. Naming a tenant one is not a member of resolves to nothing; naming none when
   several match resolves to nothing — **there is deliberately no default**, so the multiple-
   membership case §8 asks about is already answered and must not be "chosen" by an adapter.
2. **membership → employment**: Identity's `EmploymentLink` aggregate (`membershipId ↔
   employmentId`, `isPrimary`, status), readable via `identity.describe-member`. Deliberately no
   cross-module foreign key.
3. **membership → person**: `EmploymentView.personId`, then People.
4. **context**: `{ tenantId, userId, membershipId, actor: user:<workforceUserId>, correlationId }`
   → `currentMembershipId()`.

Every step exists. Only step 0 — obtaining the principal — does not.

## I. Tenant isolation

Unchanged and unweakened, because nothing was changed. The existing guarantees stand: unresolved
means **no context at all**, `currentTenantId()` throws, and row-level security returns no rows —
failing closed on both layers. `tenant.middleware.spec.ts` asserts that a member of tenant A
asking for tenant B resolves *nothing*, and ADR-0032 records that this was verified by mutation.
No new tenant-resolution mechanism was added; §16's tests cannot be run against a real principal
because no real principal can be produced.

## J. Authorization interaction

Untouched and still authoritative: the kernel pipeline (tenancy → authorization → validation →
handler) decides what a caller may do, entirely separately from who they are. No permission was
granted, injected or inferred; no guard was bypassed. The one adapter-side rule this record adds
for whoever implements Shape A is the discard of `perms`/`roles` claims described in §F.

## K. Employee scope

Cannot be exercised — no principal can be produced — so no claim is made that it works. What the
audit did establish, from source:

- **Wired and ready**: `workflow.approval.read-own` guards `workflow.pending-approvals` and
  `workflow.decided-approvals`, both keyed on `currentMembership()` with **no caller-supplied
  identifier at all** (*"its absence is the control"*). `onboarding.task.complete-own` guards one
  query and one command. These are the capabilities that light up the moment a principal exists —
  no product code required.
- **Payroll remains blocked, reconfirmed**: all 17 payroll GETs are run-, result-, group- or
  period-scoped. No read accepts an employment; none derives a subject from the caller. **"My
  payslip" cannot be honestly built even after authentication.** Payroll was not modified.
- **Assets, per §13**: `GET /assets/custody?employmentId=` honours whatever `employmentId` the
  caller supplies, under the tenant-wide `assets.custody.read`. Authentication would prove who a
  caller is; it would **not** stop an employee changing `employmentId=A` to `employmentId=B`.
  **The existing permission model does not safely support employee self-scoping here**, so — as
  §13 directs — the blocker is recorded and Assets was not broadened, patched, or exposed.
- The other 13 `-own` grants remain declared over nothing. None was wired (§18).

## L. Manager scope

Also cannot be exercised, and would still be blocked if it could. `performance/authorization.ts`
resolves a team through Employment's published contract under a bounded service grant, bounds the
query before the store, and then refuses: *"A `read-team` caller reads nothing, whatever they
name… Nothing can check the claim until a principal resolves to an employment, so the claim is
not accepted."*

**Authentication alone does not satisfy that condition.** The principal resolves to a *membership*
(ADR-0032); Performance needs the caller's *employment*. The link exists in Identity, but binding
it into a caller-scope decision is the successor ADR to ADR-0032 — an owner decision, and
explicitly not something to fix inside Performance (§11, §7). No Performance file was touched.

## M. Security review

Reviewed against §5, §25 and §26. The strongest security property of this task is what it did
**not** produce: no `x-user-id` or `x-membership-id` trust, no query-string identity, no dev
header, no bypass flag, no fixed membership, no default tenant, no demo user, no static bearer
token, no fake JWT, no "temporary" production auth. `UnauthenticatedPort` remains the only
implementation, and a deployment without a real adapter still returns 401 to everything — noticed
on the first call.

No credential, token or secret was logged, written or committed; none exists to log. No secret,
key, or machine-specific path appears in this document. The `x-munaxa-tenant` header remains a
selector over stored facts, never a grant.

## N. Existing portal verification

Both portals were inspected rather than modified. Each is a single bootstrap page proving
`@munaxa/ui`/`@munaxa/theme`/`@munaxa/platform` 1.6.1 resolve and render: no shell, no
navigation, no Work contract imports, no fetch. With no adapter they resolve no principal, no
membership and no route — the same state as before this task. Nothing was added to make them look
complete, and no `/me` was created (§6). Their emptiness is expected and correct.

## O. Tests

**No tests were added, because there is nothing new to test.** §19's suite — valid principal,
invalid credential, expired credential, missing credential, malformed credential, provider
failure, principal→membership, tenant isolation, client-supplied membership refusal — is the test
plan for Shape A and is specified in §Q below. Writing those tests now would require a mocked
provider, and §20 is explicit: *"Do not call a mocked provider 'real authentication.'"*

The existing suite continues to assert the boundary that does exist: `tenant.middleware.spec.ts`
proves cross-tenant resolution yields nothing, and the workflow authorization suite proves
`approval.read-own` refuses a caller without the grant.

## P. Full gate

`pnpm verify` with every cache cleared and PostgreSQL 16 live (`TEST_DATABASE_URL` set; 31
migrations applied; 187 tables). As recorded in the two preceding tasks, the chained script
forwards `--force` only to its last command, so each turbo stage was forced explicitly and tests
ran with the script's own `--concurrency=1`:

- `pnpm standards`: engineering standards; architecture (186 models); localization (20/20);
  dependencies (2028 files, no cycles, no unused, no unreachable); **platform parity — 5 packages
  = lockfile, all `registry`, `@munaxa/platform` 1.6.1**.
- `pnpm format:check`: clean.
- lint 51/51 tasks, 0 cached — 2m28.724s.
- typecheck 51/51 tasks, 0 cached — 47.435s.
- test 51/51 tasks, 0 cached — 10m6.677s: **471 test files passed, 5,401 tests passed, 0 failed,
  0 skipped** — unchanged from the Slice #9 baseline, as a no-code-change task requires.
- build 29/29 tasks, 0 cached — 1m30.671s. Exit 0.

No production code, package version, lockfile entry, permission, migration or CI file changed.

## Q. Limitations, and what is required before an adapter can be written

**Limitations of this record**: adapter implementation, integration and production-provider
verification (§20's three levels) were all impossible — there is no adapter, no provider and no
configuration. Nothing here claims end-to-end authentication.

**The missing owner/platform decision, stated exactly:**

> Does Munaxa Work verify tokens minted by an external Munaxa issuer (Shape A), or does Work host
> its own login using the platform's libraries (Shape B)?

**If Shape A** — required from Platform/operations before any Work change:

1. A running issuer for Work's users, and its identity: `iss` value, `aud` value for Work.
2. Public key distribution: a JWKS endpoint or PEM, with key ids and a rotation story.
3. The claim carrying the stable subject, confirmed as the value Work stores as
   `platformUserId` (AD-004: immutable for the life of the account).
4. An explicit ruling on `tid`: Work ignores it and keeps ADR-0032 membership resolution
   (recommended), or ADR-0032 is superseded.
5. An explicit ruling that `perms`/`roles` claims are discarded by Work (§17).
6. Session/expiry semantics Work must honour: access-token TTL, whether Work sees refresh at all
   (it has no refresh endpoint), and what logout means to a verify-only relying party.

Then the Work-side change is genuinely small, and is the whole of it:

- add `@munaxa/auth` + `@munaxa/crypto` + `@munaxa/types` (2.4.1, already published to the same
  registry the parity guard enforces) to `apps/api`;
- one adapter class implementing `PlatformAuthenticationPort` over
  `TokenService.verifyAccessToken` with a verify-only `AsymmetricSigner`, mapping `sub`/`iss`/
  `exp` and discarding everything else;
- issuer/audience/key configuration added to `packages/config`'s schema (the only place
  `process.env` may be read);
- swap the one provider line at `identity.module.ts:113`;
- §19's test suite against the adapter, including a forged token, a wrong issuer, a wrong
  audience, an expired token and an unknown-subject principal.

**If Shape B**: it is a phase, not an adapter — new tables, migrations, key material and a login
endpoint inside Work — and it needs ADR-0001 and the kernel port rewritten first, since both
currently forbid it.

**Sequencing note from the platform's own guide**: *"Sequence Work third. Docs proves the platform
against a modern codebase; School proves it under real load and real data."* Neither has migrated
yet (*"Nothing in this guide has been executed"*).

## R. Remaining product blockers

Unchanged by this task, and all three are independent of authentication:

1. **Payroll self-service** — no employee-scoped read exists; "My Payslip" needs a Payroll
   contract change nobody has authorized. (§12)
2. **Assets employee scoping** — the `employmentId` filter under a tenant-wide grant is not safe
   to hand to an employee; needs a module-side own-read or an explicit owner decision. (§13)
3. **Principal → employment** — the successor ADR to ADR-0032, without which Performance's
   manager scoping stays inert and the 13 dormant `-own` grants stay dormant.

## S. Git

- Branch `claude/munaxa-product-readiness-audit-8mr34d`, base `35ce806`.
- One commit adding this file. No production code, no Platform code, no package or lockfile
  change, no permission, no migration, no CI, no completed-slice modification. No `file:`, no
  `/tmp` path, no source link, no credential or secret.
