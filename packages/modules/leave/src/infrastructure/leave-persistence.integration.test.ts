import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { figuresFrom, recalculated } from '../domain/balance.js';
import {
  CONNECTION,
  TENANT_A,
  openLeaveFixture,
  requireDatabaseInCi,
  type LeaveFixture,
} from './leave-database.fixture.js';
import {
  aBalance,
  aDay,
  aDecision,
  aRequest,
  anEntitlement,
  anEntry,
  configuredTenant,
} from './leave-fixtures.js';

/**
 * What the database enforces, checked against a real one.
 *
 * Every property here is the module's correctness, and every one belongs to PostgreSQL rather than
 * to TypeScript:
 *
 * - the **GiST exclusion constraint** that refuses two full days on one date and permits a first
 *   and a second half;
 * - the **ledger's idempotency index**, which every bounded run rests on;
 * - the **stale partial index**, matched by a predicate that tests presence of the mark;
 * - the **self-approval check constraint**, enforceable only because the decision row carries a
 *   copy of `requested_by`;
 * - the **foreign keys** that make it impossible for Leave to invent an employment;
 * - the **sign check** that keeps a credit from carrying a debit.
 *
 * A mock would prove only that the mock behaves as instructed.
 */

const describeIfDatabase = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('Leave persistence');

