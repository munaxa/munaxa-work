# ADR-0043 — A bounded service grant, so one module may act inside another without widening a user's role

**Status** Accepted · **Date** 2026-08-09 · **Author** Phase 6 · **Approval** Approved before implementation (A-1)

## Context

Recruitment depends on three modules. It must know that an organizational unit named on a requisition
is real, that an interviewer is an employment in this tenant, whether a candidate might already be
somebody on the person register, and — at hire — it must create a Person and an Employment.

The rule for reaching another module is settled: through its **published application service**, never
its repositories or its tables. Phase 5 satisfied that rule by inheriting the other module's
permission check, and recorded the consequence plainly: creating an employment requires the caller to
hold `people.person.read`.

Applied to Recruitment, the same composition would require every recruiter to hold
`people.person.manage` — permission to edit the master registry of human identity — because hiring
creates a Person. That is not a boundary being kept; it is a boundary leaking in the shape of a role.
The approved decision (A-1) states the requirement directly: **Recruitment must not require recruiters
to hold People's manage permission, broad People write, or broad Organization hierarchy permissions.**

Eight constraints came with it. The user must still be authorized for the Recruitment operation; only
explicitly permitted cross-domain operations may occur; every one must be tenant-scoped and auditable;
no arbitrary access to another module's repositories; **no second authorization framework**; and the
existing authorization contract may be extended only where necessary.

## Decision

A **bounded service grant**: a narrow, named authority a module may exercise inside another *while
acting on a user's behalf*, declared at the call site and consulted only after the user's own
permissions have been checked.

```ts
runWithServiceGrant(
  {
    module: 'recruitment',
    operation: 'recruitment.hire-candidate',
    permits: ['people.person.manage', 'people.person.read', 'people.contact.manage'],
    reason: 'registering the person a hired candidate turned out to be',
  },
  () => sender.send({ commandName: 'people.create-person', ... }),
);
```

The pipeline's permission check is unchanged. `GrantAwarePermissionChecker` **decorates** the one
Platform checker the pipeline already uses:

```ts
if (await this.delegate.holds(permission)) return true;   // the user's own permission, first
const grant = currentServiceGrant();
if (grant === undefined || !grant.permits.includes(permission)) return false;
this.observe({ ...origin, module, operation, permission, reason });
return true;
```

Six properties are what keep it from becoming a bypass:

1. **The user is still checked for their own operation.** A grant is entered *inside* a handler the
   pipeline has already authorized. Nothing reaches a grant before that check.
2. **It permits an explicit list** — never a wildcard, never a prefix. A permission not named is
   refused exactly as it would be without a grant.
3. **It cannot nest.** Entering a grant inside a grant throws. Authority is not composed, which is how
   a narrow capability becomes a wide one over a few releases.
4. **It requires a tenant context**, so nothing runs untenanted under it.
5. **It does not touch the execution context.** Tenant, actor and correlation identifier stay exactly
   as the request set them, so every audit column and every event still names the human being who
   asked. A grant changes what is permitted, never who is acting.
6. **Every use is observable.** The composition root passes the logger as the observer, so "what did
   Recruitment do inside People, and for whom" is a question the logs answer.

The grants this phase declares are the whole cross-module surface, and they are visible in one file:

| Operation | Permits | Why |
| --- | --- | --- |
| `recruitment.create-requisition` | `organization.hierarchy.read` | the unit named on a requisition is real |
| `recruitment.schedule-interview` | `employment.employment.read` | an interviewer is an employment in this tenant |
| `recruitment.match-candidate` | `people.person.read` | suggest people a candidate might already be |
| `recruitment.link-candidate-to-person` | `people.person.read` | the person a recruiter named exists and was not merged |
| `recruitment.hire-candidate` | `people.person.manage`, `people.person.read`, `people.contact.manage`, `employment.employment.manage` | register the Person and create the Employment |

## Reason

**It is not a second authorization framework.** There is one checker, one pipeline and one permission
vocabulary. The decorator adds nothing at all when no grant is open, and what it adds when one is open
is bounded by a literal list written next to the call it authorizes.

**The alternative was worse in both directions.** Granting recruiters People's permissions makes the
recruiter role a superset of the HR administrator's. Duplicating People's logic inside Recruitment
breaks the module boundary this product is built on, and would put a second, weaker copy of identity
protection next to the tested one.

**A grant is legible.** A reviewer reads five entries and knows the entire cross-module authority this
module holds. A role assignment spread across a customer's permission matrix is not legible in any
comparable way.

## Consequences

- A recruiter holds recruitment permissions only. `recruitment.hire` is the narrowest of them and the
  one held by fewest people.
- Elevations are logged. A deployment can alert on them; a reviewer can count them.
- The grant is a kernel capability, so a later phase with the same need — Onboarding creating tasks,
  Offboarding ending an employment — uses it rather than inventing another mechanism.
- **Phase 5's composition is unchanged.** Employment still inherits People's check, which means
  creating an employment directly still requires `people.person.read`. That is recorded as a separate
  architectural follow-up rather than fixed here: the approved decision was explicit that Phase 5 must
  not be modified during Phase 6 merely to resolve it.
