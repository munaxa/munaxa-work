# Phase 2 — Workforce Identity

**Date** 2026-08-05 · **Verdict** Pass, with the limitations stated below

The first business module, and the closure of the risk Phase 1.1 named as the largest one open.

Every claim here is evidenced by a command that was run. Where something could not be verified in
this environment it says so rather than being marked pass.

---

## 1. The tenant-header debt, closed

Phase 1.1 recorded it plainly: *"the tenant arrives as an HTTP header — any caller can claim any
tenant. This is the single largest open risk."* It was assigned to Phase 2, before any business
data existed, and it was the first thing built.

### What changed

| | Before | Now |
| --- | --- | --- |
| Authentication | None | `PlatformAuthenticationPort` — Platform's implementation, ours authenticates nobody |
| Tenant source | `x-tenant-id` header, believed | A stored `tenant_membership` row, keyed on the authenticated principal |
| Header's power | Grants any tenant | Selects among tenants the person is *already* an active member of |
| Unresolved request | Ran with the claimed tenant | No context at all; `currentTenantId()` throws and RLS returns nothing |
| Audit actor | `user:anonymous` | `user:<workforceUserId>` |
| Unauthenticated call | Reached a handler | 401 Problem Details, before validation |

Recorded as [ADR-0032](../adr/0032-tenant-resolution-from-membership.md).

### The test that fails if the guard is removed

`apps/api/src/tenancy/tenant.middleware.spec.ts` asserts that a principal who is an active member
of tenant A only, presenting `x-munaxa-tenant: <tenant B>`, establishes **no context** — not
tenant B, and not a silent fallback to tenant A.

This was not assumed. The membership check was removed, restoring the old "trust the header"
behaviour, and the suite was run:

```
 × a forged tenant header > cannot select a tenant the authenticated person is not a member of
   → expected '019fd36e-23c7-7000-933f-0eab01fd1140' to be undefined
      Tests  1 failed | 7 passed (8)
```

The forged tenant identifier appears in the failure message. The check was restored and the suite
returned to green. Seven further tests cover the neighbouring cases: unauthenticated with a
header, a principal who is a member of nothing, several memberships with none named (refused
rather than guessed for), and the audit actor.

### End to end, against the running application

```
$ curl -i http://127.0.0.1:3998/api/v1/identity/members
401  application/problem+json
{"type":"about:blank","title":"Unauthorized","status":401,
 "detail":"Not authenticated.","instance":"/api/v1/identity/members",
 "requestId":"9a46ec31-…","correlationId":"9a46ec31-…"}
```

No credentials, no tenant, no data — and a clean Problem Details response rather than an internal
error.

---

## 2. What the module implements

Eight aggregates, each with stated invariants and a state machine:

| Aggregate | Owns | Notable invariant |
| --------- | ---- | ----------------- |
| `WorkforceUser` | The Platform account's business identity | One per Platform account, across every tenant (AD-005); identifier immutable (AD-004) |
| `TenantMembership` | One person's membership of one tenant | Only an `active` membership may resolve a request's tenant |
| `Invitation` | A tenant's request that somebody join | Carries no credential; acceptance is by an authenticated principal whose address matches |
| `PortalAssignment` | Which applications a tenant opened | Business configuration, never a permission (AD-007) |
| `EmploymentLink` | The jobs a member holds here | Several at once (AD-006); at most one primary; detaching never removes the person (AD-008) |
| `Delegation` | Who acts for whom, for a period | Never to oneself; in force is computed from the period, not the status |
| `BusinessProfile` | How this tenant presents them | A display name in **both** first-class languages, or it is refused |
| `UserPreference` | Language, calendar, time zone, numerals | Direction is derived from the language, never toggled separately |

Two design decisions are worth stating because they are the ones a reviewer should challenge:

**`workforce_user` has no `tenant_id`** — the only such table in the product. The specification's
hierarchy requires one person to span tenants, and a tenant-scoped row cannot express that. The
isolation guarantee is kept rather than waived: the table carries a *reachability* policy, so a
tenant sees a person only if it holds an undeleted membership of them, and the row holds nothing
tenant-specific (the profile and preferences do, and they are isolated normally).
[ADR-0033](../adr/0033-tenant-less-workforce-user.md).

**There is no `invited` membership state.** "Asked but not yet joined" is what a pending
`Invitation` *is*, and recording it in two aggregates would give the product two answers to
whether somebody has joined. A membership begins when a person actually becomes a member.

