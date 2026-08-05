import { describe, expect, it } from 'vitest';

import { success } from '../cqrs/pipeline.js';

import { ModuleRegistry, type WorkModule } from './module-registry.js';

const leave: WorkModule = {
  name: 'leave',
  commands: [
    {
      commandName: 'leave.approve',
      permission: 'leave.approve',
      handle: () => Promise.resolve(success(null)),
    },
  ],
  queries: [
    {
      queryName: 'leave.balance',
      permission: 'leave.read',
      handle: () => Promise.resolve(success(null)),
    },
  ],
  navigation: [{ key: 'leave', path: '/leave', permission: 'leave.read', order: 20 }],
  health: [{ name: 'leave.accrual-job', check: () => Promise.resolve('up' as const) }],
};

const attendance: WorkModule = {
  name: 'attendance',
  permissions: ['attendance.correct'],
  navigation: [
    { key: 'attendance', path: '/attendance', permission: 'attendance.read', order: 10 },
  ],
  health: [{ name: 'attendance.device-feed', check: () => Promise.resolve('down' as const) }],
};

describe('ModuleRegistry', () => {
  const registryWith = (...modules: WorkModule[]): ModuleRegistry => {
    const registry = new ModuleRegistry();
    for (const module of modules) registry.register(module);
    return registry;
  };

  it('derives permissions from handlers rather than a maintained list', () => {
    expect(registryWith(leave, attendance).describe().permissions).toEqual([
      'attendance.correct',
      'leave.approve',
      'leave.read',
    ]);
  });

  it('orders navigation across modules', () => {
    expect(
      registryWith(leave, attendance)
        .describe()
        .navigation.map((entry) => entry.key),
    ).toEqual(['attendance', 'leave']);
  });

  it('collects health checks from every module', async () => {
    expect(await registryWith(leave, attendance).health()).toEqual({
      'leave.accrual-job': 'up',
      'attendance.device-feed': 'down',
    });
  });

  it('refuses to register a module twice', () => {
    const registry = registryWith(leave);

    expect(() => {
      registry.register(leave);
    }).toThrow(/registered twice/);
  });
});
