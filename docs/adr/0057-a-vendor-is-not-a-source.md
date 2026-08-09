# ADR-0057 — A vendor is not a source: devices reach Attendance through a normalized contract

**Status** Accepted · **Date** 2026-08-11 · **Author** Phase 8 · **Approval** Approved before implementation

## Context

Time-and-attendance products accumulate device integrations: a biometric reader here, a turnstile
there, a QR gate, a badge terminal, each with its own SDK, its own polling protocol and its own idea
of what a record looks like. The usual outcome is a domain with a vendor's vocabulary in it, and a
vendor's upgrade cycle wired into a payroll-critical calculation.

## Decision

**A time event has seven sources, and none of them is a vendor**: `web`, `mobile`, `device`,
`manual`, `import`, `api`, `correction`. A biometric reader, a turnstile and a QR gate all arrive as
`device`. Which physical unit produced the punch is `device_reference` — an opaque string, stored and
compared, never parsed.

**No vendor SDK is imported by this module, at any layer.** An adapter outside Attendance speaks
whatever protocol a reader speaks and submits the normalized command. That is the whole contract:
`attendance.record-event`, idempotent, with an idempotency key or a source reference the adapter
supplies.

**No raw biometric template is stored anywhere.** Not a fingerprint, not a face embedding, not a
hash of one. Attendance receives an employment identifier that a reader's own system already
resolved. Storing biometric data would make this module a biometric identity service, subject to a
different body of law in most of the markets this product targets, and it is not one.

**Import is the same contract in bulk.** A CSV is parsed at the edge; a device's export format is an
adapter's problem. Import sends the same `attendance.record-event` command row by row, through the
same dispatcher, so a re-run deduplicates for free and every rule ingestion enforces applies. It is
bounded and refuses by name beyond the bound, because a request that timed out half way through a
month of turnstile data leaves an operator guessing what landed.

## Consequences

- Adding a vendor is writing an adapter outside this module. Nothing in the domain, the database or
  the calculation changes.
- **No device integration is shipped or verified in this phase.** There is no reader in this
  repository to test against, and the completion report marks device and biometric integration
  **NOT VERIFIED** rather than claiming a mock proves anything.
- A mobile client is a `mobile`-source caller of the same endpoint. The offline case is supported at
  the contract level — `capturedOffline`, a client idempotency key, and three separate timestamps —
  and the app itself is a later phase.

## Alternatives considered

**A per-vendor source enum value.** Rejected. The set would grow with the sales pipeline, and every
addition would be a migration to a check constraint on a table with a million rows in it.

**A generic "device integration framework" in Phase 8.** Rejected as speculative. One normalized
command and an opaque device reference is the smallest thing that works, and it is what a real
integration would use anyway.
