# Munaxa Work

**Munaxa Work** is the HCM product. This is its independent repository — it owns its own API,
apps, database, migrations, infrastructure and CI, and depends on no other product.

> **Nothing is implemented here yet.** The repository was separated out of the AXA monorepo
> carrying this document and its history, so the shape and the guardrails are settled before
> development starts — and so the shared design system has a second real consumer to be
> designed against rather than a hypothetical one.

## What already exists for you

The shared platform is done and is the single source of truth. Install it, don't rebuild it:

| You need       | Where it comes from                 |
| -------------- | ----------------------------------- |
| Components     | `@munaxa/ui`                        |
| Design tokens  | `@munaxa/tokens`                    |
| Icons          | `@munaxa/icons`                     |
| UI hooks       | `@munaxa/ui/hooks`                  |
| Theme registry | `@munaxa/theme`                     |
| Typography     | `@munaxa/typography`                |
| The Work theme | `@import '@munaxa/theme/css/work';` |

The Work palette is already authored inside
[munaxa-platform](https://github.com/tam2om/munaxa-platform). Nothing about starting Work
requires touching a colour.

## When you start

1. Create the app(s) under `apps/` and any product packages under `packages/`, following the
   shape [munaxa-school](https://github.com/tam2om/munaxa-school) uses.
2. Add each new package to [`pnpm-workspace.yaml`](pnpm-workspace.yaml) and, for anything that
   emits declarations, to the `references` in [`tsconfig.json`](tsconfig.json).
3. Depend on the platform by semantic version, e.g. `"@munaxa/ui": "^1.0.0"`.
4. In the app's `globals.css`:

   ```css
   @import 'tailwindcss';
   @import '@munaxa/theme/css/work';
   @source '../../node_modules/@munaxa/platform/dist';
   ```

   Tailwind v4 has to scan the design system's shipped sources to emit the classes its
   components use. Point `@source` at the installed package — never at a path into another
   repository.

## Setup

Installing needs a GitHub token with `read:packages` on the `tam2om` org:

```bash
export GITHUB_TOKEN=<PAT with read:packages>
pnpm install

pnpm verify   # standards · format · lint · typecheck · test · build
```

Every gate runs today against an empty workspace, so the first app added here is checked from
its first commit. `pnpm standards` on its own needs no install and no registry access.

## The standards are enforced, not advisory

[`docs/ENGINEERING_STANDARDS.md`](docs/ENGINEERING_STANDARDS.md) is mandatory for every module,
package and phase. Complexity limits, file budgets, naming, layer dependency direction and the
ban on `any` / `@ts-ignore` / `eslint-disable` are enforced by
[`tooling/eslint/standards.mjs`](tooling/eslint/standards.mjs),
[`tooling/typescript/standards.json`](tooling/typescript/standards.json) and
[`scripts/check-standards.mjs`](scripts/check-standards.mjs), and they fail CI.

Every app and package must spread the standards layer after its Platform config — see
[Adopting the standards in a package](docs/ENGINEERING_STANDARDS.md#adopting-the-standards-in-a-package).
A standard is changed by an ADR in [`docs/adr/`](docs/adr/), never by a suppression.

## Before you add anything shared

Read [`ARCHITECTURE.md`](ARCHITECTURE.md) and the platform's `CONTRIBUTING.md`. Whether
something belongs in the platform or in this product is the one decision that determines
whether the shared layer stays reusable — and a component copied into a product is the exact
failure this architecture exists to prevent.
