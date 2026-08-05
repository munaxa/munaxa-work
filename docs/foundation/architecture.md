# Foundation architecture

What Phase 1 built, and why each piece is shaped the way it is. Nothing here knows what an
employee is — the foundation carries no business concept, no tenant rule and no HR vocabulary,
and the moment it does, every module inherits the leak.

## The layers, and the one rule about them

```text
presentation  ──►  api  ──►  application  ──►  domain
                              │                  ▲
                              ▼                  │
                        infrastructure ──────────┘
```

Arrows point at what a layer may depend on. `domain` depends on nothing — no framework, no ORM,
no transport. `infrastructure` implements ports that `application` and `domain` declare, which
is what inverts the dependency and what makes the same business logic run against Postgres, a
fake, or whatever replaces them.

The direction is enforced by `tooling/eslint/standards.mjs`, not by review.

## What each package is for

| Package | Holds | Never holds |
| ------- | ----- | ----------- |
| `@work/kernel` | The abstractions every module builds on | Any business concept |
| `@work/persistence` | Connections, Unit of Work, repository base | Business rules |
| `@work/config` | The validated environment | Anything read from it |
| `@work/contracts` | Cross-module public contracts | Internals |
| `@work/testing` | Fakes, builders, assertions | Production code |
| `@work/country-packs` | Statutory content | Business logic |
| `packages/modules/<module>` | One business capability, layered inside | Another module's internals |

## The write path

Every state change follows the same route, and each step exists to make one failure impossible:

```text
Command
  │  Dispatcher: tenancy → authorization → validation
  ▼
Application service
  │  UnitOfWork.execute — begins, sets app.tenant_id transaction-locally
  ▼
Aggregate            records events, asserts its version
  │
  ▼
Repository           filters tenant, hides deleted, writes audit, checks version in the WHERE
  │
  ▼
commit ──────────────► events dispatch (never before)
```

| Step | Failure it prevents |
| ---- | ------------------- |
| Dispatcher order | An unauthorized caller learning whether their payload was valid |
| Transaction-local tenant | A pooled connection carrying one request's tenant into the next |
| Version in the `where` | The second approver's update vanishing into a read-then-write gap |
| Dispatch after commit | A consumer reacting to a change that rolled back |
| Soft delete only | A terminated employee's history disappearing from an audit |

## The read path

Queries do not share the write path, and that separation is not ceremony: it is what allows
reads to move to projections and eventually to a different store without touching a handler.

```text
Query ──► Dispatcher (tenancy, authorization) ──► QueryHandler ──► projection or table
```

Projections are folded from events and must be rebuildable — `verifyRebuild` compares a rebuild
against what is stored. A projection that cannot be rebuilt is a second source of truth that
drifts silently, and the drift is found by a customer disputing a number.

## Tenancy

Three layers, described in ADR-0030. The application half is `runInContext`; the database half
is row-level security; the guard that refuses to start when the database cannot enforce it is
`assertIsolationEnforced`.

## Ports that precede their engines

Workflow is Phase 16 and Communications is Phase 17, but five earlier domains need approvals and
notifications. `ApprovalPort`, `NotificationPort` and `DocumentPort` exist now with honest
in-process adapters (ADR-0024), so those domains depend on an interface from their first commit
and the real engines arrive as adapters.

## Determinism

Three things in the foundation are deterministic by construction, because everything financial
and statutory downstream depends on it:

- **The rule engine** — no clock, no randomness, no I/O; `versionInForce` selects by the date
  being calculated, so a March payroll re-run reproduces March's answer.
- **Money and Quantity** — exact integer arithmetic; rounding stated at every call site.
- **Projections** — the same events in the same order always produce the same state.
