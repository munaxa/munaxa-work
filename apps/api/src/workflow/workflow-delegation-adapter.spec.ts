import { describe, expect, it } from 'vitest';
import {
  err,
  runInContext,
  success,
  uuidV7,
  type HandlerFailure,
  type Query,
  type Result,
} from '@work/kernel';
import type { DelegationView } from '@work/identity';

import { WorkflowDelegations } from './workflow-sources.js';
import {
  APPROVER,
  DECIDE_SCOPE,
  DEPUTY,
  NOW,
  OUTSIDER,
  TENANT_A,
} from './workflow-cross-module-harness.js';
import type { Asking } from '../payroll/asking.js';

/**
 * The delegation adapter on its own, against answers Identity cannot actually give.
 *
 * The cross-module suite beside this one runs the adapter against the **real** Identity module and
 * the real `delegation` table, which is the evidence that matters for what the product does. It
 * cannot, however, produce the answers this file is about: a module that is unreachable, a grant
 * that is refused, a contract that answers with something that is not a list. Those are the failure
 * modes worth being certain of, because the dependency being asked is the one that says *who may
 * decide* — and the direction it fails in is the difference between an approval nobody was entitled
 * to make and an approval that simply does not happen.
 *
 * **Everything here fails closed.** No branch below produces a grant: an answer Identity did not
 * give either raises or comes back empty, and both end with the decision refused and nothing
 * written. Nothing in this module approves anything because Identity could not be reached.
 */

interface Asked {
  readonly queries: Query[];
}

/** An `Asking` that records what it was sent and answers however the test says. */
const answering = (answer: () => Promise<Result<unknown, HandlerFailure>>): Asking & Asked => {
  const queries: Query[] = [];

  return {
    queries,
    ask: <TResult>(query: Query): Promise<Result<TResult, HandlerFailure>> => {
      queries.push(query);
      return answer() as Promise<Result<TResult, HandlerFailure>>;
    },
  };
};

const aDelegation = (overrides: Partial<DelegationView> = {}): DelegationView => ({
  id: uuidV7(),
  delegatorMembershipId: APPROVER,
  delegateMembershipId: DEPUTY,
  scope: DECIDE_SCOPE,
  effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
  effectiveTo: new Date('2026-09-01T00:00:00.000Z'),
  status: 'active',
  reason: 'Annual leave',
  ...overrides,
});

const asDeputy = <TResult>(work: () => Promise<TResult>): Promise<TResult> =>
  runInContext(
    {
      tenantId: TENANT_A,
      correlationId: uuidV7(),
      actor: 'user:workflow-deputy',
      membershipId: DEPUTY,
    },
    work,
  );

