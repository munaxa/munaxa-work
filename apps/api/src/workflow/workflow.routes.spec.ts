import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { uuidV7 } from '@work/kernel';
import { ALL_WORKFLOW_PERMISSIONS } from '@work/workflow';

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
 * **Seventeen routes for seventeen handlers, one each.** The application declared nine commands and
 * eight queries in Checkpoint 4, and the HTTP layer exposes exactly those: no handler is reachable
 * twice, none is unreachable, and there is no generic "execute a command" endpoint through which a
 * client could reach one that was never declared.
 *
 * **The absences are asserted because they are the design.** A route returning 404 because nobody
 * wrote it and a route returning 404 on purpose look identical from the outside — so these tests
 * check the *source* as well as the wire. There is no `/me`, no `/my-team`, no `/roles`, no
 * `/groups`, no `/sla`, no `/escalations`; and there is no controller anywhere that reaches a
 * repository, Prisma, or the Recruitment seam directly.
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

const CONTROLLER_FILES = [
  'definition.controller.ts',
  'version.controller.ts',
  'instance.controller.ts',
  'approval.controller.ts',
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

  it('declares four controllers, in the order the module declares them', () => {
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
    ]);

    const positions = names.map((name) => module.indexOf(`    ${name},`));

    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(positions.every((position) => position > 0)).toBe(true);
  });

  /**
   * Seventeen routes, and one dispatch per route.
   *
   * Counted from the decorators and cross-checked against the command and query names the
   * controllers send: a handler exposed twice would show up as an eighteenth dispatch, and one
   * exposed not at all would be missing from the set.
   */
  it('exposes exactly seventeen routes, one per application handler', () => {
    const sources = CONTROLLER_FILES.map(codeOf);
    const routes = sources.flatMap(
      (source) => source.match(/@(?:Get|Post|Put|Patch|Delete)\(/g) ?? [],
    );
    const dispatched = sources.flatMap((source) => [
      ...(source.match(/(?:queryName|commandName): 'workflow\.[a-z-]+'/g) ?? []),
    ]);

    expect(routes).toHaveLength(17);
    expect(dispatched).toHaveLength(17);
    expect(new Set(dispatched).size).toBe(17);

    const commands = dispatched.filter((name) => name.startsWith('commandName'));
    const queries = dispatched.filter((name) => name.startsWith('queryName'));

    expect(commands).toHaveLength(9);
    expect(queries).toHaveLength(8);
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
  it('uses only GET and POST, and no generic status route', () => {
    for (const file of CONTROLLER_FILES) {
      const source = codeOf(file);
      const writes = source.match(/@(?:Post|Put|Patch|Delete)\('[^']*'\)/g) ?? [];

      expect([file, /@(?:Put|Patch|Delete)\(/.test(source)]).toEqual([file, false]);
      expect([file, writes.filter((write) => write.includes('status'))]).toEqual([file, []]);
    }
    // The one `status` route is a **read** of an approval in the port's vocabulary, not a setter.
    expect(codeOf('approval.controller.ts')).toContain("@Get(':instanceId/status')");
  });

  /**
   * The routes that must not exist.
   *
   * Checked on the wire *and* in the source. A 404 alone would prove only that nobody had written
   * the route yet; the source check is what makes the absence structural.
   */
  it('has no route for any capability this phase deferred', async () => {
    const forbidden = [
      '/me',
      '/my-team',
      '/groups',
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

    for (const fragment of [
      "'me'",
      'my-team',
      'groups',
      'roles',
      'escalation',
      'sla',
      'notification',
      'analytics',
      'parallel',
      'majority',
      'unanimous',
      'first-response',
      'tally',
      'recruitment',
    ]) {
      expect([fragment, sources.toLowerCase().includes(fragment)]).toEqual([fragment, false]);
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
    ]);
    expect(new Set(prefixes).size).toBe(4);
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
