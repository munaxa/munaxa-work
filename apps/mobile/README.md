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
own toolchain. CI builds it in a separate job with the Flutter SDK installed.

> **Not yet verified.** The Flutter SDK is not available in the environment where this was
> scaffolded, so `flutter build` has never run against it. The first CI run with the SDK is what
> proves this compiles — treat the Phase 0 acceptance criterion "Flutter builds" as outstanding
> until then.

Rules that apply here from the first screen: no business logic, the same `/api/v1` the portals
use, Platform authentication, Arabic and English, RTL and LTR, both calendars, and no
advertising or third-party marketing (ADR-0028).