describe('the Identity delegation adapter', () => {
  it('asks Identity for the caller’s own delegations, at the stated instant', async () => {
    const dispatcher = answering(() => Promise.resolve(success([aDelegation()])));
    const grants = await asDeputy(() => new WorkflowDelegations(dispatcher).activeFor(DEPUTY, NOW));

    expect(dispatcher.queries).toEqual([
      {
        queryName: 'identity.active-delegations-for',
        delegateMembershipId: DEPUTY,
        atInstant: NOW,
      },
    ]);
    expect(grants).toEqual([
      { delegatorMembershipId: APPROVER, delegateMembershipId: DEPUTY, scope: DECIDE_SCOPE },
    ]);
  });

  /**
   * The view is mapped down, not passed through.
   *
   * A period, a status and the reason somebody typed when granting the delegation all stay in
   * Identity. Carrying them would let something downstream start deciding whether a delegation is in
   * force from a `status` — a question Identity has already answered, against the instant, and whose
   * stored `status` is only as fresh as the job that last updated it. There is no such job.
   */
  it('keeps three fields and discards the rest', async () => {
    const dispatcher = answering(() => Promise.resolve(success([aDelegation()])));
    const [grant] = await asDeputy(() =>
      new WorkflowDelegations(dispatcher).activeFor(DEPUTY, NOW),
    );

    expect(Object.keys(grant ?? {}).sort()).toEqual([
      'delegateMembershipId',
      'delegatorMembershipId',
      'scope',
    ]);
  });

  /** An empty answer is an empty answer: nobody is acting for anybody. */
  it('returns nothing when Identity knows of no delegation', async () => {
    const dispatcher = answering(() => Promise.resolve(success([])));

    await expect(
      asDeputy(() => new WorkflowDelegations(dispatcher).activeFor(DEPUTY, NOW)),
    ).resolves.toEqual([]);
  });

  describe('failing closed, and loudly', () => {
    /**
     * Identity unreachable — the case that matters most.
     *
     * The failure travels. It is **not** turned into an empty list, because an empty list means
     * "nobody has delegated to you", which the decision use case renders as "this step was not
     * assigned to you" — a calm, wrong sentence shown to a deputy who is in fact entitled to decide,
     * with nothing anywhere recording that a dependency was down. Raising refuses the decision just
     * as firmly (the transaction rolls back and nothing is recorded) and refuses it as the fault it
     * is.
     */
    it('raises when the query throws', async () => {
      const dispatcher = answering(() => Promise.reject(new Error('identity is unreachable')));

      await expect(
        asDeputy(() => new WorkflowDelegations(dispatcher).activeFor(DEPUTY, NOW)),
      ).rejects.toThrow('identity is unreachable');
    });

    it('raises when Identity refuses the grant', async () => {
      const dispatcher = answering(() =>
        Promise.resolve(err({ kind: 'forbidden', permission: 'identity.delegation.read' })),
      );

      await expect(
        asDeputy(() => new WorkflowDelegations(dispatcher).activeFor(DEPUTY, NOW)),
      ).rejects.toThrow(/could not answer active-delegations-for: forbidden/);
    });

    it('raises when Identity answers not found', async () => {
      const dispatcher = answering(() =>
        Promise.resolve(err({ kind: 'not_found', resource: 'membership' })),
      );

      await expect(
        asDeputy(() => new WorkflowDelegations(dispatcher).activeFor(DEPUTY, NOW)),
      ).rejects.toThrow(/could not answer active-delegations-for: not_found/);
    });

    /** And an answer that is not a list at all, which no version of the contract promises. */
    it('raises when the answer is malformed', async () => {
      for (const malformed of [undefined, null, {}, 'delegations', 42]) {
        const dispatcher = answering(() => Promise.resolve(success(malformed)));

        await expect(
          asDeputy(() => new WorkflowDelegations(dispatcher).activeFor(DEPUTY, NOW)),
        ).rejects.toThrow(/not a list/);
      }
    });

    /**
     * **A raised failure never becomes an approval.**
     *
     * Stated as its own assertion because it is the one property the whole file exists for: there is
     * no path through this adapter on which a dependency failure produces a grant.
     */
    it('never produces a grant from a failure', async () => {
      const failures = [
        (): Promise<Result<unknown, HandlerFailure>> => Promise.reject(new Error('down')),
        (): Promise<Result<unknown, HandlerFailure>> =>
          Promise.resolve(err({ kind: 'forbidden', permission: 'identity.delegation.read' })),
        (): Promise<Result<unknown, HandlerFailure>> => Promise.resolve(success(null)),
      ];

      for (const failure of failures) {
        const outcome = await asDeputy(() =>
          new WorkflowDelegations(answering(failure))
            .activeFor(DEPUTY, NOW)
            .then((grants) => ({ grants }))
            .catch(() => ({ grants: [] as const })),
        );

        expect(outcome.grants).toEqual([]);
      }
    });
  });

  describe('identity comes from the request and from nowhere else', () => {
    /**
     * **No membership on the request, and Identity is not asked at all.**
     *
     * A missing membership is not "everybody", not "all pending approvals" and not an anonymous
     * authority. A reconciliation command, a migration and a hand-built context name no member; the
     * honest answer for each of them is that nobody is acting for anybody.
     */
    it('asks nothing when the request carries no membership', async () => {
      const dispatcher = answering(() => Promise.resolve(success([aDelegation()])));
      const grants = await runInContext(
        { tenantId: TENANT_A, correlationId: uuidV7(), actor: 'user:migration' },
        () => new WorkflowDelegations(dispatcher).activeFor(DEPUTY, NOW),
      );

      expect(grants).toEqual([]);
      expect(dispatcher.queries).toEqual([]);
    });

    it('asks nothing outside a tenant context', async () => {
      const dispatcher = answering(() => Promise.resolve(success([aDelegation()])));
      const grants = await new WorkflowDelegations(dispatcher).activeFor(DEPUTY, NOW);

      expect(grants).toEqual([]);
      expect(dispatcher.queries).toEqual([]);
    });

    /**
     * **A caller cannot ask about somebody else's delegations.**
     *
     * The one caller in the application passes the caller's own membership. A future one that passed
     * another person's would be asking "who is *that person* acting for" — a different and much
     * broader question than the grant was approved for — and it is refused here rather than trusted
     * not to happen.
     */
    it('asks nothing when the argument names somebody other than the caller', async () => {
      const dispatcher = answering(() => Promise.resolve(success([aDelegation()])));
      const grants = await asDeputy(() =>
        new WorkflowDelegations(dispatcher).activeFor(OUTSIDER, NOW),
      );

      expect(grants).toEqual([]);
      expect(dispatcher.queries).toEqual([]);
    });
  });
});
