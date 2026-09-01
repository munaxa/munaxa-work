#!/usr/bin/env node
/**
 * Dependency gate — the static analysis Phase 1.1 requires.
 *
 * Three findings, each cheap to fix now and expensive later:
 *
 * - **Circular imports.** A cycle makes module boundaries meaningless, defeats tree shaking and
 *   produces initialization order bugs that appear only in a production build.
 * - **Unused declared dependencies.** Every one is supply-chain surface and audit noise for a
 *   package nothing imports.
 * - **Unreachable files.** Code nothing imports is code nobody maintains, and it is read as
 *   authoritative by the next person who finds it.
 *
 * Dependency-free and AST-free by design: it reads import statements, which is enough to answer
 * these three questions and keeps the gate runnable on a bare checkout.
 *
 * Usage: node scripts/check-dependencies.mjs
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

const SOURCE = /^(apps|packages)\/.*\.(ts|tsx)$/;
const TEST = /\.(test|spec)\.tsx?$/;
const IMPORT = /(?:^|\n)\s*(?:import|export)[^'"]*from\s*['"]([^'"]+)['"]/g;
/** Stylesheets import from packages too — the theme is consumed entirely through CSS. */
const STYLE = /^(apps|packages)\/.*\.css$/;
const CSS_IMPORT = /@import\s+['"]([^'"]+)['"]/g;

/** Files that are entry points by contract: nothing in the repository imports them. */
const ENTRY_POINTS = [
  /\/index\.ts$/,
  /\/main\.ts$/,
  /\.config\.(ts|mjs)$/,
  /\/app\/.*\.tsx$/, // Next.js routes, discovered by the framework
  /*
   * The App Router conventions that are not `.tsx`.
   *
   * Next discovers these by filename exactly as it discovers `page.tsx`, so nothing imports them
   * and nothing should: `manifest.ts` *is* `/manifest.webmanifest`. Named one by one rather than
   * widening the rule to every `.ts` under `app/`, because a helper module that genuinely nothing
   * imports is still something this check should catch.
   */
  /\/app\/(.*\/)?(route|manifest|sitemap|robots|opengraph-image|twitter-image|icon|apple-icon)\.ts$/,
  /next-env\.d\.ts$/,
  /*
   * A package's declared subpath entry points. `src/testing.ts` backs `@work/<module>/testing`, so
   * it is imported across the package boundary by name and never by path — which is exactly what
   * this check cannot see, and exactly what makes it an entry point rather than dead code.
   */
  /\/src\/testing\.ts$/,
];

const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n');
const files = tracked.filter((file) => SOURCE.test(file) && !file.includes('node_modules'));
const stylesheets = tracked.filter((file) => STYLE.test(file) && !file.includes('node_modules'));

const importsOf = (file) => {
  const source = readFileSync(file, 'utf8');
  return [...source.matchAll(IMPORT)].map((match) => match[1]);
};

/** Resolves a relative specifier to a repository path, undoing the .js extension TS emits. */
const resolveRelative = (from, specifier) => {
  const base = normalize(join(dirname(from), specifier));
  const candidates = [
    base.replace(/\.js$/, '.ts'),
    base.replace(/\.js$/, '.tsx'),
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
  ];
  return candidates.find((candidate) => existsSync(candidate));
};

const packageOf = (file) => {
  const parts = file.split('/');
  return parts[0] === 'packages' && parts[1] === 'modules'
    ? parts.slice(0, 3).join('/')
    : parts.slice(0, 2).join('/');
};

const violations = [];
const graph = new Map();
const imported = new Set();
const workspaceImports = new Map();

for (const file of files) {
  const edges = [];

  for (const specifier of importsOf(file)) {
    if (specifier.startsWith('.')) {
      const target = resolveRelative(file, specifier);
      if (target !== undefined) {
        edges.push(target);
        imported.add(target);
      }
      continue;
    }
    const owner = packageOf(file);
    workspaceImports.set(owner, (workspaceImports.get(owner) ?? new Set()).add(specifier));
  }
  graph.set(file, edges);
}

