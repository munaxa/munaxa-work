# prisma/

**The SQL migrations are the authoritative database model.** `prisma/schema.prisma` is not.

| Path | What it is | Authoritative? |
| --- | --- | --- |
| `migrations/<timestamp>_<name>/migration.sql` | Hand-written PostgreSQL, applied in order by `prisma migrate deploy` (`pnpm db:migrate`, the migrate image) | **Yes** |
| `migrations/migration_lock.toml` | Prisma's provider lock | Never edit |
| `sql/row-level-security.sql` | A pointer only: the row-level security procedures moved into the foundation migration | No |
| `schema.prisma` | A description of the tables for `prisma validate` and the architecture gate. The runtime does not query through `@prisma/client` | No |
| `drift-baseline.json` | How far `schema.prisma` is known to disagree with the migrated database; may only go down | Ratchet |

## Why the SQL, and not the Prisma schema

The database enforces what the product promises: row-level security on every tenant table
(ADR-0030), GiST exclusion constraints that make overlapping leave, compensation and payroll
periods impossible, partial unique indexes, composite tenant-scoped foreign keys, and roles such as
`work_membership_resolver`. The Prisma schema language cannot express most of these, and
`schema.prisma` does not mirror the rest exactly.

So the two models disagree, and Prisma would "fix" the disagreement in its own direction. On a
database with every migration applied, `prisma migrate diff --from-url <db> --to-schema-datamodel
prisma/schema.prisma --script` (Prisma 6.19.3, 23 Nov 2026) proposes 528 statements on 184 tables:
drop 255 foreign keys, drop 17 indexes (the exclusion constraints and partial indexes among them),
create 130 indexes, drop 128 column defaults, add 12 foreign keys and rename one index. That is
exactly what `prisma migrate dev` would write into a new migration, and what `prisma db push` would
do to the database directly.

## Rules

1. **Write every migration by hand.** Create `prisma/migrations/<YYYYMMDDHHMMSS>_<snake_case_name>/migration.sql`
   with a timestamp later than the last merged migration. Open it with a prose comment saying what
   it does and why, as every existing migration does. Enable row-level security on a new tenant table
   in the same migration that creates it (`call app_protect_table('<table>');`).
2. **Never edit, rename or delete a merged migration.** `migrate deploy` records a checksum for
   every migration it applies; a changed one breaks every later deploy of that database. Fix forward
   with a new migration.
3. **Never run `prisma migrate dev` or `prisma db push`,** against any database. Never run
   `prisma migrate reset` against anything but your own local database.
4. **Keep `schema.prisma` in step with your migration** so the drift does not grow: add the model,
   columns, indexes and relations your SQL adds, with the same names.

## What enforces the rules

| Gate | Where | Fails when |
| --- | --- | --- |
| `node scripts/check-migration-safety.mjs` (`pnpm check:migrations`, part of `pnpm standards`) | CI, Standards job | A migration carries Prisma's markers (`-- CreateTable` and the like, the `Warnings:` block, `ON UPDATE CASCADE`, `<table>_pkey`) or lacks an opening comment; a merged migration or `migration_lock.toml` changed against the base branch (`MIGRATION_BASE_REF`, else `origin/main`; a named base that cannot be resolved fails the gate); a directory is misnamed or holds more than `migration.sql`; a `package.json` script runs `db push` (however quoted), or mentions `migrate` with `reset`, `push` or `dev` and is not exactly `node scripts/db-reset-guard.mjs && [pnpm --filter @work/api exec ]prisma migrate reset [--schema <path>] [--skip-seed] [--skip-generate]` (an allow-list: no other operator, assignment, `cd`, quoting or flag). A new migration older than the last merged one is a warning |
| `node scripts/check-migration-drift.mjs` | CI, after `Apply migrations` in the Lint · Typecheck · Test · Build job | Any count of the `prisma migrate diff` script is above `drift-baseline.json` |
| `node scripts/db-reset-guard.mjs` | In front of `pnpm db:reset` | `DATABASE_URL` is not exported, or names a host other than localhost, 127.0.0.1 or ::1, or carries a `host=` or `hostaddr=` parameter in any letter case, or `WORK_ALLOW_DB_RESET=1` is not set |

The decision logic of all three has node:test suites under `scripts/*.test.mjs`
(`pnpm test:scripts`, CI's Tooling tests step).

## Measuring and lowering the drift

With a local database that has every migration applied (see docs/DEVELOPMENT.md):

```bash
DATABASE_URL=postgresql://work:work@localhost:5432/work \
  pnpm --filter @work/api exec prisma migrate diff \
    --from-url "$DATABASE_URL" --to-schema-datamodel ../../prisma/schema.prisma --script > /tmp/drift.sql
node scripts/check-migration-drift.mjs /tmp/drift.sql
```

When a change makes the schema file agree with the SQL more closely, the check prints a notice;
record the lower counts in the same pull request with
`node scripts/check-migration-drift.mjs /tmp/drift.sql --write-baseline`. Never raise the baseline
to make a change pass: change `schema.prisma` (or the migration) until the counts hold.

## Resetting your own database

```bash
WORK_ALLOW_DB_RESET=1 DATABASE_URL=postgresql://work:work@localhost:5432/work pnpm db:reset
```

`DATABASE_URL` must be exported in the shell: a value only in a `.env` file is not seen by the
guard, so the reset is refused.
