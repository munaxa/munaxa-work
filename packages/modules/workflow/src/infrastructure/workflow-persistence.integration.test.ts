import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidV7, type Transaction } from '@work/kernel';

import { retireDefinition } from '../domain/definition.js';
import {
  CONNECTION,
  TENANT_A,
  openWorkflowFixture,
  requireDatabaseInCi,
  APPROVER,
  SECOND_APPROVER,
  type WorkflowFixture,
} from './workflow-database.fixture.js';
import {
  ADMIN,
  LATER,
  NOW,
  aDefinition,
  aDraft,
  aPublishedDefinition,
  aPublishedVersionOf,
  aStartedInstance,
  accepted,
  anApproval,
} from './workflow-states.js';

/**
 * The repository contract, against a real PostgreSQL.
 *
 * Everything goes in through a repository and comes back out through one, so what is under test is
 * the round trip: the mapper, the column types, the `jsonb`, the `timestamptz` and the two integral
 * columns. A hand-written `insert` beside the mapper it was written with would agree with itself and
 * prove nothing.
 *
 * The in-memory stores answer the same interfaces and are useful for application behaviour, but they
 * are **not evidence** for SQL types, indexes, triggers or policies. Only a suite that talks to
 * PostgreSQL is.
 */

/** A description in both first-class languages, with Arabic that is not ASCII. */
const DESCRIPTION = {
  en: 'Raised whenever a requisition is opened',
  ar: 'يُرفع عند فتح طلب توظيف',
};

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Workflow persistence suite');

