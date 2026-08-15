import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { InProcessEventDispatcher } from '@work/kernel';
import { ALL_WORKFLOW_PERMISSIONS } from '@work/workflow';
import { PostgresUnitOfWork } from '@work/persistence';
import { Pool } from 'pg';

import { workflowModuleFor } from './workflow.composition.js';
import type { Asking } from '../payroll/asking.js';

/**
 * How Workflow is assembled in production, and the things about the assembly that break quietly.
 *
 * A composition root is the one file where a real dependency can be replaced by a convenient one
 * without any type complaining — an in-memory store satisfies `WorkflowStores`, and a delegation
 * port that always answers "yes" satisfies `DelegationPort`. Nothing downstream would notice; the
 * product would simply approve things nobody was entitled to approve. So the assembly is asserted
 * here, from two directions: what the composed module actually contains, and what its source
 * mentions.
 *
 * The grant audit lives here too. **One module, one query, one permission** is a claim about a file,
 * and the cheapest honest way to check it is to read the file and count.
 */

const sourceOf = (file: string): string =>
  readFileSync(join(process.cwd(), 'src', 'workflow', file), 'utf8');

/**
 * The same file with its comments removed.
 *
 * The audit below asks what the code *does*, and these files explain at length what they
 * deliberately do not do — "there is no `ApprovalPort` implementation here", "no `JobPort`", "no
 * notification port". Naming an absent capability in order to justify its absence is exactly the
 * documentation this phase is supposed to carry, so a scan that could not tell prose from code would
 * force those explanations out of the files that most need them.
 */
