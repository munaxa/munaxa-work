#!/usr/bin/env node
/**
 * Platform parity gate — proves a local gate means what a CI gate means.
 *
 * CI installs the shared design system with `pnpm install --frozen-lockfile`, so what it
 * compiles against is exactly what `pnpm-lock.yaml` pins. A local checkout has no such
 * guarantee: a `file:` or `link:` install, a hand-made symlink or a stale `node_modules` can
 * put a different `@munaxa/*` on disk while every version number still reads correctly.
 *
 * That is not hypothetical. PR #16 passed every local gate and failed CI typecheck on
 * `Property 'railLabel' does not exist on type 'SidebarProps'`. The prop exists in
 * `@munaxa/platform` 1.5.0 and later; this repository pins 1.3.0. Nothing warned, because
 * `@munaxa/ui` — the only package the applications import — is a buildless façade whose whole
 * body is `export * from '@munaxa/platform'`. Its own version was 1.1.1 locally and 1.1.1 in
 * the lockfile. The version that had moved was the one behind it.
 *
 * So this gate asks two questions the lockfile alone cannot answer:
 *
 * - **Declaration.** Does any tracked manifest, or the lockfile, resolve an `@munaxa/*`
 *   package from a path rather than the registry? A committed `file:` would make every
 *   consumer's install machine-specific.
 * - **Installation.** For every workspace that declares one, does the package Node actually
 *   resolves carry the version the lockfile pins, from the registry's virtual store — and
 *   does the `@munaxa/ui` façade re-export the pinned `@munaxa/platform`, rather than
 *   whichever one happens to sit higher up the tree?
 *
 * The declaration half needs no `node_modules`, so it runs on a bare checkout alongside the
 * other standards gates. The installation half reports what it resolved on every run, which
 * is what makes "`pnpm verify` passed" a statement about known versions instead of a hope.
 *
 * Developing Work against unreleased platform source is a real workflow, and it is the one
 * thing that legitimately breaks parity. It stays available behind
 * `MUNAXA_ALLOW_PLATFORM_SOURCE=1`, which downgrades the installation half to a banner. It
 * is deliberately an environment variable and not a setting: nothing committed can turn this
 * gate off for somebody who did not choose it.
 *
 * Usage: node scripts/check-platform-parity.mjs
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OVERRIDE = 'MUNAXA_ALLOW_PLATFORM_SOURCE';
/** A path specifier is machine-specific by construction; `workspace:` is this repository's own. */
const BY_PATH = /^(file|link):/;

/**
 * Findings are kept apart because they are answered differently and weigh differently.
 *
 * A declared path is committed: it reaches every consumer, no reinstall fixes it, and nothing
 * — the source-development override included — may wave it through. A resolved path is one
 * machine's `node_modules`, fixed by reinstalling, and is the one thing a platform developer
 * legitimately wants.
 */
const declared = [];
const resolvedFindings = [];
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

/* ---------------------------------------------------------------- declaration */

const manifests = execFileSync('git', ['ls-files', '*package.json'], {
  cwd: ROOT,
  encoding: 'utf8',
})
  .split('\n')
  .filter((path) => path !== '' && !path.includes('node_modules'));

for (const path of manifests) {
  const manifest = JSON.parse(read(path));
  const sections = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

  for (const section of sections) {
    for (const [name, specifier] of Object.entries(manifest[section] ?? {})) {
      if (typeof specifier === 'string' && BY_PATH.test(specifier)) {
        declared.push(
          `${path} declares "${name}": "${specifier}" — a path, not a published range.`,
        );
      }
    }
  }
}

/**
 * The lockfile's importer blocks, as `{ importer, name, version }` for `@munaxa/*` only.
 *
 * Hand-parsed rather than pulled from a YAML library: every other gate in this directory runs
 * on a bare checkout with nothing installed, and this one has to as well. Lockfile v9 indents
 * importers at two spaces, their sections at four and each dependency at six, which is enough
 * structure to read without interpreting the format in general.
 */
