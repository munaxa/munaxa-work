import { describe, expect, it, vi } from 'vitest';

import { TenantIsolationException } from '../errors/domain-exception.js';
import { runInContext } from '../tenancy/tenant-context.js';
import { uuidV7 } from '../identity/uuid-v7.js';

import {
  Dispatcher,
  success,
  type Command,
  type CommandHandler,
  type PermissionChecker,
} from './pipeline.js';

const context = { tenantId: uuidV7(), correlationId: uuidV7(), actor: 'user:tester' };

const allowing: PermissionChecker = { holds: () => Promise.resolve(true) };
const denying: PermissionChecker = { holds: () => Promise.resolve(false) };

interface ApproveLeave extends Command {
  readonly commandName: 'leave.approve';
  readonly requestId: string;
  readonly days: number;
}

const approveHandler = (
  behaviour = vi.fn(() => Promise.resolve(success('approved'))),
): CommandHandler<ApproveLeave, string> => ({
  commandName: 'leave.approve',
  permission: 'leave.approve',
  validate: (command) =>
    command.days > 0 ? [] : [{ field: 'days', message: 'must be greater than zero' }],
  handle: behaviour,
});

const command: ApproveLeave = { commandName: 'leave.approve', requestId: uuidV7(), days: 1 };
const invalidCommand: ApproveLeave = { ...command, days: -5 };
const zeroDayCommand: ApproveLeave = { ...command, days: 0 };

describe('Dispatcher', () => {
  it('runs a command through its handler', async () => {
    const dispatcher = new Dispatcher(allowing);
    dispatcher.registerCommand(approveHandler());

    const result = await runInContext(context, () => dispatcher.send<string>(command));

    expect(result.ok && result.value).toBe('approved');
  });

  it('refuses an unauthorized caller before validating, so nothing is revealed', async () => {
    const handle = vi.fn(() => Promise.resolve(success('approved')));
    const dispatcher = new Dispatcher(denying);
    dispatcher.registerCommand(approveHandler(handle));

    const result = await runInContext(context, () => dispatcher.send<string>(invalidCommand));

    expect(result.ok ? undefined : result.error).toEqual({
      kind: 'forbidden',
      permission: 'leave.approve',
    });
    expect(handle).not.toHaveBeenCalled();
  });

  it('validates before reaching the handler', async () => {
    const handle = vi.fn(() => Promise.resolve(success('approved')));
    const dispatcher = new Dispatcher(allowing);
    dispatcher.registerCommand(approveHandler(handle));

    const result = await runInContext(context, () => dispatcher.send<string>(zeroDayCommand));

    expect(result.ok ? undefined : result.error).toEqual({
      kind: 'validation',
      failures: [{ field: 'days', message: 'must be greater than zero' }],
    });
    expect(handle).not.toHaveBeenCalled();
  });

  it('refuses a business operation with no tenant context', async () => {
    const dispatcher = new Dispatcher(allowing);
    dispatcher.registerCommand(approveHandler());

    await expect(dispatcher.send(command)).rejects.toThrow(TenantIsolationException);
  });

  it('reports an unknown command rather than failing silently', async () => {
    const dispatcher = new Dispatcher(allowing);

    const result = await runInContext(context, () =>
      dispatcher.send({ commandName: 'nobody.handles' }),
    );

    expect(result.ok ? undefined : result.error.kind).toBe('not_found');
  });

  it('refuses two handlers for one command', () => {
    const dispatcher = new Dispatcher(allowing);
    dispatcher.registerCommand(approveHandler());

    expect(() => {
      dispatcher.registerCommand(approveHandler());
    }).toThrow(/Two handlers/);
  });

  it('declares every permission it knows, for the module registry', async () => {
    const dispatcher = new Dispatcher(allowing);
    dispatcher.registerCommand(approveHandler());
    dispatcher.registerQuery({
      queryName: 'leave.balance',
      permission: 'leave.read',
      handle: () => Promise.resolve(success(0)),
    });

    await runInContext(context, () => dispatcher.ask({ queryName: 'leave.balance' }));

    expect(dispatcher.declaredPermissions()).toEqual(['leave.approve', 'leave.read']);
  });
});
