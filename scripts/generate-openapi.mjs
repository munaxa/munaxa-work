#!/usr/bin/env node
/**
 * Writes docs/api/openapi.json from the BUILT API (MW-004).
 *
 * The Testing stack serves no OpenAPI (`OPENAPI_ENABLED = "false"`), so testers read the committed
 * file instead. It is produced from the same composition the running API uses: the AppModule in
 * apps/api/dist, `configureApplication` (global prefix, URI versioning) and
 * `createOpenApiDocument` (the DocumentBuilder `configureOpenApi` serves). Nothing is hand-written.
 *
 * Offline: Nest's preview mode resolves the module graph without instantiating a provider or
 * running a lifecycle hook, so no database, Redis, Identity or Control is contacted. The
 * DATABASE_URL below only satisfies the environment schema; nothing connects to it.
 *
 * It must run against `nest build` output, not ts-node or vitest: the document's schemas come from
 * decorator metadata that tsc emits and esbuild does not.
 *
 * Usage (after `pnpm install` and `pnpm build`):
 *   node scripts/generate-openapi.mjs           write docs/api/openapi.json
 *   node scripts/generate-openapi.mjs --check   exit 1 if the committed file is out of date
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const apiRoot = join(root, 'apps', 'api');
const output = join(root, 'docs', 'api', 'openapi.json');
const check = process.argv.includes('--check');

const fail = (message) => {
  process.stderr.write(`generate-openapi: ${message}\n`);
  process.exit(1);
};

const dist = join(apiRoot, 'dist');
if (!existsSync(join(dist, 'app.module.js'))) {
  fail('apps/api/dist is missing. Run `pnpm install` and `pnpm build` first.');
}

// A fixed, credential-free environment, so the document depends on the code and nothing else.
// Development mode only relaxes production's secret and licensing checks; no route depends on it.
// The version is the API package's, not a deployment's APP_VERSION, so a rebuild is byte-stable.
const apiPackage = JSON.parse(readFileSync(join(apiRoot, 'package.json'), 'utf8'));
const fixedEnvironment = {
  NODE_ENV: 'development',
  APP_VERSION: apiPackage.version,
  API_PREFIX: 'api',
  LOG_LEVEL: 'fatal',
  DATABASE_URL: 'postgresql://openapi:openapi@127.0.0.1:1/openapi',
  OPENAPI_ENABLED: 'true',
  LICENSING_MODE: 'NONE',
};
for (const [key, value] of Object.entries(fixedEnvironment)) {
  process.env[key] = value;
}

// pnpm does not hoist: resolve Nest from the API package, the same copy dist/ loads.
const requireFromApi = createRequire(join(apiRoot, 'package.json'));
const load = async (specifier) => import(pathToFileURL(requireFromApi.resolve(specifier)).href);
const fromDist = async (file) => import(pathToFileURL(join(dist, file)).href);

await import(pathToFileURL(requireFromApi.resolve('reflect-metadata')).href);
const { NestFactory } = await load('@nestjs/core');
const { loadProcessEnvironment } = await load('@work/config');
const { AppModule } = await fromDist('app.module.js');
const { configureApplication, createOpenApiDocument } = await fromDist('application.setup.js');

const environment = loadProcessEnvironment();
const application = await NestFactory.create(AppModule, {
  preview: true,
  logger: false,
  abortOnError: false,
});
configureApplication(application, environment);
const document = createOpenApiDocument(application, environment);
await application.close();

/** Key order is part of a stable diff: paths and schemas sorted, everything else as emitted. */
const sortKeys = (record) =>
  Object.fromEntries(Object.entries(record ?? {}).sort(([a], [b]) => a.localeCompare(b)));
const stable = {
  ...document,
  paths: sortKeys(document.paths),
  components: { ...document.components, schemas: sortKeys(document.components?.schemas) },
};

// Formatted with the repository's own Prettier configuration, so `pnpm format:check` accepts the
// generated file unchanged and a regenerated file differs only where the API did.
const prettierModule = await import(
  pathToFileURL(createRequire(join(root, 'package.json')).resolve('prettier')).href
);
const prettier = prettierModule.default ?? prettierModule;
const prettierOptions = (await prettier.resolveConfig(output)) ?? {};
const text = await prettier.format(JSON.stringify(stable), { ...prettierOptions, parser: 'json' });
const operations = Object.values(stable.paths).reduce(
  (count, item) => count + Object.keys(item).length,
  0,
);
const summary = `${Object.keys(stable.paths).length} paths, ${operations} operations`;

if (check) {
  const committed = existsSync(output) ? readFileSync(output, 'utf8') : '';
  if (committed !== text) {
    fail(
      `docs/api/openapi.json is out of date (${summary} in the build). ` +
        'Run `pnpm build && node scripts/generate-openapi.mjs` and commit the result.',
    );
  }
  process.stdout.write(`docs/api/openapi.json is current (${summary}).\n`);
} else {
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, text);
  process.stdout.write(`Wrote docs/api/openapi.json (${summary}).\n`);
}
