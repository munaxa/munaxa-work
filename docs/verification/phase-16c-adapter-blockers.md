# Phase 16C — Checkpoint 7 — blocked before implementation

**No adapter was written.** Checkpoint 7's §2 and §25 require a stop, without a decision, when the
approved contracts cannot express the composition. Two conditions are met. Both were verified against
source and schema rather than inferred, and the evidence is below.

Starting commit `a6cf205`. Working tree unchanged.

---

## B-1 — Two active manager memberships cannot be represented (§2, §9, §25.1)

`ManagerResolution` (`packages/modules/workflow/src/domain/manager.ts:42`) has exactly four outcomes:

```ts
| { outcome: 'resolved'; employmentId; managerEmploymentId; managerMembershipId }
| { outcome: 'no-primary-employment' }
| { outcome: 'no-manager' }
| { outcome: 'manager-not-a-member' }
```

`manager-not-a-member` is documented at its declaration as *"The manager's employment resolves to **no**
active membership — nobody who could be asked."* Two candidates is not no candidates. Reporting
ambiguity as "nobody can sign" would tell an administrator to link somebody to an employment that
already has two people linked to it — sending them to fix a thing that is not broken, which is the
exact failure the four refusals exist to prevent.

**No approved rule selects one**, and I checked each candidate the brief names:

- **`isPrimary` does not disambiguate.** `employment_link_one_primary_key` is unique on
  `(tenant_id, membership_id)` — one primary *employment per member*. Two different memberships may
  each mark the same employment primary. P-2 is about the requester choosing among *their own*
  employments and says nothing about choosing among memberships of one employment.
- **It is not in the published contract anyway.** Checkpoint 6 returns `TenantMembershipView`, which
  carries no `isPrimary`.
- Ordering by identifier, `linked_at`, oldest, newest or requester-preference are all forbidden by §2,
  and each would be a routing rule invented in an adapter.

**Is it reachable?** Yes. `employment_link` is unique per `(membership, employment)` pair only;
nothing in the schema, the domain (`EmploymentLink.link`) or the use case refuses a second membership
linking to the same employment.

*Options.* **(a)** Add a fifth outcome — `manager-ambiguous` or similar — with its own refusal and
catalogue keys, failing closed per D-16C-10. **(b)** Approve a deterministic selection rule and state
it as a parameter, which would also need the discriminating field published. **(c)** Have Identity
refuse a second active link at write time, which is a completed-module behaviour change and would not
help the rows that already exist.

*Recommendation.* **(a)**, as a new approved parameter. It is the only option consistent with
D-16C-10 and with the existing rule that each refusal names a different person's mistake. It requires
changing `ManagerResolution`, which §4 forbids without approval — hence this stop.

*Approval required: yes.*

---

## B-2 — The composition needs three cross-module reads, not two (§20, §25.12)

§6's diagram begins at `employment.read-employment`, which implies the adapter already holds the
requester's **employment**. It cannot: the port it must implement is
`managerOf(requesterMembershipId, asOfDate)` and receives a *membership*.

**Employment has no concept of a membership at all.** Its contracts mention none, and
`employment.search` filters by person, unit, position, cost centre and manager — never membership. So
the requester's employment can only come from Identity, as a read of its own:

| # | Read | Contract | Permission |
| --- | --- | --- | --- |
| 1 | requester membership → their employment links, to pick the primary active one (P-2) | `identity.describe-member` | `identity.membership.read` |
| 2 | employment + `asOf` → primary manager employment (P-3, P-4) | `employment.read-employment` | `employment.employment.read` |
| 3 | manager employment → active memberships | `identity.active-memberships-for-employment` | `identity.employment-link.read` |

Three, which §20 budgets at two and §25.12 makes a stop condition.

**Read 1 also needs a wider grant than the phase authorized**, which is the sharper half of this.
`identity.describe-member` is guarded by `identity.membership.read` — the permission behind the
member register — and returns the membership, business profile, preferences, portal assignments,
employment links *and* delegations in one object. Workflow's only standing grant today is
`identity.delegation.read`, declared explicitly in `runWithServiceGrant`. Granting
`identity.membership.read` would give the approvals engine the tenant's member register in order to
read one boolean, which is broader than the one narrow capability D-16C-04 authorized.

*Options.* **(a)** Approve the third read and the `identity.membership.read` grant. **(b)** Authorize
a second narrow Identity query — `membership → primary active employment link` — under the existing
`identity.employment-link.read`, keeping the grant narrow but making the read count three. **(c)**
Widen Checkpoint 6's query to answer both directions, which reintroduces exactly the directory shape
D-16C-04 refused.

*Recommendation.* **(b)**, plus an explicit amendment of §20's budget from two reads to three. It
keeps Workflow's grant at the two narrow employment-link and employment-read permissions, adds no
directory, and is symmetrical with the query Checkpoint 6 already built. The read count is a
consequence of the chain crossing three module boundaries, not of the design.

*Approval required: yes.*

---

## What is not blocked

Everything else the checkpoint asks for is available and was verified:

- **Employment's contract is sufficient for P-3 and P-4.** `employment.read-employment { employmentId,
  asOf }` filters `lineType === 'primary'` and resolves through `inForceOn`, returning a single
  `managerEmploymentId`. No traversal, no chain, no depth. §25.2 is *not* met.
- **Effective dating works.** `resolutionDateOf` already pins the UTC civil date, and Employment takes
  `asOf`. Nothing needs a clock.
- **Self-manager is representable** and doubly guarded — `resolveManager` compares memberships, and
  `employment_reporting_line_not_self_check` already refuses self at the employment level.
- **The adapter pattern is settled.** `WorkflowDelegations` establishes dispatcher use, an explicit
  `runWithServiceGrant` permits list, context-derived membership, and — importantly — the convention
  that an infrastructure failure **raises** rather than becoming a business refusal (§15).
- **No schema, index or migration is required** by anything above.

---

## Stop conditions met

§25.1 (ambiguity unrepresentable) and §25.12 (more than two cross-module reads). §13 is arguably met
too, since read 1 requires a broader existing permission rather than a new one.

No decision was taken and no code was written.
