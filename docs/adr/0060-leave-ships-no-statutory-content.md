# ADR-0060 — Leave ships no statutory content, and approval is recorded rather than delegated

**Status** Accepted · **Date** 2026-08-10 · **Author** Phase 9 · **Approval** Approved before implementation

## Context

Leave is the module where a product most wants to be helpful. Every market this product serves has
statutory leave — annual leave scaling with service, maternity, Hajj, Iddah, bereavement by degree of
kinship — and every one of them is *different*. Shipping "sensible defaults" would make the product
feel complete on day one and wrong in the second country on day two.

Separately, the phase specification asked for the approval chain to consume the `ApprovalPort`
defined in Phase 1. The only adapter behind that port in this repository is `AutoApprovingPort`,
which approves everything immediately as `system:auto-approval`. Leave approval authorizes paid
absence.

## Decision

### Nothing statutory ships

**No leave type, no entitlement figure, no accrual formula, no eligibility threshold and no carry-over
rule is shipped, seeded or defaulted.** A tenant that has configured nothing has nothing, and the
screen says so.

Every threshold on a policy version is nullable and inert. `accrualMethod` defaults to `none`,
`carryOverMethod` to `none`, every cap to absent, `minimumServiceMonths` to zero. A policy created
with no settings permits leave with no limits and grants no entitlement — a policy that does nothing,
rather than one that quietly implements somebody's labour law.

The extension points a country pack uses, each concrete:

| Point | How a pack uses it |
| --- | --- |
| `leave_type.statutory_source_code` | Marks a type as supplied by a pack rather than a tenant |
| `leave_policy.country_pack_id`, `country_pack_version` | Which pack version authored this policy version |
| `leave_policy.eligibility_rule` | A `RuleDefinition`, evaluated by the kernel engine, with a trace |
| `accrual_method = 'service_band'` + a rule | Service bands as data |
| `leave_year_calendar` | Hijri leave years, where the law uses them |
| `gender_restriction` as a **code** | Maternity and Iddah without this product enumerating them |
| Assignment scoped to `legal_entity` | A pack resolves from the legal entity, never the tenant |

**If a new country requires a change to this module, that is an architecture defect** (00B).

### Approval is recorded here, not delegated to a port that fakes it

**Leave records its own decisions and does not consume `ApprovalPort`** — while publishing the chain
in `ApprovalPort`'s own shape. This follows ADR-0045's precedent for the same reason: an approval
`AutoApprovingPort` produced is not evidence that a human decided anything, and recording it as
though it were is a false statement in an audit trail.

- `leave_request_decision` records the decision of a **named human**, taken from the authenticated
  context and never from a command.
- Self-approval is refused three times over: by the domain, by the permission separation
  (`leave.approve` is not `leave.request`), and by a **check constraint** — enforceable only because
  the decision row carries a copy of `requested_by`, since a check constraint cannot reach another
  table.
- A policy requiring no approval produces a request that reaches `approved` with **no decision row
  at all**, and the published chain says "no approval was required" rather than naming a system
  approver.
- Multi-level approval is a **sequence, not routing**: N distinct approvers, with no escalation, no
  timeout, no delegation resolution and no conditional path. Those are Workflow's.
- `leave_request.approval_id` is present and null, as Recruitment's and Attendance's are.

The published `LeaveApprovalChainView` matches `ApprovalStatus` and `ApprovalStep` field for field.
When Phase 16 lands, the **source** of those steps changes from this table to Workflow and the
contract does not.

## Consequences

- A tenant must configure leave before anybody can request it. That is a real onboarding cost and it
  is the correct one: the alternative is a customer discovering that the product granted their
  workforce an entitlement nobody chose.
- **No golden-case statutory tests exist in this phase**, because no statutory rule ships to test.
  The completion report says so rather than claiming 00B's golden-case criterion is met. What is
  tested instead is that the machinery is country-agnostic — a fixture configuring two contrived
  packs with different accrual and different leave years, with no code path branching on either.
- The employee sees the approval chain from this phase, as the specification requires.
- The specification's "consumes the ApprovalPort" is **not** satisfied literally, and the report says
  that plainly rather than quietly.

## Alternatives considered

**Ship a Jordanian country pack as a default.** Rejected: it is the first step of the architecture
defect 00B describes, and it is hardest to remove once a customer depends on it.

**Consume `AutoApprovingPort` and note the limitation.** Rejected: the note lives in a document and
the fake approval lives in the database, attached to a person's paid absence, for as long as the
record does.

**Wait for Phase 16 and ship no approval at all.** Rejected: the specification requires the chain
from this phase, and a leave module that cannot record who approved what is not a leave module.