describeIfDatabase('Leave, in PostgreSQL', () => {
  let fixture: LeaveFixture;
  let employmentId: string;
  let leaveTypeId: string;
  let leavePolicyId: string;

  beforeAll(async () => {
    fixture = await openLeaveFixture('leave_fixture_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
    employmentId = await fixture.seedEmployment(TENANT_A, '2024-01-15');

    const configured = await fixture.asTenant(TENANT_A, (transaction) =>
      configuredTenant(transaction, fixture.stores, TENANT_A),
    );

    leaveTypeId = configured.leaveTypeId;
    leavePolicyId = configured.leavePolicyId;
  });

  describe('the ledger', () => {
    it('round-trips an entry with its minutes intact as a number', async () => {
      const entry = anEntry(TENANT_A, employmentId, leaveTypeId, {
        kind: 'consumption',
        minutes: -480,
      });

      await fixture.asTenant(TENANT_A, async (transaction) => {
        await fixture.stores.ledger.insert(transaction, entry);
      });

      const found = await fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.ledger.byId(transaction, entry.id),
      );

      // A driver returning an integer column as a string would make every sum a concatenation.
      expect(found?.minutes).toBe(-480);
      expect(typeof found?.minutes).toBe('number');
      expect(found?.effectiveOn).toBe('2026-01-01');
    });

    /** The index every bounded run rests on: an accrual repeated writes nothing the second time. */
    it('refuses a second entry with the same source and kind', async () => {
      const entry = anEntry(TENANT_A, employmentId, leaveTypeId);

      await fixture.asTenant(TENANT_A, async (transaction) => {
        await fixture.stores.ledger.insert(transaction, entry);
      });

      const again = fixture.asTenant(TENANT_A, async (transaction) => {
        await fixture.stores.ledger.insert(transaction, {
          ...entry,
          id: anEntry(TENANT_A, employmentId, leaveTypeId).id,
        });
      });

      await expect(again).rejects.toThrow(/leave_ledger_source_key|duplicate key/);
    });

    /** The sign convention lives in the database as well as in the domain. */
    it('refuses a credit kind carrying a debit', async () => {
      const entry = anEntry(TENANT_A, employmentId, leaveTypeId);

      const written = fixture.asTenant(TENANT_A, async (transaction) => {
        await fixture.stores.ledger.insert(transaction, { ...entry, minutes: -1 });
      });

      await expect(written).rejects.toThrow(/leave_ledger_sign_check|check constraint/);
    });

    /** Leave references an employment and cannot invent one. */
    it('refuses an entry for an employment that does not exist', async () => {
      const entry = anEntry(TENANT_A, '01920000-0000-7000-8000-00000000dead', leaveTypeId);

      const written = fixture.asTenant(TENANT_A, async (transaction) => {
        await fixture.stores.ledger.insert(transaction, entry);
      });

      await expect(written).rejects.toThrow(/foreign key|leave_ledger_employment_fk/);
    });

    it('sums a bucket back to the figure the projection derives', async () => {
      const entries = [
        anEntry(TENANT_A, employmentId, leaveTypeId, { kind: 'opening', minutes: 9600 }),
        anEntry(TENANT_A, employmentId, leaveTypeId, { kind: 'accrual', minutes: 480 }),
        anEntry(TENANT_A, employmentId, leaveTypeId, { kind: 'consumption', minutes: -1920 }),
      ];

      await fixture.asTenant(TENANT_A, async (transaction) => {
        for (const entry of entries) await fixture.stores.ledger.insert(transaction, entry);
      });

      const stored = await fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.ledger.forBucket(transaction, {
          employmentId,
          leaveTypeId,
          leaveYearStart: '2026-01-01',
        }),
      );

      expect(figuresFrom(stored).availableMinutes).toBe(8160);
      expect(figuresFrom(stored).consumedMinutes).toBe(1920);
    });
  });

  describe('the balance projection', () => {
    /**
     * The reconciliation read, against the real partial index.
     *
     * The predicate is presence of the mark. A comparison against `calculated_at` would lose an
     * entry written within the same clock tick as the calculation it invalidates.
     */
    it('finds a marked balance and stops finding it once recalculated', async () => {
      const balance = aBalance(TENANT_A, employmentId, leaveTypeId);

      await fixture.asTenant(TENANT_A, async (transaction) => {
        await fixture.stores.balances.insert(transaction, balance);
      });

      const stale = await fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.balances.stale(transaction, 10),
      );

      expect(stale.map((one) => one.id)).toContain(balance.id);

      await fixture.asTenant(TENANT_A, async (transaction) => {
        const found = await fixture.stores.balances.forBucket(transaction, {
          employmentId,
          leaveTypeId,
          leaveYearStart: '2026-01-01',
        });

        if (found === undefined) throw new Error('The balance should be there.');

        const { state } = recalculated(found, [], new Date());

        await fixture.stores.balances.update(transaction, state, found.version);
      });

      const after = await fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.balances.stale(transaction, 10),
      );

      expect(after.map((one) => one.id)).not.toContain(balance.id);
    });

    it('marks in bulk, by predicate, and reports how many it touched', async () => {
      const balance = aBalance(TENANT_A, employmentId, leaveTypeId);

      await fixture.asTenant(TENANT_A, async (transaction) => {
        await fixture.stores.balances.insert(transaction, balance);
      });

      const marked = await fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.balances.markStale(transaction, { employmentId }, new Date()),
      );

      expect(marked).toBe(1);
    });
  });

  describe('requests and their days', () => {
    /** The invariant the whole overlap model rests on, enforced by the database. */
    it('refuses two full days on one date and permits two halves', async () => {
      const first = aRequest(TENANT_A, employmentId, leaveTypeId, leavePolicyId);
      const second = aRequest(TENANT_A, employmentId, leaveTypeId, leavePolicyId);

      await fixture.asTenant(TENANT_A, async (transaction) => {
        await fixture.stores.requests.insert(transaction, first);
        await fixture.stores.requests.insert(transaction, second);
        await fixture.stores.requestDays.insert(transaction, aDay(first));
      });

      const clash = fixture.asTenant(TENANT_A, async (transaction) => {
        await fixture.stores.requestDays.insert(transaction, aDay(second));
      });

      await expect(clash).rejects.toThrow(/leave_request_day_overlap|exclusion constraint/);

      const halves = aRequest(TENANT_A, employmentId, leaveTypeId, leavePolicyId, {
        fromDate: '2026-06-20',
        toDate: '2026-06-20',
      });

      await fixture.asTenant(TENANT_A, async (transaction) => {
        await fixture.stores.requests.insert(transaction, halves);
        await fixture.stores.requestDays.insert(
          transaction,
          aDay(halves, { portion: 'first_half', minutes: 240 }),
        );
        await fixture.stores.requestDays.insert(
          transaction,
          aDay(halves, { portion: 'second_half', minutes: 240 }),
        );
      });

      const days = await fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.requestDays.forRequest(transaction, halves.id),
      );

      expect(days).toHaveLength(2);
    });

    /** Removing a day is soft, and it is what releases the date for another request. */
    it('releases a date once its day row is removed', async () => {
      const first = aRequest(TENANT_A, employmentId, leaveTypeId, leavePolicyId);
      const day = aDay(first);
      const second = aRequest(TENANT_A, employmentId, leaveTypeId, leavePolicyId);

      await fixture.asTenant(TENANT_A, async (transaction) => {
        await fixture.stores.requests.insert(transaction, first);
        await fixture.stores.requests.insert(transaction, second);
        await fixture.stores.requestDays.insert(transaction, day);
        await fixture.stores.requestDays.remove(transaction, day.id, new Date());
        await fixture.stores.requestDays.insert(transaction, aDay(second));
      });

      const covering = await fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.requestDays.covering(transaction, {
          employmentId,
          from: '2026-06-15',
          to: '2026-06-15',
        }),
      );

      expect(covering.map((one) => one.leaveRequestId)).toEqual([second.id]);
    });

    /** A request somebody merely asked for is not leave. */
    it('returns nothing to Attendance for a request that is not approved', async () => {
      const pending = aRequest(TENANT_A, employmentId, leaveTypeId, leavePolicyId, {
        state: 'pending_approval',
      });
      const { approvedAt: _approvedAt, ...undecided } = pending;

      await fixture.asTenant(TENANT_A, async (transaction) => {
        await fixture.stores.requests.insert(transaction, undecided);
        await fixture.stores.requestDays.insert(transaction, aDay(pending));
      });

      const covering = await fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.requestDays.covering(transaction, {
          employmentId,
          from: '2026-06-15',
          to: '2026-06-15',
        }),
      );

      expect(covering).toHaveLength(0);
    });

    /**
     * Self-approval, refused by the database.
     *
     * Only enforceable because the decision row carries a copy of `requested_by`: a check
     * constraint cannot reach another table.
     */
    it('refuses a decision whose approver is the requester', async () => {
      const request = aRequest(TENANT_A, employmentId, leaveTypeId, leavePolicyId);

      await fixture.asTenant(TENANT_A, async (transaction) => {
        await fixture.stores.requests.insert(transaction, request);
      });

      const forged = fixture.asTenant(TENANT_A, async (transaction) => {
        await fixture.stores.decisions.insert(transaction, aDecision(request, request.requestedBy));
      });

      await expect(forged).rejects.toThrow(
        /leave_request_decision_self_approval_check|check constraint/,
      );

      await fixture.asTenant(TENANT_A, async (transaction) => {
        await fixture.stores.decisions.insert(transaction, aDecision(request, 'user:manager'));
      });

      const chain = await fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.decisions.forRequest(transaction, request.id),
      );

      expect(chain.map((one) => one.decidedBy)).toEqual(['user:manager']);
    });
  });

  describe('entitlement', () => {
    /** The idempotency read an interrupted accrual run relies on. */
    it('refuses a second grant from the same run for the same bucket', async () => {
      const sourceId = aRequest(TENANT_A, employmentId, leaveTypeId, leavePolicyId).id;
      const granted = {
        ...anEntitlement(TENANT_A, employmentId, leaveTypeId, leavePolicyId),
        source: 'accrual' as const,
        sourceId,
      };

      await fixture.asTenant(TENANT_A, async (transaction) => {
        await fixture.stores.entitlements.insert(transaction, granted);
      });

      const found = await fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.entitlements.bySource(transaction, {
          employmentId,
          leaveTypeId,
          leaveYearStart: '2026-01-01',
          source: 'accrual',
          sourceId,
        }),
      );

      expect(found?.id).toBe(granted.id);

      const again = fixture.asTenant(TENANT_A, async (transaction) => {
        await fixture.stores.entitlements.insert(transaction, {
          ...granted,
          id: anEntitlement(TENANT_A, employmentId, leaveTypeId, leavePolicyId).id,
        });
      });

      await expect(again).rejects.toThrow(/leave_entitlement_source_key|duplicate key/);
    });
  });
});
