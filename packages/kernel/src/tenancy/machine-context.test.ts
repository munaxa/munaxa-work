import { describe, expect, it } from 'vitest';

import { TenantIsolationException } from '../errors/domain-exception.js';
import { uuidV7 } from '../identity/uuid-v7.js';
import { Dispatcher, success, type CommandHandler } from '../cqrs/pipeline.js';

import {
  GrantAwarePermissionChecker,
  runWithServiceGrant,
  type ServiceElevation,
} from './service-context.js';
import {
  currentContext,
  currentMembershipId,
  currentTenantId,
  isMachineContext,
  isSystemContext,
  isTenantScoped,
  runInContext,
  type MachineContext,
  type TenantContext,
} from './tenant-context.js';

/**
 * The machine execution context: tenant-scoped work that nobody is doing.
 *
 * The point of these tests is not that the fields exist — it is that the machine is admitted exactly
 * where a tenant belongs and refused exactly where a person belongs, without either rule being
 * written twice.
 */

const machine = (tenantId: string = uuidV7()): MachineContext => ({
  machine: true,
  tenantId,
  executionIdentity: 'service:workflow-reminders',
  jobId: 'job-1',
  attempt: 1,
  correlationId: uuidV7(),
});

const person = (tenantId: string = uuidV7()): TenantContext => ({
  tenantId,
  actor: 'user:tester',
  membershipId: uuidV7(),
  correlationId: uuidV7(),
});

describe('machine context', () => {
  it('is tenant-scoped, so tenant-scoped work runs under it', () => {
    const context = machine();

    runInContext(context, () => {
      expect(currentTenantId()).toBe(context.tenantId);
    });
  });

  it('is not the system context, and the system context is not it', () => {
    runInContext(machine(), () => {
      const context = currentContext();

      expect(context === undefined ? undefined : isSystemContext(context)).toBe(false);
      expect(context === undefined ? undefined : isMachineContext(context)).toBe(true);
    });
    runInContext({ system: true, reason: 'migration', correlationId: uuidV7() }, () => {
      const context = currentContext();

      expect(context === undefined ? undefined : isMachineContext(context)).toBe(false);
    });
  });

  it('is not a person, and holds no membership that could make it one', () => {
    runInContext(machine(), () => {
      expect(currentMembershipId()).toBeUndefined();
    });
    // The contrast is the assertion: the same function answers for a person, so `undefined` above
    // means "a machine has none" rather than "this never answers".
    const acting = person();

    runInContext(acting, () => {
      expect(currentMembershipId()).toBe(acting.membershipId);
    });
  });

  it("refuses an invalid tenant exactly as a person's context does", () => {
    expect(() => runInContext({ ...machine(), tenantId: 'not-a-uuid' }, () => undefined)).toThrow(
      TenantIsolationException,
    );
  });

  it('counts as tenant-scoped, and the system context does not', () => {
    expect(isTenantScoped(machine())).toBe(true);
    expect(isTenantScoped(person())).toBe(true);
    expect(isTenantScoped({ system: true, reason: 'migration', correlationId: uuidV7() })).toBe(
      false,
    );
  });

  it('carries the job identity and attempt when a runner supplied them, and neither when not', () => {
    const running = machine();

    expect([running.jobId, running.attempt]).toStrictEqual(['job-1', 1]);

    // A machine context with no runner behind it: the two scheduling fields are optional precisely
    // because nothing schedules work yet, and a context that had to invent them would be inventing
    // a job that does not exist.
    const unscheduled: MachineContext = {
      machine: true,
      tenantId: running.tenantId,
      executionIdentity: running.executionIdentity,
      correlationId: running.correlationId,
    };

    expect([unscheduled.jobId, unscheduled.attempt]).toStrictEqual([undefined, undefined]);
    expect(unscheduled.tenantId).toBe(running.tenantId);
  });
});