const pinned = () => {
  const lines = read('pnpm-lock.yaml').split('\n');
  const entries = [];
  let inImporters = false;
  let importer;
  let name;

  for (const line of lines) {
    if (/^\S/.test(line)) {
      inImporters = line.startsWith('importers:');
      continue;
    }
    if (!inImporters) continue;

    const start = /^ {2}(\S.*):$/.exec(line);
    if (start?.[1] !== undefined) {
      importer = start[1];
      name = undefined;
      continue;
    }

    const dependency = /^ {6}'?(@munaxa\/[^':]+)'?:$/.exec(line);
    if (dependency?.[1] !== undefined) {
      name = dependency[1];
      continue;
    }

    const version = /^ {8}version: (.+)$/.exec(line);
    if (version?.[1] !== undefined && name !== undefined && importer !== undefined) {
      entries.push({ importer, name, version: version[1].split('(')[0]?.trim() ?? '' });
      name = undefined;
    }
  }
  return entries;
};

const expected = pinned();

for (const { importer, name, version } of expected) {
  if (BY_PATH.test(version)) {
    declared.push(
      `pnpm-lock.yaml resolves ${name} for ${importer} from "${version}", not the registry.`,
    );
  }
}

if (expected.length === 0) {
  declared.push('pnpm-lock.yaml pins no @munaxa/* package — the lockfile or this parser is wrong.');
}

/* --------------------------------------------------------------- installation */

/**
 * The nearest `node_modules/<name>` walking up from `from`, as pnpm and Node both resolve it.
 *
 * The walk stops at the repository root rather than continuing to `/`: a package found above it
 * belongs to some enclosing checkout and is not what any build here would load.
 */
