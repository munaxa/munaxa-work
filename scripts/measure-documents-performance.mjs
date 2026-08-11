#!/usr/bin/env node
/**
 * Measures the **production** Documents and Letters implementations at the volumes Phase 12 names:
 * 10,000 and 100,000 documents, and a version dataset of five versions per document at the smaller
 * size.
 *
 * Real PostgreSQL, the real repositories, the real row mappers. Every measurement runs as an
 * **unprivileged role** under the same row-level security a request runs under, because a superuser
 * sees every row without consulting a policy and would hide exactly the cost RLS adds.
 *
 * **The three reads that decide whether this module is usable** are measured separately, because an
 * aggregate says the page took a second and does not say which query to index:
 *
 * 1. **The expiry queue** — "what expires in the next ninety days". An indexed comparison on
 *    `expiry_date`, never `ILIKE`. This is the highest-value question in the domain and the one
 *    that would fail first if it were a text search (D-21).
 * 2. **The verification queue** — "what is waiting for a verifier". Also a plain predicate.
 * 3. **The access trail for one document** — the query a subject access request runs.
 *
 * Reconciliation is measured too, and is deliberately the slowest: it scans for duplicate content
 * across the whole tenant. It is a query somebody runs, not one on a page load.
 *
 * The figures this prints are the figures the Phase 12 report carries, **including any that miss
 * their budget**. A benchmark whose failures are not reported is not a benchmark.
 *
 * Usage: TEST_DATABASE_URL=... node scripts/measure-documents-performance.mjs [--only=A|B] [--purge]
 */

import { Client, Pool } from 'pg';

import { InProcessEventDispatcher, runInContext, uuidV7 } from '../packages/kernel/dist/index.js';
import { PostgresUnitOfWork } from '../packages/persistence/dist/index.js';
import { postgresDocumentsStores } from '../packages/modules/documents/dist/index.js';

const CONNECTION = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

if (CONNECTION === undefined) {
  console.error('Set TEST_DATABASE_URL (or DATABASE_URL) to a migrated database.');
  process.exit(1);
}

const TENANT = '01930000-0000-7000-8000-0000000dbe01';
const ROLE = 'documents_benchmark_role';

/**
 * The two volumes, and the budgets each read is held to.
 *
 * The budgets are what a person waiting at a screen will tolerate rather than what the machine
 * happens to manage: a queue somebody opens every morning has to answer in well under a second, and
 * a subject access request may take longer because somebody asked for it in writing.
 */
const DATASETS = [
  {
    key: 'A',
    documents: 10_000,
    versionsPer: 5,
    budgetMs: { queue: 400, trail: 200, reconcile: 5_000 },
  },
  {
    key: 'B',
    documents: 100_000,
    versionsPer: 1,
    budgetMs: { queue: 1_000, trail: 200, reconcile: 30_000 },
  },
];

const only = process.argv
  .find((argument) => argument.startsWith('--only='))
  ?.slice('--only='.length);
const purge = process.argv.includes('--purge');

const elapsed = async (work) => {
  const started = process.hrtime.bigint();
  const value = await work();

  return { value, ms: Number(process.hrtime.bigint() - started) / 1e6 };
};

const admin = new Pool({ connectionString: CONNECTION, max: 4, statement_timeout: 600_000 });

/**
 * The unprivileged role, created if absent.
 *
 * It owns nothing and holds no `BYPASSRLS`. A benchmark run as a superuser would measure a
 * different query plan from the one production uses — the policy predicate is part of the cost.
 */
const applicationUrl = async () => {
  await admin.query(
    `do $$ begin
       if not exists (select 1 from pg_roles where rolname = '${ROLE}') then
         create role ${ROLE} login nosuperuser password 'benchmark';
       end if;
     end $$`,
  );
  await admin.query(
    `grant select, insert, update, delete on
       document_type, document, document_version, document_verification, document_access_event,
       person to ${ROLE}`,
  );

  const url = new URL(CONNECTION);

  url.username = ROLE;
  url.password = 'benchmark';
  return url.toString();
};

const AUDIT = `now(), 'benchmark', now(), 'benchmark', 1`;

