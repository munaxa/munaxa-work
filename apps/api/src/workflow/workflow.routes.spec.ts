import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { uuidV7 } from '@work/kernel';
import { ALL_WORKFLOW_PERMISSIONS } from '@work/workflow';
import { InProcessEventDispatcher } from '@work/kernel';
import { PostgresUnitOfWork } from '@work/persistence';

import { workflowModuleFor } from './workflow.composition.js';

import {
  APPROVER,
  CONNECTION,
  TENANT_A,
  UNADOPTED,
  CONTROLLERS,
  http,
  openWorkflowApi,
  permitting,
  requireDatabaseInCi,
  type WorkflowApiFixture,
} from './workflow-api.fixture.js';
import { BASE, get, runningApproval } from './workflow-api-scenario.js';

/**
 * The surface, counted — and the much larger surface that is deliberately not there.
 *
 * **Twenty-two routes for twenty-two handlers, one each.** The application declares twelve commands
 * and ten queries, and the HTTP layer exposes exactly those — reconciled by name against the module's
 * own registration rather than counted. No handler is reachable twice, none is unreachable, and there
 * is no generic "execute a command" endpoint through which a client could reach one that was never
 * declared.
 *
 * **The absences are asserted because they are the design.** A route returning 404 because nobody
 * wrote it and a route returning 404 on purpose look identical from the outside — so these tests
 * check the *source* as well as the wire. There is no `/me`, no `/my-team`, no `/roles`, no `/sla`,
 * no `/escalations`; and there is no controller anywhere that reaches a repository, Prisma, or the
 * Recruitment seam directly.
 *
 * `/approval-groups` **is** here since Phase 16B, and the difference between it and `/roles` is the
 * one this module turns on: a group is an explicit list of memberships a tenant wrote down, and a
 * role is a directory this product has committed never to build.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Workflow API route suite');

const API = join(process.cwd(), '..', '..', 'packages', 'modules', 'workflow', 'src', 'api');

const sourceOf = (file: string): string => readFileSync(join(API, file), 'utf8');

/** The same file with its comments removed: an absence is about code, not about prose. */
const codeOf = (file: string): string =>
  sourceOf(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

/** And with the string literals removed too, for the assertions that are about *arithmetic*. */
const logicOf = (file: string): string =>
  codeOf(file)
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');

const CONTROLLER_FILES = [
  'definition.controller.ts',
  'version.controller.ts',
  'instance.controller.ts',
  'approval.controller.ts',
  'approval-group.controller.ts',
];

suite('the Workflow API surface', () => {
  let fixture: WorkflowApiFixture;
  let application: INestApplication;

  beforeAll(async () => {
    fixture = await openWorkflowApi();
    application = await fixture.applicationFor(
      TENANT_A,
      permitting(...ALL_WORKFLOW_PERMISSIONS),
      APPROVER,
    );
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  it('declares five controllers, in the order the module declares them', () => {
    const module = readFileSync(
      join(process.cwd(), 'src', 'workflow', 'workflow.module.ts'),
      'utf8',
    );
    const names = CONTROLLERS.map((controller) => controller.name);

    expect(names).toEqual([
      'WorkflowDefinitionController',
      'WorkflowVersionController',
      'WorkflowInstanceController',
      'WorkflowApprovalController',
      'WorkflowApprovalGroupController',
    ]);

    const positions = names.map((name) => module.indexOf(`    ${name},`));

    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(positions.every((position) => position > 0)).toBe(true);
  });

  /**
   * Twenty-two routes, and one dispatch per route.
   *
   * Seventeen since 16A and five since Phase 16B's group controller. Counted from the decorators and
   * cross-checked against the command and query names the controllers send: a handler exposed twice
   * would show up as a twenty-third dispatch, and one exposed not at all would be missing from the
   * set. **Every application handler is reachable exactly once**, which is the property that makes
   * the count worth asserting rather than the number itself.
   */
  it('exposes exactly twenty-two routes, one per application handler', () => {
    const sources = CONTROLLER_FILES.map(codeOf);
    const routes = sources.flatMap(
      (source) => source.match(/@(?:Get|Post|Put|Patch|Delete)\(/g) ?? [],
    );
    const dispatched = sources.flatMap((source) => [
      ...(source.match(/(?:queryName|commandName): 'workflow\.[a-z-]+'/g) ?? []),
    ]);

    expect(routes).toHaveLength(22);
    expect(dispatched).toHaveLength(22);
    expect(new Set(dispatched).size).toBe(22);

    const commands = dispatched.filter((name) => name.startsWith('commandName'));
    const queries = dispatched.filter((name) => name.startsWith('queryName'));

    expect(commands).toHaveLength(12);
    expect(queries).toHaveLength(10);
  });

  /**
   * And every one of them is a handler the application actually declared.
   *
   * The names are read out of the controllers and compared against the module's own registration, in
   * **both** directions: a route dispatching a name nobody registered is a 500 waiting for its first
   * caller, and a handler no route reaches is a capability nobody can use. This is the reconciliation
   * the count above cannot do on its own.
   */
  it('reconciles every route against a registered handler, and every handler against a route', () => {
    const dispatched = new Set(
      CONTROLLER_FILES.map(codeOf)
        .flatMap((source) => [
          ...(source.match(/(?:queryName|commandName): '(workflow\.[a-z-]+)'/g) ?? []),
        ])
        .map((match) => match.slice(match.indexOf("'") + 1, -1)),
    );
    const module = workflowModuleFor(
      new PostgresUnitOfWork(fixture.pool, new InProcessEventDispatcher()),
      { ask: () => Promise.reject(new Error('not called')) },
      {
        ask: () => Promise.reject(new Error('not called')),
        send: () => Promise.reject(new Error('not called')),
      },
      { holds: () => Promise.resolve(true) },
    );
    const registered = new Set([
      ...(module.commands ?? []).map((handler) => handler.commandName),
      ...(module.queries ?? []).map((handler) => handler.queryName),
    ]);

    expect([...dispatched].filter((name) => !registered.has(name))).toStrictEqual([]);
    expect([...registered].filter((name) => !dispatched.has(name))).toStrictEqual([]);
  });

  /**
   * Nine writes and eight reads, and no `PUT`, `PATCH` or `DELETE` anywhere.
   *
   * The status *setter* is the shape being excluded, not the word: a client must reach a transition
   * by naming it — publish, archive, cancel, decide — rather than by assigning a status, because a
   * generic setter is a route through which the domain's own rules about which move is legal never
   * get to run. So no write decorator anywhere carries a `status` path; the single `status` route is
   * a read.
   */
  it('uses no PUT and no PATCH, one DELETE, and no generic status route', () => {
    for (const file of CONTROLLER_FILES) {
      const source = codeOf(file);
      const writes = source.match(/@(?:Post|Put|Patch|Delete)\('[^']*'\)/g) ?? [];

      expect([file, /@(?:Put|Patch)\(/.test(source)]).toEqual([file, false]);
      expect([file, writes.filter((write) => write.includes('status'))]).toEqual([file, []]);
    }
    /**
     * **One `DELETE` in the module, and it removes a person from a list.**
     *
     * 16A had none, because nothing it exposed was removable: a decision and a history entry are
     * evidence, and a definition or a version is retired or archived by name rather than deleted. A
     * group is neither — it is a list an organization edits — so the one removal the application has
     * is the one route that carries the verb.
     */
    const deletes = CONTROLLER_FILES.flatMap(
      (file) => codeOf(file).match(/@Delete\('[^']*'\)/g) ?? [],
    );

    expect(deletes).toStrictEqual(["@Delete('members/:approvalGroupMemberId')"]);
    // The one `status` route is a **read** of an approval in the port's vocabulary, not a setter.
    expect(codeOf('approval.controller.ts')).toContain("@Get(':instanceId/status')");
  });

  /**
   * The routes that must not exist.
   *
   * Checked on the wire *and* in the source. A 404 alone would prove only that nobody had written
   * the route yet; the source check is what makes the absence structural.
   */
  it('has no route for any capability this phase defers', async () => {
    const forbidden = [
      '/me',
      '/my-team',
      '/roles',
      '/escalations',
      '/sla',
      '/sessions',
      '/waitlists',
      '/recruitment',
    ];

    for (const path of forbidden) {
      const response = await http(application).get(`${BASE}${path}`).send();

      expect([path, response.status]).toEqual([path, 404]);
    }

    const sources = CONTROLLER_FILES.map(codeOf).join('\n');

    /**
     * **`/groups` left this list in Phase 16B and `/roles` did not**, which is the distinction the
     * whole capability rests on.
     *
     * A Workflow approval group is a list of memberships a tenant wrote down, in this module's own
     * tables, resolved into individual approvers when an approval starts. A role is a *directory* —
     * a question about people answered from facts somebody else owns — and ADR-0001 places that with
     * Platform. `manager` and `team` stay refused for the same reason: both need the caller's
     * employment, which no principal in this repository resolves.
     *
     * The tally words also left it, and for a narrower reason: `majority` and the rest are the
     * domain's vocabulary, and the API now carries them **as values a client may send** on a step
     * body. What must stay absent is an *implementation* — a controller computing a threshold — and
     * that is asserted structurally below rather than by the presence of a word.
     */
    for (const fragment of [
      "'me'",
      'my-team',
      'roles',
      'escalation',
      'sla',
      'notification',
      'analytics',
      'recruitment',
    ]) {
      expect([fragment, sources.toLowerCase().includes(fragment)]).toEqual([fragment, false]);
    }
  });

  /**
   * No controller computes anything about a branch.
   *
   * The tally is the domain's — a denominator, a threshold and an outcome that decide who is
   * approved — and a controller that recomputed any of it would be a second implementation of the
   * rule, reachable over HTTP and disagreeing with the first the day one of them changed. So the
   * assertion is about arithmetic and comparison in the controllers, not about the words.
   */
  it('computes no threshold, no denominator and no outcome at the edge', () => {
    for (const file of CONTROLLER_FILES) {
      // Literals as well as comments: an operation summary is prose that happens to be a string, and
      // a scan that could not tell it from code would push the documentation out of the files that
      // most need it — exactly as the application boundary suite found.
      const source = logicOf(file);

      for (const forbidden of [
        'Math.',
        'floor(',
        'ceil(',
        'round(',
        '.filter(',
        '.reduce(',
        'approvals',
        'threshold',
        'quorumMet',
        'outcome',
      ]) {
        expect([file, forbidden, source.includes(forbidden)]).toEqual([file, forbidden, false]);
      }
    }
  });

  /**
   * No controller reaches past the dispatcher.
   *
   * A controller holding a repository would be an authorization bypass with a route, and one holding
   * the Recruitment seam would let a client apply a business decision without an approval.
   */
  it('reaches nothing but the dispatcher', () => {
    for (const file of [...CONTROLLER_FILES, 'workflow-dispatcher.ts']) {
      const source = codeOf(file);

      for (const forbidden of [
        'PrismaClient',
        'prisma',
        'postgresWorkflowStores',
        'Repository',
        'UnitOfWork',
        'BusinessDecisionPort',
        'ApprovalPort',
        'select ',
        'insert into',
      ]) {
        expect([file, forbidden, source.includes(forbidden)]).toEqual([file, forbidden, false]);
      }
    }
  });

  /**
   * Within `workflow/approvals`, the two literals resolve before the parameter.
   *
   * `pending` and `decided` are declared before `:instanceId/status`, so neither is captured as an
   * instance identifier. Asserted against real requests rather than trusted to declaration order: a
   * `pending` captured by the parameter would answer 400 for a malformed UUID, not 200.
   */
  it('resolves the literal approval routes before the parameterized ones', async () => {
    const running = await runningApproval(application, {
      approver: APPROVER,
      subjectId: uuidV7(),
      subjectType: UNADOPTED,
    });
    const pending = await get(application, '/approvals/pending');
    const decided = await get(application, '/approvals/decided');
    const status = await get(application, `/approvals/${running.instanceId}/status`);

    expect(pending.status).toBe(200);
    expect(decided.status).toBe(200);
    expect(status.status).toBe(200);
    expect(status.body['approvalId']).toBe(running.instanceId);
  });

  /** And the four prefixes belong to four controllers, so none can shadow another. */
  it('gives each prefix to exactly one controller', () => {
    const prefixes = CONTROLLER_FILES.map((file) => {
      const source = codeOf(file);
      const match = /path: '(workflow\/[a-z-]+)'/.exec(source);

      return match?.[1] ?? '';
    });

    expect(prefixes).toEqual([
      'workflow/definitions',
      'workflow/versions',
      'workflow/instances',
      'workflow/approvals',
      'workflow/approval-groups',
    ]);
    expect(new Set(prefixes).size).toBe(5);
    // `approvals` and `approval-groups` are sibling segments rather than nested, so neither can
    // capture the other however the controllers are ordered.
    expect(prefixes.filter((prefix) => prefix.startsWith('workflow/approvals/'))).toStrictEqual([]);
  });

  /**
   * Nine permissions, and the API introduces none of its own.
   *
   * Seven since 16A and two since Phase 16B's application layer — `workflow.group.read` and
   * `workflow.group.manage`. **Neither has a route yet**: the group controllers are Checkpoint 6, so
   * the two permissions are composed and enforced by their handlers while being unreachable over
   * HTTP. That is why this counts the application's permissions rather than the controllers'.
   */
  it('introduces no permission beyond the nine the application declares', () => {
    const sources = CONTROLLER_FILES.map(codeOf).join('\n');
    const mentioned = sources.match(/'workflow\.[a-z.-]+'/g) ?? [];

    expect(ALL_WORKFLOW_PERMISSIONS).toHaveLength(9);
    // Controllers name commands and queries, never permissions: the handler declares the permission
    // and the pipeline enforces it, so a route cannot quietly widen or narrow one.
    for (const name of mentioned) {
      expect([name, ALL_WORKFLOW_PERMISSIONS.includes(name.slice(1, -1))]).toEqual([name, false]);
    }
  });
});
