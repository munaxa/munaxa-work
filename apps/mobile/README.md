# Munaxa Work — mobile

Bootstrap only. Functionality is specified in
[`20A_PHASE_19.1_MOBILE_APPLICATIONS.md`](../../work%20prompts/20A_PHASE_19.1_MOBILE_APPLICATIONS.md).

```bash
flutter pub get
flutter analyze
flutter test
flutter build apk --debug
```

This application is **not** part of the pnpm workspace and is not built by `turbo`: it has its
own toolchain and its own CI job.

## Verification status

Verified against Flutter 3.27.1 / Dart 3.6.0: `pub get` resolves, `analyze` reports no issues,
both tests pass, and the application compiles to a real artifact.

`flutter build apk` is verified in CI rather than locally — it needs the Android SDK, which the
CI runner provides. The lockfile is committed so those runs are reproducible: an application,
unlike a library, pins its dependency graph.

## Rules that apply here from the first screen

No business logic. The same `/api/v1` the portals use. Platform authentication. Arabic and
English, RTL and LTR, both calendars. No advertising or third-party marketing (ADR-0028).
