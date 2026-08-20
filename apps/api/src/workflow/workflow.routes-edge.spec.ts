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
  openWorkflowApi,
  permitting,
  requireDatabaseInCi,
  type WorkflowApiFixture,
} from './workflow-api.fixture.js';
import { get, runningApproval } from './workflow-api-scenario.js';

/**
 * What a Workflow controller must **not** do, and the two properties only a running app can show.
 *
 * Split from `workflow.routes.spec.ts` at the file-size budget, on a real seam: that file is the
 * **inventory** — how many routes there are, which handler each reaches, which verbs are used, and
 * which capabilities have no route at all. This one is about the **edge itself**: that a controller
 * computes nothing, reaches nothing but the dispatcher, and that Nest resolves the literal approval
 * paths before the parameterized ones.
 *
 * The last of those is the reason this file needs a real application rather than a source scan: route
 * ordering is a fact about the router, and reading the decorators cannot establish it.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Workflow route-edge suite');

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

suite('what a Workflow controller must not do', () => {
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
  it('introduces no permission beyond the eleven the application declares', () => {
    const sources = CONTROLLER_FILES.map(codeOf).join('\n');
    const mentioned = sources.match(/'workflow\.[a-z.-]+'/g) ?? [];

    expect(ALL_WORKFLOW_PERMISSIONS).toHaveLength(11);
    // Controllers name commands and queries, never permissions: the handler declares the permission
    // and the pipeline enforces it, so a route cannot quietly widen or narrow one.
    for (const name of mentioned) {
      expect([name, ALL_WORKFLOW_PERMISSIONS.includes(name.slice(1, -1))]).toEqual([name, false]);
    }
  });
});
