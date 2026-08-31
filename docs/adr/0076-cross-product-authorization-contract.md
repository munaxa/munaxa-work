# ADR-0076 — How a Platform grant becomes a Work permission

**Status** Accepted
**Date** 2026-08-31
**Author** Munaxa Work engineering
**Approval** Pending review
**Extends** [ADR-0032](0032-tenant-resolution-from-membership.md) — tenant resolution from membership
**Relates to** [ADR-0043](0043-bounded-service-grant.md) — the bounded service grant

## Context

Authentication is Platform's and Munaxa Work consumes it (ADR-0001). Authorization was meant to
arrive the same way, and could not: the two products describe a permission in grammars that do not
overlap.

Work declares **285 permissions**, dot-separated, two to four segments — `assets.asset.read`,
`employment.employment.status.change`. Platform's RBAC requires `resource:action`, with segments
matching `[a-z0-9][a-z0-9_-]*`, in which a dot is illegal. Running Platform's own validators against
Work's own names shows the consequence exactly: **every one of the 285 is rejected**, as a check and
as a grant. `RoleHierarchy` calls `assertValidGrant` on every role permission, so no Platform role
can hold a Work permission, and `PermissionResolver` therefore cannot produce one.

Platform's `perms` claim is not validated at issue or at verification, so a bespoke issuer could put
Work's names in a token regardless. That is an absent validator rather than an agreed contract, and
Platform's own ADR-0020 rejects the shape — opening a closed platform namespace to arbitrary product
strings, or having products cast their names into a platform type, are both recorded there as
rejected options.

Platform's RBAC is also built on wildcards. `defaultRoles()` cannot express an administrator without
them: `users:*`, `roles:*`, `tenant:*`. Work's checker is exact-match everywhere — `Set.has` in the
permission checker, `permits.includes` in the bounded service grant — and Work's own Platform-facing
contract states "no wildcard authorization; the checker matches exactly".

## Decision

**Work owns the permission vocabulary. Platform owns the grant mechanism.** Neither owns both.

1. **Work's 285 permissions remain canonical and are not renamed.** Their names, their grammar and
   their semantics are Work's, and this ADR changes none of them.

2. **Platform represents a Work permission under the reserved `work:` namespace**, in Platform's own
   legal grammar. The namespace is reserved for Munaxa Work and no other product's namespace is
   accepted.

3. **The mapping is total and bijective on its domain:**

   ```text
   φ(p) = "work:" + p.replaceAll(".", ":")          Work → Platform
   ψ(q) = q.startsWith("work:")                      Platform → Work
            ? q.slice(5).replaceAll(":", ".")
            : undefined
   ```

   ```text
   assets.asset.read                    ↔  work:assets:asset:read
   employment.employment.status.change  ↔  work:employment:employment:status:change
   ```

4. **The mapping is proven over all 285 current permissions**, against Platform's real
   `permissions.ts`: every image passes `assertValidCheck` and `assertValidGrant`; the map is
   injective; ψ(φ(p)) = p for all 285; the three four-segment permissions survive intact. It cannot
   collide, because the two alphabets are disjoint — a Work name contains no `:` and a Platform
   segment forbids `.`, so a mixed form such as `a:b.read` is representable on neither side.

5. **No wildcard crosses the boundary.** `*`, `work:*`, `work:payroll:*` and every scoped pattern
   grant nothing in Work. There is no expansion and no prefix matching. A wildcard reaching the
   adapter is dropped and logged.

6. **Work matches exactly.** A granted permission is a member of a set; the check is set membership
   and nothing else. Platform's `grantCovers` and `hasPermission` are never called for a Work check.

7. **A translated grant must be in Work's declared catalogue.** `work:` plus a syntactically valid
   remainder is not sufficient: the resulting name must be one of the 285 Work declares. Work owns
   the vocabulary, so a grant naming a permission Work does not declare creates nothing.