---

## 3. Verification

### Repository and architecture

```
Engineering Standards: no violations.
Architecture: 8 model(s) checked, no violations.
Localization: 2 catalogue set(s) complete.
Dependencies: 167 source file(s), no cycles, no unused dependencies, no unreachable files.
```

Module-first per ADR-0023: `packages/modules/identity/{domain,application,infrastructure,
contracts,api}`. The layer lint rules applied without configuration, and caught real violations
during the phase — the domain and application layers import no framework, no ORM and no
transport, and the API layer imports no repository.

### Persistence

Eight tables, applied to a fresh database:

```
       table       | rls | forced | policies
-------------------+-----+--------+----------
 business_profile  | t   | t      |        1
 delegation        | t   | t      |        1
 employment_link   | t   | t      |        1
 invitation        | t   | t      |        1
 portal_assignment | t   | t      |        1
 tenant_membership | t   | t      |        1
 user_preference   | t   | t      |        1
 workforce_user    | t   | t      |        1
```

Every one carries the audit columns, `deleted_at` / `deleted_by`, `version` and a UUIDv7
identifier. The migration also installs `app_uuid_v7()`, so a row written by a script or a data
fix is still time-ordered rather than a v4 dropped into the middle of the index — verified
monotonic across five values minted in the same millisecond, which required implementing the
sub-millisecond fraction the layout comment claimed.

