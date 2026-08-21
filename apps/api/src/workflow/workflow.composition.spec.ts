import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { InProcessEventDispatcher } from '@work/kernel';
import { ALL_WORKFLOW_PERMISSIONS, WorkflowPermissions } from '@work/workflow';
import { PostgresUnitOfWork } from '@work/persistence';
import { Pool } from 'pg';

import { workflowModuleFor } from './workflow.composition.js';
import type { Asking } from '../payroll/asking.js';
import type { Sending } from './sending.js';

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
    const sending: Sending = {
      ask: () => Promise.reject(new Error('not called')),
      send: () => Promise.reject(new Error('not called')),
    };

    // Nothing connects: constructing the module registers handlers and touches no socket. The pool
    // exists because `PostgresUnitOfWork` takes one, and it is never used.
    return workflowModuleFor(
      new PostgresUnitOfWork(pool, new InProcessEventDispatcher()),
      asking,
      sending,
      { holds: () => Promise.resolve(true) },
    );
  };

  it('registers the whole application surface and nothing more', () => {
    const workflow = composed();

    expect(workflow.name).toBe('workflow');
    // Nine and eight in 16A; twelve and ten after Phase 16B's three group commands and two group
    // reads; thirteen after Phase 16D's escalation command; **fourteen** since Phase 16E's reminder.
    //
    // **The fourteenth has no HTTP route, and never will.** It runs under a machine execution context
    // a job runner supplies, and an HTTP request produces a person's context, which the handler
    // refuses outright — so a route could only ever answer 422. This counts what is *composed*;
    // `workflow.routes.spec.ts` counts what is reachable over HTTP and names that one by hand. The
    // two numbers differing is the design rather than a gap.
    //
    // The eleventh read is that command's other half: `workflow.due-reminders`, the discovery the
    // runner makes before it can call anything (D-16E-14). It is unrouted for the same reason and
    // named in the same place, so both halves of the machine surface are counted here and enumerated
    // there.
    expect(workflow.commands ?? []).toHaveLength(14);
    expect(workflow.queries ?? []).toHaveLength(11);
    expect(workflow.permissions).toEqual(ALL_WORKFLOW_PERMISSIONS);
    expect(ALL_WORKFLOW_PERMISSIONS).toHaveLength(11);
  });

  /** Every handler declares one permission, and none of them is a wildcard or a prefix. */
  it('declares one explicit permission per handler', () => {
    const workflow = composed();
    const declared = [...(workflow.commands ?? []), ...(workflow.queries ?? [])].map(
      (handler) => handler.permission,
    );

    expect(declared).toHaveLength(25);
    // Twenty-five declarations over eleven permissions, so some are shared — and exactly one of them
    // is shared by the machine surface. `workflow.reminder.execute` is declared twice and only twice:
    // by the reminder command and by the discovery query that feeds it. Discovering the work and doing
    // it are one capability held by one principal; a third holder would be a grant somebody could hold
    // without the other, which is what this number is here to catch.
    expect(
      declared.filter((permission) => permission === WorkflowPermissions.reminderExecute),
    ).toHaveLength(2);
    for (const permission of declared) {
      expect(ALL_WORKFLOW_PERMISSIONS).toContain(permission);
      expect(permission).not.toContain('*');
      expect(permission.startsWith('workflow.')).toBe(true);
    }
  });

  /**
   * **The real stores and both real adapters, named in the composition and nowhere replaced.**
   *
   * `postgresWorkflowStores()` returns the whole `WorkflowStores` interface rather than a partial, so
   * a missing repository is a compile error — but nothing stops a composition from importing
   * `inMemoryWorkflowStores`, or from handing the module a decision port that always says yes. Both
   * substitutions would leave every type satisfied and the product approving things nobody decided.
   */
  it('composes real repositories and both real adapters', () => {
    const source = codeOf('workflow.composition.ts');

    expect(source).toContain('postgresWorkflowStores()');
    expect(source).toContain('new WorkflowDelegations(reader)');
    expect(source).toContain('new RecruitmentDecisions(writer)');
    expect(source).not.toContain('inMemory');
    expect(source).not.toContain('AutoApproving');
    // `Recording` left this list in Phase 16E **by authorization**, and the precedent is Performance's:
    // `RecordingNotificationPort` is what the kernel provides and what production has, because
    // **intent is a real record and delivery is a missing dependency** (D-16E-07, and D-21 before it).
    // It was forbidden here while Workflow notified nobody at all; now that it emits intent, keeping
    // it would forbid the correct adapter. What must never appear is something that *delivers* — and
    // the assertion below is the one that says so.
    expect(source).toContain('new WorkflowReminderRecipient(reader)');
    expect(source).toContain('RecordingNotificationPort');
    for (const delivery of [
      'Smtp',
      'Email',
      'Sms',
      'Push',
      'Broker',
      'Queue',
      'Outbox',
      'Twilio',
    ]) {
      expect([delivery, source.includes(delivery)]).toStrictEqual([delivery, false]);
    }
  });

  /**
   * **Two capabilities, and which adapter gets which is a type rather than a convention.**
   *
   * The delegation adapter reads Identity and takes `Asking`: reading a delegation register must
   * never be able to write to it, and there is no `send` on the object it holds. Only the adapter
   * that applies a terminal decision takes `Sending`. A single dispatcher parameter shared by both
   * would make "Workflow writes into exactly one place" a claim nobody could check.
   */
  it('separates the reading capability from the writing one', () => {
    const composition = codeOf('workflow.composition.ts');
    const delegations = codeOf('workflow-sources.ts');
    const decisions = codeOf('recruitment-decisions.ts');

    expect(composition).toContain('reader: Asking');
    expect(composition).toContain('writer: Sending');
    expect(composition).not.toContain('Dispatcher');

    expect(delegations).toContain('private readonly dispatcher: Asking');
    expect(delegations).not.toContain('.send(');

    expect(decisions).toContain('private readonly dispatcher: Sending');
  });

  /**
   * **The exact grant set: five permissions, in six grants, across three adapters.**
   *
   * It was three and three until Phase 16C. The reporting-line adapter added three grants of two
   * permissions — one Identity read used twice, at the two ends of the manager chain, and one
   * Employment read in the middle. Counted from source rather than asserted as a sentence, because a
   * seventh grant, a widened `permits`, a wildcard or a prefix is exactly the change that would pass
   * every behavioural test in this repository.
   *
   * **What is not here is the point.** `identity.membership.read` would have reached the requester's
   * employment through `identity.describe-member` — and handed the approvals engine the tenant's
   * member register to read one identifier. B-2 authorized a second narrow Identity query instead,
   * so both of Workflow's Identity grants stay employment-scoped, and the forbidden list below names
   * the register explicitly.
   */
  it('holds exactly six cross-module grants, of exactly five permissions', () => {
    const delegations = codeOf('workflow-sources.ts');
    const decisions = codeOf('recruitment-decisions.ts');
    const reporting = codeOf('workflow-reporting-line.ts');
    const all = `${delegations}\n${decisions}\n${reporting}`;
    const grants = all.match(/runWithServiceGrant\(/g) ?? [];
    const permits = all.match(/permits: \[[^\]]*\]/g) ?? [];

    expect(grants).toHaveLength(6);
    expect(permits).toEqual([
      'permits: [DELEGATION_READ]',
      'permits: [REQUISITION_READ]',
      'permits: [REQUISITION_APPROVE]',
      'permits: [EMPLOYMENT_LINK_READ]',
      'permits: [EMPLOYMENT_READ]',
      'permits: [EMPLOYMENT_LINK_READ]',
    ]);
    expect(delegations).toContain("const DELEGATION_READ = 'identity.delegation.read';");
    expect(decisions).toContain("const REQUISITION_READ = 'recruitment.requisition.read';");
    expect(decisions).toContain("const REQUISITION_APPROVE = 'recruitment.requisition.approve';");
    expect(reporting).toContain("const EMPLOYMENT_LINK_READ = 'identity.employment-link.read';");
    expect(reporting).toContain("const EMPLOYMENT_READ = 'employment.employment.read';");
    // No wildcard, no prefix, and no grant permitting two things at once.
    expect(all).not.toMatch(/'[a-z]+\.\*'/);
    expect(all).not.toMatch(/permits: \[[^\]]*,/);
    // And above all, not the member register.
    expect(all).not.toContain('identity.membership.read');
  });

  /** Six published contracts in total, each named in full, and nothing else reachable. */
  it('consumes exactly six published contracts', () => {
    const delegations = codeOf('workflow-sources.ts');
    const decisions = codeOf('recruitment-decisions.ts');
    const reporting = codeOf('workflow-reporting-line.ts');
    const names = (source: string): readonly string[] => [
      ...new Set(source.match(/(?:queryName|commandName): '[a-z.-]+'/g) ?? []),
    ];

    expect(names(delegations)).toEqual(["queryName: 'identity.active-delegations-for'"]);
    expect([...names(decisions)].sort()).toEqual([
      "commandName: 'recruitment.decide-requisition'",
      "queryName: 'recruitment.read-requisition'",
    ]);
    // Three, in the order the manager chain asks them, and no command anywhere: this adapter reads.
    expect(names(reporting)).toEqual([
      "queryName: 'identity.primary-employment-for-membership'",
      "queryName: 'employment.read-employment'",
      "queryName: 'identity.active-memberships-for-employment'",
    ]);
    // The broad reads that would answer the same questions less honestly. `employment.` left this
    // list in Phase 16C — the manager chain asks Employment one bounded question — and is replaced
    // by the reads that would make it a directory or a search.
    for (const forbidden of [
      'identity.list-memberships',
      'identity.search-members',
      'identity.describe-member',
      'recruitment.search-requisitions',
      'recruitment.search-candidates',
      'employment.search',
      'employment.export-workforce',
      'organization.',
    ]) {
      expect(`${delegations}\n${decisions}\n${reporting}`).not.toContain(forbidden);
    }
  });

  /** And it is wired into the one composition root the product has, rather than a second one. */
  it('is registered in the API module registry', () => {
    const module = apiSourceOf('identity', 'identity.module.ts');

    expect(module).toContain(
      "import { workflowModuleFor } from '../workflow/workflow.composition.js'",
    );
    expect(module).toContain('senders.recruitment, permissions)');
    expect(module).toContain('registry.register(permissionAware.workflow)');
  });

  /**
   * **Two seams, pointing in opposite directions, and neither is the other.**
   *
   * `WorkflowApprovals` implements the kernel's `ApprovalPort` — a business module asking Workflow to
   * route a decision. `RecruitmentDecisions` implements Workflow's own `BusinessDecisionPort` — a
   * decided approval reaching the module that asked. The kernel interface has no method for the
   * second, which is why there are two files and not one.
   */
  it('implements the kernel port inbound and Workflow’s own port outbound', () => {
    const inbound = codeOf('workflow-approvals.ts');
    const outbound = codeOf('recruitment-decisions.ts');

    expect(inbound).toContain('implements ApprovalPort');
    expect(inbound).toMatch(/public async request\(/);
    expect(inbound).toMatch(/public async status\(/);
    expect(inbound).toMatch(/public async cancel\(/);

    expect(outbound).toContain('implements BusinessDecisionPort');
    expect(outbound).not.toContain('implements ApprovalPort');
  });

  /**
   * The kernel's port is untouched.
   *
   * D-8 approved implementing it as written. Adding an outbound method to it would have changed a
   * contract five completed modules already depend on, which is why the return path is Workflow's own
   * port instead.
   */
  it('leaves the kernel approval port exactly as it was', () => {
    const port = readFileSync(
      join(process.cwd(), '..', '..', 'packages', 'kernel', 'src', 'ports', 'approval.ts'),
      'utf8',
    );
    const methods = port
      .slice(port.indexOf('export interface ApprovalPort'))
      .split('}')[0]
      ?.match(/^\s{2}(\w+)\(/gm)
      ?.map((line) => line.trim().replace('(', ''));

    expect(methods).toEqual(['request', 'status', 'cancel']);
  });

  /**
   * Nothing in this folder reaches another module's internals, and nothing acquires a 16B capability.
   *
   * The write seam is the one place Workflow can corrupt a completed module, so the audit is
   * structural: no Prisma, no repository, no SQL, no entity, and none of the machinery this phase
   * refused. `JobPort` in particular stays forbidden — Workflow schedules nothing, and the runner
   * that will one day invoke the reminder belongs on the other side of this boundary (D-16E-03).
   */
  it('reaches Recruitment only through its published contracts', () => {
    for (const file of [
      'workflow.composition.ts',
      'workflow-sources.ts',
      'recruitment-decisions.ts',
      'workflow-approvals.ts',
    ]) {
      const source = codeOf(file);

      for (const forbidden of [
        'PrismaClient',
        'prisma',
        'postgresRecruitmentStores',
        'Repository',
        'select ',
        'insert into',
        'JobPort',
        // `NotificationPort` left this list in Phase 16E, by the same authorization as `Recording`
        // above: the composition now wires one, because Workflow emits intent (D-16E-07). Delivery is
        // what must never appear, and the forbidden words for it are asserted in the composition test
        // above rather than duplicated here.
        'StoragePort',
        'SearchPort',
        'outbox',
        'setTimeout',
        'setInterval',
      ]) {
        expect([file, source.includes(forbidden)]).toEqual([file, false]);
      }
    }
  });
});
