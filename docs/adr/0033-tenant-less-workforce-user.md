# ADR-0033 — `workforce_user` has no tenant, and how it is protected instead

**Status** Accepted
**Date** 2026-08-05
**Author** Munaxa Work engineering
**Approval** Pending review
**Refines** [ADR-0030](0030-tenant-isolation.md), which requires `tenant_id` on every business
table

## Decision

`workforce_user` is the one business table in Munaxa Work without a `tenant_id`. There is exactly
one row per Platform account, spanning every tenant that person belongs to.

Three things make that safe rather than merely convenient:

1. **The row holds nothing a tenant would consider its own.** Only the Platform identifier and
   the account's lifecycle status. Display name, job title, work contact details, language,
   calendar and time zone are all tenant-specific and live in `business_profile` and
   `user_preference`, which carry `tenant_id` and are isolated normally.
2. **It carries a row-level security policy anyway — a reachability policy.** A tenant may read,
   update or delete a workforce user only if that user holds an undeleted membership of the
   tenant currently in context. Inserts are permitted, because a user necessarily exists a moment
   before the membership that makes it reachable, and a row nobody can read is a row nobody can
   use.
3. **The one query that must cross tenants is one named function.** `app_memberships_of` is
   `security definer`, takes only an authenticated `platform_user_id`, and returns identifiers —
   never data. The application role holds no row-level security bypass of its own.

## Reason

The hierarchy the phase specification states is `Platform User → Workforce User → Tenant
Membership → Employment`, and AD-005 makes one Platform user a member of several tenants. A
tenant-scoped user row cannot express that: the same consultant working for two customers would
become two people, with two unrelated audit histories, two sets of delegations, and no way to
answer "has this person worked with us before".

The interesting question was therefore not whether to make the table global, but what to do about
the isolation guarantee that ADR-0030 makes absolute. Dropping the policy for one table would put
a hole in a rule whose value comes from having no exceptions. The reachability policy keeps the
rule — the database still refuses — and changes only the predicate: instead of "this row belongs
to my tenant", it is "my tenant has admitted this person". For reads, the effect is the same:
tenant A cannot see somebody tenant A has never admitted.

Splitting the person's *identity* from the tenant's *view of them* is what makes this work, and
it is a better model regardless. "Sara Haddad — Head of Finance" at one customer and
"S. Haddad — Contractor" at another are not two spellings of one field; they are two customers'
records about one person, and neither has any business seeing the other's.

The cross-tenant function is the one place the layering genuinely cannot apply, because the
request pipeline must answer "which tenants may this person act in?" *before* any tenant is in
context — that question is what establishes the context. The alternative was a second connection
holding `BYPASSRLS`, which would open a general hole to solve one specific problem and would then
be available to every query written afterwards by somebody not present for this decision.

## Consequences

- **The architecture gate needs its opt-out used, visibly.** The model declares
  `/// @global one-row-per-Platform-account …`, which `scripts/check-architecture.mjs` requires
  and which makes the exception greppable rather than implicit.
- **`WorkforceUserRepository` does not extend the shared `Repository` base.** That base's
  contract is "every read is tenant-filtered", and a subclass that quietly was not would make
  the base's guarantee a lie for the twenty repositories that rely on it. The exception is
  explicit, local and visible in the type.
- **`app_memberships_of` is a deliberate, bounded exposure**, stated here rather than left
  implicit. Reaching it requires a database connection as the application role — which can read
  none of the tables underneath it — and what it adds for such an attacker is a set of opaque
  UUIDs for a platform user id they already knew. It returns nothing for a suspended person or a
  suspended account.
- **Every property above is tested against a real PostgreSQL**, including the case that would
  otherwise be assumed: a person visible to the tenant that admitted them, invisible to one that
  did not, and invisible again once the membership is soft deleted.

## Alternatives considered

- **A `tenant_id` on `workforce_user`, one row per tenant.** Rejected: it makes one person into
  several and breaks AD-005, AD-006 and the delegation model with it.
- **No policy at all on the table, relying on the repositories.** Rejected: it is exactly the
  "application filtering only" option ADR-0030 already rejected, reintroduced for the one table
  where the reasoning is no weaker.
- **A `BYPASSRLS` connection for the directory query.** Rejected as above — a general capability
  granted to solve one specific problem.
- **Keeping the person's name on the global row.** Rejected: it is the field most likely to
  differ between tenants and the one most likely to be considered confidential by either.