for (const stylesheet of stylesheets) {
  const owner = packageOf(stylesheet);
  const source = readFileSync(stylesheet, 'utf8');

  for (const match of source.matchAll(CSS_IMPORT)) {
    const specifier = match[1];
    if (specifier !== undefined && !specifier.startsWith('.')) {
      workspaceImports.set(owner, (workspaceImports.get(owner) ?? new Set()).add(specifier));
    }
  }
}

/** Depth-first cycle detection, reporting the cycle rather than only its existence. */
const findCycles = () => {
  const state = new Map();
  const stack = [];
  const found = [];

  const visit = (file) => {
    state.set(file, 'visiting');
    stack.push(file);

    for (const next of graph.get(file) ?? []) {
      if (state.get(next) === 'visiting') {
        found.push([...stack.slice(stack.indexOf(next)), next].join(' → '));
      } else if (state.get(next) === undefined) {
        visit(next);
      }
    }
    stack.pop();
    state.set(file, 'visited');
  };

  for (const file of graph.keys()) if (state.get(file) === undefined) visit(file);
  return found;
};

for (const cycle of findCycles()) {
  violations.push(`Circular import: ${cycle}`);
}

/** A dependency declared but never imported by the package that declares it. */
const packages = [
  ...new Set(files.map(packageOf).filter((owner) => existsSync(join(owner, 'package.json')))),
];

for (const owner of packages) {
  const manifest = JSON.parse(readFileSync(join(owner, 'package.json'), 'utf8'));
  const declared = Object.keys(manifest.dependencies ?? {});
  const used = workspaceImports.get(owner) ?? new Set();
  const isUsed = (name) =>
    [...used].some((specifier) => specifier === name || specifier.startsWith(`${name}/`));

  for (const dependency of declared) {
    // Loaded by a framework rather than imported by us: a peer the runtime resolves itself,
    // a transport the logger loads by name, a renderer the framework calls. Each is named
    // rather than a wildcard, so a genuinely unused dependency still surfaces.
    const runtimeOnly = [
      // Used by a build script rather than by a module: its `munaxa-sync-brand` bin copies the
      // approved product artwork into an application's `public/` on predev and prebuild. The
      // components come through `@munaxa/ui`, which re-exports it — but a bin is only linked
      // for a *direct* dependency, so the declaration is load-bearing and dropping it would
      // leave every application serving no logo at all.
      '@munaxa/platform',
      'reflect-metadata', // Nest decorators
      'pino-pretty', // resolved by pino via a transport target string
      '@prisma/client', // generated client, imported once a model exists
      'react-dom', // Next renders with it; applications do not import it
      'rxjs', // Nest peer
      'pino', // nestjs-pino peer
      'pino-http', // nestjs-pino peer
      'class-validator', // ValidationPipe resolves it at runtime
      'class-transformer', // ValidationPipe resolves it at runtime
      '@nestjs/platform-express', // selected by NestFactory, not imported
    ];
    if (!isUsed(dependency) && !runtimeOnly.includes(dependency)) {
      violations.push(`${owner}/package.json declares "${dependency}", which nothing imports.`);
    }
  }
}

/** A file nothing imports, and which is not an entry point. */
for (const file of files) {
  if (TEST.test(file) || imported.has(file)) continue;
  if (ENTRY_POINTS.some((pattern) => pattern.test(file))) continue;

  violations.push(`${file} is imported by nothing and is not an entry point.`);
}

if (violations.length > 0) {
  console.error(`Dependencies: ${String(violations.length)} finding(s).\n`);
  for (const violation of violations) console.error(`  ${violation}`);
  process.exit(1);
}

console.log(
  `Dependencies: ${String(files.length)} source file(s), no cycles, no unused dependencies, no unreachable files.`,
);
