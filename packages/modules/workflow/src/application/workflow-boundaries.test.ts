import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { workflowModule } from './workflow-module.js';
import type { ApprovalDelivery } from './workflow-ports.js';
import { inMemoryWorkflowStores } from './in-memory-stores.js';
import { ALL_WORKFLOW_PERMISSIONS, DELEGABLE_SCOPES } from './workflow-permissions.js';
import { FakeDelegation, FakeReportingLine, FixedClock, NOW } from './workflow-test-harness.js';

/**
 * What the application layer deliberately does not contain, asserted three ways.
 *
 * **By registration**, which is the strongest: a capability that is not a registered handler cannot
 * be reached by anybody, whatever the source says. The command and query names are read out of the
 * module itself rather than typed here again.
 *
 * **By dependency**, which is nearly as strong: a capability with no port behind it has nothing to
 * call. `WorkflowDependencies` is seven fields, and the audit asserts the shape rather than trusting
 * that nobody added an eighth.
 *
 * **By source**, with comments and string literals stripped. This is the weakest of the three and it
 * is here for the cases the other two miss — a helper that computes a due date, say, reachable from
 * a handler that looks innocent. It has to strip prose because `workflow-permissions.ts` names
 * `role`, `group` and `manager` in order to explain why none exists, and `workflow-ports.ts` names
 * `JobPort` to say there is none. Prose is not implementation.
 */

const APPLICATION = join(process.cwd(), 'src', 'application');

