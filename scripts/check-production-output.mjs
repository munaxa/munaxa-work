/**
 * No test-only code may be reachable from the production API build.
 *
 * Phase 10 found the API image dying at startup on `ERR_MODULE_NOT_FOUND` for `@work/testing`: nine
 * module barrels exported their test doubles, so importing `@work/leave` pulled in in-memory fakes
 * of the ports it depends on and a test-only package became a runtime dependency of the API. The
 * barrels are fixed; nothing stopped it recurring. A single `export { FakePeople }` added to an
 * index file would reintroduce it and every other gate would still pass.
 *
 * The check walks the *emitted* module graph rather than the source, starting at
 * `apps/api/dist/main.js` and following relative imports and `@work/*` specifiers into each
 * workspace package's `dist`. That is the same graph Node walks at startup, which is what makes
 * this decisive: scanning `apps/api/dist` alone is not enough, because the offending re-export
 * lives in the *module's* barrel and the API only ever names the package.
 *
 * Run after `pnpm build`. With no build present it fails rather than passing silently — a check
 * that quietly skips is worse than no check.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const ENTRY = 'apps/api/dist/main.js';

/** A module whose path says it exists for tests. Reachable from production is the defect. */
const TEST_ONLY_PATH = /(test-harness|-harness|\.fixture|fixtures|scenario|\/testing)\b/;

/** Named test doubles, in case one is ever copied in rather than imported. */
const TEST_DOUBLE = /\bFake(Employment|People|Organization|Leave|Attendance)\b|\bFixedClock\b/;

/**
 * Both module systems, because the graph crosses them: `nest build` emits CommonJS `require` for
 * the API while the workspace packages emit ESM `import`. Matching only one silently walks a graph
 * of size one and reports success, which is exactly how the first version of this check passed a
 * deliberately reintroduced regression.
 */
const IMPORT = /(?:from\s*|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g;

/** Where a workspace package's emitted entry point lives. */
const packageEntry = (specifier) => {
  const [, name, sub] = /^@work\/([a-z-]+)(\/.*)?$/.exec(specifier) ?? [];
  if (name === undefined) return undefined;
  const roots = [`packages/modules/${name}`, `packages/${name}`];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const file = sub === undefined ? 'dist/index.js' : `dist${sub}.js`;
    const path = join(root, file);
    if (existsSync(path)) return path;
  }
  return undefined;
};

const resolveRelative = (from, specifier) => {
  const path = resolve(dirname(from), specifier);
  for (const candidate of [path, `${path}.js`, join(path, 'index.js')]) {
    if (existsSync(candidate)) return relative('.', candidate);
  }
  return undefined;
};

if (!existsSync(ENTRY)) {
  console.error(
    `Production output check: ${ENTRY} does not exist.\n` +
      '  Run `pnpm build` first. This inspects the built artefact, not the source, because that is\n' +
      '  the only thing that proves what actually ships.',
  );
  process.exit(1);
}

const seen = new Set();
const violations = [];
const queue = [{ file: ENTRY, via: ['<entry>'] }];

while (queue.length > 0) {
  const { file, via } = queue.shift();
  if (seen.has(file)) continue;
  seen.add(file);

  if (TEST_ONLY_PATH.test(file)) {
    violations.push(`${file}\n      reached by: ${[...via, file].join(' → ')}`);
    continue;
  }

  const text = readFileSync(file, 'utf8');
  if (TEST_DOUBLE.test(text) && !file.startsWith('apps/api/dist')) {
    // A workspace barrel naming a fake is the defect one step before the import appears.
    violations.push(`${file}\n      names a test double: ${TEST_DOUBLE.exec(text)[0]}`);
  }

  for (const [, specifier] of text.matchAll(IMPORT)) {
    if (specifier === '@work/testing') {
      violations.push(
        `${file}\n      imports @work/testing, a test-only package\n      reached by: ${[...via, file].join(' → ')}`,
      );
      continue;
    }
    const next = specifier.startsWith('.')
      ? resolveRelative(file, specifier)
      : packageEntry(specifier);
    if (next !== undefined) queue.push({ file: next, via: [...via, file] });
  }
}

if (violations.length > 0) {
  console.error(`Production output: ${violations.length} test-only module(s) reachable from ${ENTRY}.\n`);
  for (const violation of violations.slice(0, 15)) console.error(`  ${violation}\n`);
  if (violations.length > 15) console.error(`  … and ${violations.length - 15} more`);
  console.error(
    '  A fake reaching the production bundle is one substitution away from serving real requests,\n' +
      '  and it makes a test-only package a runtime dependency of the API.\n' +
      "  Export test doubles from the module's `./testing` entry point, never from `index.ts`.",
  );
  process.exit(1);
}

console.log(`Production output: ${seen.size} reachable module(s), no test-only code.`);