suite('workflow persistence', () => {
  let fixture: WorkflowFixture;

  beforeAll(async () => {
    fixture = await openWorkflowFixture('workflow_persistence_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  const inA = <TResult>(work: (transaction: Transaction) => Promise<TResult>): Promise<TResult> =>
    fixture.inTenant(TENANT_A, work);

  /** One version and its templates, written through the repository that owns both. */
  const writeVersion = async (
    transaction: Transaction,
    published: Omit<ReturnType<typeof aPublishedDefinition>, 'definition'>,
  ): Promise<void> => {
    await fixture.stores.versions.insert(transaction, published.version);
    for (const template of published.templates) {
      await fixture.stores.versions.insertTemplate(transaction, template);
    }
  };

  /** A definition and its first version, all written through the repositories. */
  const writePublished = async (
    transaction: Transaction,
    published: ReturnType<typeof aPublishedDefinition>,
  ): Promise<void> => {
    await fixture.stores.definitions.insert(transaction, published.definition);
    await writeVersion(transaction, published);
  };

  /** A whole started instance: definition, version, templates, instance, steps and history. */
  const writeStarted = async (
    transaction: Transaction,
    started: ReturnType<typeof aStartedInstance>,
  ): Promise<void> => {
    await writePublished(transaction, started);
    await fixture.stores.instances.insert(transaction, started.instance);
    for (const step of started.steps) {
      await fixture.stores.steps.insert(transaction, step);
    }
    for (const entry of started.history) {
      await fixture.stores.history.insert(transaction, entry);
    }
  };

  describe('definitions', () => {
    it('round-trips a definition, optional columns and all', async () => {
      const definition = aDefinition({ description: DESCRIPTION });
      const read = await inA(async (transaction) => {
        await fixture.stores.definitions.insert(transaction, definition);
        return fixture.stores.definitions.byId(transaction, definition.definitionId);
      });

      expect(read).toEqual(definition);
      expect(read?.name).toEqual({ en: 'Requisition approval', ar: 'اعتماد طلب التوظيف' });
    });

    /**
     * An absent optional column comes back **absent**, not present-and-undefined.
     *
     * `exactOptionalPropertyTypes` makes those different types, and a mapper that wrote `undefined`
     * into the key would satisfy `toEqual` while failing a `in`-check and any exhaustive serializer.
     */
    it('omits the keys whose columns are null rather than setting them undefined', async () => {
      const definition = aDefinition();
      const read = await inA(async (transaction) => {
        await fixture.stores.definitions.insert(transaction, definition);
        return fixture.stores.definitions.byId(transaction, definition.definitionId);
      });

      expect(read).toBeDefined();
      expect(Object.keys(read ?? {})).not.toContain('description');
      expect(Object.keys(read ?? {})).not.toContain('retiredAt');
    });

    it('finds one by code and returns nothing for a code nobody used', async () => {
      const definition = aDefinition({ code: 'requisition-approval' });
      const found = await inA(async (transaction) => {
        await fixture.stores.definitions.insert(transaction, definition);
        return {
          byCode: await fixture.stores.definitions.byCode(transaction, 'requisition-approval'),
          missing: await fixture.stores.definitions.byCode(transaction, 'nobody-made-this'),
          missingById: await fixture.stores.definitions.byId(transaction, uuidV7()),
        };
      });

      expect(found.byCode?.definitionId).toBe(definition.definitionId);
      expect(found.missing).toBeUndefined();
      expect(found.missingById).toBeUndefined();
    });

    it('round-trips the instant a definition was retired at, to the millisecond', async () => {
      const definition = aDefinition();
      const retired = accepted(retireDefinition(definition, LATER, ADMIN));
      const read = await inA(async (transaction) => {
        await fixture.stores.definitions.insert(transaction, definition);
        await fixture.stores.definitions.update(transaction, retired, definition.version);
        return fixture.stores.definitions.byId(transaction, definition.definitionId);
      });

      expect(read?.status).toBe('retired');
      expect(read?.retiredAt?.toISOString()).toBe(LATER.toISOString());
      expect(read?.retiredAt?.getTime()).toBe(LATER.getTime());
      expect(read?.retiredBy).toBe(ADMIN);
    });

    it('filters a search by status and by subject type, and counts in the database', async () => {
      const kept = aDefinition({ subjectType: 'recruitment.requisition' });
      const other = aDefinition({ subjectType: 'leave.request' });
      const found = await inA(async (transaction) => {
        await fixture.stores.definitions.insert(transaction, kept);
        await fixture.stores.definitions.insert(transaction, other);
        return {
          bySubject: await fixture.stores.definitions.search(
            transaction,
            { subjectType: 'recruitment.requisition' },
            { limit: 10, offset: 0 },
          ),
          unfiltered: await fixture.stores.definitions.search(
            transaction,
            {},
            { limit: 10, offset: 0 },
          ),
        };
      });

      expect(found.bySubject.total).toBe(1);
      expect(found.bySubject.items[0]?.definitionId).toBe(kept.definitionId);
      expect(found.unfiltered.total).toBe(2);
    });
  });

  describe('versions and their step templates', () => {
    it('round-trips a published version and its templates in ordinal order', async () => {
      const published = aPublishedDefinition([APPROVER, SECOND_APPROVER]);
      const read = await inA(async (transaction) => {
        await writePublished(transaction, published);
        return {
          version: await fixture.stores.versions.byId(
            transaction,
            published.version.workflowVersionId,
          ),
          templates: await fixture.stores.versions.templatesFor(
            transaction,
            published.version.workflowVersionId,
          ),
        };
      });

      expect(read.version).toEqual(published.version);
      expect(read.version?.publishedAt?.getTime()).toBe(NOW.getTime());
      expect(read.templates).toEqual(published.templates);
      expect(read.templates.map((template) => template.ordinal)).toEqual([1, 2]);
    });

    /**
     * The published version an instance follows is the highest-numbered one.
     *
     * Nothing constrains a definition to a single published version — Checkpoint 3 declined to invent
     * that rule — so "which one" is a choice, and this asserts the choice rather than assuming a
     * table with one row.
     */
    it('returns the highest-numbered published version', async () => {
      const first = aPublishedDefinition([APPROVER]);
      const second = aPublishedVersionOf(first.definition, 2);
      const current = await inA(async (transaction) => {
        await writePublished(transaction, first);
        await writeVersion(transaction, second);
        return fixture.stores.versions.currentPublished(transaction, first.definition.definitionId);
      });

      expect(current?.versionNumber).toBe(2);
      expect(current?.workflowVersionId).toBe(second.version.workflowVersionId);
    });

    it('counts the next version number with the database rather than with a page', async () => {
      const published = aPublishedDefinition([APPROVER]);
      const numbers = await inA(async (transaction) => {
        const before = await fixture.stores.versions.nextNumberFor(
          transaction,
          published.definition.definitionId,
        );

        await writePublished(transaction, published);
        return {
          before,
          after: await fixture.stores.versions.nextNumberFor(
            transaction,
            published.definition.definitionId,
          ),
        };
      });

      expect(numbers.before).toBe(1);
      expect(numbers.after).toBe(2);
    });

    it('lists a definition’s versions newest first', async () => {
      const first = aPublishedDefinition([APPROVER]);
      const later = aDraft(first.definition, 2);
      const page = await inA(async (transaction) => {
        await writePublished(transaction, first);
        await fixture.stores.versions.insert(transaction, later);
        return fixture.stores.versions.forDefinition(transaction, first.definition.definitionId, {
          limit: 10,
          offset: 0,
        });
      });

      expect(page.total).toBe(2);
      expect(page.items.map((version) => version.versionNumber)).toEqual([2, 1]);
    });
  });

  describe('instances and steps', () => {
    it('round-trips an instance, its jsonb context and its start instant', async () => {
      const started = aStartedInstance([APPROVER, SECOND_APPROVER]);
      const read = await inA(async (transaction) => {
        await writeStarted(transaction, started);
        return fixture.stores.instances.byId(transaction, started.instance.instanceId);
      });

      expect(read).toEqual(started.instance);
      expect(read?.context).toEqual({ headcount: 2 });
      expect(read?.startedAt.getTime()).toBe(NOW.getTime());
    });

    it('finds the open instance for a subject and nothing once it is no longer running', async () => {
      const started = aStartedInstance([APPROVER]);
      const found = await inA(async (transaction) => {
        await writeStarted(transaction, started);
        const open = await fixture.stores.instances.openForSubject(
          transaction,
          started.instance.subjectType,
          started.instance.subjectId,
        );

        await fixture.stores.instances.update(
          transaction,
          { ...started.instance, status: 'completed', completedAt: LATER },
          started.instance.version,
        );
        return {
          open,
          afterCompletion: await fixture.stores.instances.openForSubject(
            transaction,
            started.instance.subjectType,
            started.instance.subjectId,
          ),
        };
      });

      expect(found.open?.instanceId).toBe(started.instance.instanceId);
      expect(found.afterCompletion).toBeUndefined();
    });

    it('returns an instance’s steps in ordinal order, first awaiting and the rest pending', async () => {
      const started = aStartedInstance([APPROVER, SECOND_APPROVER, APPROVER]);
      const steps = await inA(async (transaction) => {
        await writeStarted(transaction, started);
        return fixture.stores.steps.forInstance(transaction, started.instance.instanceId);
      });

      // **Red at the end of Phase 16C Checkpoint 4**, for the one reason set out at length beside the
      // round-trip assertion in `workflow-branch-persistence.integration.test.ts`: the first step now
      // carries the instant it became awaiting, and the mapper that would persist it is Checkpoint
      // 5's. The status assertion below is unaffected and still passes.
      expect(steps).toEqual(started.steps);
      expect(steps.map((step) => step.status)).toEqual(['awaiting', 'pending', 'pending']);
    });

    it('serves the queue for one membership and for nobody else', async () => {
      const mine = aStartedInstance([APPROVER], { subjectId: 'requisition-mine' });
      const theirs = aStartedInstance([SECOND_APPROVER], { subjectId: 'requisition-theirs' });
      const queues = await inA(async (transaction) => {
        await writeStarted(transaction, mine);
        await writeStarted(transaction, theirs);
        return {
          approver: await fixture.stores.steps.awaitingFor(transaction, APPROVER, {
            limit: 10,
            offset: 0,
          }),
          second: await fixture.stores.steps.awaitingFor(transaction, SECOND_APPROVER, {
            limit: 10,
            offset: 0,
          }),
        };
      });

      expect(queues.approver.total).toBe(1);
      expect(queues.approver.items[0]?.instanceId).toBe(mine.instance.instanceId);
      expect(queues.second.total).toBe(1);
      expect(queues.second.items[0]?.instanceId).toBe(theirs.instance.instanceId);
    });

    it('drops a step out of the queue once it has been decided', async () => {
      const started = aStartedInstance([APPROVER, SECOND_APPROVER]);
      const decided = anApproval(started);
      const queue = await inA(async (transaction) => {
        await writeStarted(transaction, started);
        await fixture.stores.steps.update(transaction, decided.step, decided.step.version);
        return fixture.stores.steps.awaitingFor(transaction, APPROVER, { limit: 10, offset: 0 });
      });

      expect(queue.total).toBe(0);
      expect(queue.items).toEqual([]);
    });
  });
});
