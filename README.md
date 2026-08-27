# Munaxa Work

**Munaxa Work** is the HCM product. This is its independent repository — it owns its own API,
apps, database, migrations, infrastructure and CI, and depends on no other product.

> **Where this is.** Eighteen business modules, 186 tables, 32 migrations and 513 routes are
> built and tested; the ledger is [`docs/PHASES.md`](docs/PHASES.md). The product surface over
> them is thinner than the domain beneath it, and
> [`docs/verification/product-readiness-audit.md`](docs/verification/product-readiness-audit.md)
> says exactly how thin, area by area. Authentication and authorization are Platform's and are
> not implemented here, so a deployment without Platform's adapters answers `401` to every
> business route — by design (ADR-0001, ADR-0032).

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

## Adding to it

1. New apps go under `apps/` and new product packages under `packages/`, following the shape the
   existing ones use.
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

`pnpm standards` on its own needs no install and no registry access; the rest needs the packages.

## The rules are enforced, not advisory

Two documents govern this repository, and both are mandatory for every module, package and
phase:

- [`docs/MASTER_INSTRUCTIONS.md`](docs/MASTER_INSTRUCTIONS.md) — the architectural law:
  Platform ownership, layer direction, module independence, multi-tenancy, deployment
  agnosticism, externalized configuration. Supporting registries:
  [domain ownership](docs/DOMAIN_OWNERSHIP.md) and the [implementation ledger](docs/PHASES.md).
- [`docs/ENGINEERING_STANDARDS.md`](docs/ENGINEERING_STANDARDS.md) — the code-level law:
  complexity limits, file budgets, naming, and the ban on `any` / `@ts-ignore` /
  `eslint-disable`.

They are enforced by [`tooling/eslint/standards.mjs`](tooling/eslint/standards.mjs),
[`tooling/typescript/standards.json`](tooling/typescript/standards.json),
[`scripts/check-standards.mjs`](scripts/check-standards.mjs) and
[`scripts/check-architecture.mjs`](scripts/check-architecture.mjs) — and they fail CI.

Every app and package must spread the standards layer after its Platform config — see
[Adopting the standards in a package](docs/ENGINEERING_STANDARDS.md#adopting-the-standards-in-a-package).
A rule is changed by an ADR in [`docs/adr/`](docs/adr/), never by a suppression.

## Before you add anything shared

Read [`ARCHITECTURE.md`](ARCHITECTURE.md) and the platform's `CONTRIBUTING.md`. Whether
something belongs in the platform or in this product is the one decision that determines
whether the shared layer stays reusable — and a component copied into a product is the exact
failure this architecture exists to prevent.
