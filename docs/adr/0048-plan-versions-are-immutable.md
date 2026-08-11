# ADR-0048 — A plan version is immutable once published, and an instance copies its tasks at creation

**Status** Accepted · **Date** 2026-08-10 · **Author** Phase 7 · **Approval** Approved before implementation (D-5)

## Context

An onboarding plan is a reusable checklist a tenant configures: "corporate joiner", "field engineer",
"contractor". Administrators improve them. Meanwhile people are part-way through inductions that were
generated from them.

Two questions have to have one answer each, a year later:

- *What were we asking of joiners last March?*
- *Was this person actually asked to do the safety briefing, or was it added afterwards?*

A design where an instance points at a live plan answers neither. Editing the plan silently rewrites
history for every onboarding still running, and for every completed one an auditor reads.

## Decision

**Two mechanisms, and both are needed.**

**A plan version is immutable once published.** A plan holds no tasks; its *versions* do. A version
is drafted, edited freely, and then published — after which nothing about it changes. Adding or
removing a template on a published version is refused by the application, and there is no endpoint
that edits one. Publishing records `published_at` and `published_by`, and a published version cannot
be published again. Improving the checklist means drafting the *next* version, optionally copying the
published one as a starting point; publishing it supersedes the previous one and leaves it readable.

**An instance copies its tasks at creation.** When an onboarding is generated, each template becomes
a row in `onboarding_task` with its owner and its due date already resolved. Nothing afterwards reads
the template again. The instance also records `plan_version_id`, so "which checklist was this" is a
stored fact rather than an inference.

A version with **no templates cannot be published**. An empty checklist produces onboardings that
complete the moment they begin.

## Reason

**Immutability alone is not enough, and copying alone is not enough.** Without immutability, an
auditor reading `plan_version_id` would be reading something that has since changed. Without the
copy, an instance would resolve its tasks live and a *new* published version would silently change
what a running onboarding is asking for. Together they mean an onboarding's checklist is fixed at the
moment it was given, and the version it came from still says the same thing.

**Resolving the owner and the due date once is part of the same argument.** A task whose deadline was
recomputed on read would move every time a template's offset changed, and a task whose manager was
resolved on read would silently move to a new manager after a reorganization — losing the record that
the previous one was ever responsible for it.

**Retiring is not cascading.** A retired plan stops being usable for *new* onboardings and touches
none of the ones generated from it.

## Consequences

- A tenant editing a checklist takes two steps rather than one: draft, then publish. The extra step
  is the control, and publishing is its own permission.
- Storage grows with instances rather than with plans: sixty tasks per joiner are sixty rows. That is
  the cost of an answerable history, and the volumes measured in the phase report are within it.
- A correction to a *published* version is impossible by design. Correcting a running onboarding is
  done on the onboarding — add, reassign, reschedule or waive a task — and each of those leaves a
  history row saying who did it.
- A tenant that has configured no plan gets an onboarding with no tasks. This product ships no
  default checklist: what a joiner is asked to do is the customer's decision, and in several of this
  product's markets part of it is statutory and belongs to a country pack (00B).

## Alternatives considered

**Instances point at the live plan; edits are guarded by a "do not edit while instances are running"
rule.** Rejected. The rule is unenforceable in practice — there is almost always a running onboarding
— and a guard that is routinely bypassed is not a guard.

**Copy-on-write: edit the plan, and snapshot only the instances affected.** Rejected as the same
guarantee with more moving parts and a failure mode where a snapshot is missed.
