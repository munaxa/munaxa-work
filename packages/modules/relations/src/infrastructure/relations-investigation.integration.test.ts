import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { uuidV7 } from '@work/kernel';

import {
  CONNECTION,
  TENANT_A,
  openRelationsFixture,
  requireDatabaseInCi,
  type RelationsFixture,
} from './relations-database.fixture.js';
import { appendTransition, givenViolation, openInquiry } from './relations-case.fixture.js';

/**
 * Immutability and the shape constraints, proved against a real PostgreSQL because every one of them
 * is the database's.
 *
 *   * **The history cannot be rewritten** — `relation_case_event` refuses every update and delete
 *     unconditionally, from any path including SQL nobody wrote in TypeScript.
 *   * **A concluded inquiry cannot be rewritten either** — and, just as importantly, an *open* one
 *     still can. A trigger that refused both would be wrong in the other direction, and only a test
 *     that checks both directions would notice.
 *   * **A conclusion is all-or-nothing**, and the states a transition may name are closed.
 *
 * The suite connects as an unprivileged role that cannot bypass row-level security. Concurrency and
 * isolation are in `relations-case-lifecycle.integration.test.ts`.
 */

requireDatabaseInCi('Relations lifecycle immutability');

describe.skipIf(CONNECTION === undefined)('investigation and case-history immutability', () => {
  let fixture: RelationsFixture;

  beforeAll(async () => {
    fixture = await openRelationsFixture('relations_investigation_fixture');
  });

  afterEach(async () => {
    await fixture.truncate();
  });

  afterAll(async () => {
    await fixture.close();
  });

  describe('the case history', () => {
    it('refuses an update of a recorded transition', async () => {
      const violationId = await givenViolation(fixture);

      await fixture.asTenant(TENANT_A, (transaction) =>
        appendTransition(fixture, transaction, violationId, 1),
      );

      await expect(
        fixture.asTenant(TENANT_A, (transaction) =>
          transaction.execute(
            `update relation_case_event set reason = 'something else' where violation_id = $1`,
            [violationId],
          ),
        ),
      ).rejects.toThrow(/relation_case_event_immutable/);
    });

    it('refuses a delete, and refuses a soft delete for the same reason', async () => {
      const violationId = await givenViolation(fixture);

      await fixture.asTenant(TENANT_A, (transaction) =>
        appendTransition(fixture, transaction, violationId, 1),
      );

      await expect(
        fixture.asTenant(TENANT_A, (transaction) =>
          transaction.execute(`delete from relation_case_event where violation_id = $1`, [
            violationId,
          ]),
        ),
      ).rejects.toThrow(/relation_case_event_immutable/);

      await expect(
        fixture.asTenant(TENANT_A, (transaction) =>
          transaction.execute(
            `update relation_case_event set deleted_at = now(), deleted_by = 'test'
               where violation_id = $1`,
            [violationId],
          ),
        ),
      ).rejects.toThrow(/relation_case_event_immutable/);
    });

    /** Not even a no-op: the trigger fires `before update`, whatever the statement changes. */
    it('refuses an update that would change nothing', async () => {
      const violationId = await givenViolation(fixture);

      await fixture.asTenant(TENANT_A, (transaction) =>
        appendTransition(fixture, transaction, violationId, 1),
      );

      await expect(
        fixture.asTenant(TENANT_A, (transaction) =>
          transaction.execute(
            `update relation_case_event set sequence = sequence where violation_id = $1`,
            [violationId],
          ),
        ),
      ).rejects.toThrow(/relation_case_event_immutable/);
    });

    it('refuses a second transition claiming a sequence already taken', async () => {
      const violationId = await givenViolation(fixture);

      await fixture.asTenant(TENANT_A, (transaction) =>
        appendTransition(fixture, transaction, violationId, 1),
      );

      await expect(
        fixture.asTenant(TENANT_A, (transaction) =>
          appendTransition(fixture, transaction, violationId, 1),
        ),
      ).rejects.toThrow(/relation_case_event_sequence_idx/);
    });

    /**
     * `acknowledged` rather than `action_issued`: the latter became reachable when Checkpoint 4 was
     * approved and built, so this asserts a state that is *still* unreachable rather than a state
     * that merely used to be. The protection is the same; the example moved with the boundary.
     */
    it('refuses a transition to a state no checkpoint has built', async () => {
      const violationId = await givenViolation(fixture);

      await expect(
        fixture.asTenant(TENANT_A, (transaction) =>
          transaction.execute(
            `insert into relation_case_event
               (tenant_id, violation_id, sequence, from_state, to_state, reason, actor,
                occurred_at, correlation_id, created_at, created_by, updated_at, updated_by, version)
             values ($1, $2, 1, 'findings', 'acknowledged', 'r', 'a', now(), $3, now(), 'a', now(), 'a', 1)`,
            [TENANT_A, violationId, uuidV7()],
          ),
        ),
      ).rejects.toThrow(/relation_case_event_to_state_check/);
    });

    it('refuses a transition that moves nowhere', async () => {
      const violationId = await givenViolation(fixture);

      await expect(
        fixture.asTenant(TENANT_A, (transaction) =>
          appendTransition(fixture, transaction, violationId, 1, ['reported', 'reported']),
        ),
      ).rejects.toThrow(/relation_case_event_moves_check/);
    });
  });

  describe('an investigation', () => {
    /**
     * The other half of the immutability rule, and the half a one-sided assertion would miss: while
     * an inquiry is open its investigator is still writing, and the trigger must let them.
     */
    it('may still be corrected while it is open', async () => {
      const violationId = await givenViolation(fixture);
      const investigationId = await openInquiry(fixture, violationId);

      await fixture.asTenant(TENANT_A, (transaction) =>
        transaction.execute(`update relation_investigation set subject = $2 where id = $1`, [
          investigationId,
          'Three unnotified absences, and a fourth reported later',
        ]),
      );

      const held = await fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.investigations.byId(transaction, investigationId),
      );

      expect(held?.subject).toContain('a fourth reported later');
    });

    it('refuses every update once it has concluded', async () => {
      const violationId = await givenViolation(fixture);
      const investigationId = await openInquiry(fixture, violationId, TENANT_A, {
        state: 'concluded',
        findings: 'The absences were unnotified.',
        recommendation: 'A written warning.',
        concludedOn: '2026-08-22',
      });

      await expect(
        fixture.asTenant(TENANT_A, (transaction) =>
          transaction.execute(`update relation_investigation set findings = $2 where id = $1`, [
            investigationId,
            'Something more favourable.',
          ]),
        ),
      ).rejects.toThrow(/relation_investigation_concluded/);

      await expect(
        fixture.asTenant(TENANT_A, (transaction) =>
          transaction.execute(`delete from relation_investigation where id = $1`, [
            investigationId,
          ]),
        ),
      ).rejects.toThrow(/relation_investigation_concluded/);
    });

    it('refuses a conclusion missing half of itself', async () => {
      const violationId = await givenViolation(fixture);

      await expect(
        fixture.asTenant(TENANT_A, (transaction) =>
          transaction.execute(
            `insert into relation_investigation
               (tenant_id, violation_id, investigator_membership_id, opened_on, subject, state,
                findings, created_at, created_by, updated_at, updated_by, version)
             values ($1, $2, $3, '2026-08-21', 's', 'concluded', 'found things',
                     now(), 'a', now(), 'a', 1)`,
            [TENANT_A, violationId, uuidV7()],
          ),
        ),
      ).rejects.toThrow(/relation_investigation_conclusion_check/);
    });

    it('refuses an open inquiry that claims to have concluded something', async () => {
      const violationId = await givenViolation(fixture);

      await expect(
        openInquiry(fixture, violationId, TENANT_A, { findings: 'Decided in advance.' }),
      ).rejects.toThrow(/relation_investigation_conclusion_check/);
    });

    it('allows any number of concluded inquiries, but only one open at a time', async () => {
      const violationId = await givenViolation(fixture);

      await openInquiry(fixture, violationId, TENANT_A, {
        state: 'concluded',
        findings: 'The first inquiry found little.',
        recommendation: 'No action.',
        concludedOn: '2026-08-21',
      });
      await openInquiry(fixture, violationId, TENANT_A, {
        state: 'concluded',
        findings: 'The second inquiry found more.',
        recommendation: 'A written warning.',
        concludedOn: '2026-08-22',
      });
      await openInquiry(fixture, violationId);

      await expect(openInquiry(fixture, violationId)).rejects.toThrow(
        /relation_investigation_open_idx/,
      );
    });
  });
});
