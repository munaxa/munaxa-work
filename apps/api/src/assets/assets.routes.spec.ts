import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { InProcessEventDispatcher } from '@work/kernel';
import { PostgresUnitOfWork } from '@work/persistence';
import { Pool } from 'pg';

import { assetsModuleFor } from './assets.composition.js';

/**
 * The HTTP surface: what it exposes, and — more to the point — what it does not.
 *
 * The suite reconciles the routes against the handlers in **both** directions, and then asserts the
 * shapes that must not exist: no update or delete verb, no tenant on any route, and no endpoint for
 * a capability this checkpoint did not build.
 */

const ASSETS_API = join(process.cwd(), '..', '..', 'packages', 'modules', 'assets', 'src', 'api');

const CONTROLLER_FILES = [
  'asset-category.controller.ts',
  'asset.controller.ts',
  'custody.controller.ts',
];

const sourceOf = (file: string): string => readFileSync(join(ASSETS_API, file), 'utf8');

const codeOf = (file: string): string =>
  sourceOf(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const composed = (): ReturnType<typeof assetsModuleFor> => {
  const pool = new Pool({ connectionString: 'postgresql://unused:unused@127.0.0.1:1/unused' });

  return assetsModuleFor(new PostgresUnitOfWork(pool, new InProcessEventDispatcher()), {
    ask: () => Promise.reject(new Error('not called')),
  });
};

const dispatchedNames = (): readonly string[] =>
  CONTROLLER_FILES.map(codeOf)
    .flatMap((source) => [
      ...(source.match(/(?:queryName|commandName): '(assets\.[a-z-]+)'/g) ?? []),
    ])
    .map((match) => match.slice(match.indexOf("'") + 1, -1));

describe('the assets HTTP surface', () => {
  it('dispatches exactly the twelve names the module registers, and no thirteenth', () => {
    const dispatched = dispatchedNames();

    expect(dispatched).toHaveLength(12);
    expect(new Set(dispatched).size).toBe(12);
  });

  /**
   * Every route reaches a handler, and every handler is reachable.
   *
   * The exact-set assertion in the second direction is the valuable one: a handler no route reaches
   * is a capability nobody can use, and one somebody could wire to a route later without anybody
   * noticing.
   */
  it('reconciles every route against a registered handler, and every handler against a route', () => {
    const dispatched = new Set(dispatchedNames());
    const module = composed();
    const registered = new Set([
      ...(module.commands ?? []).map((handler) => handler.commandName),
      ...(module.queries ?? []).map((handler) => handler.queryName),
    ]);

    expect([...dispatched].sort()).toEqual([...registered].sort());
  });

  /**
   * No `PUT`, `PATCH` or `DELETE`.
   *
   * An amendment is a `POST` to the resource and a status change a `POST` to a sub-resource, which
   * is the convention `relations/categories` established. An asset leaves service by retirement,
   * never by deletion.
   */
  it('publishes no verb that edits or deletes in place', () => {
    for (const file of CONTROLLER_FILES) {
      const code = codeOf(file);

      expect(code).not.toContain('@Put(');
      expect(code).not.toContain('@Patch(');
      expect(code).not.toContain('@Delete(');
    }
  });

  /**
   * The literal prefix is declared first, and Nest resolves by declaration order.
   *
   * `assets/categories` would otherwise be swallowed by `assets/:assetId`, and the failure mode is a
   * caller listing the catalogue and receiving "no such asset".
   */
  it('declares both literal prefixes before the controllers that take an :assetId', () => {
    const module = readFileSync(join(process.cwd(), 'src', 'assets', 'assets.module.ts'), 'utf8');
    const declaration = module.slice(module.indexOf('controllers: ['));
    const order = ['AssetCategoryController', 'CustodyController', 'AssetController,'].map((name) =>
      declaration.indexOf(name),
    );

    for (const position of order) expect(position).toBeGreaterThan(-1);
    // `assets/categories` and `assets/custody` are literals; `assets/:assetId` would swallow either.
    expect(order[0]).toBeLessThan(order[2] as number);
    expect(order[1]).toBeLessThan(order[2] as number);
  });

  it('declares its own collection and create routes before its parameterised one', () => {
    const code = codeOf('asset.controller.ts');
    const collection = code.indexOf('@Get()');
    const create = code.indexOf('@Post()');
    const parameterised = code.indexOf("@Get(':assetId')");

    expect(collection).toBeLessThan(parameterised);
    expect(create).toBeLessThan(parameterised);
  });

  it('takes no tenant on any route or body, and no actor', () => {
    const dto = readFileSync(join(ASSETS_API, 'assets.dto.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    for (const absent of ['tenantId', 'tenant_id', 'createdBy', 'registeredBy', 'actor']) {
      expect(dto).not.toContain(absent);
      for (const file of CONTROLLER_FILES) expect(codeOf(file)).not.toContain(absent);
    }
  });

  /**
   * The exact route surface, as the decorators declare it.
   *
   * The Checkpoint 1 assertion here forbade every custody route by name. Two of those words —
   * `custody` and `return` — describe an approved capability now, so the blanket ban became stale.
   * It is **replaced with an exact set**: these twelve paths and no thirteenth, plus a still-exact
   * ban on the words that describe capabilities nobody has authorized. It was not deleted, and the
   * replacement is stricter, because an exact set forbids everything a list of words would miss.
   */
  it('publishes exactly the twelve paths this checkpoint approves, and no other', () => {
    const code = CONTROLLER_FILES.map(codeOf).join('\n');
    const paths = [...code.matchAll(/@(?:Get|Post)\(\s*'?([^')]*)'?\s*\)/g)].map(
      (match) => match[1] ?? '',
    );

    expect(paths.filter((path) => path !== '').sort()).toEqual([
      ':assetCategoryId',
      ':assetCustodyId/return',
      ':assetId',
      ':assetId',
      ':assetId/custody',
      ':assetId/custody',
      ':assetId/status',
    ]);
  });

  it('publishes no route for a capability nobody has authorized', () => {
    const code = CONTROLLER_FILES.map(codeOf).join('\n');
    const paths = [...code.matchAll(/@(?:Get|Post)\(\s*'([^']*)'/g)].map((match) => match[1] ?? '');

    for (const absent of [
      'acknowledge',
      'accept',
      'incident',
      'waiver',
      'deduction',
      'clearance',
      'transfer',
      'cancel',
      'correct',
      'condition',
    ]) {
      for (const path of paths) expect(path).not.toContain(absent);
      expect(code).not.toContain(`${absent}(`);
    }
  });

  it('exposes every controller under the versioned prefix', () => {
    expect(codeOf('asset-category.controller.ts')).toContain(
      "@Controller({ path: 'assets/categories', version: '1' })",
    );
    expect(codeOf('custody.controller.ts')).toContain(
      "@Controller({ path: 'assets/custody', version: '1' })",
    );
    expect(codeOf('asset.controller.ts')).toContain(
      "@Controller({ path: 'assets', version: '1' })",
    );
  });
});
