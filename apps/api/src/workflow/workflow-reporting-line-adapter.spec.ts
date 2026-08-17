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
import type { EmploymentLinkView, TenantMembershipView } from '@work/identity';
import type { EmploymentSnapshot } from '@work/employment';
import type { ManagerResolution } from '@work/workflow';

import { WorkflowReportingLine } from './workflow-reporting-line.js';
import type { Asking } from '../payroll/asking.js';

/**
 * The reporting-line adapter on its own, against answers the real modules cannot easily be made to
 * give.
 *
 * The cross-module suite beside this one runs it against the **real** Identity module and the real
 * tables, which is the evidence that matters for what the product does. What that cannot produce is
 * the shape this file exists for: a module that is unreachable, a query that is refused, an
 * employment held by two people. Those are the cases where the direction of failure decides whether
 * an approval routes to the wrong person or does not route at all.
 *
 * **Two things are asserted throughout and they are the point of the file.** What the adapter
 * *asked* — how many questions, in what order, with what arguments — and what it did with the
 * answer. A suite that only checked the return value would not notice a fourth read, a chain
 * followed one level too far, or a business refusal manufactured out of an outage.
 */

const REQUESTER = uuidV7();
const MANAGER = uuidV7();
const SECOND_HOLDER = uuidV7();
const EMPLOYMENT = uuidV7();
const MANAGER_EMPLOYMENT = uuidV7();

const AS_OF = '2026-08-14';

interface Asked {
  readonly queries: Query[];
}

type Answer = () => Promise<Result<unknown, HandlerFailure>>;
type Answers = ReadonlyMap<string, Answer>;

/**
 * An `Asking` that records what it was sent and answers per query name.
 *
 * A `Map` rather than an object literal because query names carry dots, and a literal keyed by them
 * is the one shape this repository's naming rules refuse — for the good reason that a dotted key in
 * an object reads like a nested path.
 *
 * **An unarranged query raises.** A double that answered `undefined` for a question the adapter was
 * not supposed to ask would let a fourth read pass silently, which is one of the two things this
 * file exists to catch.
 */
const answering = (answers: Answers): Asking & Asked => {
  const queries: Query[] = [];

  return {
    queries,
    ask: <TResult>(query: Query): Promise<Result<TResult, HandlerFailure>> => {
      queries.push(query);

      const answer = answers.get(query.queryName);

      if (answer === undefined) {
        throw new Error(`The adapter asked an unexpected query: ${query.queryName}`);
      }
      return answer() as Promise<Result<TResult, HandlerFailure>>;
    },
  };
};

const aLink = (employmentId = EMPLOYMENT): EmploymentLinkView => ({
  id: uuidV7(),
  membershipId: REQUESTER,
  employmentId,
  isPrimary: true,
  status: 'linked',
  linkedAt: new Date('2026-01-01T00:00:00.000Z'),
});

const aMembership = (id: string): TenantMembershipView => ({
  id,
  tenantId: uuidV7(),
  workforceUserId: uuidV7(),
  status: 'active',
  joinedAt: new Date('2026-01-01T00:00:00.000Z'),
});

/** An employment snapshot carrying whichever manager the case needs, or none. */
const aSnapshot = (managerEmploymentId?: string): EmploymentSnapshot => ({
  asOf: new Date(`${AS_OF}T00:00:00.000Z`),
  employment: {
    employmentId: EMPLOYMENT,
    employmentNumber: 'E-1',
    personId: uuidV7(),
    status: 'active',
    employmentTypeCode: 'permanent',
    originalHireDate: '2026-01-01',
    startDate: '2026-01-01',
    asOf: AS_OF,
    metadata: {},
    version: 1,
    ...(managerEmploymentId === undefined ? {} : { managerEmploymentId }),
  },
  assignments: [],
});

const PRIMARY_EMPLOYMENT = 'identity.primary-employment-for-membership';
const READ_EMPLOYMENT = 'employment.read-employment';
const ACTIVE_MEMBERSHIPS = 'identity.active-memberships-for-employment';

/** The three answers a fully resolvable chain gives. */
const resolvable = (holders: readonly TenantMembershipView[] = [aMembership(MANAGER)]): Answers =>
  new Map<string, Answer>([
    [PRIMARY_EMPLOYMENT, () => Promise.resolve(success(aLink()))],
    [READ_EMPLOYMENT, () => Promise.resolve(success(aSnapshot(MANAGER_EMPLOYMENT)))],
    [ACTIVE_MEMBERSHIPS, () => Promise.resolve(success(holders))],
  ]);

const TENANT = uuidV7();