/** Source with block comments, line comments and string literals removed. */
const codeOf = (file: string): string =>
  readFileSync(join(APPLICATION, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');

const production = readdirSync(APPLICATION).filter(
  (file) =>
    file.endsWith('.ts') &&
    !file.endsWith('.test.ts') &&
    !file.includes('test-harness') &&
    !file.includes('scenarios'),
);
const code = production.map((file) => codeOf(file)).join('\n');

const dependencies = {
  unitOfWork: {
    execute: <T>(work: (t: never) => Promise<T>): Promise<T> => work(undefined as never),
  },
  stores: inMemoryWorkflowStores(),
  delegation: new FakeDelegation(),
  businessDecision: {
    apply: (): Promise<ApprovalDelivery> => Promise.resolve({ kind: 'not-adopted' }),
  },
  permissions: { holds: () => Promise.resolve(true) },
  clock: new FixedClock(NOW),
  reportingLine: new FakeReportingLine(),
};
const module = workflowModule(dependencies);
const registered = [
  ...(module.commands ?? []).map((handler) => handler.commandName),
  ...(module.queries ?? []).map((handler) => handler.queryName),
];

/**
 * The boundary has now moved twice, both times **by authorization**, and these rows moved with it.
 *
 * 16B built tallies, parallel branches, conditions and groups. 16C built the manager approver and the
 * service-level target. What remains deferred is everything that needs something to run when nobody
 * is asking — escalation, expiry, notification — plus the two capabilities that need facts this
 * product does not hold: a role directory and a business-day calendar. The fragments below are what
 * each would be written in. Rewritten rather than deleted, because a removed assertion is a removed
 * guarantee, and the complement is asserted too so a loosened row cannot pass for a built one.
 *
 * `group` left the list in 16B — Workflow owns an explicit list of memberships. `manager` is not on
 * it either, in the *handler* sense: there is no manager command and no manager query. The manager is
 * resolved inside `start-instance` and appears as an approver, which is why the registration
 * assertion below still forbids the word.
 */
describe('nothing deferred beyond Phase 16C is reachable', () => {
  it('registers no handler for any of it', () => {
    const deferred = [
      // `escalat` gave way to the automatic half when Phase 16D registered
      // `workflow.escalate-branch`, a human's command. What must never appear is a handler that
      // *fires* one, and no elapsed time can reach any name in this list.
      'auto-escalat',
      'escalate-after',
      'sweep',
      'sla',
      'breach',
      'schedule',
      'expire',
      'role',
      'manager',
      'team',
      'notify',
      'notification',
      'analytic',
      'external',
    ];
    const offending = registered.filter((name) =>
      deferred.some((fragment) => name.toLowerCase().includes(fragment)),
    );

    expect(offending).toStrictEqual([]);
    // Twenty-three: seventeen from 16A, the three group commands and two group reads 16B added, and
    // Phase 16D's one escalation command. Counted so a handler nobody decided on fails here rather
    // than shipping.
    expect(registered).toHaveLength(23);
    expect(registered).toContain('workflow.escalate-branch');
  });

  /**
   * Seven dependencies, and the list is the capability surface.
   *
   * The unit of work, the stores, Identity's delegation read, the permission checker, a clock, the
   * one outbound seam through which a terminal decision reaches the module that asked for it — and,
   * since Phase 16C, one reporting-line read. An eighth would be the beginning of a capability this
   * phase refuses, and the names below are the ones that would announce it: a scheduler, a notifier,
   * a blob store, an index, a role directory.
   *
   * **`reportingLine` is not `directory`, and that word is still on the forbidden list below.** A
   * directory answers questions *about* people — who holds this role, who is in this department, who
   * reports to me. This port answers one: who is this one person's manager, on this one day. It is
   * the same distinction that let an approval group exist in 16B, and it is asserted here rather than
   * merely argued.
   *
   * `businessDecision` is checked by name rather than by pattern because "approval" appears in it
   * only in the honest sense — it carries an approval that has already been decided — while the
   * forbidden list is about capabilities Workflow must not acquire.
   */
  it('offers no port through which any of it could be called', () => {
    expect(Object.keys(dependencies).sort()).toStrictEqual([
      'businessDecision',
      'clock',
      'delegation',
      'permissions',
      'reportingLine',
      'stores',
      'unitOfWork',
    ]);
    for (const forbidden of ['job', 'notification', 'storage', 'search', 'directory', 'outbox']) {
      expect(Object.keys(dependencies).join(' ').toLowerCase()).not.toContain(forbidden);
    }
  });

  /**
   * And the outbound seam is one method wide.
   *
   * The prohibition it carries is structural rather than documentary: a port with `send`, a command
   * name or a module name on it would be a generic dispatcher wearing a narrow name, and every
   * subsequent cross-module capability would arrive through it without another decision.
   */
  it('gives the outbound decision seam exactly one method and no dispatcher', () => {
    const port = dependencies.businessDecision;
    const prototype: unknown = Object.getPrototypeOf(port);
    // A literal's prototype is `Object.prototype`, whose members are not this port's surface; a
    // class instance's is the class, whose members are.
    const declared =
      prototype === Object.prototype || prototype === null
        ? []
        : Object.getOwnPropertyNames(prototype);
    const methods = [...new Set([...Object.keys(port), ...declared])].filter(
      (name) => name !== 'constructor',
    );

    expect(methods).toStrictEqual(['apply']);
    for (const forbidden of ['send', 'ask', 'dispatch', 'publish', 'emit', 'execute']) {
      expect(methods).not.toContain(forbidden);
    }
  });

  /**
   * The row that moved in Phase 16C, and it moved **by authorization**.
   *
   * `dueAt` and `managerOf` left this list because D-16C-04 authorized the manager approver and
   * D-16C-05 the service-level target. They are asserted *present* below rather than merely dropped
   * from here, because a fragment silently removed from a forbidden list is indistinguishable from a
   * capability quietly abandoned.
   *
   * Everything still here is still absent, and each for its own reason. **`escalat`** and
   * **`breach`** need something that writes when nobody is asking. **`businessDay`** and
   * **`workingDay`** need a calendar Workflow does not hold and declined to take a dependency on.
   * **`roleId`** and **`reportsTo`** are the two shapes a directory would arrive in — the first a
   * role engine, the second the chain rather than one level of it. **`notify`** is Phase 17's.
   * **`setTimeout`**, **`setInterval`** and **`cron`** are the three ways a timer gets into a process
   * that has none.
   */
  it('has no code that escalates, expires, schedules or consults a calendar', () => {
    const fragments = [
      // See the handler list above: the human command is built, and the thing that would fire one is
      // not. `escalateAfter` and a sweep are what an automatic escalation would be written in.
      'escalateAfter',
      'autoEscalat',
      'escalationTimer',
      'slaHours',
      'businessDay',
      'workingDay',
      'breach',
      'expiresAt',
      'roleId',
      'reportsTo',
      'notify',
      'setTimeout',
      'setInterval',
      'cron',
    ];
    const present = fragments.filter((fragment) => new RegExp(fragment, 'i').test(code));

    expect(present).toStrictEqual([]);
  });

  /**
   * And the complement: what 16C and 16D *did* build is in the source, not only in prose.
   *
   * Without this, the edits above would read exactly like deletions — and a boundary suite that only
   * ever loosens is a suite that stopped meaning anything. `escalateBranch` is 16D's, and it is here
   * because a human command that adds an approver was authorized; nothing above it fires one.
   */
  it('does compute a due date, resolve one manager, and escalate on request', () => {
    for (const fragment of [
      'dueAt',
      'managerOf',
      'serviceLevelState',
      'resolutionDateOf',
      'escalateBranch',
      'escalationHistory',
    ]) {
      expect([fragment, new RegExp(fragment).test(code)]).toStrictEqual([fragment, true]);
    }
  });

  it('names those capabilities in its prose, which is where they belong', () => {
    // The complement of the assertion above, and the reason it had to strip comments. If this fails,
    // the module stopped explaining its own boundaries.
    const permissions = readFileSync(join(APPLICATION, 'workflow-permissions.ts'), 'utf8');
    const ports = readFileSync(join(APPLICATION, 'workflow-ports.ts'), 'utf8');

    for (const word of ['manager', 'read-team']) expect(permissions).toContain(word);
    for (const word of ['JobPort', 'role', 'notification']) expect(ports).toContain(word);
  });
});

describe('the boundaries this module keeps', () => {
  it('reads nothing from a business module', () => {
    // AD-001. The one cross-module read is Identity's delegation register, and there is no other
    // port, no other adapter and no other module named in the code.
    for (const business of [
      'recruitment',
      'requisition',
      'leave',
      'payroll',
      'attendance',
      'compensation',
      'employment',
      'organization',
      'performance',
      'learning',
      'career',
    ]) {
      expect(new RegExp(`\\b${business}`, 'i').test(code)).toBe(false);
    }
  });

  it('implements no ApprovalPort adapter and calls no adopting module', () => {
    // Checkpoint 7 owns the seam. What exists here is a *query* published in the port's shape, which
    // is a view — not an implementation, and not wired to anything.
    expect(code).not.toContain('implements ApprovalPort');
    expect(code).not.toContain('ApprovalPort');
    expect(registered).toContain('workflow.read-approval-status');
  });

  it('owns no delegation of its own', () => {
    // Identity's (AD-010). One read, no store, no aggregate, no expiry.
    expect(Object.keys(inMemoryWorkflowStores()).sort()).toStrictEqual([
      'decisions',
      'definitions',
      'groups',
      'history',
      'instances',
      'steps',
      'versions',
    ]);
    expect(code).not.toContain('delegationStore');
    expect(code).not.toContain('expireDelegation');
  });

  it('honours a delegation scope rather than accepting any delegation at all', () => {
    // A delegation granted for something else is not a delegation for this. The scope key is the
    // module's own permission name, which is what Identity's opaque `scope` is designed for.
    expect([...DELEGABLE_SCOPES]).toStrictEqual(['workflow.approval.decide', '*']);
  });

  it('declares no permission for a capability it does not have', () => {
    // `group` is no longer among them: Workflow owns an explicit list of memberships, and the two
    // permissions that read and edit one are routed to real handlers. `role`, `manager` and `team`
    // still are — each needs a directory or an employment resolution this repository does not have.
    expect(
      [...ALL_WORKFLOW_PERMISSIONS].filter((permission) => /team|manager|role/i.test(permission)),
    ).toStrictEqual([]);
    // Every declared permission is routed — unlike every other module's `read-own`.
    const declared = new Set([
      ...(module.commands ?? []).map((handler) => handler.permission),
      ...(module.queries ?? []).map((handler) => handler.permission),
    ]);

    expect(
      [...ALL_WORKFLOW_PERMISSIONS].filter((permission) => !declared.has(permission)),
    ).toStrictEqual([]);
  });

  it('exposes no query that takes an approver identifier from the caller', () => {
    // The queue's control is an absence. If somebody adds a filter, this fails.
    const queries = codeOf('approval-queries.ts');

    expect(queries).not.toContain('approverMembershipId?');
    expect(queries).not.toContain('membershipId?');
    expect(queries).toContain('currentMembership()');
  });
});
