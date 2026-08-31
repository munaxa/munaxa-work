import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { InProcessEventDispatcher } from '@work/kernel';
import { PostgresUnitOfWork } from '@work/persistence';
import { Pool } from 'pg';

import { EmploymentPermissions } from '@work/employment';

import { assetsModuleFor } from './assets.composition.js';

/**
 * The composition, and the dependencies it deliberately does not have.
 *
 * Checkpoint 1 had **zero cross-module dependencies**. Checkpoint 2 has exactly **one**, and it
 * consumes a read Employment already publishes rather than creating a contract.
 *
 * The "zero dependencies" assertion this file used to carry became stale when the approved capability
 * genuinely changed the boundary. It was **replaced with an exact statement of the new one** — one
 * adapter, one permission, one boolean — rather than deleted, so the next dependency is still a
 * deliberate act rather than a quiet one.
 */

const SOURCE = readFileSync(join(process.cwd(), 'src', 'assets', 'assets.composition.ts'), 'utf8');

const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ADAPTER = readFileSync(join(process.cwd(), 'src', 'assets', 'assets-sources.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/** Employment's own declaration, resolved at runtime rather than restated as a string. */
const EMPLOYMENT_READ_PERMISSION = EmploymentPermissions.employmentRead;

const composed = (): ReturnType<typeof assetsModuleFor> => {
  const pool = new Pool({ connectionString: 'postgresql://unused:unused@127.0.0.1:1/unused' });

  return assetsModuleFor(new PostgresUnitOfWork(pool, new InProcessEventDispatcher()), {
    ask: () => Promise.reject(new Error('not called')),
  });
};

describe('the assets composition', () => {
  it('takes the unit of work and a dispatcher to ask with, and nothing else', () => {
    expect(assetsModuleFor).toHaveLength(2);
    expect(CODE).toContain('postgresAssetsStores()');
    expect(CODE).toContain('new AssetsEmploymentDirectory(dispatcher)');
  });

  /**
   * Every adapter this module could have grown and did not, asserted by name.
   *
   * Each corresponds to a decision: D-5.3-04 settled how a document reference would work and this
   * checkpoint still builds none; D-5.3-06 settled that approvals stay this module's own and this
   * checkpoint approves nothing; D-5.3-03 remains open and nothing here touches Payroll.
   */
  it('wires exactly one adapter to another module, and none of the others', () => {
    expect(CODE).toContain('AssetsEmploymentDirectory');

    for (const absent of [
      'MembershipDirectory',
      'DocumentReference',
      'ApprovalPort',
      'WorkflowApprovals',
      'StoragePort',
      'Notifications',
      'JobPort',
      'PermissionChecker',
      'ReportingLine',
    ]) {
      expect(CODE).not.toContain(absent);
    }
  });

  /**
   * The adapter reaches exactly one query and permits exactly one permission.
   *
   * Asserted on the adapter's own source rather than on the composition, because that is where the
   * grant is written and where a second permission would be added.
   */
  it('permits one permission, for one query, and nothing wider', () => {
    const permitted = [...ADAPTER.matchAll(/permits: \[([^\]]+)\]/g)].map((match) => match[1]);
    // Deduplicated: the query name appears twice by design — once on the typed interface and once at
    // the call site — and what is under test is that there is one *distinct* query, not one mention.
    const queries = new Set(
      [...ADAPTER.matchAll(/queryName: '([a-z.-]+)'/g)].map((match) => match[1]),
    );

    expect(permitted).toEqual(['EMPLOYMENT_READ']);
    expect([...queries]).toEqual(['employment.read-employment']);
    expect(ADAPTER).not.toContain('commandName');
  });

  /**
   * **The grant's permitted string is Employment's own constant, not a literal typed twice.**
   *
   * `GrantAwarePermissionChecker` matches a grant by exact string. Relations permits
   * `'employment.read'` while `employment.read-employment` declares `employment.employment.read`, so
   * its employment check cannot succeed through the grant — a shipped defect this repository already
   * has. Reconciling the two here is what makes the same mistake impossible in Assets.
   */
  it('permits exactly the permission Employment’s own read declares', () => {
    expect(EMPLOYMENT_READ_PERMISSION).toBe(EmploymentPermissions.employmentRead);
    expect(ADAPTER).toContain('const EMPLOYMENT_READ = EmploymentPermissions.employmentRead');
    // The literal Relations got wrong must not appear here at all.
    expect(ADAPTER).not.toContain("'employment.read'");
  });

  it('imports its own package, the kernel, Employment’s contract and the shared clock', () => {
    const imports = [...CODE.matchAll(/from '(@work\/[a-z-]+)'/g)].map((match) => match[1]);

    expect([...new Set(imports)].sort()).toEqual(['@work/assets', '@work/kernel', '@work/payroll']);
  });

  /**
   * Checkpoints 3 and 4 each added one query and no permission, and both halves of that are asserted.
   *
   * A read that arrived with a permission of its own would be a permission minted for a capability;
   * `assets.custody-summary` and `assets.employment-clearance` both sit behind the
   * `assets.custody.read` that already existed, because both are projections of custody rows.
   */
  it('registers seven commands, seven queries and seven permissions', () => {
    const module = composed();

    expect(module.name).toBe('assets');
    expect(module.commands ?? []).toHaveLength(7);
    expect(module.queries ?? []).toHaveLength(7);
    // Still seven. Checkpoints 3 and 4 each added a read and neither added a permission: both sit
    // behind `assets.custody.read`, because both are projections of custody and nothing else.
    expect(module.permissions ?? []).toHaveLength(7);
  });

  /**
   * **No event handler, at the composition root — which is where one would actually be registered.**
   *
   * This is D-5.3-11 as a test rather than as prose. The mechanism exists and Employment already
   * raises `employment.employment.ended`, so subscribing is reachable; the repository's only
   * `EventHandler` is Identity reacting to its own event, and dispatch here is post-commit,
   * in-process and at-most-once with no outbox (ADR-0050). A module that closed custody on an event
   * it might never receive would lose an asset to any restart mid-dispatch.
   *
   * Assets is asked; it never subscribes. An entry appearing in this array is that decision being
   * reversed, and it should fail here.
   */
  it('subscribes to no event, and registers no handler that could receive one', () => {
    expect(composed().eventHandlers ?? []).toHaveLength(0);

    for (const absent of ['eventHandlers', 'EventHandler', 'onEmploymentEnded', 'subscribe']) {
      expect(SOURCE).not.toContain(absent);
    }
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

    expect(registry).toContain('registry.register(assetsModuleFor(unitOfWork, senders.payroll));');
    expect(application).toContain('AssetsModule,');
  });

  /**
   * Nothing outside Assets reads its tables or imports its package.
   *
   * The consumer the specification names — Offboarding, reading custody through public contracts
   * (AD-006) — does not exist yet, and when it does it will read the contract rather than the table.
   *
   * **Suites are not consumers.** A test that asserts a property *of* Assets' declarations — that
   * every permission in the product translates at the platform seam, say — imports the package to
   * make a claim about it, not to depend on it. Counting one would make this guard fire on the
   * suite that proves Assets is correct, which is the opposite of what it is for.
   */
  it('is read by no other module in this application', () => {
    const root = join(process.cwd(), 'src');
    const consumers = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== 'assets')
      .filter((entry) =>
        readdirSync(join(root, entry.name))
          .filter((file) => file.endsWith('.ts') && !/\.(spec|test)\.ts$/.test(file))
          .some((file) =>
            readFileSync(join(root, entry.name, file), 'utf8').includes('@work/assets'),
          ),
      )
      .map((entry) => entry.name);

    expect(consumers).toEqual([]);
  });
});