/**
 * Resolving inside a tenant context, because the adapter cannot run outside one.
 *
 * `runWithServiceGrant` refuses a grant entered without a tenant, so the ambient context is not a
 * convenience here — it is the mechanism that stops a caller reaching another tenant's reporting
 * line. The last test in this file asserts the refusal directly rather than leaving it as something
 * every other test happens to satisfy.
 */
const resolve = (dispatcher: Asking): Promise<ManagerResolution> =>
  runInContext(
    { tenantId: TENANT, correlationId: uuidV7(), actor: 'user:workflow-requester' },
    () => new WorkflowReportingLine(dispatcher).managerOf(REQUESTER, AS_OF),
  );

describe('the reporting-line adapter', () => {
  describe('a chain that resolves', () => {
    it('asks three questions, in order, and returns the manager', async () => {
      const dispatcher = answering(resolvable());
      const resolution = await resolve(dispatcher);

      expect(resolution).toStrictEqual({
        outcome: 'resolved',
        employmentId: EMPLOYMENT,
        managerEmploymentId: MANAGER_EMPLOYMENT,
        managerMembershipId: MANAGER,
      });
      expect(dispatcher.queries.map((query) => query.queryName)).toStrictEqual([
        PRIMARY_EMPLOYMENT,
        READ_EMPLOYMENT,
        ACTIVE_MEMBERSHIPS,
      ]);
    });

    /**
     * Each question carries only what the next step needs, and the date is the caller's.
     *
     * `asOf` is the instant of UTC midnight on the day `resolutionDateOf` produced — the same
     * convention that produced the string, so the round trip is exact and no local zone is involved
     * at either end. An adapter that reached for a clock here would resolve the same instance
     * against a different day on a second attempt.
     */
    it('passes the requester, then their employment, then the manager’s employment', async () => {
      const dispatcher = answering(resolvable());

      await resolve(dispatcher);

      expect(dispatcher.queries).toStrictEqual([
        { queryName: PRIMARY_EMPLOYMENT, membershipId: REQUESTER },
        {
          queryName: READ_EMPLOYMENT,
          employmentId: EMPLOYMENT,
          asOf: new Date('2026-08-14T00:00:00.000Z'),
        },
        { queryName: ACTIVE_MEMBERSHIPS, employmentId: MANAGER_EMPLOYMENT },
      ]);
    });

    it('never asks a fourth question, whatever the answers are', async () => {
      const dispatcher = answering(resolvable());

      await resolve(dispatcher);

      expect(dispatcher.queries).toHaveLength(3);
    });
  });

  describe('short circuits', () => {
    /**
     * A requester with no employment never reaches Employment, and Identity is never asked twice.
     *
     * Not an optimization. Asking a later question after an earlier one has already failed is how a
     * chain acquires a fallback nobody approved — and the second Identity read would be asking "who
     * holds employment `undefined`".
     */
    it('stops after one read when the requester has no primary employment', async () => {
      const dispatcher = answering(
        new Map<string, Answer>([[PRIMARY_EMPLOYMENT, () => Promise.resolve(success(undefined))]]),
      );

      expect(await resolve(dispatcher)).toStrictEqual({ outcome: 'no-primary-employment' });
      expect(dispatcher.queries).toHaveLength(1);
    });

    it('stops after two reads when that employment has no manager', async () => {
      const dispatcher = answering(
        new Map<string, Answer>([
          [PRIMARY_EMPLOYMENT, () => Promise.resolve(success(aLink()))],
          [READ_EMPLOYMENT, () => Promise.resolve(success(aSnapshot()))],
        ]),
      );

      expect(await resolve(dispatcher)).toStrictEqual({ outcome: 'no-manager' });
      expect(dispatcher.queries).toHaveLength(2);
    });
  });

  describe('who holds the manager’s employment', () => {
    it('refuses when nobody does', async () => {
      const dispatcher = answering(resolvable([]));

      expect(await resolve(dispatcher)).toStrictEqual({ outcome: 'manager-not-a-member' });
    });

    /**
     * Two holders is a refusal with its own name, and the adapter picks neither (B-1).
     *
     * The list is deliberately given in an order that would make a `[0]` look correct — the first
     * entry is a perfectly good active membership — so an adapter that quietly took it would pass a
     * weaker test and fail this one.
     */
    it('refuses when two do, without choosing either', async () => {
      const dispatcher = answering(resolvable([aMembership(MANAGER), aMembership(SECOND_HOLDER)]));

      expect(await resolve(dispatcher)).toStrictEqual({
        outcome: 'manager-membership-ambiguous',
      });
    });

    it('refuses when three do', async () => {
      const dispatcher = answering(
        resolvable([aMembership(MANAGER), aMembership(SECOND_HOLDER), aMembership(uuidV7())]),
      );

      expect(await resolve(dispatcher)).toStrictEqual({
        outcome: 'manager-membership-ambiguous',
      });
    });

    /**
     * And ambiguity does not depend on the order the list arrives in.
     *
     * The same two holders, reversed, give the same refusal — which is what "no ordering" means in
     * an assertion rather than in a comment.
     */
    it('gives the same refusal whichever order the holders arrive in', async () => {
      const forwards = await resolve(
        answering(resolvable([aMembership(MANAGER), aMembership(SECOND_HOLDER)])),
      );
      const backwards = await resolve(
        answering(resolvable([aMembership(SECOND_HOLDER), aMembership(MANAGER)])),
      );

      expect(forwards).toStrictEqual(backwards);
    });

    /**
     * Absence and ambiguity are two refusals and never one.
     *
     * They are opposite problems for different people: nobody holds the job, or two people do.
     * Collapsing them would send an administrator to link a member to an employment that already
     * has two members linked to it.
     */
    it('keeps “nobody holds it” and “two people hold it” apart', async () => {
      const nobody = await resolve(answering(resolvable([])));
      const two = await resolve(
        answering(resolvable([aMembership(MANAGER), aMembership(SECOND_HOLDER)])),
      );

      expect(nobody).not.toStrictEqual(two);
    });
  });

  /**
   * The self-manager case reaches the domain rather than being decided here.
   *
   * The adapter resolves and reports; `resolveManager` compares the membership with the requester's
   * and refuses. Splitting that rule across two layers would put half of it where nothing tests it
   * against the approval it is protecting.
   */
  it('reports a requester who holds their own manager’s employment, and judges nothing', async () => {
    const dispatcher = answering(resolvable([aMembership(REQUESTER)]));

    expect(await resolve(dispatcher)).toStrictEqual({
      outcome: 'resolved',
      employmentId: EMPLOYMENT,
      managerEmploymentId: MANAGER_EMPLOYMENT,
      managerMembershipId: REQUESTER,
    });
  });

  /**
   * **A failure is not an answer**, and this is the most important group in the file.
   *
   * Reporting an outage as "you have no manager" would tell an administrator to go and fix a
   * reporting line that is perfectly correct, route nothing, and record nowhere that a dependency
   * was down. So an unreachable module raises, while a *business* absence — no link, no manager, no
   * holder — is an outcome, because it is a fact about the organization rather than about the
   * system. `WorkflowDelegations` draws the same line.
   */
  describe('when a module cannot answer', () => {
    const refusing: Answer = () =>
      Promise.resolve(
        err({ kind: 'not_found', reason: 'gone' }) as Result<unknown, HandlerFailure>,
      );

    const failing = (queryName: string): Asking & Asked =>
      answering(new Map<string, Answer>([...resolvable(), [queryName, refusing]]));

    it.each([
      [PRIMARY_EMPLOYMENT, 'Identity'],
      [READ_EMPLOYMENT, 'Employment'],
      [ACTIVE_MEMBERSHIPS, 'Identity'],
    ])('raises rather than refusing when %s fails', async (queryName, module) => {
      await expect(resolve(failing(queryName))).rejects.toThrow(new RegExp(module));
    });

    it('raises when the dispatcher itself throws', async () => {
      const dispatcher: Asking = {
        ask: () => Promise.reject(new Error('Identity is unreachable')),
      };

      await expect(resolve(dispatcher)).rejects.toThrow(/unreachable/);
    });

    /** And no refusal it produces is ever one of the manager outcomes. */
    it('never turns an outage into a manager refusal', async () => {
      const outcomes: unknown[] = [];

      for (const queryName of [PRIMARY_EMPLOYMENT, READ_EMPLOYMENT, ACTIVE_MEMBERSHIPS]) {
        await resolve(failing(queryName)).then(
          (resolution) => outcomes.push(resolution),
          () => undefined,
        );
      }

      expect(outcomes).toStrictEqual([]);
    });
  });

  /**
   * The tenant is ambient, and there is no argument through which a caller could supply one.
   *
   * `managerOf` takes a membership and a date. Outside a tenant context the service grant refuses
   * before either module is asked — so a caller cannot reach another tenant's reporting line by
   * omitting a tenant any more than by naming one.
   */
  it('refuses outside a tenant context, before asking anybody', async () => {
    const dispatcher = answering(resolvable());

    await expect(new WorkflowReportingLine(dispatcher).managerOf(REQUESTER, AS_OF)).rejects.toThrow(
      /tenant/i,
    );
    expect(dispatcher.queries).toStrictEqual([]);
  });
});
