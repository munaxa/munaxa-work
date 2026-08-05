# ADR-0021 — Engineering standards enforcement

**Status** Accepted
**Date** 2026-08-05
**Author** Munaxa Work engineering
**Approval** Pending review

## Decision

The engineering standards are enforced by tooling that runs in CI, not by review convention.
They are expressed in three places, all of which are part of the repository:

- `docs/ENGINEERING_STANDARDS.md` — the canonical, human-readable standard.
- `tooling/eslint/standards.mjs` and `tooling/typescript/standards.json` — the standards that
  a compiler or linter can decide, layered on top of `@munaxa/config-eslint` and
  `@munaxa/config-typescript`.
- `scripts/check-standards.mjs` — the standards that neither can see: file and folder naming,
  file budgets for files no package config reaches, and committed suppression markers.

Inline lint directives are disabled repository-wide (`noInlineConfig`), so a committed
`eslint-disable` suppresses nothing and is reported as a violation.

A standard is changed by a new ADR, and the document and the tooling are updated in the same
change. A standard is never relaxed by a suppression.

## Reason

The standards forbid disabling lint rules and suppressing type errors. A standard that is only
written down is negotiated in every pull request; one that fails the build is not. Splitting
the checks in three keeps each one where it belongs: the compiler decides types, ESLint decides
code shape and dependency direction, and a dependency-free script decides the rest — the
last of which runs on a bare checkout, so the gate does not depend on the package registry
being reachable.

The layer rules are expressed as import restrictions rather than a boundaries plugin because
the repository has no source yet: the rules must be correct before the first file exists, and
path patterns need no build graph to evaluate.

## Consequences

- Every app and package must spread the standards layer after its Platform config, and list
  the TypeScript overlay last. This is documented in `docs/ENGINEERING_STANDARDS.md`.
- Violations block CI. There is no local escape hatch; the escape hatch is an ADR.
- The file budgets are enforced twice — in ESLint and in the script — so a file that no package
  config covers is still bounded.
- `@ts-expect-error` with a description of at least 20 characters remains available. It is
  self-removing and documented, unlike `@ts-ignore`, which is forbidden outright.

## Alternatives considered

- **Review-only enforcement.** Rejected: the standards are mandatory, and mandatory rules
  enforced by humans decay.
- **Publishing the rules to `@munaxa/config-eslint` in the platform.** Rejected for now: these
  are Munaxa Work standards, not platform standards, and ADR-0001 forbids Work from changing
  the platform for its own needs. If a second product adopts them unchanged, promoting them is
  a future ADR.
- **`eslint-plugin-boundaries` for the layer rules.** Rejected: another dependency and another
  configuration language for a constraint `no-restricted-imports` already expresses.
- **Enforcing budgets only in ESLint.** Rejected: ESLint sees only what a package config
  includes, and the repository has no packages yet.