/**
 * Seeds one dataset with `COPY`-shaped multi-row inserts.
 *
 * Deliberately **not** through the command handlers: seeding a hundred thousand documents through
 * the dispatcher would measure the seeding rather than the reads, and the reads are the point. The
 * rows it writes are the rows the handlers write — same columns, same constraints, same triggers.
 */
const seed = async (dataset) => {
  const personId = uuidV7();
  const typeId = uuidV7();

  await admin.query(
    `insert into person (id, tenant_id, person_number, status, metadata,
                         created_at, created_by, updated_at, updated_by, version)
     values ($1, $2, $3, 'active', '{}'::jsonb, ${AUDIT})
     on conflict do nothing`,
    [personId, TENANT, `BEN-${personId.slice(-12)}`],
  );
  await admin.query(
    `insert into document_type
       (id, tenant_id, code, name, owner_types, expires, requires_verification, confidentiality,
        employee_visible, manager_visible, notice_days, active, metadata,
        created_at, created_by, updated_at, updated_by, version)
     values ($1, $2, 'passport', '{"en":"Passport","ar":"جواز"}'::jsonb,
             array['person']::varchar(32)[], true, true, 'normal', true, true,
             array[90, 30], true, '{}'::jsonb, ${AUDIT})`,
    [typeId, TENANT],
  );

  const documentIds = [];

  for (let written = 0; written < dataset.documents; written += 1_000) {
    const batch = Math.min(1_000, dataset.documents - written);
    const rows = [];
    const values = [];

    for (let index = 0; index < batch; index += 1) {
      const id = uuidV7();

      documentIds.push(id);
      // A tenth of the register expires inside the ninety-day window, so the queue returns a
      // realistic slice rather than everything or nothing.
      const days = (written + index) % 10 === 0 ? 30 : 900;
      const at = values.length;

      values.push(id, TENANT, typeId, personId, days);
      rows.push(
        `($${at + 1}, $${at + 2}, $${at + 3}, 'person', $${at + 4}, ` +
          `'{"en":"Passport scan","ar":"صورة"}'::jsonb, 'active', 'normal', ` +
          `(current_date + make_interval(days => $${at + 5}::int))::date, ` +
          `case when $${at + 5}::int = 30 then 'pending_verification' else 'verified' end, ` +
          `0, 'direct', ${AUDIT})`,
      );
    }
    await admin.query(
      `insert into document
         (id, tenant_id, document_type_id, owner_type, owner_id, title, status, confidentiality,
          expiry_date, verification_state, version_count, source,
          created_at, created_by, updated_at, updated_by, version)
       values ${rows.join(', ')}`,
      values,
    );
  }
  await seedVersions(documentIds, dataset.versionsPer);
  await seedTrail(documentIds[0]);
  return { documentIds, typeId };
};

/** Versions, with content hashes that collide on purpose so reconciliation has work to do. */
const seedVersions = async (documentIds, versionsPer) => {
  for (let from = 0; from < documentIds.length; from += 500) {
    const slice = documentIds.slice(from, from + 500);
    const rows = [];
    const values = [];

    for (const [offset, documentId] of slice.entries()) {
      for (let number = 1; number <= versionsPer; number += 1) {
        const at = values.length;
        // One duplicate hash per thousand documents: enough for the duplicate scan to find
        // something, few enough that it is not scanning one enormous group.
        const hash = ((from + offset) % 1_000 === 0 ? 'd' : 'a').repeat(64);

        // The reference is passed as its own parameter rather than built from `version_number`:
        // casting a bind parameter to text after using it as an integer makes PostgreSQL infer two
        // types for one placeholder, and it refuses the statement outright.
        values.push(uuidV7(), TENANT, documentId, number, `documents/benchmark/v${number}`, hash);
        rows.push(
          `($${at + 1}, $${at + 2}, $${at + 3}, $${at + 4}, $${at + 5}, ` +
            `'passport.pdf', 'application/pdf', 2048, $${at + 6}, 'sha-256', false, 'direct', ` +
            `'unverified', ${AUDIT})`,
        );
      }
    }
    await admin.query(
      `insert into document_version
         (id, tenant_id, document_id, version_number, storage_reference, original_file_name,
          declared_media_type, size_in_bytes, content_hash, hash_algorithm, hash_verified, source,
          verification_state, created_at, created_by, updated_at, updated_by, version)
       values ${rows.join(', ')}`,
      values,
    );
  }
};

