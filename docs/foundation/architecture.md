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

## Invariants the database enforces

Most invariants live in the domain, and the database repeats the ones whose failure is
unrecoverable: tenant isolation by row-level security, uniqueness and overlap by index and
exclusion constraint, self-approval by check constraint.

Phase 11 added the first **business trigger** in the repository, and it is deliberately the only
one. Once a payroll run is finalized, `app_payroll_refuse_finalized` rejects any update or delete
of a row it owns, on six tables. A trigger is used here because nothing cheaper can express it: a
check constraint cannot see the old row, and neither can a rule, a grant or a row-level-security
policy. The alternatives were compared explicitly and the cost was measured before it was
introduced (ADR-0066) — +8% on single-row updates, ≈14 µs per row, and within run-to-run noise in
bulk. Application-level enforcement remains in place as well; the trigger is the net, not the
rule.

Phase 12 added four more, and each clears the same bar. `document_version` and
`document_access_event` are **immutable from the instant they exist** — there is no "finalized"
moment to wait for, which is what makes a version a version and an access trail an access trail.
`letter_template_version` freezes the moment it issues a letter, and `letter_issued` freezes at
issue. All four express a rule about the *old* row, which no check constraint, rule, grant or
policy can read.

Two of the four were narrowed after the tests found them too broad, and both corrections are worth
recording because they are the same mistake in opposite directions. `document_version` originally
refused every update, including the one stamp that says a version is no longer current — as shipped,
adding a second version to a document was impossible. `letter_issued` originally left the
supersession pointer unguarded, and unguarded means repointable: somebody could rewrite which letter
replaced which, long after a bank acted on one of them. A trigger that refuses too much and a
trigger that refuses too little are both found the same way, by asserting the **permitted** case
alongside the refusals rather than only the refusals.

The bar for the next one is unchanged: application enforcement alone is insufficient, no
declarative constraint can express it, the alternatives are compared in an ADR, and the cost is
measured rather than assumed.

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
