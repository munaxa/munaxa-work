# ADR-0075 — A Next.js dynamic route segment is named by the router

**Status** Accepted
**Date** 2026-08-24
**Author** Munaxa Work engineering
**Approval** Pending review
**Extends** [ADR-0029](0029-ecosystem-file-naming.md) — file naming follows the ecosystem

## Decision

`kebab-case` remains the file and folder convention for the TypeScript workspace, unchanged.

Inside a Next.js App Router directory, a **dynamic route segment** is named by the router rather
than by us, and the standards gate checks it against the router's own grammar instead:

```text
[employmentId]      one segment
[...slug]           a catch-all
[[...slug]]         an optional catch-all
(group)             a route group, which forms no URL segment
@panel              a parallel route slot
```

The name **inside** the brackets is still `camelCase`, exactly as an identifier in this workspace
is, and it is still checked. Anything that is neither a dynamic segment nor `kebab-case` is still a
violation.

## Reason

The App Router reads directory names as routing syntax. `[employmentId]` is not a folder somebody
named badly — it is how the framework is told that the segment is a parameter, and the parameter's
name is the key the page receives it under. There is no spelling of it that satisfies both the
router and a blanket `kebab-case` rule, so a repository-wide rule makes a conforming Next.js
application permanently fail our own gate.

This is the same situation ADR-0029 already resolved twice, for the same reason, and it is resolved
the same way: enforce each ecosystem's convention rather than impose one ecosystem's on another's
toolchain. The Dart analyzer requires `snake_case`; Prisma reads `<timestamp>_<name>/migration.sql`
by name; the Android toolchain parses `values-night` as a qualifier. A Next.js dynamic segment
belongs on that list, and putting it there is applying ADR-0029's principle rather than taking a new
decision.

The alternative was to leave the product without detail routes, which is what it had: fifteen
listings, no way to open a row, and no employee record. That is not a naming outcome anybody
intended.

## Consequences

- `scripts/check-standards.mjs` accepts a route-segment folder name under `apps/*/src/app/`, and
  checks the identifier inside the brackets is `camelCase`.
- Everything else in the TypeScript workspace is unchanged and still `kebab-case`, including every
  file inside a dynamic segment: `page.tsx`, `loading.tsx` and `not-found.tsx` are checked exactly
  as before.
- `apps/admin/src/app` is not an unchecked directory. A folder called `[Employment_Id]` or
  `MyRoute` still fails.
- `docs/ENGINEERING_STANDARDS.md` states the convention beside the other three.

## Alternatives considered

- **Ship no detail routes.** Rejected: it is the reason the product had no employee record, and a
  naming rule is not a reason to leave the central screen of an HR product unbuilt.
- **Query parameters instead of a path segment** — `/employment/record?employmentId=…`. Rejected: it
  makes the record un-linkable as a resource, defeats `not-found.tsx` and `loading.tsx` per route,
  and works around the gate rather than answering it.
- **Exempt `apps/admin/src/app` from the naming check.** Rejected for ADR-0029's own reason: it
  trades a false failure for no coverage, in the directory where every future screen will live.
- **A suppression.** Not available, and correctly so — a rule is changed by an ADR, never by a
  suppression.
