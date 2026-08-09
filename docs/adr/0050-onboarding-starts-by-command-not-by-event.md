# ADR-0050 — An onboarding is started by an idempotent command and guaranteed by reconciliation, never by an event

**Status** Accepted · **Date** 2026-08-10 · **Author** Phase 7 · **Approval** Approved before implementation (D-1, D-2)

## Context

The obvious design is that Recruitment's hire raises an event and Onboarding subscribes to it. The
repository makes that design unsafe, and the facts are worth stating precisely rather than
paraphrasing:

- `PostgresUnitOfWork.execute` commits the transaction and **then** dispatches the collected events.
  A process that dies between the two loses them.
- Delivery is **in-process**. There is no broker, no queue and no retry.
- There is **no outbox**. Nothing records that an event should have been delivered, so nothing can
  replay one.
- Event names are internal constants. There is **no published event contract** and **no cross-module
  subscription contract**.

So an event is at-most-once, and "the hire event was raised" is not evidence that anything happened.
If onboarding depended on it, the observable failure would be a joiner arriving on their first day
with no induction and no record that one was ever expected.

The approved decision (D-1, D-2) is explicitly **not** to fix the event architecture in this phase —
that is Phase 16/17's work — and explicitly not to make Onboarding depend on an event either.

## Decision

**Three mechanisms, in order of authority.**

**1. The authoritative start is an idempotent command.** `onboarding.start-onboarding` names an
employment and is safe to send any number of times. It is a `POST` a client may retry freely: a
repeat returns the onboarding that exists, with `alreadyExisted: true` and a `200` — not a `409`, and
not a second instance.

**2. The uniqueness boundary is a database constraint.** A partial unique index:

```sql
create unique index onboarding_instance_live_employment_key
  on onboarding_instance (tenant_id, employment_id)
  where state in ('draft', 'preboarding', 'in_progress') and deleted_at is null;
```

At most one *live* onboarding per employment per tenant. The command reads the same predicate before
it writes, so the ordinary repeat costs one read; the index is what decides a **race**. Two concurrent
requests both read "none", both insert, one is refused with SQLSTATE `23505`, and the loser re-reads
and returns the winner's instance. Convergence is deterministic and does not depend on timing. A
terminal onboarding leaves the index, so a rehire can be onboarded again.

**3. Reconciliation is the guarantee.** `GET /api/v1/onboarding/reconciliation` names every eligible
employment in the tenant that has no onboarding; `POST` starts one for each by **sending the same
command** an administrator would, through the same dispatcher. Every rule the start enforces applies
to a reconciliation run: the employment must be real and not ended, the person must not have been
merged away, and the uniqueness boundary holds. It is tenant-scoped, bounded, deterministic and safe
to rerun — an employment that already has an onboarding of *any* state is skipped, so a rerun creates
nothing.

**An event may be an accelerator, never a guarantee.** If a composition root subscribes to a hire
event and sends the start command, nothing about the guarantee changes: a duplicate event costs a
read, and an event that never arrives is picked up by reconciliation. **Event received ≠ onboarding
guarantee; event not received ≠ onboarding failure.**

## Reason

**A command can be retried; an event cannot be replayed.** Given at-most-once delivery and no outbox,
the only mechanism that can *guarantee* an onboarding exists is one somebody or something can run
again — which is a command, plus a query that says what is missing.

**Idempotency belongs in the database, not in the handler.** A read-then-write check is correct until
two requests interleave, and the interleaving is exactly what a hire event, an HTTP retry and a
reconciliation run make likely. The index cannot be bypassed by a defect in the application.

**Reconciliation must send the command, not write rows.** A reconciliation that inserted directly
would be a second implementation of the start, and it would drift — the first time a rule is added to
the command and not to the job, the bulk path silently produces onboardings the single path would
have refused.

**"Any state" rather than "live" in the reconciliation predicate matters.** Skipping only employments
with a *live* onboarding would make every rerun recreate an onboarding somebody had deliberately
cancelled, which is how a safe-to-rerun job becomes a nightly duplicate factory.

## Consequences

- Onboarding is **not automatic** unless something calls the endpoint. Whether that is an operator, a
  deployment's scheduler or an event accelerator is a deployment decision, and Phase 7 introduces no
  job infrastructure to make it for them.
- The three reliability properties are covered by tests that are the evidence for the claims above:
  an onboarding created by reconciliation when no event was delivered and not duplicated on a rerun;
  a start command sent twice returning one instance; two concurrent starts converging on one row
  against the real index.
- Reconciliation reads a bounded page of employments. A run that hits the bound is not a failure — it
  reports what it scanned, and the next run continues with what still has none.
- The completion report states, verbatim: *current event delivery is post-commit, in-process,
  at-most-once, with no outbox.* Nothing in this module claims durable delivery, exactly-once
  processing or outbox semantics.

## Alternatives considered

**Build an outbox in Phase 7.** Rejected on the approved instruction, and on merit: an outbox is
infrastructure every module depends on, and building it inside a business phase would make one
module's needs the shape of the whole product's messaging. Phase 16/17 own it.

**An idempotency key supplied by the caller.** Rejected as weaker. A key deduplicates *requests*; the
real invariant is one live onboarding per employment, which also has to hold across two different
callers who never shared a key.

**`insert ... on conflict do nothing`.** Rejected. It swallows the race and returns a success carrying
no identifier, which is the shape of an idempotent API that quietly does nothing. The command needs
to know it lost so it can read the winner and return it.
