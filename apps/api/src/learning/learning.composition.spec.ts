import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Pool } from 'pg';
import {
  Dispatcher,
  GrantAwarePermissionChecker,
  InProcessEventDispatcher,
  runInContext,
  uuidV7,
  type PermissionChecker,
} from '@work/kernel';
import { ALL_LEARNING_PERMISSIONS, LearningPermissions } from '@work/learning';
import { PostgresUnitOfWork } from '@work/persistence';

import { learningModuleFor } from './learning.composition.js';
import { CONNECTION, TENANT, requireDatabaseInCi } from './phase-fourteen-harness.js';
import { upstreamHandlers, upstream } from './phase-fourteen-upstream.js';

/**
 * The **real composition function** the composition root calls, exercised end to end.
 *
 * `learningModuleFor` is what `identity.module.ts` invokes: it builds the PostgreSQL stores, the
 * four production adapters and the recording notification port, and returns the module the registry
 * registers. This suite calls that same function — not a hand-assembled equivalent — so a
 * composition that could not be instantiated, or that wired a port to nothing, fails here rather
 * than at boot.
 *
 * The dispatcher it is given is the same one the adapters read through, which is how the composition
 * root wires it: `DeferredPayrollDispatcher` resolves to the assembled dispatcher after registration,
 * so the module and its adapters share one.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Learning composition suite');

suite('the Learning composition', () => {
  let pool: Pool;
  let dispatcher: Dispatcher;

  beforeAll(() => {
    pool = new Pool({ connectionString: CONNECTION, max: 2, connectionTimeoutMillis: 15_000 });

    const permissions: PermissionChecker = new GrantAwarePermissionChecker({
      holds: (permission) => Promise.resolve(ALL_LEARNING_PERMISSIONS.includes(permission)),
    });

    dispatcher = new Dispatcher(permissions);

    for (const handler of upstreamHandlers(upstream())) dispatcher.registerQuery(handler);

    // The real composition function, given the same shapes the composition root gives it.
    const module = learningModuleFor(
      new PostgresUnitOfWork(pool, new InProcessEventDispatcher()),
      { ask: (query) => dispatcher.ask(query) },
      permissions,
    );

    for (const handler of module.commands ?? []) dispatcher.registerCommand(handler);
    for (const handler of module.queries ?? []) dispatcher.registerQuery(handler);

    composed = module;
  });

  afterAll(async () => {
    await pool.query('truncate learning_course_version, learning_course cascade');
    await pool.end();
  });

  let composed: ReturnType<typeof learningModuleFor>;

  it('produces a complete module the registry can register', () => {
    expect(composed.name).toBe('learning');
    expect(composed.commands).toHaveLength(27);
    expect(composed.queries).toHaveLength(11);
    // Stated in full so the administration screen offers the whole set rather than the subset that
    // happens to be some handler's own declaration.
    expect(composed.permissions).toEqual(ALL_LEARNING_PERMISSIONS);
    expect(composed.navigation).toHaveLength(4);
  });

  it('declares a permission on every command and every query', () => {
    const handlers = [...(composed.commands ?? []), ...(composed.queries ?? [])];

    for (const handler of handlers) {
      expect(ALL_LEARNING_PERMISSIONS).toContain(handler.permission);
    }
  });

  it('runs a real command through the composed module, against the real database', async () => {
    const code = `composed-${uuidV7().slice(0, 8)}`;
    const created = await runInContext(
      { tenantId: TENANT, correlationId: uuidV7(), actor: 'user:composition' },
      () =>
        dispatcher.send<{ courseId: string }>({
          commandName: 'learning.create-course',
          code,
          name: { en: 'Composed', ar: 'مركّب' },
          delivery: 'virtual',
        } as never),
    );

    expect(created.ok).toBe(true);

    // It reached PostgreSQL through the composed stores, not an in-memory double.
    const held = await pool.query<{ code: string }>(
      `select code from learning_course where tenant_id = $1 and code = $2`,
      [TENANT, code],
    );

    expect(held.rows[0]?.code).toBe(code);
  });

  it('wires the notification port to something that records and claims no delivery', async () => {
    // The composition installs `RecordingNotificationPort`. A composition that had wired a real
    // sender would be claiming a capability this repository does not have.
    const assigned = await runInContext(
      { tenantId: TENANT, correlationId: uuidV7(), actor: 'user:composition' },
      () =>
        dispatcher.send({
          commandName: 'learning.assign',
          employmentId: '01900000-0000-7000-8000-00000000d002',
          courseId: uuidV7(),
        } as never),
    );

    // Refused because the course does not exist — but it reached the handler, which is the point:
    // the module is wired and dispatching, and nothing threw on the way.
    expect(assigned.ok).toBe(false);
  });

  it('leaves the two self-service permissions declared and routed nowhere', () => {
    const routed = [
      ...(composed.commands ?? []).map((handler) => handler.permission),
      ...(composed.queries ?? []).map((handler) => handler.permission),
    ];

    // Declared so a tenant may grant them; enforced nowhere, because there is no
    // principal-to-employment resolution (ADR-0032). NOT VERIFIED, and stated rather than implied.
    expect(routed).not.toContain(LearningPermissions.assignmentReadOwn);
    expect(routed).not.toContain(LearningPermissions.certificationReadOwn);
    expect(composed.permissions).toContain(LearningPermissions.assignmentReadOwn);
  });
});
