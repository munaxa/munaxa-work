# Modules

One folder per business module, created by the phase that owns it:

```text
packages/modules/<module>/
├── domain/           # business rules — no framework, no ORM, no transport
├── application/      # use cases, commands, queries
├── infrastructure/   # persistence and external integrations
├── contracts/        # the public surface other modules may depend on
└── api/              # transport
```

A module is reached only through its application services, public contracts or domain events.
Its repositories and its Prisma client are private to its infrastructure layer, and the lint
layer in `tooling/eslint/standards.mjs` enforces that.

Ownership of every business concept is recorded in [`docs/DOMAIN_OWNERSHIP.md`](../../docs/DOMAIN_OWNERSHIP.md).
No module exists yet — Phase 2 creates the first one.
