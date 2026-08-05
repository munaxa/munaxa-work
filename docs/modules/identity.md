# Workforce Identity

**Module** `@work/identity` · **Phase** 2 · **Owns** the business identity of an authenticated
Platform user

Platform knows who authenticated. This module knows who the business user is — which tenants
have admitted them, which portals those tenants have opened, which jobs they hold, and who acts
for them while they are away.

It implements no authentication and no authorization. There is no password field, no token, no
session and no place to put one; a search of this package for those words returns comments
explaining their absence.

---

## The chain

```text
Platform User          Platform owns it. We store only its immutable identifier.
      │
      ▼
Workforce User         One per Platform account, spanning every tenant (AD-005).
      │                Tenant-less by design — ADR-0033.
      ▼
Tenant Membership      One per (person, tenant). What resolves a request's tenant — ADR-0032.
      │
      ├──▶ Portal Assignment    Which applications this tenant opened to them (AD-007).
      ├──▶ Employment Link      The jobs they hold here. Several at once is ordinary (AD-006).
      ├──▶ Delegation           Who acts for them, for a period and a scope (AD-010).
      ├──▶ Business Profile     How this tenant presents them, in both languages.
      └──▶ User Preference      Language, calendar, time zone, numerals.
```

Each arrow is a separate aggregate, because each has a different lifetime. A job ends and the
person stays (AD-008). A membership ends and the workforce user stays. A tenant suspends somebody
and their other tenants are unaffected.

---

## Entity relationships

```text
┌──────────────────────────┐
│ workforce_user           │  no tenant_id (ADR-0033)
│──────────────────────────│  reachability policy: visible only to a tenant
│ id                    PK │  that holds an undeleted membership of this person
│ platform_user_id      UQ │
│ status                   │  provisioned │ active │ suspended │ deactivated
└────────────┬─────────────┘
             │ 1
             │
             │ n
┌────────────▼─────────────┐
│ tenant_membership        │  UQ (tenant_id, workforce_user_id)
│──────────────────────────│  IX (workforce_user_id, status)  ← the tenant guard's read
│ id                    PK │
│ tenant_id                │
│ workforce_user_id     FK │
│ status                   │  active │ suspended │ ended
│ invited_at / joined_at   │
│ ended_at                 │
└─┬────┬────┬────┬─────────┘
  │    │    │    │
  │    │    │    │ n   ┌──────────────────────────┐
  │    │    │    └────▶│ portal_assignment        │ UQ (tenant, membership, portal)
  │    │    │          │ portal, status           │ employee │ manager │ admin
  │    │    │          └──────────────────────────┘
  │    │    │ n        ┌──────────────────────────┐
  │    │    └─────────▶│ employment_link          │ UQ (tenant, membership, employment)
  │    │               │ employment_id  ← by identity only, no FK (Phase 5 owns it)
  │    │               │ is_primary               │ partial UQ: one primary per member
  │    │               └──────────────────────────┘
  │    │ n             ┌──────────────────────────┐
  │    └──────────────▶│ delegation               │ delegator FK, delegate FK
  │                    │ scope, effective_from/to │ CHECK delegator <> delegate
  │                    │ status                   │ scheduled │ active │ revoked │ expired
  │                    └──────────────────────────┘
  │ 1                  ┌──────────────────────────┐
  ├───────────────────▶│ business_profile         │ UQ (tenant, membership)
  │                    │ display_name  jsonb      │ CHECK ? 'en' and ? 'ar'
  │                    │ job_title     jsonb      │ GIN index for name search
  │                    └──────────────────────────┘
  │ 1                  ┌──────────────────────────┐
  └───────────────────▶│ user_preference          │ UQ (tenant, membership)
                       │ language, calendar       │ direction is derived, never stored
                       │ time_zone, numerals      │
                       └──────────────────────────┘

┌──────────────────────────┐
│ invitation               │  tenant-scoped, no membership yet — that is the point
│──────────────────────────│  partial UQ (tenant, lower(email)) where status = 'pending'
│ email, portals[]         │  No token column. Acceptance is by an authenticated principal.
│ status, expires_at       │  pending │ accepted │ revoked │ expired
│ accepted_by_...       FK │
└──────────────────────────┘
```

Every table carries `tenant_id` (except `workforce_user`), the audit columns, `deleted_at` /
`deleted_by`, `version`, and a UUIDv7 identifier. All eight have row-level security enabled and
forced.

---

## API

Everything is under `/api/v1/identity`. Every endpoint appears in OpenAPI, returns Problem
Details (RFC 9457) on every error path, and requires an authenticated principal with a resolved
tenant before its payload is even validated.

