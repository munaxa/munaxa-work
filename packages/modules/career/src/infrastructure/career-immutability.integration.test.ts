import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  CONNECTION,
  TENANT_A,
  openCareerFixture,
  refusalOf,
  requireDatabaseInCi,
  type CareerFixture,
} from './career-database.fixture.js';
import { insertAssessment, insertReadinessLevel } from './career-fixtures.js';

/**
 * A readiness assessment cannot be rewritten (D-14, ADR-0074).
 *
 * It is a statement one person made about another on one day, and it decides who is put forward for
 * a director's post. Editing it destroys the trail that makes the statement answerable: "who said
 * this, and when did they change their mind" is what a succession review asks, and an edited row
 * cannot answer it. A correction is a *new* assessment.
 *
 * **The domain has no amend function, and that is not the guarantee.** A repair script, a migration
 * or a future handler reaches the table without passing through the domain at all, which is why the
 * refusal is a trigger and why this suite issues the `update` as raw SQL rather than through
 * anything that could be written to behave.
 *
 * This is deliberately the *only* trigger in the module. The other invariants are check constraints,
 * partial unique indexes and an optimistic version — mechanisms that do not need to compare an old
 * row with a new one, and that a reader can see by reading the table definition.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Career immutability suite');

suite('career immutability', () => {
  let fixture: CareerFixture;
  let levelId: string;

  beforeAll(async () => {
    fixture = await openCareerFixture('career_immutability_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
    levelId = await fixture.asTenant(TENANT_A, (client) => insertReadinessLevel(client, TENANT_A));
  });

  const seedAssessment = (): Promise<string> =>
    fixture.asTenant(TENANT_A, (client) => insertAssessment(client, TENANT_A, levelId));

  const refusalFrom = async (statement: string, values: readonly unknown[]): Promise<string> => {
    try {
      await fixture.asTenant(TENANT_A, (client) => client.query(statement, values));
    } catch (error: unknown) {
      return refusalOf(error);
    }
    throw new Error('The database accepted a mutation of an immutable row.');
  };

  it('refuses an update, naming the reason a correction is a new assessment', async () => {
    const id = await seedAssessment();

    expect(
      await refusalFrom(`update career_readiness_assessment set rationale = $1 where id = $2`, [
        'Reconsidered',
        id,
      ]),
    ).toContain('career_readiness_assessment_immutable');
  });

  /**
   * Including an update that changes nothing.
   *
   * A trigger written as "refuse when a meaningful column changed" leaves the shape of the guarantee
   * up to whoever later disagrees about which columns are meaningful. This one refuses the statement.
   */
  it('refuses an update that would leave every value as it was', async () => {
    const id = await seedAssessment();

    expect(
      await refusalFrom(
        `update career_readiness_assessment set assessed_by = assessed_by where id = $1`,
        [id],
      ),
    ).toContain('career_readiness_assessment_immutable');
  });

  it('refuses a delete, so a rewrite cannot be spelled as a delete and an insert', async () => {
    const id = await seedAssessment();

    expect(
      await refusalFrom(`delete from career_readiness_assessment where id = $1`, [id]),
    ).toContain('career_readiness_assessment_immutable');
  });

  /**
   * A soft delete is an update, and the trigger fires `before update` — so `deleted_at` is refused
   * too. Stated as its own test because "we only soft-delete" is precisely the argument somebody
   * makes for relaxing an append-only rule.
   */
  it('refuses a soft delete', async () => {
    const id = await seedAssessment();

    expect(
      await refusalFrom(
        `update career_readiness_assessment set deleted_at = now(), deleted_by = 'user:test'
          where id = $1`,
        [id],
      ),
    ).toContain('career_readiness_assessment_immutable');
  });

  /**
   * The refusal must not be a table that rejects everything: recording a *correction* is the whole
   * mechanism, so a second assessment on the same subject has to be accepted.
   */
  it('accepts a later assessment as the correction', async () => {
    await seedAssessment();

    const both = await fixture.asTenant(TENANT_A, async (client) => {
      await insertAssessment(client, TENANT_A, levelId, { assessedOn: '2026-06-10' });
      return client.query<{ assessed_on: string }>(
        `select assessed_on::text as assessed_on from career_readiness_assessment
          order by assessed_on`,
      );
    });

    expect(both.rows.map((row) => row.assessed_on)).toEqual(['2026-05-04', '2026-06-10']);
  });

  /**
   * The trigger is Career's own and applies to Career's own table only. A trigger that reached
   * another module's rows would be this module enforcing a rule on a table it does not own.
   */
  it('leaves every other Career table mutable', async () => {
    const updated = await fixture.asTenant(TENANT_A, async (client) => {
      const changed = await client.query(
        `update career_readiness_level set active = false where id = $1`,
        [levelId],
      );

      return changed.rowCount;
    });

    expect(updated).toBe(1);
  });
});
