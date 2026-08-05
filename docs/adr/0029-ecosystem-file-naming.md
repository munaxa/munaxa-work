# ADR-0029 — File naming follows the ecosystem

**Status** Accepted
**Date** 2026-08-05
**Author** Munaxa Work engineering
**Approval** Pending review

## Decision

`kebab-case` remains the file and folder convention for the TypeScript workspace. The Dart
application under `apps/mobile` uses `snake_case`, and the standards gate enforces that
convention there instead.

Both are enforced. Neither is exempt.

## Reason

The Dart analyzer's `file_names` rule requires `snake_case`, and Dart tooling mandates specific
filenames outright — `pubspec.yaml`, `analysis_options.yaml`. A repository-wide `kebab-case`
rule makes a conforming Flutter application permanently fail our own gate, which leaves two bad
options: suppress the gate for a whole directory, or fight the platform's tooling in every file.

The standard's intent is that naming is consistent and machine-checked, not that one language's
convention is imposed on another's toolchain. Enforcing each ecosystem's convention satisfies
the intent exactly; a blanket exemption for `apps/mobile` would not, because it would stop
checking anything there.

## Consequences

- `scripts/check-standards.mjs` selects the pattern by path: `apps/mobile` is checked as
  `snake_case`, everything else as `kebab-case`.
- A Dart file that is neither is still a violation, so the mobile application does not become an
  unchecked corner of the repository.
- `docs/ENGINEERING_STANDARDS.md` states both conventions.

## Alternatives considered

- **Rename the Dart files to kebab-case.** Rejected: `analysis_options.yaml` and `pubspec.yaml`
  are read by name, and the analyzer would flag every renamed source file.
- **Exempt `apps/mobile` from the naming check entirely.** Rejected: it trades a false failure
  for no coverage, and the mobile application is where a large share of user-facing code will
  eventually live.
- **Disable the Dart `file_names` lint instead.** Rejected: it makes our repository hostile to
  every Flutter developer who joins, and the convention is not ours to overrule.
