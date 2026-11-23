# Database and data integrity audit

Baseline `61c115b`. Evidence comes from applying every migration to an empty local PostgreSQL 16
cluster created for this session (`psql -v ON_ERROR_STOP=1 -f migration.sql` per directory, in order)
and querying the catalogue. No external or production database was touched.

## Facts

| Item                                   | Value                                                                                                                       |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Migrations                             | 35 directories, all applied cleanly in order                                                                                |
| Tables                                 | 188 in `public` (no `_prisma_migrations`, because SQL was applied directly)                                                 |
| RLS                                    | enabled on 188, **forced** on 188                                                                                           |
| Policies                               | 187 tables use `tenant_id = app_current_tenant()`; `workforce_user` uses membership reachability; 3 `membership_resolution` select policies for `work_membership_resolver` |
| Tables without a `tenant_id`-leading index | 0                                                                                                                       |
| Tables without creation audit columns  | 0                                                                                                                           |
| Foreign keys                           | 255, all `ON DELETE NO ACTION` (no cascading deletes)                                                                       |
| User triggers                          | 29 (append-only and immutability enforcement)                                                                               |
| `SECURITY DEFINER` functions           | 2 (`app_memberships_of`, `app_bound_memberships_of`), owned by the non-login `work_membership_resolver`, `search_path` pinned |
| Tenant context                         | `set_config('app.tenant_id', …, true)` inside the unit of work's transaction (`packages/persistence/src/postgres-unit-of-work.ts:41-44`) |
| Roles needed                           | owner with `CREATEROLE` (creates `work_membership_resolver`), app role `NOBYPASSRLS`; both created by `munaxa-platform/infra/aws/stack/scripts/db-bootstrap.sh:67-72` |

## What is good

- **Tenant scoping is structural.** Forced RLS means even the table owner is held to the policies; the
  tenant setting is transaction-local, so a pooled connection cannot carry one tenant's context into
  another's request. Verified with a `NOBYPASSRLS` probe role: no context, 0 rows; own tenant, 1 row;
  update of another tenant's row, 0 rows; insert for another tenant, refused ("new row violates
  row-level security policy").
- **History is preserved.** Effective dating, append-only ledgers (leave), immutable raw events
  (attendance), immutable plan and template versions, finalized payroll frozen by trigger (ADR-0066),
  soft deletes with `deleted_at` and partial unique indexes that ignore deleted rows.
- **Concurrency is handled by the database where it matters.** GiST exclusion against overlapping
  compensation (ADR-0063), unique keys that make two administrators creating the same period race in
  the database rather than both committing (comments in the compensation and payroll migrations),
  optimistic `version` columns.
- **Money** is integer minor units with an explicit exponent (ADR-0061); JOD's three decimals are
  exercised in payroll and letters tests.
- **No cascading deletes**, so no single delete can silently remove an employee's history.

## Findings

### MW-008 (Medium, Internal Testing): the Prisma schema has drifted from the SQL migrations

`prisma migrate diff --from-url <migrated database> --to-schema-datamodel prisma/schema.prisma` (Prisma
6.19.0, run in this session) exits 2. It would change **184 tables**: remove and re-add 255 foreign keys,
add 93 indexes, **remove 17 indexes** (the GiST exclusions and partial indexes Prisma cannot express)
and change 128 column defaults. The runtime never uses `@prisma/client` for queries; the schema is used
only for `prisma validate` and the architecture gate. `prisma validate` passes, which is why nothing
catches the drift.

**Impact:** the first agent or developer who runs `prisma migrate dev` or `prisma db push` generates a
migration that drops the overlap protections and rewrites every foreign key. With several agents
editing the database in parallel this is a real risk.

**Fix:** declare the SQL migrations authoritative in `docs/DEVELOPMENT.md` and `prisma/README`, add a CI
gate that fails when a new migration is created with `prisma migrate dev` (for example: every migration
must be hand-written SQL that the drift report does not grow), and forbid `db push` in scripts.
**Acceptance:** CI fails on a PR that runs `prisma migrate dev`; the drift count is recorded and can
only go down.

### MW-044 (Medium, Production): there is no tenant registry

There is no `tenant` table. A tenant exists because a `tenant_platform_binding` and a first
`tenant_membership` reference its UUID (`scripts/bootstrap-tenant.mjs`). There is no tenant status,
suspension, closure, data export per tenant or deletion procedure, apart from licensing state
(`licensing_state`, migrations `20261027090000` and `20261029130000`).

**Fix:** a tenant lifecycle design (create, suspend, export, close, purge) owned by Identity or Control
with a Work-side record.

### MW-052 (Low): `workforce_user` insert check is `true`

See SECURITY_AUDIT.md §2.

### Migration safety and reversibility (MW-021 context, MW-041)

- Migrations are forward-only SQL; there are no down migrations. The platform README's rollback for a
  failed migration is "fix forward; in Testing, drop and re-create the database"; production relies on
  RDS point-in-time restore. That is acceptable for Testing and must be rehearsed before production
  (MW-041).
- The last four migrations are small and additive (`licensing_state`, `licensing_revocation` adding
  columns, `tenant_platform_binding`, `membership_resolution_role`). No migration uses `CREATE INDEX
CONCURRENTLY` or a long data rewrite, so on an empty or small database none is dangerous.
- `20260901090000_membership_resolution_role` creates a cluster-wide role. On the shared RDS instance
  the role name `work_membership_resolver` must stay unique to Work, and the owner role keeps
  `CREATEROLE` for this reason (accepted by the platform; under PostgreSQL 16 a `CREATEROLE` role can
  administer only roles it created).
- `deploy/aws/runtime-grants.sql` emits about 200 harmless "no privileges were granted" warnings
  (recorded on 30 Oct). Not a defect; worth silencing so a real warning is not lost.

### Data retention and erasure (MW-023)

Soft delete only; no purge job, no retention configuration, no anonymisation. See SECURITY_AUDIT.md §3.

### Payroll data integrity

- Finalized results immutable at the table; reversal creates new rows.
- Snapshot per employment with a digest of its inputs (`snapshotDigest`,
  `packages/modules/payroll/src/domain/payroll-snapshot.ts:140-148`), so a result is explainable later.
- Gap: the snapshot has no person facts (nationality, birth date, gender) and no year-to-date figures,
  which Jordanian statutory rules will need (MW-010).

### Query performance

`scripts/measure-*.mjs` exist for ten modules, and the phase reports record measurements (payroll at
500, 10,000 and 100,000 employments, Phase 11 report). They are not run in CI and were not run in this
session. Every table has a `tenant_id`-leading index. No load test of the deployed API on RDS
`db.t4g.micro` exists (MW-042).

## Dangerous operations to avoid during deployment

| Operation                                          | Why                                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------------------- |
| `prisma migrate dev`, `prisma db push`, `prisma migrate reset` against a shared database | Drift (MW-008); `reset` drops everything. `pnpm db:reset` exists in `package.json` for local use only |
| Running the migrate image with the app role        | Migrations need the owner; the app role cannot create the resolver role         |
| Running `bootstrap-tenant.mjs` with the wrong `--platform-tenant-id` | The binding is never changed by the script; a wrong organisation needs manual database repair |
| Pinning the `b490b25` images                        | Withdrawn (CRITICAL zlib CVE) and refused by `withdrawn-images.tf`              |
