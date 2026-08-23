import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  CONNECTION,
  TENANT_A,
  TENANT_B,
  openRelationsFixture,
  requireDatabaseInCi,
  type RelationsFixture,
} from './relations-database.fixture.js';
import { appendTransition, givenViolation, openInquiry } from './relations-case.fixture.js';

/**
 * What happens when two administrators act at the same moment, and what one tenant can see of
 * another's cases.
 *
 * **Two real connections contending for real** — no sleep, no fake timer and no assumption about
 * which transaction is quicker. Both begin, both read the same state, both compute the same next
 * value, and the database arbitrates: `relation_case_event_sequence_idx` for a transition,
 * `relation_investigation_open_idx` for an inquiry. That is ADR-0071 applied to a lifecycle — a
 * `select` followed by an `insert` is not idempotent under concurrency, so the index decides rather
 * than the read.
 *
 * The suite connects as an unprivileged role that cannot bypass row-level security. A run as a
 * superuser would report that isolation works without having checked.
 */

requireDatabaseInCi('Relations lifecycle concurrency');

describe.skipIf(CONNECTION === undefined)('concurrent transitions and tenant isolation', () => {
  let fixture: RelationsFixture;

  beforeAll(async () => {
    fixture = await openRelationsFixture('relations_case_lifecycle_fixture');
  });

  afterEach(async () => {
    await fixture.truncate();
  });

  afterAll(async () => {
    await fixture.close();
  });

  describe('two administrators acting at the same moment', () => {
    /**
     * **Two real connections, contending for real.** No sleep, no fake timer and no assumption about
     * which transaction is quicker: both begin, both read the same empty history, both compute
     * sequence 1, and both attempt the insert. The unique index arbitrates.
     *
     * The assertion is about the *outcome*, not about which one wins — exactly one row exists and
     * exactly one caller was told no. Asserting a winner would be asserting a race.
     */
    it('lets exactly one transition claim a sequence', async () => {
      const violationId = await givenViolation(fixture);

      const outcomes = await Promise.allSettled([
        fixture.asTenant(TENANT_A, (transaction) =>
          appendTransition(fixture, transaction, violationId, 1),
        ),
        fixture.asTenant(TENANT_A, (transaction) =>
          appendTransition(fixture, transaction, violationId, 1),
        ),
      ]);

      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);

      const rejected = outcomes.find((outcome) => outcome.status === 'rejected');

      expect(String((rejected as PromiseRejectedResult).reason)).toMatch(
        /relation_case_event_sequence_idx/,
      );

      const history = await fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.caseEvents.forViolation(transaction, violationId),
      );

      expect(history).toHaveLength(1);
    });

    it('lets exactly one inquiry be the open one', async () => {
      const violationId = await givenViolation(fixture);

      const outcomes = await Promise.allSettled([
        openInquiry(fixture, violationId),
        openInquiry(fixture, violationId),
      ]);

      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);

      const rejected = outcomes.find((outcome) => outcome.status === 'rejected');

      expect(String((rejected as PromiseRejectedResult).reason)).toMatch(
        /relation_investigation_open_idx/,
      );
    });
  });

  describe('row-level security', () => {
    it('is enabled and forced on both new tables', async () => {
      const protection = await fixture.admin.query<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(
        `select relname, relrowsecurity, relforcerowsecurity from pg_class
           where relname in ('relation_investigation', 'relation_case_event')
           order by relname`,
      );

      expect(protection.rows).toStrictEqual([
        { relname: 'relation_case_event', relrowsecurity: true, relforcerowsecurity: true },
        { relname: 'relation_investigation', relrowsecurity: true, relforcerowsecurity: true },
      ]);
    });

    /**
     * `forced` is the load-bearing half. Without it the table's owner reads every tenant's rows —
     * and in this module those rows are inquiries into named people's conduct.
     */
    it("hides one tenant's inquiries and case history from another", async () => {
      const violationId = await givenViolation(fixture, TENANT_A);
      const investigationId = await openInquiry(fixture, violationId, TENANT_A);

      await fixture.asTenant(TENANT_A, (transaction) =>
        appendTransition(fixture, transaction, violationId, 1),
      );

      const seenByB = await fixture.asTenant(TENANT_B, async (transaction) => ({
        investigation: await fixture.stores.investigations.byId(transaction, investigationId),
        history: await fixture.stores.caseEvents.forViolation(transaction, violationId),
        page: await fixture.stores.investigations.forViolation(transaction, violationId, {
          limit: 50,
          offset: 0,
        }),
      }));

      expect(seenByB.investigation).toBeUndefined();
      expect(seenByB.history).toStrictEqual([]);
      expect(seenByB.page).toStrictEqual({ items: [], total: 0 });

      // …and the rows are still there, so the assertion above is about isolation rather than about
      // the fixture having failed to write anything.
      const seenByA = await fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.investigations.byId(transaction, investigationId),
      );

      expect(seenByA?.investigationId).toBe(investigationId);
    });
  });
});
