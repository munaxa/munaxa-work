import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { InProcessEventDispatcher } from '@work/kernel';
import { PostgresUnitOfWork } from '@work/persistence';
import { Pool } from 'pg';

import { assetsModuleFor } from './assets.composition.js';

/**
 * The composition, and the dependencies it deliberately does not have.
 *
 * Checkpoint 1's approved scope has **zero cross-module dependencies**, which makes this the
 * shortest composition in the repository. That is a property worth protecting: the day a second
 * argument appears here, Assets has started asking another module a question, and the assertions
 * below are what make that a deliberate act rather than a quiet one.
 */

const SOURCE = readFileSync(join(process.cwd(), 'src', 'assets', 'assets.composition.ts'), 'utf8');

const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const composed = (): ReturnType<typeof assetsModuleFor> => {
  const pool = new Pool({ connectionString: 'postgresql://unused:unused@127.0.0.1:1/unused' });

  return assetsModuleFor(new PostgresUnitOfWork(pool, new InProcessEventDispatcher()));
};

describe('the assets composition', () => {
  it('takes the unit of work and nothing else', () => {
    expect(assetsModuleFor).toHaveLength(1);
    expect(CODE).toContain('postgresAssetsStores()');
  });

  /**
   * Every adapter this module could have grown and did not, asserted by name.
   *
   * Each corresponds to a decision: D-5.3-04 settled how a document reference would work and this
   * checkpoint still builds none; D-5.3-06 settled that approvals stay this module's own and this
   * checkpoint approves nothing; D-5.3-03 remains open and nothing here touches Payroll.
   */
  it('wires no adapter to any other module', () => {
    for (const absent of [
      'EmploymentDirectory',
      'MembershipDirectory',
      'Documents',
      'DocumentReference',
      'ApprovalPort',
      'WorkflowApprovals',
      'StoragePort',
      'Notifications',
      'JobPort',
      'runWithServiceGrant',
      'dispatcher',
      'permissions',
      'systemClock',
      'Clock',
    ]) {
      expect(CODE).not.toContain(absent);
    }
  });

  it('imports nothing but its own package and the kernel’s types', () => {
    const imports = [...CODE.matchAll(/from '(@work\/[a-z-]+)'/g)].map((match) => match[1]);

    expect([...new Set(imports)].sort()).toEqual(['@work/assets', '@work/kernel']);
  });

  it('registers five commands, three queries and four permissions', () => {
    const module = composed();

    expect(module.name).toBe('assets');
    expect(module.commands ?? []).toHaveLength(5);
    expect(module.queries ?? []).toHaveLength(3);
    expect(module.permissions ?? []).toHaveLength(4);
    expect(module.eventHandlers ?? []).toHaveLength(0);
  });

  /**
   * Every handler declares a permission, checked at the composition root rather than only inside the
   * module.
   *
   * This is the assertion that would catch a handler added later with the declaration omitted — the
   * one failure mode that turns an authenticated route into an unauthorized one.
   */
  it('gives every registered handler an assets permission', () => {
    const module = composed();

    for (const handler of [...(module.commands ?? []), ...(module.queries ?? [])]) {
      expect(handler.permission).toMatch(/^assets\.[a-z-]+\.[a-z-]+$/);
    }
  });

  it('is registered on the shared registry and on the Nest application', () => {
    const registry = readFileSync(
      join(process.cwd(), 'src', 'identity', 'identity.module.ts'),
      'utf8',
    );
    const application = readFileSync(join(process.cwd(), 'src', 'app.module.ts'), 'utf8');

    expect(registry).toContain('registry.register(assetsModuleFor(unitOfWork));');
    expect(application).toContain('AssetsModule,');
  });

  /**
   * Nothing outside Assets reads its tables or imports its package.
   *
   * The consumer the specification names — Offboarding, reading custody through public contracts
   * (AD-006) — does not exist yet, and when it does it will read the contract rather than the table.
   */
  it('is read by no other module in this application', () => {
    const root = join(process.cwd(), 'src');
    const consumers = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== 'assets')
      .filter((entry) =>
        readdirSync(join(root, entry.name))
          .filter((file) => file.endsWith('.ts'))
          .some((file) =>
            readFileSync(join(root, entry.name, file), 'utf8').includes('@work/assets'),
          ),
      )
      .map((entry) => entry.name);

    expect(consumers).toEqual([]);
  });
});
