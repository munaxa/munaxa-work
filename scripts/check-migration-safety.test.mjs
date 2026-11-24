/**
 * The migration safety gate's decisions (MW-008). Run with: node --test scripts/
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  baseCandidates,
  COMMAND_FILE,
  findForbiddenCommands,
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

  const guard = 'node scripts/db-reset-guard.mjs';
  const reset =
    'pnpm --filter @work/api exec prisma migrate reset --schema ../../prisma/schema.prisma';

  it('accepts the root db:reset exactly as committed', () => {
    const root = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    assert.equal(root.scripts['db:reset'], `${guard} && ${reset}`);
    assert.deepEqual(findForbiddenScripts('package.json', root), []);
  });

  it('accepts the allowed reset form with harmless flags', () => {
    assert.deepEqual(scripts({ r: `${guard} && prisma migrate reset` }), []);
    assert.deepEqual(
      scripts({ r: `${guard} && prisma migrate reset --schema prisma/schema.prisma --skip-seed` }),
      [],
    );
  });

  it('refuses an unguarded reset and a guard that runs after it', () => {
    assert.equal(scripts({ r: 'prisma migrate reset --schema s' }).length, 1);
    assert.equal(scripts({ r: `${reset} && ${guard}` }).length, 1);
  });

  it('refuses every way to run a reset the guard refused', () => {
    for (const command of [
      `${guard} || true && ${reset}`,
      `true || ${guard} && ${reset}`,
      `${guard}; ${reset}`,
      `${guard} & ${reset}`,
      `${guard} | cat && ${reset}`,
      `${guard}\n${reset}`,
      `${guard} && $(${reset})`,
      `${guard} && \`${reset}\``,
      `echo ${guard} && ${reset}`,
      // A second reset after the first: only the first used to be checked.
      `${guard} && ${reset} || ${reset}`,
      `${guard} && echo migrate reset; ${reset}`,
      `${guard} && ${reset} || exit 1`,
      `${guard} && ${reset}; true`,
      // Changing what the reset connects to or where it runs after the guard approved.
      `${guard} && DATABASE_URL=postgresql://db.example.com/work ${reset}`,
      `${guard} && env DATABASE_URL=postgresql://db.example.com/work ${reset}`,
      `${guard} && cd apps/api && prisma migrate reset`,
      `cd apps/api && ${guard} && prisma migrate reset`,
      // Quoting and escaping that a shell reads as the same command.
      `${guard} && prisma migrate 'reset'`,
      `${guard} && prisma migrate "reset"`,
      `${guard} && prisma migrate re\\set`,
      `prisma 'migrate' re''set`,
      // Flags beyond the harmless ones, and the other commands.
      `${guard} && ${reset} --force`,
      `${guard} && ${reset} --schema=../../elsewhere.prisma --url postgresql://db`,
      `${guard} && prisma migrate dev --name x`,
      `${guard} && prisma migrate 'd'ev`,
    ]) {
      assert.equal(scripts({ r: command }).length, 1, command);
    }
  });

  it('refuses db push however it is quoted', () => {
    assert.equal(scripts({ p: "prisma db 'push'" }).length, 1);
    assert.equal(scripts({ p: 'prisma db pu\\sh --accept-data-loss' }).length, 1);
  });

  it('accepts migrate deploy and a manifest with no scripts', () => {
    assert.deepEqual(scripts({ m: 'prisma migrate deploy --schema s' }), []);
    assert.deepEqual(findForbiddenScripts('package.json', {}), []);
  });
});

describe('findForbiddenScripts after Wave 1 closure (MW-008c)', () => {
  const scripts = (map) => findForbiddenScripts('package.json', { scripts: map });
  const guard = 'node scripts/db-reset-guard.mjs';

  it('refuses a reset spelled with shell expansion, which a static check cannot read', () => {
    for (const command of [
      `${guard} && pri$(echo s)ma migrate reset`,
      `${guard} && prisma migrate re\${X}set`,
      `${guard} && prisma migrate re$X\set`,
      "prisma migrate $'\\x72eset'",
      `${guard} && prisma migrate \`printf reset\``,
      `eval "prisma migrate reset"`,
      `sh -c 'prisma migrate reset'`,
      `bash -c 'prisma db push'`,
      // Expansion is refused whatever it builds, because what it builds cannot be known here.
      'echo $HOME',
    ]) {
      assert.equal(scripts({ r: command }).length, 1, command);
      assert.match(scripts({ r: command })[0], /shell expansion|outside the one allowed form/);
    }
  });

  it('accepts the reset only against the repository schema', () => {
    assert.deepEqual(
      scripts({ r: `${guard} && prisma migrate reset --schema ../../prisma/schema.prisma` }),
      [],
    );
    assert.deepEqual(
      scripts({ r: `${guard} && prisma migrate reset --schema prisma/schema.prisma` }),
      [],
    );
    for (const schema of [
      '/tmp/other.prisma',
      '../../../elsewhere/schema.prisma',
      'prisma/schema.prisma.bak',
      'other/prisma/schema.prisma',
    ]) {
      const command = `${guard} && prisma migrate reset --schema ${schema}`;
      assert.equal(scripts({ r: command }).length, 1, command);
    }
  });

  it('still accepts every committed manifest at every depth of the workspace', () => {
    for (const path of ['../package.json', '../packages/modules/leave/package.json']) {
      const manifest = JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
      assert.deepEqual(findForbiddenScripts(path, manifest), [], path);
    }
  });
});

describe('findForbiddenCommands', () => {
  it('refuses push, dev and reset in a shell script, Dockerfile or workflow line', () => {
    for (const line of [
      'npx prisma db push --accept-data-loss',
      './node_modules/.bin/prisma migrate dev --name x',
      'pnpm --filter @work/api exec prisma migrate reset --force',
      'RUN prisma migrate "reset" --force',
      'CMD ["sh", "-c", "prisma migrate reset --force"]',
      '          run: prisma migrate re\\set --force',
    ]) {
      assert.equal(findForbiddenCommands('x.sh', `#!/bin/sh\n${line}\n`).length, 1, line);
    }
  });

  it('reports the file and line', () => {
    assert.deepEqual(findForbiddenCommands('deploy/run.sh', 'set -eu\nprisma db push\n'), [
      'deploy/run.sh:2 runs `prisma db push`, `migrate dev` or `migrate reset`. Outside the ' +
        'guarded db:reset package script Prisma may only `migrate deploy`.',
    ]);
  });

  it('accepts migrate deploy, migrate diff, db execute and comments', () => {
    const text = [
      '# never run `prisma migrate dev` here',
      '      # script that runs `prisma migrate dev`, `prisma db push` or an unguarded `migrate reset`.',
      'prisma migrate deploy --schema ../../prisma/schema.prisma',
      'pnpm --filter @work/api exec prisma migrate diff --from-migrations prisma/migrations',
      'prisma db execute --file deploy/aws/runtime-grants.sql',
    ].join('\n');
    assert.deepEqual(findForbiddenCommands('ci.yml', text), []);
  });

  it('accepts the committed api Dockerfile and CI workflow', () => {
    for (const path of ['../apps/api/Dockerfile', '../.github/workflows/ci.yml']) {
      const text = readFileSync(new URL(path, import.meta.url), 'utf8');
      assert.deepEqual(findForbiddenCommands(path, text), [], path);
    }
  });

  it('reads shell scripts, Dockerfiles, workflows and compose files, and nothing else', () => {
    for (const path of [
      'deploy/aws/run.sh',
      '.github/scripts/scan-image.sh',
      'tools/x.bash',
      'apps/api/Dockerfile',
      'apps/admin/Dockerfile.dev',
      'Dockerfile',
      'docker-compose.yml',
      'docker-compose.test.yaml',
      '.github/workflows/ci.yml',
    ]) {
      assert.ok(COMMAND_FILE.test(path), path);
    }
    for (const path of [
      'README.md',
      'scripts/check-migration-safety.mjs',
      'docs/x.sh.md',
      'shell',
    ]) {
      assert.ok(!COMMAND_FILE.test(path), path);
    }
  });
});

describe('baseCandidates', () => {
  it('uses only the named base, so an unresolvable one fails instead of falling back', () => {
    assert.deepEqual(baseCandidates('8a975f682406'), ['8a975f682406']);
    assert.deepEqual(baseCandidates(' origin/release '), ['origin/release']);
  });

  it('falls back to origin/main only when no base is named', () => {
    assert.deepEqual(baseCandidates(undefined), ['origin/main']);
    assert.deepEqual(baseCandidates(''), ['origin/main']);
    assert.deepEqual(baseCandidates('0000000000000000000000000000000000000000'), ['origin/main']);
  });
});
