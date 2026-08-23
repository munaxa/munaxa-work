import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { InProcessEventDispatcher } from '@work/kernel';
import { ALL_RELATIONS_PERMISSIONS } from '@work/relations';
import { PostgresUnitOfWork } from '@work/persistence';
import { Pool } from 'pg';

import { relationsModuleFor } from './relations.composition.js';

/**
 * How Employee Relations is assembled in production, and the things about the assembly that break
 * quietly.
 *
 * A composition root is the one file where a real dependency can be replaced by a convenient one
 * without any type complaining — an in-memory store satisfies `RelationsStores`, and an employment
 * directory that always answers "yes" satisfies `EmploymentDirectoryPort`. Nothing downstream would
 * notice; the product would simply file disciplinary records against employments that do not exist.
 * So the assembly is asserted here, from two directions: what the composed module actually contains,
 * and what its source mentions.
 */

const sourceOf = (file: string): string =>
  readFileSync(join(process.cwd(), 'src', 'relations', file), 'utf8');

/**
 * The same file with its comments removed.
 *
 * The audit below asks what the code *does*, and these files explain at length what they
 * deliberately do not do — "there is no storage adapter", "no `JobPort`", "no notification port".
 * Naming an absent capability in order to justify its absence is exactly the documentation this
 * phase is supposed to carry, so a scan that could not tell prose from code would force those
 * explanations out of the files that most need them.
 */
const codeOf = (file: string): string =>
  sourceOf(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('relations composition', () => {
  const composed = (): ReturnType<typeof relationsModuleFor> => {
    const pool = new Pool({ connectionString: 'postgresql://unused:unused@127.0.0.1:1/unused' });

    // Nothing connects: constructing the module registers handlers and touches no socket. The pool
    // exists because `PostgresUnitOfWork` takes one, and it is never used.
    return relationsModuleFor(new PostgresUnitOfWork(pool, new InProcessEventDispatcher()), {
      ask: () => Promise.reject(new Error('not called')),
    });
  };

  it('registers the whole application surface and nothing more', () => {
    const relations = composed();

    expect(relations.name).toBe('relations');
    // Three and three, in Checkpoint 1: define and amend a catalogue entry, record a violation; list
    // the catalogue, read one violation, list one employment's. Every later capability —
    // investigations, actions, warnings, grievances, appeals — arrives with the checkpoint that
    // builds it, so these numbers moving is a scope change rather than a detail.
    expect(relations.commands ?? []).toHaveLength(3);
    expect(relations.queries ?? []).toHaveLength(3);
    expect(relations.permissions).toEqual(ALL_RELATIONS_PERMISSIONS);
    expect(ALL_RELATIONS_PERMISSIONS).toHaveLength(4);
  });

  /** Every handler declares one permission, and none of them is a wildcard or a prefix. */
  it('declares one explicit permission per handler', () => {
    const relations = composed();
    const declared = [...(relations.commands ?? []), ...(relations.queries ?? [])].map(
      (handler) => handler.permission,
    );

    expect(declared).toHaveLength(6);
    for (const permission of declared) {
      expect(ALL_RELATIONS_PERMISSIONS).toContain(permission);
      expect(permission).not.toContain('*');
      expect(permission.startsWith('relations.')).toBe(true);
    }
  });

  /**
   * **AD-007 asserted against every other module's vocabulary.**
   *
   * "Access is restricted independently of ordinary employee access" is a claim about permissions
   * nobody holds. The cheapest honest check is that no `relations` handler declares a permission
   * belonging to any other module — so no existing HR grant can open a disciplinary record by
   * accident, today or after somebody adds a handler.
   */
  it('declares no permission belonging to any other module', () => {
    const relations = composed();
    const declared = [...(relations.commands ?? []), ...(relations.queries ?? [])].map(
      (handler) => handler.permission,
    );

    for (const permission of declared) {
      expect(permission.startsWith('relations.')).toBe(true);
    }
    for (const foreign of [
      'employee.read',
      'employment.read',
      'people.read',
      'document.read',
      'workflow.instance.read',
      'payroll.run.manage',
    ]) {
      expect(declared).not.toContain(foreign);
    }
  });

  /**
   * **The real stores and the real employment adapter, named in the composition and nowhere
   * replaced.**
   *
   * `postgresRelationsStores()` returns the whole `RelationsStores` interface rather than a partial,
   * so a missing repository is a compile error — but nothing stops a composition from importing
   * `inMemoryRelationsStores`, or from handing the module a directory that always says yes. Either
   * substitution would leave every type satisfied and the product filing disciplinary records
   * against employments nobody has.
   */
  it('composes real repositories and the real employment adapter', () => {
    const source = codeOf('relations.composition.ts');

    expect(source).toContain('postgresRelationsStores()');
    expect(source).toContain('new RelationsEmploymentDirectory(dispatcher)');
    expect(source).not.toContain('inMemory');
    expect(source).not.toContain('AlwaysExists');
  });

  /**
   * **Nothing scheduled, nothing delivered, nothing stored.**
   *
   * Each of these would be a capability nobody approved, wired in a file where a single line is
   * enough to do it. The composition is where they would appear first.
   */
  it.each([
    'JobPort',
    'Scheduler',
    'cron',
    'setInterval',
    'Notification',
    'Smtp',
    'Email',
    'Sms',
    'Storage',
    'S3',
    'ApprovalPort',
  ])('wires no %s', (forbidden) => {
    const source = codeOf('relations.composition.ts');

    expect([forbidden, source.includes(forbidden)]).toStrictEqual([forbidden, false]);
  });

  /**
   * The cross-module read goes through a **bounded service grant**, not a raw dispatch.
   *
   * ADR-0043: a module reading another module's data does it under a named, audited grant that
   * permits exactly one permission for exactly one operation. Without it, Relations would be reading
   * Employment on whatever the *caller* happens to hold.
   */
  it('reads Employment under a bounded service grant naming one permission', () => {
    const source = codeOf('relations-sources.ts');

    expect(source).toContain('runWithServiceGrant');
    expect(source).toContain("module: 'relations'");
    expect(source).toContain('permits: [EMPLOYMENT_READ]');
    // One published read, and no second one smuggled alongside it.
    expect(source).toContain("queryName: 'employment.read-employment'");
    expect(source).not.toContain('people.');
    expect(source).not.toContain('employment.search');
  });

  /**
   * The adapter answers a boolean and carries nothing back.
   *
   * A port that returned the employment would put a person's employment record inside a
   * disciplinary module, which is the directory AD-001 exists to prevent.
   */
  it('returns only whether the employment exists', () => {
    const source = codeOf('relations-sources.ts');

    expect(source).toContain('Promise<boolean>');
    expect(source).toContain('return found.ok');
    for (const leaked of ['name', 'status', 'personId', 'grade', 'manager']) {
      expect([leaked, source.includes(`${leaked}:`)]).toStrictEqual([leaked, false]);
    }
  });
});
