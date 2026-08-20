import { RecordingNotificationPort } from '@work/kernel';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { workflowModule } from './workflow-module.js';
import type { ApprovalDelivery } from './workflow-ports.js';
import { inMemoryWorkflowStores } from './in-memory-stores.js';
import {
  FakeDelegation,
  FakeMembershipStanding,
  FakeReminderRecipient,
  FakeReportingLine,
  FixedClock,
  NOW,
} from './workflow-test-harness.js';

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

const dependencies = {
  unitOfWork: {
    execute: <T>(work: (t: never) => Promise<T>): Promise<T> => work(undefined as never),
  },
  stores: inMemoryWorkflowStores(),
  delegation: new FakeDelegation(),
  membershipStanding: new FakeMembershipStanding(),

  reminderRecipient: new FakeReminderRecipient(),

  notifications: new RecordingNotificationPort(),
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
/**
 * One port's own source, with its prose removed.
 *
 * Read from the file rather than from a test double: a fake carries helpers a real adapter never
 * will, so its prototype would answer a question about the harness instead of about the contract.
 *
 * **Comments and string literals are stripped**, and that is load-bearing rather than tidy. These
 * assertions forbid the words a directory would arrive in — `page`, `search`, `list` — and a doc
 * comment explaining that a port has none of them contains every one. Scanning raw text would make
 * the honest explanation fail the assertion it is explaining.
 */
const codeOf = (file: string): string =>
  readFileSync(join(process.cwd(), 'src', 'application', file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""');

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
    // Twenty-four: seventeen from 16A, the three group commands and two group reads 16B added,
    // Phase 16D's one escalation command, and Phase 16E's one reminder command. Counted so a handler
    // nobody decided on fails here rather than shipping.
    //
    // **`workflow.remind-step` passes the forbidden-fragment scan above rather than being excused
    // from it**, which is the point worth keeping: it contains none of `sla`, `breach`, `schedule`,
    // `expire` or `notify`, because it schedules nothing, breaches nothing and delivers nothing. A
    // handler that *did* fire on elapsed time would have had to be named for what it does and would
    // have failed the scan.
    expect(registered).toHaveLength(24);
    expect(registered).toContain('workflow.escalate-branch');
    expect(registered).toContain('workflow.remind-step');
  });

  /**
   * Ten dependencies, and the list is the capability surface.
   *
   * The unit of work, the stores, Identity's delegation read, the permission checker, a clock, the
   * one outbound seam through which a terminal decision reaches the module that asked for it, one
   * reporting-line read since Phase 16C — and, since Phase 16D, one membership-standing read. A
   * and, since Phase 16E, one recipient read and one notification port. An eleventh would be the
   * beginning of a capability nobody approved, and the names below are the ones that would announce
   * it: a scheduler, a blob store, an index, a role directory, or any of the words that mean
   * *delivering* a notification rather than emitting the intent of one.
   *
   * **The count moved from seven to eight, and only because a decision moved it.** `membershipStanding`
   * is D-16D-11 and D-16D-12, approved 2026-08-18 and implemented in Checkpoint 8C. This assertion is
   * an exact set rather than a count precisely so that a port arriving *without* a decision fails
   * here — which is what it did when this one was added, and the reason the failure was the right
   * kind. The companion test below asserts the new port is present and one method wide, so widening
   * the set could not be mistaken for dropping the guarantee.
   *
   * **Neither `reportingLine` nor `membershipStanding` is a `directory`, and that word is still on the
   * forbidden list below.** A directory answers questions *about* people — who holds this role, who is
   * in this department, who reports to me. These answer one each: who is this one person's manager on
   * this one day, and may this one person act at all. It is the same distinction that let an approval
   * group exist in 16B, and it is asserted here rather than merely argued.
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
      'membershipStanding',
      'notifications',
      'permissions',
      'reminderRecipient',
      'reportingLine',
      'stores',
      'unitOfWork',
    ]);
    // `notification` left this list, and the replacement is the honest one.
    //
    // It was here to say Workflow tells nobody anything, which was true until D-16E-07 approved
    // notification *intent*. Keeping it would have meant either failing a decision the owner made or
    // renaming the port to evade a word — both worse than saying plainly what is still forbidden.
    // What the port must never become is *delivery*, so the fragments below are the ones that would
    // announce it: a broker, a queue, a channel, a transport, a delivery record, an outbox.
    for (const forbidden of [
      'job',
      'storage',
      'search',
      'directory',
      'outbox',
      'broker',
      'queue',
      'channel',
      'transport',
      'delivery',
      'email',
      'sms',
      'push',
    ]) {
      expect(Object.keys(dependencies).join(' ').toLowerCase()).not.toContain(forbidden);
    }
  });

  /**
   * And the approved eighth port is exactly as narrow as the decision that authorized it.
   *
   * The positive half of the change above. One method, and it takes **one membership identifier** —
   * no tenant, no page, no term, no filter and no list. A port that grew a second method, or a first
   * one taking a query, would be the member directory D-16D-16 refused, arriving through the seam
   * D-16D-11 opened for something much smaller.
   *
   * Asserted against the **port's own source** rather than against the test double implementing it:
   * a fake carries helpers a real adapter never will, so its prototype would answer a question about
   * the harness instead of about the contract.
   */
  it('exposes the approved membership-standing port and nothing wider', () => {
    const port = codeOf('workflow-membership-standing.ts');
    const declaration = port.slice(port.indexOf('interface MembershipStandingPort'));

    // One method, and its whole parameter list is one identifier.
    expect(declaration.match(/^\s{2}\w+\(/gm)).toStrictEqual(['  standing(']);
    expect(declaration).toContain('standing(membershipId: string): Promise<MembershipStanding>');

    // And nothing a directory would need, in the file that defines the seam.
    for (const wider of ['[]', 'page', 'size', 'term', 'filter', 'search', 'list', 'tenantId']) {
      expect([wider, port.toLowerCase().includes(wider.toLowerCase())]).toStrictEqual([
        wider,
        false,
      ]);
    }
  });

  /**
   * And Phase 16E's port is exactly as narrow as the one before it.
   *
   * The same assertion, for the same reason: `ReminderRecipientPort` exists to turn one membership
   * into one recipient, and a second method — or a first one taking a query — would be the member
   * directory arriving through a seam opened for something much smaller.
   */
  it('exposes the approved recipient port and nothing wider', () => {
    const port = codeOf('workflow-reminder-recipient.ts');
    const declaration = port.slice(port.indexOf('interface ReminderRecipientPort'));

    expect(declaration.match(/^\s{2}\w+\(/gm)).toStrictEqual(['  recipient(']);
    expect(declaration).toContain('recipient(membershipId: string): Promise<ReminderRecipient>');

    for (const wider of ['[]', 'page', 'size', 'term', 'filter', 'search', 'list', 'tenantId']) {
      expect([wider, port.toLowerCase().includes(wider.toLowerCase())]).toStrictEqual([
        wider,
        false,
      ]);
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
});
