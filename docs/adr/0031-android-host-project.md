# ADR-0031 — The Android host project is committed and checked as Android

**Status** Accepted
**Date** 2026-08-05
**Author** Munaxa Work engineering
**Approval** Pending review

## Decision

The generated Android host project lives in the repository at `apps/mobile/android`, and the
standards gate checks it against the Android toolchain's naming rules rather than against
`kebab-case` or `snake_case`.

## Reason

The mobile application was committed with its Dart sources but without a platform host, so
`flutter analyze` and `flutter test` passed while `flutter build apk` failed with *"your app is
using an unsupported Gradle project"*. Two of the three mobile gates were green for an
application that could not be built, which is exactly the shape of failure the verification
phase exists to catch. It was found by CI on the first run against a real Android toolchain — not
by reading the code.

The host project's names are not ours. Resource folders are qualifiers the Android platform
parses (`mipmap-hdpi`, `values-night`, `drawable-v21`), a Kotlin file must carry the name of the
class it declares (`MainActivity.kt`), and the Gradle files answer to Gradle (`build.gradle`,
`gradle-wrapper.properties`). This is the situation ADR-0029 already decided: enforce the
ecosystem's convention, never leave a directory unchecked.

## Consequences

- `scripts/check-standards.mjs` recognises `apps/mobile/android/` as its own ecosystem:
  lowercase folder names with `-` and `_` qualifiers, lowercase file names, `PascalCase` for
  `.kt` and `.java` files, and the literal names the build looks up.
- A misnamed file there is still a violation. The directory is checked, not excluded.
- The CI mobile job pins Temurin 17, because Gradle 8.3 supports Java 17 up to but not including
  Java 21 and the runner image's default JDK is not ours to depend on.
- Build output, the Gradle wrapper JAR, `local.properties` and signing material stay ignored, per
  the template's own `.gitignore`.

## Alternatives considered

- **Drop `flutter build apk` from CI.** Rejected outright. The gate found a real defect on its
  first run; removing it would convert a caught failure into an uncaught one.
- **Generate the host project during CI instead of committing it.** Rejected: the manifest, the
  application identifier, the signing configuration and the SDK levels are product decisions that
  must be reviewable in a diff, not re-derived from a template on every run.
- **Exclude `apps/mobile/android` from the standards gate.** Rejected for the reason recorded in
  ADR-0029 — an exemption trades a false failure for no coverage.

## Debt this records

The release build type signs with the debug keys, as the Flutter template leaves it. A real
signing configuration is owned by Phase 19.1, the phase that ships this application. Until then
no release artefact built from this repository may be distributed, and only `--debug` is built in
CI.
