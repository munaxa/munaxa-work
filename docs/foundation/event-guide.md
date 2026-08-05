# Event guide

## What an event is

A fact that has already happened. Past tense, always: `leave.request.approved`, not
`approve.leave.request`. An event a consumer can refuse is a command wearing the wrong name.

## The envelope

Every event carries the same envelope, because the consumers that never read a payload — audit,
tracing, the integration hub — depend on the envelope alone.

| Field | Why it exists |
| ----- | ------------- |
| `eventId` | Identity of the occurrence; consumers deduplicate on it |
| `eventName` | What happened |
| `eventVersion` | Payload schema version — events outlive the code that wrote them |
| `tenantId` | Which tenant it belongs to |
| `occurredAt` | When, supplied rather than read from a clock |
| `correlationId` | The business operation, propagated from the request |
| `causationId` | The event or command that caused this one |
| `actor` | Who or what did it |
| `aggregateType` / `aggregateId` | What it happened to |

`occurredAt` is supplied so every event from one transaction shares an instant and tests are
deterministic. `causationId` is omitted when absent rather than carried empty — an empty field
that means "no cause" is indistinguishable from a bug that dropped it.

## Raising one

```ts
this.recordEvent(
  createDomainEvent(
    { eventName: 'leave.request.approved', eventVersion: 1, payload: { days }, occurredAt },
    { aggregateType: 'LeaveRequest', aggregateId: this.id },
    origin,
  ),
);
```

The aggregate **records**; it does not publish. The Unit of Work publishes after commit.

## Publication

```text
work ──► commit ──► dispatch
              ▲
              └── nothing is published before this point
```

Publishing before commit lets a consumer react to something that then rolls back: a notification
for a leave request that was never approved, a payroll instruction for a run that failed.

A handler failing **after** commit does not roll anything back — it cannot, the transaction is
durable. The failure surfaces to the caller while the write stands, which is the honest outcome:
the fact happened, and something downstream needs attention.

## Handlers

Every handler for an event runs, even when one throws; the failures are reported together.
Stopping at the first would let a notification bug silently prevent an audit record.

Handlers must be idempotent. Deduplicate on `eventId` — at-least-once delivery is what a message
bus will give you when the in-process dispatcher is replaced, and a handler that assumes
exactly-once is a handler that double-pays someone.

## Versioning

Add fields; never repurpose or remove one. When a payload must change incompatibly, raise the
version and publish both until every consumer has moved. A stored event from 2026 must still be
readable in 2030, because projections rebuild from it.

## Naming

`<module>.<aggregate>.<past-tense-verb>` — `leave.request.approved`, `payroll.run.finalized`,
`employment.assignment.changed`. The module prefix is what lets a message bus route by topic
later without renaming anything.
