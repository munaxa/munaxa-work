import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Transaction } from '@work/kernel';

import {
  CONNECTION,
  TENANT_A,
  openWorkflowFixture,
  requireDatabaseInCi,
  type WorkflowFixture,
} from './workflow-database.fixture.js';
import { aDefinition } from './workflow-states.js';

/**
 * A definition's localized description, from the domain to the column and back.
 *
 * Checkpoint 5 reported that the domain declared `description?: string` while the column had always
 * been `jsonb`, so a definition carrying a description could not be written at all. Checkpoint 6
 * resolved it by bringing the **domain** to the schema — `LocalizedName`, exactly as the `name`
 * beside it, and exactly as Career, Learning and Onboarding represent a tenant-authored description.
 * **No migration was added and the column was not touched.**
 *
 * This suite is the regression lock on that resolution, and it checks both halves: that the text
 * survives in each language, and that what lands in the column is a JSON object rather than a string
 * that happens to contain JSON.
 */

/** A description in both first-class languages, with Arabic that is not ASCII. */
const DESCRIPTION = {
  en: 'Raised whenever a requisition is opened',
  ar: '\u064a\u064f\u0631\u0641\u0639 \u0639\u0646\u062f \u0641\u062a\u062d \u0637\u0644\u0628 \u062a\u0648\u0638\u064a\u0641',
};

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Workflow description parity suite');

suite('a localized description', () => {
  let fixture: WorkflowFixture;

  beforeAll(async () => {
    fixture = await openWorkflowFixture('workflow_description_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  const inA = <TResult>(work: (transaction: Transaction) => Promise<TResult>): Promise<TResult> =>
    fixture.inTenant(TENANT_A, work);

  const write = async (
    definition: ReturnType<typeof aDefinition>,
  ): Promise<ReturnType<typeof aDefinition> | undefined> =>
    inA(async (transaction) => {
      await fixture.stores.definitions.insert(transaction, definition);
      return fixture.stores.definitions.byId(transaction, definition.definitionId);
    });

  it('persists a definition that carries no description', async () => {
    const read = await write(aDefinition());

    expect(read).toBeDefined();
    expect(Object.keys(read ?? {})).not.toContain('description');
  });

  it('persists the English text unchanged', async () => {
    const read = await write(aDefinition({ description: DESCRIPTION }));

    expect(read?.description?.en).toBe('Raised whenever a requisition is opened');
  });

  /** Arabic, non-ASCII, through a `jsonb` column and back — no escaping and no mojibake. */
  it('persists the Arabic text unchanged', async () => {
    const read = await write(aDefinition({ description: DESCRIPTION }));

    expect(read?.description?.ar).toBe('يُرفع عند فتح طلب توظيف');
    expect(read?.description?.ar).toHaveLength(DESCRIPTION.ar.length);
  });

  it('round-trips both languages together, and nothing else', async () => {
    const definition = aDefinition({ description: DESCRIPTION });
    const read = await write(definition);

    expect(read?.description).toEqual(DESCRIPTION);
    // Sorted, because `jsonb` normalizes key order and does not promise to return the one it was
    // given. Asserting the written order here would be asserting a property PostgreSQL never
    // offered — and the two languages are what matter, not which is written first.
    expect(Object.keys(read?.description ?? {}).sort()).toEqual(['ar', 'en']);
    expect(read).toEqual(definition);
  });

  /**
   * The column holds a JSON **object**, which is what makes the round trip a round trip.
   *
   * Read as raw text rather than through the mapper: a mapper that wrote `JSON.stringify` twice, or
   * that stored a scalar string, would still satisfy every assertion above while leaving a column a
   * `->>` in some future report could not read.
   */
  it('stores a JSON object in the column, not a string carrying JSON', async () => {
    const definition = aDefinition({ description: DESCRIPTION });

    await write(definition);

    const stored = await inA(async (transaction) => {
      const rows = await transaction.execute<{ kind: string; english: string | null }>(
        `select jsonb_typeof(description) as kind, description->>'en' as english
             from workflow_definition where id = $1`,
        [definition.definitionId],
      );

      return rows[0];
    });

    expect(stored?.kind).toBe('object');
    expect(stored?.english).toBe('Raised whenever a requisition is opened');
  });

  /** And the schema itself is untouched: still `jsonb`, still nullable. */
  it('leaves the column exactly as Checkpoint 3 declared it', async () => {
    const column = await inA(async (transaction) => {
      const rows = await transaction.execute<{ data_type: string; is_nullable: string }>(
        `select data_type, is_nullable from information_schema.columns
             where table_schema = 'public' and table_name = 'workflow_definition'
               and column_name = 'description'`,
      );

      return rows[0];
    });

    expect(column).toEqual({ data_type: 'jsonb', is_nullable: 'YES' });
  });
});
