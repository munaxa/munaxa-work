/**
 * The migration safety gate's decisions (MW-008). Run with: node --test scripts/
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  findForbiddenScripts,
  findGeneratedSignals,
  judgeMigrationChanges,
} from './check-migration-safety.mjs';

const fixture = (name) =>
  readFileSync(new URL(`./fixtures/migration-safety/${name}`, import.meta.url), 'utf8');

const BASE = ['00000000000000_foundation', '20261112090000_tenant_platform_binding'];
const added = (directory, file = 'migration.sql') => ({
  status: 'A',
  path: `prisma/migrations/${directory}/${file}`,
});

describe('findGeneratedSignals', () => {
  it('rejects the migration `prisma migrate dev` writes', () => {
    const reasons = findGeneratedSignals(fixture('prisma-generated.sql'));
    assert.ok(reasons.some((reason) => reason.includes('step marker')));
    assert.ok(reasons.some((reason) => reason.includes('Warnings block')));
    assert.ok(reasons.some((reason) => reason.includes('ON UPDATE CASCADE')));
    assert.ok(reasons.some((reason) => reason.includes('_pkey')));
    assert.ok(reasons.some((reason) => reason.includes('hand-written comment')));
  });

  it('rejects a generated migration even with only one step', () => {
    assert.notEqual(findGeneratedSignals(fixture('prisma-generated-minimal.sql')).length, 0);
  });

  it('rejects a step marker inside an otherwise hand-written file', () => {
    const sql = `${fixture('hand-written.sql')}\n-- AddForeignKey\nalter table a add constraint b;\n`;
    assert.deepEqual(findGeneratedSignals(sql), [
      `carries Prisma's step marker "-- AddForeignKey"`,
    ]);
  });

  it('accepts a hand-written migration', () => {
    assert.deepEqual(findGeneratedSignals(fixture('hand-written.sql')), []);
  });

  it('rejects an empty migration and one without an opening comment', () => {
    assert.deepEqual(findGeneratedSignals('\n'), ['is empty']);
    assert.equal(findGeneratedSignals('create table t (id uuid);\n').length, 1);
  });

  it('accepts a prose comment that merely starts with a verb', () => {
    assert.deepEqual(findGeneratedSignals('-- Create the asset notes table.\nselect 1;\n'), []);
  });
});

describe('judgeMigrationChanges', () => {
  it('accepts a new migration after the latest merged one', () => {
    const result = judgeMigrationChanges([added('20261124130000_asset_notes')], BASE);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(result.added, ['prisma/migrations/20261124130000_asset_notes/migration.sql']);
  });

  it('refuses a modified merged migration', () => {
    const { errors } = judgeMigrationChanges(
      [{ status: 'M', path: 'prisma/migrations/00000000000000_foundation/migration.sql' }],
      BASE,
    );
    assert.equal(errors.length, 1);
    assert.match(errors[0], /modifies merged migration 00000000000000_foundation/);
  });

  it('refuses a deleted merged migration and a file added to one', () => {
    const { errors } = judgeMigrationChanges(
      [
        {
          status: 'D',
          path: 'prisma/migrations/20261112090000_tenant_platform_binding/migration.sql',
        },
        added('00000000000000_foundation', 'extra.sql'),
      ],
      BASE,
    );
    assert.equal(errors.length, 2);
    assert.match(errors[0], /deletes merged migration/);
    assert.match(errors[1], /adds a file to merged migration/);
  });

  it('refuses a changed migration_lock.toml', () => {
    const { errors } = judgeMigrationChanges(
      [{ status: 'M', path: 'prisma/migrations/migration_lock.toml' }],
      BASE,
    );
    assert.equal(errors.length, 1);
  });

  it('refuses a badly named directory and a stray file in a new one', () => {
    const { errors } = judgeMigrationChanges(
      [added('add_notes'), added('20261124130000_asset_notes', 'down.sql')],
      BASE,
    );
    assert.equal(errors.length, 2);
  });

  it('warns, but does not fail, on a migration older than the latest merged one', () => {
    const result = judgeMigrationChanges([added('20261101000000_late')], BASE);
    assert.deepEqual(result.errors, []);
    assert.equal(result.warnings.length, 1);
  });
});

describe('findForbiddenScripts', () => {
  const scripts = (entries) => findForbiddenScripts('package.json', { scripts: entries });

  it('refuses migrate dev and db push in any script', () => {
    assert.equal(scripts({ a: 'prisma migrate dev --name x' }).length, 1);
    assert.equal(scripts({ b: 'pnpm --filter @work/api exec prisma db push' }).length, 1);
  });

  it('refuses an unguarded reset and accepts a guarded one', () => {
    assert.equal(scripts({ r: 'prisma migrate reset --schema s' }).length, 1);
    assert.equal(
      scripts({ r: 'prisma migrate reset && node scripts/db-reset-guard.mjs' }).length,
      1,
    );
    assert.deepEqual(
      scripts({ r: 'node scripts/db-reset-guard.mjs && prisma migrate reset --schema s' }),
      [],
    );
  });

  it('accepts migrate deploy and a manifest with no scripts', () => {
    assert.deepEqual(scripts({ m: 'prisma migrate deploy --schema s' }), []);
    assert.deepEqual(findForbiddenScripts('package.json', {}), []);
  });
});
