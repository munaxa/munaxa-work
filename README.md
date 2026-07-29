# Work

Reserved product root for **Munaxa Work**, the HCM product. **Nothing is implemented here yet** — this folder exists so the
repository's shape is settled before development starts, and so the design system has a second
real consumer to be designed against rather than a hypothetical one.

## What already exists for you

The shared platform is done and is the single source of truth:

| You need               | Where it comes from                                              |
| ---------------------- | ---------------------------------------------------------------- |
| Components             | `@axa/platform`                                              |
| Design tokens          | `@axa/platform/tokens`                                       |
| Icons                  | `@axa/platform/icons`                                        |
| UI hooks               | `@axa/platform/hooks`                                        |
| Theme registry         | `@axa/platform/themes`                                       |
| The Work theme         | `@import '@axa/platform/css/themes/work';`                |

The Work palette is already authored — see
[`platform/themes/work/`](../platform/themes/work). Nothing about starting Work
requires touching the platform's colours.

## When you start

1. Create the app(s) under `work/` using the same shape School uses
   (`work/apps/*`, `work/packages/*`).
2. Add the new paths to the root [`pnpm-workspace.yaml`](../pnpm-workspace.yaml) and, for any
   package that emits declarations, to the root [`tsconfig.json`](../tsconfig.json) references.
3. Depend on `"@axa/platform": "workspace:*"`.
4. In the app's `globals.css`:

   ```css
   @import 'tailwindcss';
   @import '@axa/platform/css/themes/work';
   @source '../../../../platform/ui';
   ```

   (Adjust the `@source` depth to the file's actual location — Tailwind v4 needs to scan the
   platform's sources to emit the classes its components use.)

Read [`platform/CONTRIBUTING.md`](../platform/CONTRIBUTING.md) before adding any component —
it is the mandatory standard for all work in the shared layer. Whether something belongs in the
platform or in this product is the one decision that determines whether the shared layer stays
reusable.