8. **Authorization is carried in the verified `perms` claim** of the access token established by the
   Platform authentication seam. Work re-verifies nothing and parses no token a second time.

9. **The token's `tid` is never a Work tenant source**, unchanged from the authentication seam.
   `VerifiedAccessToken` does not declare it.

10. **Tenant membership remains the independent authorization boundary.** A permission never implies
    a membership: the tenant comes from `tenant_membership` resolved for the authenticated
    `platformUserId` (ADR-0032), and row-level security enforces it beneath that (ADR-0030). A
    caller holding every Work permission and no membership can do nothing.

11. **Work never mints a Platform credential**, and holds no signing key.

12. **Platform role resolution stays Platform's.** Work does not implement, host or call a role
    engine, and does not hold Platform's role stores.

## Consequences

- **Staleness is bounded by the token lifecycle, and must be operated as such.** Permissions travel
  in the access token, so a revoked permission remains effective until that token expires —
  Platform's default access-token lifetime is 15 minutes. Immediate revocation is Platform's
  `tokenVersion` bump, which `verifyAccessToken` enforces. This is a property of the contract, not a
  defect, and it belongs in the runbook rather than in a reader's memory.

- **A Work administrator role in Platform enumerates its grants.** Because no wildcard confers a
  Work permission, a role granting broad Work access lists the φ-form names explicitly. That list is
  derived from Work's declarations rather than maintained by hand — see
  `scripts/emit-permission-catalogue.mjs`, whose output is the artifact Platform's role catalogue is
  generated from.

- **Catalogue drift fails closed.** A Work permission added without regenerating Platform's role
  catalogue is simply ungranted until it is. Nothing is silently permitted.

- **An operator's wildcard grant does nothing, visibly.** It is dropped and logged with the grant
  name — never with the token — so "I granted `work:*` and nothing happened" has an answer in the
  log rather than being a mystery.

- **Platform's migration guide for Work contradicts this decision and must be corrected on the
  Platform side.** `docs/security-platform/migration/munaxa-work.md` describes Work as having "ad
  hoc role checks in handlers" and `if (user.role === 'admin')`, which has not been true for the
  life of this repository, and its step 4 prescribes mapping Work's checks to `resource:action` —
  the rename this ADR rejects. Correcting it is Platform's change, deliberately not made here.

## What was rejected

| Option | Why not |
| --- | --- |
| Rename Work's 285 into `resource:action` | Mechanically cheap — nothing is persisted, no migration stores a permission name, no API publishes one — but it moves Work's permissions inside Platform's *pattern* namespace, where `payroll:*` would confer every payroll permission. It creates the wildcard exposure Work does not currently have, to solve a naming problem. |
| Put Work's dot-names straight into `perms` | Works only because `issueAccessToken` and `verifyAccessToken` happen not to validate claim contents. No Platform mechanism can *produce* such a grant — `RoleHierarchy` rejects it — and Platform's Authorizer throws on it. ADR-0020 records this shape as rejected. |
| Let a Platform wildcard satisfy a Work permission | Collapses distinctions every permission file exists to preserve: `payroll.approve` against `payroll.run.finalize`, `assets.custody.assign` against `assets.custody.return`. |
| Expand wildcards at the boundary into the catalogue | Defensible, and the sanctioned upgrade if enumerating grants proves unworkable. Not now: it is expansion logic on the authorization path, and the contract is smaller and more obviously correct without it. Adopting it later needs no change to φ or ψ. |
| Resolve permissions from Platform's `PermissionResolver` | It is an in-process library over the role stores, so Work would have to hold Platform's authorization data — inverting the ownership this decision rests on. No remote authorization API exists, and none was invented. |

## What this does not decide

The Platform side of the contract. Platform must reserve `work:`, accept and durably assign φ-form
grants, place them in the signed `perms` claim, and never issue a bare `*` to a Work audience. Those
remain external dependencies, and until they exist this contract is implemented and dormant: a
deployment with no Platform authentication configured authenticates nobody and authorizes nobody,
exactly as before.
