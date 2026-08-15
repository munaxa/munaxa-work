import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidV7, type Transaction } from '@work/kernel';

import {
  CONNECTION,
  TENANT_A,
  TENANT_B,
  openWorkflowFixture,
  requireDatabaseInCi,
  APPROVER,
  SECOND_APPROVER,
  type WorkflowFixture,
} from './workflow-database.fixture.js';
import {
  LATER,
  aDefinition,
  aDraft,
  aPublishedVersionOf,
  aStartedInstance,
  aTemplate,
  anApproval,
  stepAt,
} from './workflow-states.js';

/**
 * The seven uniqueness invariants, reached the way the application reaches them.
 *
 * Each is a **partial** unique index, and a partial index has two halves worth asserting: what it
 * refuses, and what it deliberately permits. Only checking the refusal is how a partial index
 * silently becomes a full one in a later migration — the refusal tests keep passing and the
 * permitted case, which is a real product behaviour, quietly stops working. So every partial index
 * here is asserted from both sides.
 *
 * A code freed by a soft delete, a second approval for a subject whose first was rejected, and the
 * next step becoming current after the previous one was decided are not loopholes. They are the
 * product, and the index is written to allow exactly them and nothing else.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Workflow repository uniqueness suite');

suite('repository uniqueness', () => {
  let fixture: WorkflowFixture;

  beforeAll(async () => {
    fixture = await openWorkflowFixture('workflow_repo_uniqueness_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  const inA = <TResult>(work: (transaction: Transaction) => Promise<TResult>): Promise<TResult> =>
    fixture.inTenant(TENANT_A, work);

  const writeStarted = async (
    tenantId: string,
    seed: ReturnType<typeof aStartedInstance>,
  ): Promise<void> => {
    await fixture.inTenant(tenantId, async (transaction) => {
      await fixture.stores.definitions.insert(transaction, seed.definition);
      await fixture.stores.versions.insert(transaction, seed.version);
      for (const template of seed.templates) {
        await fixture.stores.versions.insertTemplate(transaction, template);
      }
      await fixture.stores.instances.insert(transaction, seed.instance);
      for (const step of seed.steps) {
        await fixture.stores.steps.insert(transaction, step);
      }
    });
  };

  /** Soft-deletes one row the way `Repository.softDeleteRow` would, as the unprivileged role. */
  const softDelete = async (table: string, id: string): Promise<void> => {
    await fixture.asTenant(TENANT_A, async (client) => {
      await client.query(
        `update ${table} set deleted_at = now(), deleted_by = 'user:test' where id = $1`,
        [id],
      );
    });
  };

  describe('a definition code, once per tenant', () => {
    it('refuses a second definition with the same code', async () => {
      const first = aDefinition({ code: 'requisition-approval' });
      const second = aDefinition({ code: 'requisition-approval' });

      await inA((transaction) => fixture.stores.definitions.insert(transaction, first));

      await expect(
        inA((transaction) => fixture.stores.definitions.insert(transaction, second)),
      ).rejects.toThrow(/workflow_definition_code_idx/);
    });

    it('permits the same code in another tenant', async () => {
      const code = 'requisition-approval';

      await inA((transaction) =>
        fixture.stores.definitions.insert(transaction, aDefinition({ code })),
      );
      await fixture.inTenant(TENANT_B, (transaction) =>
        fixture.stores.definitions.insert(transaction, aDefinition({ code })),
      );

      const inOther = await fixture.inTenant(TENANT_B, (transaction) =>
        fixture.stores.definitions.byCode(transaction, code),
      );

      expect(inOther?.code).toBe(code);
    });

    /** The partial half: a code a discarded definition once held is available again. */
    it('permits the code again once the first is soft-deleted', async () => {
      const first = aDefinition({ code: 'requisition-approval' });

      await inA((transaction) => fixture.stores.definitions.insert(transaction, first));
      await softDelete('workflow_definition', first.definitionId);

      const replacement = aDefinition({ code: 'requisition-approval' });

      await inA((transaction) => fixture.stores.definitions.insert(transaction, replacement));

      const found = await inA((transaction) =>
        fixture.stores.definitions.byCode(transaction, 'requisition-approval'),
      );

      expect(found?.definitionId).toBe(replacement.definitionId);
    });
  });

  describe('a version number, once per definition', () => {
    it('refuses a second version with the same number', async () => {
      const definition = aDefinition();
      const first = aDraft(definition, 2);
      const second = aDraft(definition, 2);

      await inA(async (transaction) => {
        await fixture.stores.definitions.insert(transaction, definition);
        await fixture.stores.versions.insert(transaction, first);
      });

      await expect(
        inA((transaction) => fixture.stores.versions.insert(transaction, second)),
      ).rejects.toThrow(/workflow_version_number_idx/);
    });

    /**
     * And the next number never reuses one, even after a draft is discarded.
     *
     * `nextNumberFor` counts soft-deleted rows deliberately: the index would permit the number again,
     * but two rows in an audit trail answering to "version 3" is a worse outcome than a gap.
     */
    it('does not hand back a number a discarded draft once held', async () => {
      const definition = aDefinition();
      const draft = aDraft(definition, 1);

      await inA(async (transaction) => {
        await fixture.stores.definitions.insert(transaction, definition);
        await fixture.stores.versions.insert(transaction, draft);
      });
      await softDelete('workflow_version', draft.workflowVersionId);

      const next = await inA((transaction) =>
        fixture.stores.versions.nextNumberFor(transaction, definition.definitionId),
      );

      expect(next).toBe(2);
    });
  });

  describe('a step-template ordinal, once per version', () => {
    it('refuses a second template at the same ordinal', async () => {
      const definition = aDefinition();
      const draft = aDraft(definition);

      await inA(async (transaction) => {
        await fixture.stores.definitions.insert(transaction, definition);
        await fixture.stores.versions.insert(transaction, draft);
        await fixture.stores.versions.insertTemplate(transaction, aTemplate(draft, 1));
      });

      await expect(
        inA((transaction) =>
          fixture.stores.versions.insertTemplate(transaction, aTemplate(draft, 1, SECOND_APPROVER)),
        ),
      ).rejects.toThrow(/workflow_step_template_ordinal_idx/);
    });

    it('permits the same ordinal on a different version of the same definition', async () => {
      const definition = aDefinition();
      const first = aPublishedVersionOf(definition, 1);
      const second = aPublishedVersionOf(definition, 2);

      await inA(async (transaction) => {
        await fixture.stores.definitions.insert(transaction, definition);
        for (const published of [first, second]) {
          await fixture.stores.versions.insert(transaction, published.version);
          for (const template of published.templates) {
            await fixture.stores.versions.insertTemplate(transaction, template);
          }
        }
      });

      const templates = await inA((transaction) =>
        fixture.stores.versions.templatesFor(transaction, second.version.workflowVersionId),
      );

      expect(templates.map((template) => template.ordinal)).toEqual([1]);
    });
  });

  describe('one open approval per subject', () => {
    it('refuses a second running instance for the same subject', async () => {
      const first = aStartedInstance([APPROVER], { subjectId: 'requisition-7' });
      const second = aStartedInstance([APPROVER], { subjectId: 'requisition-7' });

      await writeStarted(TENANT_A, first);

      await expect(
        fixture.inTenant(TENANT_A, async (transaction) => {
          await fixture.stores.definitions.insert(transaction, second.definition);
          await fixture.stores.versions.insert(transaction, second.version);
          await fixture.stores.instances.insert(transaction, second.instance);
        }),
      ).rejects.toThrow(/workflow_instance_open_subject_idx/);
    });

    /**
     * The partial half, and it is the product rather than a loophole: an approval that was rejected
     * or cancelled does not block a corrected request for the same subject.
     */
    it('permits a second approval once the first is no longer running', async () => {
      const first = aStartedInstance([APPROVER], { subjectId: 'requisition-7' });
      const second = aStartedInstance([APPROVER], { subjectId: 'requisition-7' });

      await writeStarted(TENANT_A, first);
      await inA((transaction) =>
        fixture.stores.instances.update(
          transaction,
          { ...first.instance, status: 'rejected', completedAt: LATER },
          first.instance.version,
        ),
      );
      await writeStarted(TENANT_A, second);

      const open = await inA((transaction) =>
        fixture.stores.instances.openForSubject(
          transaction,
          second.instance.subjectType,
          'requisition-7',
        ),
      );

      expect(open?.instanceId).toBe(second.instance.instanceId);
    });
  });

  describe('one step per ordinal, and one step awaiting', () => {
    it('refuses a second step at the same ordinal on one instance', async () => {
      const seed = aStartedInstance([APPROVER]);

      await writeStarted(TENANT_A, seed);

      const clash = { ...stepAt(seed, 0), stepId: uuidV7(), status: 'pending' as const };

      await expect(
        inA((transaction) => fixture.stores.steps.insert(transaction, clash)),
      ).rejects.toThrow(/workflow_step_ordinal_idx/);
    });

    /**
     * **Two steps of one approval cannot await a decision at the same time.**
     *
     * This is sequential approval expressed as a property of the data rather than of whatever code
     * happens to walk it, and it is the index that cannot be deferred: the decided step must leave
     * `awaiting` before the next one enters, in that order, inside the same transaction.
     */
    it('refuses a second step becoming awaiting on the same instance', async () => {
      const seed = aStartedInstance([APPROVER, SECOND_APPROVER]);

      await writeStarted(TENANT_A, seed);

      const next = stepAt(seed, 1);

      await expect(
        inA((transaction) =>
          fixture.stores.steps.update(transaction, { ...next, status: 'awaiting' }, next.version),
        ),
      ).rejects.toThrow(/workflow_step_awaiting_idx/);
    });

    /** And permits it in the order a decision actually happens: the first leaves, then the next enters. */
    it('permits the next step to await once the decided one has left', async () => {
      const seed = aStartedInstance([APPROVER, SECOND_APPROVER]);

      await writeStarted(TENANT_A, seed);

      const decided = anApproval(seed);
      const steps = await inA(async (transaction) => {
        await fixture.stores.steps.update(transaction, decided.step, decided.step.version);
        for (const following of decided.next) {
          await fixture.stores.steps.update(transaction, following, following.version);
        }
        return fixture.stores.steps.forInstance(transaction, seed.instance.instanceId);
      });

      expect(steps.map((step) => step.status)).toEqual(['approved', 'awaiting']);
    });

    it('permits two instances to each have a step awaiting', async () => {
      const first = aStartedInstance([APPROVER], { subjectId: 'requisition-1' });
      const second = aStartedInstance([APPROVER], { subjectId: 'requisition-2' });

      await writeStarted(TENANT_A, first);
      await writeStarted(TENANT_A, second);

      const queue = await inA((transaction) =>
        fixture.stores.steps.awaitingFor(transaction, APPROVER, { limit: 10, offset: 0 }),
      );

      expect(queue.total).toBe(2);
    });
  });

  describe('one decision per step', () => {
    it('refuses a second decision on a step that has one', async () => {
      const seed = aStartedInstance([APPROVER]);

      await writeStarted(TENANT_A, seed);

      const decided = anApproval(seed);

      await inA((transaction) => fixture.stores.decisions.insert(transaction, decided.decision));

      await expect(
        inA((transaction) =>
          fixture.stores.decisions.insert(transaction, {
            ...decided.decision,
            decisionId: uuidV7(),
          }),
        ),
      ).rejects.toThrow(/workflow_decision_step_idx/);
    });

    it('permits one decision on each step of an approval', async () => {
      const seed = aStartedInstance([APPROVER, SECOND_APPROVER]);

      await writeStarted(TENANT_A, seed);

      const first = anApproval(seed);
      const secondStep = stepAt(seed, 1);
      const recorded = await inA(async (transaction) => {
        await fixture.stores.decisions.insert(transaction, first.decision);
        await fixture.stores.decisions.insert(transaction, {
          ...first.decision,
          decisionId: uuidV7(),
          stepId: secondStep.stepId,
          decidedByMembershipId: SECOND_APPROVER,
        });
        return fixture.stores.decisions.forInstance(transaction, seed.instance.instanceId);
      });

      expect(recorded).toHaveLength(2);
    });
  });
});