| Method   | Path                                        | Permission                        |
| -------- | ------------------------------------------- | --------------------------------- |
| `GET`    | `/members`                                  | `identity.membership.read`        |
| `GET`    | `/members/search?term=`                     | `identity.profile.read`           |
| `GET`    | `/members/:membershipId`                    | `identity.membership.read`        |
| `POST`   | `/members`                                  | `identity.membership.manage`      |
| `PATCH`  | `/members/:membershipId`                    | `identity.membership.manage`      |
| `PUT`    | `/members/:membershipId/profile`            | `identity.profile.manage`         |
| `PUT`    | `/members/:membershipId/preferences`        | `identity.preference.manage`      |
| `GET`    | `/invitations`                              | `identity.invitation.read`        |
| `POST`   | `/invitations`                              | `identity.invitation.manage`      |
| `POST`   | `/invitations/:invitationId/acceptance`     | `identity.invitation.accept`      |
| `DELETE` | `/invitations/:invitationId`                | `identity.invitation.manage`      |
| `POST`   | `/members/:membershipId/portals`            | `identity.portal.manage`          |
| `DELETE` | `/portals/:assignmentId`                    | `identity.portal.manage`          |
| `POST`   | `/members/:membershipId/employments`        | `identity.employment-link.manage` |
| `PATCH`  | `/employments/:linkId/primary`              | `identity.employment-link.manage` |
| `DELETE` | `/employments/:linkId`                      | `identity.employment-link.manage` |
| `POST`   | `/members/:membershipId/delegations`        | `identity.delegation.manage`      |
| `DELETE` | `/delegations/:delegationId`                | `identity.delegation.manage`      |

**Status codes.** 400 is a malformed request — the client can fix it by sending different bytes.
422 is a well-formed request the domain refused, carrying a catalogue key rather than a sentence
so the portal renders it in the reader's language. 401 is "not signed in", including the case of
an authenticated principal with no usable membership. 409 is a version conflict.

**Optimistic concurrency.** Every endpoint that changes an existing record takes
`expectedVersion`. It is required rather than optional: a client that cannot say which version it
read cannot be protected from overwriting somebody else's change.

---

## Events

All version 1, named `identity.<aggregate>.<past participle>`, published after commit.

`workforce-user.{provisioned,activated,suspended,reinstated,deactivated}` ·
`tenant-membership.{granted,activated,suspended,reinstated,ended}` ·
`invitation.{issued,accepted,revoked,expired}` · `portal-assignment.{granted,revoked}` ·
`employment-link.{linked,unlinked,primary-changed}` ·
`delegation.{created,revoked,expired}` · `business-profile.updated` · `user-preference.updated`

`tenant-membership.ended` is the one with a consumer today: this module reacts to it by revoking
the person's portals and the cover they had arranged. It runs after commit and is idempotent, so
a retry finds them already revoked and raises nothing a second time.

---

## Configuration

Nothing about a country, a language, a calendar or a validity period is written in this module.
All of it arrives through `TenantSettingsPort`:

| Setting                    | Environment variable       | Default     |
| -------------------------- | -------------------------- | ----------- |
| Default language           | `DEFAULT_LOCALE`           | `en`        |
| Default calendar           | `DEFAULT_CALENDAR`         | `gregorian` |
| Default time zone          | `DEFAULT_TIME_ZONE`        | `UTC`       |
| Default numerals           | `DEFAULT_NUMERALS`         | `western`   |
| Invitation validity (days) | `INVITATION_VALIDITY_DAYS` | `14`        |
| Portals opened on joining  | `DEFAULT_PORTALS`          | `employee`  |

Per-tenant overrides arrive with Organization in Phase 3. The port already exists, so adding
them changes `ConfiguredTenantSettings` and nothing else — see the known limitations in the
[Phase 2 report](../verification/phase-2-report.md).

---

## Consuming this module

Three crossings, and nothing else (see the [module guide](../foundation/module-guide.md)):

| You want to                     | Use                                                       |
| ------------------------------- | --------------------------------------------------------- |
| Ask it to do something          | Its command handlers, through the `Dispatcher`             |
| Read its data                   | `@work/identity`'s exported contracts and query handlers   |
| React to something that happened| Its domain events                                          |

Its repositories, its tables and its aggregates are private. In particular, **do not read
`tenant_membership` directly** — the guard's correctness depends on the active-only filter living
in one place.

For Workflow (Phase 16), the query you want is `identity.active-delegations-for`. It answers from
the delegation's *period*, not from its status, so a sweep that has not run yet cannot make you
route an approval to somebody whose cover ended yesterday.