const codeOf = (file: string): string =>
  sourceOf(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const apiSourceOf = (...parts: readonly string[]): string =>
  readFileSync(join(process.cwd(), 'src', ...parts), 'utf8');

describe('workflow composition', () => {
  const composed = (): ReturnType<typeof workflowModuleFor> => {
    const pool = new Pool({ connectionString: 'postgresql://unused:unused@127.0.0.1:1/unused' });
    const asking: Asking = { ask: () => Promise.reject(new Error('not called')) };

    // Nothing connects: constructing the module registers handlers and touches no socket. The pool
    // exists because `PostgresUnitOfWork` takes one, and it is never used.
    return workflowModuleFor(new PostgresUnitOfWork(pool, new InProcessEventDispatcher()), asking, {
      holds: () => Promise.resolve(true),
    });
  };

  it('registers the whole application surface and nothing more', () => {
    const workflow = composed();

    expect(workflow.name).toBe('workflow');
    expect(workflow.commands ?? []).toHaveLength(9);
    expect(workflow.queries ?? []).toHaveLength(8);
    expect(workflow.permissions).toEqual(ALL_WORKFLOW_PERMISSIONS);
    expect(ALL_WORKFLOW_PERMISSIONS).toHaveLength(7);
  });

  /** Every handler declares one permission, and none of them is a wildcard or a prefix. */
  it('declares one explicit permission per handler', () => {
    const workflow = composed();
    const declared = [...(workflow.commands ?? []), ...(workflow.queries ?? [])].map(
      (handler) => handler.permission,
    );

    expect(declared).toHaveLength(17);
    for (const permission of declared) {
      expect(ALL_WORKFLOW_PERMISSIONS).toContain(permission);
      expect(permission).not.toContain('*');
      expect(permission.startsWith('workflow.')).toBe(true);
    }
  });

  /**
   * **The real stores and the real adapter, named in the composition and nowhere replaced.**
   *
   * `postgresWorkflowStores()` returns the whole `WorkflowStores` interface rather than a partial,
   * so a missing repository is a compile error — but nothing stops a composition from importing
   * `inMemoryWorkflowStores` instead, which is exactly the substitution this asserts against.
   */
  it('composes real repositories and the real delegation adapter', () => {
    const source = codeOf('workflow.composition.ts');

    expect(source).toContain('postgresWorkflowStores()');
    expect(source).toContain('new WorkflowDelegations(dispatcher)');
    expect(source).not.toContain('inMemory');
    expect(source).not.toContain('AutoApproving');
    expect(source).not.toContain('Recording');
  });

  /**
   * The adapter takes `Asking`, not the dispatcher.
   *
   * A parameter that could `send` would be authority Workflow has no use for in 16A: it writes
   * nothing outside itself until Checkpoint 7, and the type of this parameter is part of how that is
   * structurally true rather than merely intended.
   */
  it('gives the adapter a read-only capability', () => {
    const composition = codeOf('workflow.composition.ts');
    const adapter = codeOf('workflow-sources.ts');

    expect(composition).toContain('dispatcher: Asking');
    expect(composition).not.toContain('Dispatcher');
    expect(adapter).toContain('private readonly dispatcher: Asking');
    expect(adapter).not.toContain('.send(');
  });

  /**
   * **The exact grant set: one permission, in one grant, for one query.**
   *
   * Counted from the source rather than asserted as a sentence. A second `runWithServiceGrant`, a
   * second permission inside the existing one, a wildcard or a prefix all show up here.
   */
  it('holds exactly one cross-module grant, of exactly one permission', () => {
    const source = codeOf('workflow-sources.ts');
    const grants = source.match(/runWithServiceGrant\(/g) ?? [];
    const permits = source.match(/permits: \[[^\]]*\]/g) ?? [];

    expect(grants).toHaveLength(1);
    expect(permits).toEqual(['permits: [DELEGATION_READ]']);
    expect(source).toContain("const DELEGATION_READ = 'identity.delegation.read';");
    // No wildcard, no prefix, and no second permission constant to reach for.
    expect(source).not.toMatch(/'[a-z]+\.\*'/);
    expect(source).not.toMatch(/permits: \[[^\]]*,/);
  });

  /** One query, named in full, and no other module's contract mentioned anywhere. */
  it('consumes exactly one published contract', () => {
    const source = codeOf('workflow-sources.ts');
    // Distinct, because the name appears twice by design: once declaring the query's type and once
    // in the literal sent. Two occurrences of one name is the shape; two names would not be.
    const queries = [...new Set(source.match(/queryName: '[a-z.-]+'/g) ?? [])];

    expect(queries).toEqual(["queryName: 'identity.active-delegations-for'"]);
    expect(source).not.toContain('identity.list-memberships');
    expect(source).not.toContain('identity.search-members');
    expect(source).not.toContain('recruitment.');
    expect(source).not.toContain('employment.');
    expect(source).not.toContain('organization.');
  });

  /** And it is wired into the one composition root the product has, rather than a second one. */
  it('is registered in the API module registry', () => {
    const module = apiSourceOf('identity', 'identity.module.ts');

    expect(module).toContain(
      "import { workflowModuleFor } from '../workflow/workflow.composition.js'",
    );
    expect(module).toContain(
      'workflow: workflowModuleFor(unitOfWork, senders.payroll, permissions)',
    );
    expect(module).toContain('registry.register(permissionAware.workflow)');
  });

  /**
   * Nothing here anticipates Checkpoint 7.
   *
   * The write seam into an adopting module is the only place a Phase 16 defect could corrupt a
   * completed module, and a path to it that exists before the checkpoint meant to prove it is a path
   * that ships unproven.
   */
  it('implements no approval port and reaches no adopting module', () => {
    const files = ['workflow.composition.ts', 'workflow-sources.ts'];

    for (const file of files) {
      const source = codeOf(file);

      expect(source).not.toContain('ApprovalPort');
      expect(source).not.toContain('approval_id');
      expect(source).not.toContain('recruitmentModule');
      expect(source).not.toContain('JobPort');
      expect(source).not.toContain('NotificationPort');
      expect(source).not.toContain('StoragePort');
      expect(source).not.toContain('SearchPort');
    }
  });
});