const locate = (from, name) => {
  let directory = resolve(ROOT, from);

  for (;;) {
    const candidate = join(directory, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;

    const parent = dirname(directory);
    // The repository root, or the filesystem root for a start outside it — a path install can
    // put the façade in `/tmp`, and `dirname('/')` is `/`, which would otherwise never end.
    if (directory === ROOT || parent === directory) return undefined;
    directory = parent;
  }
};

const describe = (path) => {
  const real = realpathSync(path);
  return {
    version: JSON.parse(readFileSync(join(real, 'package.json'), 'utf8')).version,
    real,
    /** `@munaxa+ui@1.1.1_…` for a registry install; `@munaxa+ui@file+…` for a path install. */
    store: /node_modules\/\.pnpm\/([^/]+)/.exec(real)?.[1],
  };
};

const installed = existsSync(join(ROOT, 'node_modules'));
const permitted = process.env[OVERRIDE] === '1';
const resolved = [];

if (installed) {
  /*
   * The façade is the case a per-workspace check misses. `@munaxa/ui` re-exports
   * `@munaxa/platform`, and it resolves that from beside itself in the virtual store — not
   * from the application that imported it. Those two can and did disagree, so the façade's
   * own view is checked as its own row.
   */
  const facade = locate('apps/admin', '@munaxa/ui');
  const checks = [
    ...expected,
    ...(facade === undefined
      ? []
      : [
          {
            importer: '@munaxa/ui (façade re-export)',
            name: '@munaxa/platform',
            version: expected.find((each) => each.name === '@munaxa/platform')?.version ?? '',
            from: relative(ROOT, realpathSync(facade)),
          },
        ]),
  ];

  for (const check of checks) {
    const path = locate(check.from ?? check.importer, check.name);

    if (path === undefined) {
      resolved.push({ ...check, actual: undefined, origin: 'not installed' });
      continue;
    }

    const { version, real, store } = describe(path);
    /*
     * pnpm names a registry entry `@scope+name@version` and appends `_<peers>` when the
     * package was resolved against peers, so the version is the segment before the first
     * underscore — matched whole, because `1.1.1` is a prefix of `1.1.10`.
     */
    const wanted = `${check.name.replace('/', '+')}@${check.version}`;
    const origin = !real.startsWith(`${ROOT}/`)
      ? real
      : store === undefined
        ? relative(ROOT, real)
        : store === wanted || store.startsWith(`${wanted}_`)
          ? 'registry'
          : store;

    resolved.push({ ...check, actual: version, origin });
  }
}

/*
 * One finding per package, not per workspace.
 *
 * Every workspace declares the two config packages and three declare the design system, so a
 * single path install produces seventy identical lines — which reads as seventy problems and
 * buries the one that matters. What a reader needs is the package, what it resolved to, and
 * where it came from; the workspace count only matters when workspaces disagree with each
 * other, and that case says so.
 */
const grouped = new Map();

for (const each of resolved) {
  const key = `${each.name} ${String(each.actual)} ${each.origin} ${each.version}`;
  grouped.set(key, { ...each, importers: (grouped.get(key)?.importers ?? 0) + 1 });
}

for (const each of grouped.values()) {
  const where = each.importers === 1 ? each.importer : `${String(each.importers)} workspaces`;

  if (each.actual === undefined) {
    resolvedFindings.push(`${each.name} is declared by ${where} but is not installed.`);
  } else if (each.actual !== each.version) {
    resolvedFindings.push(
      `${each.name} resolves ${each.actual} for ${where}; the lockfile pins ${each.version}.`,
    );
  } else if (each.origin !== 'registry') {
    resolvedFindings.push(
      `${each.name} ${each.actual} resolves for ${where} from ${each.origin} — not a registry install.`,
    );
  }
}

/* -------------------------------------------------------------------- report */

if (grouped.size > 0) {
  const rows = [...grouped.values()].map((each) => ({
    name: each.name,
    version: `${each.actual ?? '—'} ${each.actual === each.version ? '=' : '≠'} lockfile ${each.version}`,
    origin: each.origin === 'registry' ? 'registry' : `PATH INSTALL: ${each.origin}`,
  }));
  const name = Math.max(...rows.map((row) => row.name.length));
  const version = Math.max(...rows.map((row) => row.version.length));

  console.log('Platform parity: the @munaxa/* this run resolved.\n');
  for (const row of rows) {
    console.log(`  ${row.name.padEnd(name)}  ${row.version.padEnd(version)}  ${row.origin}`);
  }
  console.log('');
}

const report = (heading, findings, advice) => {
  console.error(`${heading}\n`);
  for (const finding of findings) console.error(`  ${finding}`);
  console.error(`\n${advice}`);
};

if (declared.length > 0) {
  report(
    `Platform parity: ${String(declared.length)} committed finding(s).`,
    declared,
    '  A path specifier in a committed manifest or lockfile resolves against one machine\n' +
      '  and cannot be installed anywhere else. Restore the published range and relock\n' +
      `  against npm.pkg.github.com. ${OVERRIDE} does not apply: it\n` +
      '  covers one developer’s install, not what every consumer of this repository gets.',
  );
  process.exit(1);
}

if (resolvedFindings.length > 0 && permitted) {
  console.warn(
    `${OVERRIDE}=1 — PARITY NOT ENFORCED.\n\n` +
      `  ${String(resolvedFindings.length)} package(s) diverge from the lockfile and are being reported rather\n` +
      '  than failed. Nothing this run verifies says anything about what CI will compile.\n' +
      '  Do not report this gate as equivalent to a green CI gate.\n',
  );
  for (const finding of resolvedFindings) console.warn(`  ${finding}`);
  process.exit(0);
}

if (resolvedFindings.length > 0) {
  report(
    `Platform parity: ${String(resolvedFindings.length)} finding(s).`,
    resolvedFindings,
    '  What is installed here is not what CI installs, so a green gate here would not mean\n' +
      '  a green gate there. Reinstall with `pnpm install --frozen-lockfile` against\n' +
      `  npm.pkg.github.com, or set ${OVERRIDE}=1 to develop against\n` +
      '  platform source knowing this run proves nothing about CI.',
  );
  process.exit(1);
}

console.log(
  installed
    ? `Platform parity: ${String(grouped.size)} package(s) match the lockfile, all from the registry.`
    : 'Platform parity: nothing declared or locked by path. Nothing installed, so nothing resolved.',
);