/** Two hundred accesses on one document: what a subject access request reads. */
const seedTrail = async (documentId) => {
  const rows = [];
  const values = [];

  for (let index = 0; index < 200; index += 1) {
    const at = values.length;

    values.push(uuidV7(), TENANT, documentId);
    rows.push(
      `($${at + 1}, $${at + 2}, $${at + 3}, 'metadata_read', 'user:benchmark', now(), ` +
        `'permitted', ${AUDIT})`,
    );
  }
  await admin.query(
    `insert into document_access_event
       (id, tenant_id, document_id, action, actor, occurred_at, outcome,
        created_at, created_by, updated_at, updated_by, version)
     values ${rows.join(', ')}`,
    values,
  );
};

const truncate = async () => {
  // `truncate` rather than `delete`: the immutability triggers refuse a delete of a version or an
  // access event, and a table-level truncate is not something a row trigger sees.
  await admin.query(
    `truncate document_access_event, document_verification, document_version, document,
              document_type cascade`,
  );
};

const horizon = () => new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);

const run = async () => {
  const application = new Pool({
    connectionString: await applicationUrl(),
    max: 4,
    statement_timeout: 600_000,
  });
  const unitOfWork = new PostgresUnitOfWork(application, new InProcessEventDispatcher());
  const stores = postgresDocumentsStores();
  const asTenant = (work) =>
    runInContext({ tenantId: TENANT, correlationId: uuidV7(), actor: 'user:benchmark' }, () =>
      unitOfWork.execute(work),
    );

  for (const dataset of DATASETS) {
    if (only !== undefined && only !== dataset.key) continue;

    await truncate();
    const seeded = await elapsed(() => seed(dataset));
    const { documentIds } = seeded.value;

    const expiry = await elapsed(() =>
      asTenant((transaction) =>
        stores.documents.search(
          transaction,
          { includeConfidential: true, expiringOnOrBefore: horizon() },
          { limit: 50, offset: 0 },
        ),
      ),
    );
    const pending = await elapsed(() =>
      asTenant((transaction) =>
        stores.documents.search(
          transaction,
          { includeConfidential: true, verificationState: 'pending_verification' },
          { limit: 50, offset: 0 },
        ),
      ),
    );
    const trail = await elapsed(() =>
      asTenant((transaction) =>
        stores.access.forDocument(transaction, documentIds[0], { limit: 50, offset: 0 }),
      ),
    );
    const duplicates = await elapsed(() =>
      asTenant((transaction) => stores.reconciliation.duplicateContent(transaction, 200)),
    );
    const stale = await elapsed(() =>
      asTenant((transaction) => stores.reconciliation.staleVerifications(transaction, 200)),
    );

    report(dataset, { seeded, expiry, pending, trail, duplicates, stale });
  }

  await application.end();
  if (purge) await truncate();
  await admin.end();
};

const verdict = (ms, budget) => (ms <= budget ? 'within budget' : `MISSED (budget ${budget}ms)`);

const report = (dataset, measured) => {
  const line = (name, ms, total, budget) =>
    console.log(
      `  ${name.padEnd(28)} ${ms.toFixed(1).padStart(10)} ms  ${String(total).padStart(8)} rows  ` +
        (budget === undefined ? '' : verdict(ms, budget)),
    );

  console.log(
    `\nDataset ${dataset.key}: ${dataset.documents} documents, ` +
      `${dataset.versionsPer} version(s) each ` +
      `(seeded in ${(measured.seeded.ms / 1000).toFixed(1)}s)`,
  );
  line('expiry queue', measured.expiry.ms, measured.expiry.value.total, dataset.budgetMs.queue);
  line(
    'verification queue',
    measured.pending.ms,
    measured.pending.value.total,
    dataset.budgetMs.queue,
  );
  line(
    'access trail (one document)',
    measured.trail.ms,
    measured.trail.value.total,
    dataset.budgetMs.trail,
  );
  line(
    'reconciliation: duplicates',
    measured.duplicates.ms,
    measured.duplicates.value.length,
    dataset.budgetMs.reconcile,
  );
  line(
    'reconciliation: stale',
    measured.stale.ms,
    measured.stale.value.length,
    dataset.budgetMs.reconcile,
  );
};

const client = new Client({ connectionString: CONNECTION });

await client.connect();
await client.end();
await run();