Constraints the database enforces rather than the application, each with a test: one membership
per person per tenant, at most one primary job per member, one open invitation per address per
tenant (case-insensitively, matching the repository's lookup expression), a display name in both
languages, and no delegation to oneself.

### Tenant isolation, per entity

Against a real PostgreSQL, as an unprivileged role that cannot bypass row-level security:

```
another tenant's membership, by its exact identifier        → not found ✓
portal assignment, employment link, delegation,             → not found ✓
  business profile, user preference, invitation
insert into another tenant                                  → policy violation ✓
no tenant set                                               → 0 rows (fails closed) ✓
workforce_user, tenant that admitted the person             → visible ✓
workforce_user, tenant that did not                         → invisible ✓
workforce_user, after the membership is soft deleted        → invisible ✓
workforce_user, both tenants after both admit them          → the same single row ✓
```

The strongest form of the property, not the weakest: not "a list comes back filtered", but "a
caller who already knows the primary key still cannot read the row".

### Tests

**377 tests**, up from 208.

| Suite | Tests |
| ----- | ----- |
| `@work/identity` | 149 (10 files) |
| `@work/kernel` | 139 |
| `@work/api` | 30 |
| `@work/testing` | 23 |
| `@work/persistence` | 20 |
| `@work/config` | 16 |

Covering the matrix `00A_PHASE_SPECIFICATION_TEMPLATE.md` requires: domain invariants and state
machines; every command and query through the real pipeline; repositories including tenant
scoping; every endpoint including authorization failures; every permission granted and denied;
tenant isolation per entity; concurrency; and localization in both languages.

The integration suites refuse to skip in CI, and run serially against one database because each
truncates this module's tables between tests — stated in `vitest.config.ts` rather than left as
an intermittent failure for somebody else to find.

### Quality gates

| Gate | Result |
| ---- | ------ |
| Standards, architecture, localization, dependencies | Pass |
| Format, lint, typecheck | Pass |
| Tests (377) | Pass |
| Production build (12 packages) | Pass |
| Migration validation | Pass — applied to a fresh database |
| Prisma schema validation | Pass |
| Flutter analyze, test, APK build | **Not verifiable here** — no Flutter toolchain on this machine. CI runs it, unchanged by this phase |

`pnpm verify` passes end to end.

### Security

| Check | Result |
| ----- | ------ |
| Authentication | Platform's, through a port. This repository authenticates nobody |
| Authorization | Declared by every handler, checked centrally, refused by default |
| Tenant validation | Membership-derived, RLS-enforced, guard-checked, proven per entity |
| Order of checks | Authorization before validation — in the pipeline, and now at the transport too |
| Credentials in the module | None. No password, token, secret or hash field exists |
| PII | `invitation.email`, `business_profile` contact details. Identified below |
| Problem Details | Every error path; no stack trace, SQL, connection string or environment detail |
| Audit | Actor written by infrastructure from the context; a caller cannot supply or omit it |

**A real finding, fixed during the phase.** The first API test asserted that an unauthorized
caller sending a malformed payload gets 403 rather than 400 — the ordering Phase 1.1 verified in
the CQRS pipeline. It failed with 400: Nest runs the global `ValidationPipe` *before* the request
reaches a handler, so the transport answered first and told an unauthenticated caller their body
was malformed. Guards run before pipes, so `AuthenticatedTenantGuard` now extends the ordering
out to the transport. The residual is stated rather than smoothed over: an *authenticated member
of the tenant* who lacks a specific permission and sends a malformed body still gets 400, which
tells somebody already inside the tenant only that their own payload was wrong.

### Performance

Measured on this machine, against a real database:

| Operation | Measurement | Budget |
| --------- | ----------- | ------ |
| Cold start to first response | 930 ms | — |
| `GET /health/live` | 3 ms average over 20 | — |
| `GET /health/ready` (round trip to the database) | 2 ms | — |
| Unauthenticated `GET /api/v1/identity/members` (guard refusal) | 1 ms | — |
| Identity test suite, 149 tests including integration | 3.4 s | — |
| Workspace typecheck | ~9 s across 12 packages | — |

The authenticated request path could not be timed here: it requires Platform's authentication
adapter, which does not exist yet. What can be said about it is structural rather than measured —
one indexed lookup on `tenant_membership (workforce_user_id, status)` before anything else, and
a member page that issues its six reads together rather than in sequence. **This is a gap, and it
is in the debt register below.**

### Localization

Both catalogues complete, checked by gate. Every rejection the domain can produce carries a
catalogue key rather than a sentence, so the message an Arabic-speaking user reads is chosen at
the edge from their language. Statuses, portals, labels, actions and empty states are all
translated.

The module's own tests run against a **Riyadh tenant** — Arabic, Hijri, Arabic-Indic numerals —
deliberately. Testing against English and Gregorian would let a hardcoded English default pass
every test in the suite and fail on the first customer.

`BusinessProfile` refuses a display name that is missing either first-class language, and the
database refuses it too (`CHECK display_name ? 'en' and ? 'ar'`). That is the failure everybody
recognizes — an org chart that reads correctly in English and shows Latin characters in the
middle of an Arabic page, forever, because nobody was ever asked for the second name.

### API

18 paths published in OpenAPI, 15 of them this module's, all under `/api/v1`. Problem Details on
every error path. Every mutating endpoint that touches an existing record requires
`expectedVersion`.

---

## 4. PII

| Field | Why it is held | Protection |
| ----- | -------------- | ---------- |
| `invitation.email` | An invitation that cannot say who it was sent to cannot be audited or resent | Tenant-isolated by RLS; redacted from logs |
| `business_profile.display_name` | The name on the org chart | Tenant-isolated; deliberately *not* on the global user row |
| `business_profile.business_email` / `business_phone` | Work contact details | Same |
| `workforce_user.platform_user_id` | The immutable link to the Platform account | Opaque identifier, no personal content |

The split is the protection: the tenant-less table holds nothing a tenant would consider its own,
which is what makes it defensible to have one.

---

## 5. Technical debt

The Phase 1.1 register, carried forward and updated. Nothing has been quietly dropped.

| Item | Impact | When it must be addressed |
| ---- | ------ | ------------------------- |
| ~~The tenant arrives as an HTTP header~~ | ~~Any caller can claim any tenant~~ | **Closed in Phase 2** — ADR-0032 |
| ~~`actor` is `user:anonymous`~~ | ~~Audit records a placeholder~~ | **Closed in Phase 2** — the actor is the workforce user |
| No projection store | Queries read the transactional tables | Phase 20, or the first module needing a read model. These reads are small, tenant-scoped and index-covered; reporting is what needs projections |
| The rule engine has no arithmetic | It decides, it does not compute | Phase 11.1 |
| `@work/contracts`, `@work/sdk`, `@work/country-packs` are empty | Placeholders | The phases that own them. Identity publishes its contracts from its own package, per ADR-0023 |
| Cache health is `not-configured` | Redis declared, unused | Whenever the first cache consumer arrives |
| No rate limiting | An unauthenticated endpoint could be hammered | Before production exposure, Phase 24 at the latest. Every business endpoint now refuses without a principal, which narrows this to the health probes and the authentication path itself |
| The Android release build signs with debug keys | A release artefact is not distributable | Phase 19.1 |

New in this phase:

| Item | Impact | When it must be addressed |
| ---- | ------ | ------------------------- |
| **Tenant settings are deployment-wide, not per tenant** | Every tenant in a deployment shares one default language, calendar, time zone and invitation validity | Phase 3, when Organization can store them. The port already exists, so this is one adapter, not a redesign |
| **The authenticated request path is unmeasured** | The < 300 ms budget is argued structurally, not demonstrated | When Platform's authentication adapter lands. The membership lookup is indexed and the member page batches its reads, but that is a design claim rather than a measurement |
| **No scheduled sweep for invitation and delegation expiry** | `expire()` exists on both aggregates and is idempotent, but nothing calls it, so an elapsed invitation still reads `pending` | Phase 24 (background jobs) at the latest. The *behaviour* is already correct — acceptance refuses a lapsed invitation and `isInForceAt` computes from the period — so this is a register-tidiness gap, not a correctness one |
| **No bulk import or export** | The specification's scope lists both. A tenant onboarding hundreds of people invites them one at a time | Phase 7 (Onboarding) or Phase 22 (Integrations), whichever lands first. Deliberately deferred rather than half-built: a bulk path that bypassed the application service would bypass the invariants with it |
| **Portal screens for the module are not built** | The admin portal does not yet render the member register | Phase 18/19, which own the portals. The API, contracts and localization they need are complete |

Three of these five are scope the specification lists. They are stated as deferred rather than
omitted, and each names the phase that owns it.

---

## 6. Risks

1. **Platform's authentication adapter does not exist yet.** Until it does, the API authenticates
   nobody and serves 401 to everything. That is the correct failure direction, and it also means
   the authenticated path has never run outside a test.
2. **`app_memberships_of` is a deliberate hole**, narrow and documented (ADR-0033). It takes only
   an authenticated identifier and returns only identifiers, but it is the one query that crosses
   tenants and it should be reviewed as such.
3. **The in-process adapters are still honest but temporary.** Auto-approval approves; delegation
   is recorded here and consumed by Workflow in Phase 16.

---

## 7. Recommendations

1. **Wire Platform's authentication adapter next**, or at least alongside Phase 3. Every
   remaining claim about the request path depends on it, and it is the one thing no test here can
   substitute for.
2. **Keep the fake honest.** `inMemoryIdentityStores` matched production only after being made to
   insert at version 1, as `auditForInsert` does. That was one bug away from a suite that passed
   for behaviour the database would have rejected.
3. **Do not read `tenant_membership` from another module.** The guard's correctness depends on the
   active-only filter living in one place.

---

## 8. Production readiness

**Ready for the next phase to build on. Not ready for production exposure**, and for one reason
that is now the only one: there is no authentication implementation. Everything else the
production-readiness criteria ask for is in place — invariants in the domain, transactional
writes with events after commit, optimistic concurrency on every mutable aggregate, tenant
isolation proven per entity, Problem Details throughout, structured logs with request,
correlation, tenant and user identifiers, OpenAPI current, ER diagram current, ADRs written, and
the limitations above stated rather than omitted.

**Rollback path.** The phase is additive: eight new tables, one new package, and a replaced
middleware. Rolling back means reverting the commit and dropping the tables — no existing data is
migrated or reshaped, because there was none. The one irreversible-in-effect change is the
tenant middleware, and reverting it would restore a known vulnerability; a deployment needing to
roll back should roll back the whole phase rather than that file.

---

## 9. Acceptance criteria

✓ Workforce user model, with the Platform link immutable
✓ Tenant membership, and the request pipeline deriving the tenant from it
✓ Invitations, creating workforce users and never authentication
✓ User lifecycle — provisioned, active, suspended, deactivated — and membership lifecycle
✓ Portal access as business configuration
✓ Employment linking, concurrent and non-destructive
✓ Delegation foundation, consumable by Workflow from Phase 16
✓ No authentication, passwords, JWT, OAuth, SSO, identity providers or MFA implemented
✓ Every table tenant-first, audited, versioned, soft-deleted, UUIDv7, snake_case
✓ Row-level security on every new table, applied by the migration that creates it
✓ Arabic and English complete; both directions; both calendars accepted
✓ 377 tests including tenant isolation per entity, permissions, concurrency and localization
✓ Production build passing, `pnpm verify` green
✓ Documentation, ER diagram, ADRs and the debt register updated

**Phase 2 passes.** Awaiting approval before Phase 3.