describe('the pipeline under a machine context', () => {
  const commandName = 'probe.run';
  const permission = 'probe.run';

  /** Records that the handler body was reached, which is what the refusal tests need to deny. */
  const handlerRecording = (
    onRun: () => void,
  ): CommandHandler<{ commandName: string }, string> => ({
    commandName,
    permission,
    handle: () => {
      onRun();
      return Promise.resolve(success('ran'));
    },
  });

  it('admits a machine that holds the permission', async () => {
    let ran = false;
    const dispatcher = new Dispatcher({ holds: () => Promise.resolve(true) });

    dispatcher.registerCommand(
      handlerRecording(() => {
        ran = true;
      }),
    );

    const outcome = await runInContext(machine(), () => dispatcher.send({ commandName }));

    expect([outcome.ok, ran]).toStrictEqual([true, true]);
  });

  /**
   * The property that makes the machine context safe to add at all: it opens the tenancy gate and
   * **not** the authorization one. Automatic work is refused for exactly the reason a person would
   * be — it does not hold the permission — so there is one place authorization is decided.
   */
  it('refuses a machine that does not, exactly as it refuses a person', async () => {
    let ran = false;
    const dispatcher = new Dispatcher({ holds: () => Promise.resolve(false) });

    dispatcher.registerCommand(
      handlerRecording(() => {
        ran = true;
      }),
    );

    const outcome = await runInContext(machine(), () => dispatcher.send({ commandName }));

    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? undefined : outcome.error).toStrictEqual({ kind: 'forbidden', permission });
    expect(ran).toBe(false);
  });

  it('still refuses the system context, which has no tenant to run in', async () => {
    const dispatcher = new Dispatcher({ holds: () => Promise.resolve(true) });

    dispatcher.registerCommand(handlerRecording(() => undefined));

    await expect(
      runInContext({ system: true, reason: 'migration', correlationId: uuidV7() }, () =>
        dispatcher.send({ commandName }),
      ),
    ).rejects.toThrow(TenantIsolationException);
  });
});

describe('a service grant under a machine context', () => {
  /**
   * `originOf` is internal, so the elevation record is what surfaces it — and the elevation record
   * is the audit answer to "what did this module do inside another, and for whom". Asserting the
   * fixture's own field would prove nothing; this goes through the checker production wires.
   */
  it('names the machine identity in the elevation, never a person and never an empty actor', async () => {
    const elevations: ServiceElevation[] = [];
    const checker = new GrantAwarePermissionChecker(
      { holds: () => Promise.resolve(false) },
      (elevation) => elevations.push(elevation),
    );
    const context = machine();

    const permitted = await runInContext(context, () =>
      runWithServiceGrant(
        {
          module: 'workflow',
          operation: 'workflow.remind-step',
          permits: ['identity.membership.read'],
          reason: 'resolve the reminder recipient',
        },
        () => checker.holds('identity.membership.read'),
      ),
    );

    expect(permitted).toBe(true);
    expect(elevations).toHaveLength(1);
    expect(elevations[0]?.actor).toBe(context.executionIdentity);
    expect(elevations[0]?.tenantId).toBe(context.tenantId);
    // Nothing that could be read as a person having asked for this.
    expect(elevations[0]?.actor).not.toMatch(/^user:/);
  });

  it('still permits only what the grant names, for a machine as for anybody', async () => {
    const checker = new GrantAwarePermissionChecker({ holds: () => Promise.resolve(false) });

    const permitted = await runInContext(machine(), () =>
      runWithServiceGrant(
        {
          module: 'workflow',
          operation: 'workflow.remind-step',
          permits: ['identity.membership.read'],
          reason: 'resolve the reminder recipient',
        },
        () => checker.holds('identity.membership.manage'),
      ),
    );

    expect(permitted).toBe(false);
  });
});

describe('the machine context is not reachable by accident', () => {
  it('is absent outside any context, so nothing defaults to a machine', () => {
    expect(currentContext()).toBeUndefined();
    expect(currentMembershipId()).toBeUndefined();
  });

  it('does not leak out of its own scope', () => {
    const seen: string[] = [];
    const context = machine();

    runInContext(context, () => {
      seen.push(currentTenantId());
    });

    expect(seen).toStrictEqual([context.tenantId]);
    expect(currentContext()).toBeUndefined();
  });
});
