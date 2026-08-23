import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { InProcessEventDispatcher } from '@work/kernel';
import { PostgresUnitOfWork } from '@work/persistence';
import { Pool } from 'pg';

import { relationsModuleFor } from './relations.composition.js';

/**
 * The HTTP surface: what it exposes, and — more to the point here — what it does not.
 *
 * A disciplinary module's routes are the part an attacker meets. So this suite reconciles the routes
 * against the handlers in **both** directions, and then asserts the shapes that must not exist: no
 * update, no delete, no tenant-wide listing, and no endpoint that takes a tenant.
 */

const RELATIONS_PACKAGE = join(
  process.cwd(),
  '..',
  '..',
  'packages',
  'modules',
  'relations',
  'src',
  'api',
);

const CONTROLLER_FILES = [
  'violation-category.controller.ts',
  'violation.controller.ts',
  'investigation.controller.ts',
  'disciplinary-rule.controller.ts',
  'disciplinary-action.controller.ts',
];

const sourceOf = (file: string): string => readFileSync(join(RELATIONS_PACKAGE, file), 'utf8');

const codeOf = (file: string): string =>
  sourceOf(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const composed = (): ReturnType<typeof relationsModuleFor> => {
  const pool = new Pool({ connectionString: 'postgresql://unused:unused@127.0.0.1:1/unused' });

  return relationsModuleFor(
    new PostgresUnitOfWork(pool, new InProcessEventDispatcher()),
    { ask: () => Promise.reject(new Error('not called')) },
    { holds: () => Promise.resolve(true) },
  );
};

describe('the relations HTTP surface', () => {
  it('dispatches exactly the nineteen names the module registers, and no twentieth', () => {
    const dispatched = CONTROLLER_FILES.map(codeOf).flatMap((source) => [
      ...(source.match(/(?:queryName|commandName): 'relations\.[a-z-]+'/g) ?? []),
    ]);

    expect(dispatched).toHaveLength(19);
    expect(new Set(dispatched).size).toBe(19);
  });

  /**
   * Every route reaches a handler, and every handler is reachable.
   *
   * The exact-set assertion in the second direction is the valuable one: a handler no route reaches
   * is a capability nobody can use, and — in this module — a handler somebody could wire to a route
   * later without anybody noticing.
   */
  it('reconciles every route against a registered handler, and every handler against a route', () => {
    const dispatched = new Set(
      CONTROLLER_FILES.map(codeOf)
        .flatMap((source) => [
          ...(source.match(/(?:queryName|commandName): '(relations\.[a-z-]+)'/g) ?? []),
        ])
        .map((match) => match.slice(match.indexOf("'") + 1, -1)),
    );
    const module = composed();
    const registered = new Set([
      ...(module.commands ?? []).map((handler) => handler.commandName),
      ...(module.queries ?? []).map((handler) => handler.queryName),
    ]);

    expect([...dispatched].filter((name) => !registered.has(name))).toStrictEqual([]);
    // **Every handler is routed. There is no exemption here**, unlike Workflow's machine surface —
    // Checkpoint 1 builds nothing a person cannot reach. The empty array is the assertion: the day
    // an unroutable handler appears, it has to be named here deliberately.
    expect([...registered].filter((name) => !dispatched.has(name))).toStrictEqual([]);
  });

  /**
   * **No `PUT`, no `PATCH`, no `DELETE`, anywhere.**
   *
   * A recorded violation is immutable (AD-003) and a catalogue entry leaves service by deactivation
   * rather than deletion. An HTTP verb that implied otherwise would be the first thing somebody
   * tried, and the database would refuse it — but offering the route at all invites the attempt and
   * suggests the capability is coming.
   */
  it.each(['Put', 'Patch', 'Delete'])('exposes no @%s route', (verb) => {
    const source = CONTROLLER_FILES.map(codeOf).join('\n');

    expect([verb, source.includes(`@${verb}(`)]).toStrictEqual([verb, false]);
  });

  /**
   * No route takes a tenant, in a body, a parameter or a query string.
   *
   * Tenancy comes from the execution context. A route that accepted one would let a caller file a
   * disciplinary record into another organisation, and row-level security would be the only thing
   * left standing between them and it.
   */
  it('accepts no tenant identifier at the edge', () => {
    const source = CONTROLLER_FILES.map(codeOf).join('\n');

    expect(source).not.toContain('tenantId');
    expect(source).not.toContain('tenant_id');
  });

  /**
   * The only collection read of violations names an employment.
   *
   * A route that listed a tenant's disciplinary matters at large would be a watchlist. It is
   * asserted here as well as in the module, because the route is where somebody would add a
   * convenience parameter.
   */
  it('lists violations only for a named employment', () => {
    const source = codeOf('violation.controller.ts');

    expect(source).toContain("@Query('employmentId')");
    for (const forbidden of ['severity', 'state', 'categoryCode', 'reportedBy', 'occurredFrom']) {
      expect([forbidden, source.includes(`@Query('${forbidden}')`)]).toStrictEqual([
        forbidden,
        false,
      ]);
    }
  });

  /**
   * The same restraint on the lifecycle routes: inquiries are listed for one violation, and there is
   * no route that lists a tenant's open cases, its investigators' workloads, or its case history at
   * large. Each would be the watchlist the violation routes already refuse to be.
   */
  it('lists inquiries only for a named violation', () => {
    const source = codeOf('investigation.controller.ts');

    expect(source).toContain("@Query('violationId')");
    for (const forbidden of ['state', 'investigatorMembershipId', 'openedFrom', 'employmentId']) {
      expect([forbidden, source.includes(`@Query('${forbidden}')`)]).toStrictEqual([
        forbidden,
        false,
      ]);
    }
  });

  /**
   * **No route sets a state.**
   *
   * A case moves because somebody opened or concluded an inquiry, and the transition is that act's
   * consequence. A `PATCH /state` — or any route carrying a `fromState` — would let a caller name
   * where the case is and have the server validate their claim rather than the case (D-5.2-17).
   */
  it('exposes no route that sets a case state directly', () => {
    const source = CONTROLLER_FILES.map(codeOf).join('\n');

    // No route *carries* a state. `transition` and `state` are not forbidden words — the case-history
    // route's own summary describes the transitions it returns — so this asks the exact question:
    // does any route path or payload name a state the caller could set?
    for (const forbidden of ['fromState', 'toState', 'currentState', 'setState']) {
      expect([forbidden, source.includes(forbidden)]).toStrictEqual([forbidden, false]);
    }

    const routePaths = [...source.matchAll(/@(?:Get|Post)\('([^']*)'\)/g)].map(
      (match) => match[1] ?? '',
    );

    for (const path of routePaths) {
      expect([path, /state|transition/.test(path)]).toStrictEqual([path, false]);
    }
    // …and the one route that concludes an inquiry names the act, not a state to set.
    expect(routePaths).toContain(':investigationId/conclusion');
  });

  /** The literal prefix resolves before the parameter route, or `categories` becomes a violation id. */
  it('declares the category controller before the violation controller', () => {
    const registration = readFileSync(
      join(process.cwd(), 'src', 'relations', 'relations.module.ts'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '');

    expect(registration.indexOf('ViolationCategoryController')).toBeLessThan(
      registration.indexOf('ViolationController,'),
    );

    // The two lifecycle controllers own distinct literal prefixes, so neither is shadowed by the
    // `:violationId` route above them whatever order Nest resolves them in.
    const controllers = readFileSync(
      join(RELATIONS_PACKAGE, 'investigation.controller.ts'),
      'utf8',
    );

    expect(controllers).toContain("path: 'relations/investigations'");
    expect(controllers).toContain("path: 'relations/cases'");
  });

  /**
   * A controller computes nothing.
   *
   * Every business rule — the frozen category, the future-date refusal, the access trail — lives
   * behind the dispatcher. A controller that decided anything would be a rule outside the
   * transaction that must contain it.
   */
  it('holds no business rule at the edge', () => {
    const source = CONTROLLER_FILES.map(codeOf).join('\n');

    // Concepts, not substrings. An earlier version of this list forbade the bare word `active` and
    // matched `includeInactive` — the query-string flag a controller legitimately parses. Reading a
    // *decision about* activeness is the boundary; carrying the caller's flag through is transport.
    for (const forbidden of [
      'new Date(',
      '.active',
      'isActive',
      '.severity',
      'occurredOn <',
      'if (',
      '.sequence',
      'sort(',
      'filter(',
    ]) {
      expect([forbidden, source.includes(forbidden)]).toStrictEqual([forbidden, false]);
    }

    // And the one flag it does carry is parsed, not interpreted: it goes straight to the query.
    expect(codeOf('violation-category.controller.ts')).toContain(
      "includeInactive: includeInactive === 'true'",
    );
  });
});
