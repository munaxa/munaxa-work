import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { Transaction } from '@work/kernel';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ManagerSnapshot } from '../domain/branch-plan.js';
import {
  APPROVER,
  CONNECTION,
  REQUESTER,
  SECOND_APPROVER,
  TENANT_A,
  TENANT_B,
  openWorkflowFixture,
  requireDatabaseInCi,
  type WorkflowFixture,
} from './workflow-database.fixture.js';
import {
  aBranchTemplate,
  aDefinition,
  aDraft,
  aManagerTemplate,
  aStartedApproval,
  stepAt,
} from './workflow-states.js';

/**
 * The manager approver, as PostgreSQL actually holds it — which is to say, **as nothing special at
 * all**.
 *
 * That is the finding this file exists to make legible. A manager template names nobody, and a
 * running manager step names a person exactly as one a tenant typed does. There is no manager column
 * on either table, no manager foreign key, no manager index and nothing in the mappers that knows a
 * reporting line exists. What Phase 16C added to persistence for the manager approver is **one value
 * in an existing check constraint**.
 *
 * **The repository never resolves anything.** It cannot: it imports no Identity, no Organization and
 * no resolver, and the assertion at the end of this file is over the infrastructure source rather
 * than over prose. Following a reporting line is the application's job, and wiring it to a real
 * Identity query is Checkpoint 6's and Checkpoint 7's.
 *
 * **The snapshot is asserted at the row.** A step written with a resolved membership keeps that
 * membership when the world moves: the application's fixture is changed to name somebody else, the
 * row is read again, and the original person is still there. Not because the repository defends it,
 * but because there is nothing in the row that points at a reporting line to be re-followed.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi("Workflow's manager persistence suite");

const INFRASTRUCTURE = join(process.cwd(), 'src', 'infrastructure');

/** The manager the application resolved, as the domain receives it. */
const resolvedTo = (managerMembershipId: string): ManagerSnapshot => ({
  requesterMembershipId: REQUESTER,
  resolution: {
    outcome: 'resolved',
    employmentId: '01930000-0000-7000-8000-0000000000f1',
    managerEmploymentId: '01930000-0000-7000-8000-0000000000f2',
    managerMembershipId,
  },
});

suite('the manager approver, persisted', () => {
  let fixture: WorkflowFixture;

  beforeAll(async () => {
    fixture = await openWorkflowFixture('workflow_manager_repo_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  const inA = <TResult>(work: (transaction: Transaction) => Promise<TResult>): Promise<TResult> =>
    fixture.inTenant(TENANT_A, work);

  describe('a manager template', () => {
    it('round-trips with no approver identifier of either kind', async () => {
      const definition = aDefinition();
      const draft = aDraft(definition);
      const template = aManagerTemplate(draft, 1);

      const read = await inA(async (transaction) => {
        await fixture.stores.definitions.insert(transaction, definition);
        await fixture.stores.versions.insert(transaction, draft);
        await fixture.stores.versions.insertTemplate(transaction, template);
        return fixture.stores.versions.templatesFor(transaction, draft.workflowVersionId);
      });

      expect(read).toStrictEqual([template]);
      expect(read[0]?.approverKind).toBe('manager');
      expect(read[0]?.approverMembershipId).toBeUndefined();
      expect(read[0]?.approverGroupId).toBeUndefined();
    });

    /**
     * And the two columns really are null, not empty strings.
     *
     * Read as raw SQL rather than through the mapper, because a mapper that turned `''` into
     * `undefined` would make the assertion above pass over a row
     * `workflow_step_template_approver_check` should never have accepted.
     */
    it('stores both approver columns as SQL null', async () => {
      const definition = aDefinition();
      const draft = aDraft(definition);
      const template = aManagerTemplate(draft, 1);

      await inA(async (transaction) => {
        await fixture.stores.definitions.insert(transaction, definition);
        await fixture.stores.versions.insert(transaction, draft);
        await fixture.stores.versions.insertTemplate(transaction, template);
      });

      const { rows } = await fixture.admin.query<{
        approver_kind: string;
        approver_membership_id: string | null;
        approver_group_id: string | null;
      }>(
        `select approver_kind, approver_membership_id, approver_group_id
           from workflow_step_template where id = $1`,
        [template.stepTemplateId],
      );

      expect(rows[0]).toStrictEqual({
        approver_kind: 'manager',
        approver_membership_id: null,
        approver_group_id: null,
      });
    });

    it('sits beside a membership template in one version, each keeping its own kind', async () => {
      const definition = aDefinition();
      const draft = aDraft(definition);
      const person = aBranchTemplate(draft, 1, APPROVER);
      const manager = aManagerTemplate(draft, 2);

      const read = await inA(async (transaction) => {
        await fixture.stores.definitions.insert(transaction, definition);
        await fixture.stores.versions.insert(transaction, draft);
        await fixture.stores.versions.insertTemplate(transaction, person);
        await fixture.stores.versions.insertTemplate(transaction, manager);
        return fixture.stores.versions.templatesFor(transaction, draft.workflowVersionId);
      });

      expect(read.map((template) => template.approverKind)).toStrictEqual([
        'membership',
        'manager',
      ]);
    });
  });

  describe('a manager-resolved running step', () => {
    const started = (managerMembershipId = SECOND_APPROVER) =>
      aStartedApproval((draft) => [aManagerTemplate(draft, 1)], {
        manager: resolvedTo(managerMembershipId),
      });

    const write = async (seed: ReturnType<typeof started>): Promise<void> => {
      await inA(async (transaction) => {
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

    /**
     * The whole of manager persistence, in one assertion.
     *
     * `membership`, and a person. A running approval names somebody concrete whether the template
     * named them, named a list they were on, or named nobody at all — which is what makes an approval
     * already under way independent of the organization it came from.
     */
    it('is stored as an ordinary membership step, with no trace of how it was resolved', async () => {
      const seed = started();

      await write(seed);

      const read = await inA((transaction) =>
        fixture.stores.steps.byId(transaction, stepAt(seed, 0).stepId),
      );

      expect(read?.approverKind).toBe('membership');
      expect(read?.approverMembershipId).toBe(SECOND_APPROVER);
      // Not a group member either: `source_group_id` is provenance for a list, and there was none.
      expect(read?.sourceGroupId).toBeUndefined();
      expect(read).toStrictEqual(stepAt(seed, 0));
    });

    /**
     * The snapshot, at the row.
     *
     * Step 5 of the approved scenario is "change the external manager resolution fixture". Here that
     * is a second approval started with a different resolved manager — the world has moved — and the
     * first approval's step is read again. It still names the person it was started with, because
     * nothing in the row points at a reporting line that could be followed a second time.
     */
    it('keeps the membership it started with after the resolution changes', async () => {
      const first = started(SECOND_APPROVER);

      await write(first);

      const second = started(APPROVER);

      await write({ ...second, instance: { ...second.instance, subjectId: 'requisition-2' } });

      const reread = await inA((transaction) =>
        fixture.stores.steps.byId(transaction, stepAt(first, 0).stepId),
      );

      expect(reread?.approverMembershipId).toBe(SECOND_APPROVER);
    });

    it('appears on the resolved manager’s queue and on nobody else’s', async () => {
      const seed = started();

      await write(seed);

      const theirs = await inA((transaction) =>
        fixture.stores.steps.awaitingFor(transaction, SECOND_APPROVER, { limit: 20, offset: 0 }),
      );
      const somebodyElse = await inA((transaction) =>
        fixture.stores.steps.awaitingFor(transaction, REQUESTER, { limit: 20, offset: 0 }),
      );

      expect(theirs.total).toBe(1);
      expect(somebodyElse.total).toBe(0);
    });

    it('takes an optimistic update exactly as a membership step does', async () => {
      const seed = started();

      await write(seed);

      const step = stepAt(seed, 0);
      const reread = await inA(async (transaction) => {
        await fixture.stores.steps.update(transaction, { ...step, status: 'approved' }, 1);
        return fixture.stores.steps.byId(transaction, step.stepId);
      });

      expect(reread?.status).toBe('approved');
      expect(reread?.version).toBe(2);
      // And the approver is untouched by a status change.
      expect(reread?.approverMembershipId).toBe(SECOND_APPROVER);
    });

    it('cannot be read from another tenant', async () => {
      const seed = started();

      await write(seed);

      const theirs = await fixture.inTenant(TENANT_B, (transaction) =>
        fixture.stores.steps.byId(transaction, stepAt(seed, 0).stepId),
      );
      const theirQueue = await fixture.inTenant(TENANT_B, (transaction) =>
        fixture.stores.steps.awaitingFor(transaction, SECOND_APPROVER, { limit: 20, offset: 0 }),
      );

      expect(theirs).toBeUndefined();
      expect(theirQueue).toStrictEqual({ items: [], total: 0 });
    });

    it('keeps a manager template inside its own tenant too', async () => {
      const seed = started();

      await write(seed);

      const theirs = await fixture.inTenant(TENANT_B, (transaction) =>
        fixture.stores.versions.templatesFor(transaction, seed.version.workflowVersionId),
      );

      expect(theirs).toStrictEqual([]);
    });
  });

  /**
   * And the persistence layer holds no route to an organizational fact.
   *
   * The strongest form of "the repository never resolves a manager" is that it has nothing to resolve
   * one *with*. Asserted over the infrastructure source, with prose stripped, because this file's own
   * comments name all four modules in order to say they are absent.
   */
  it('imports no module that could answer who somebody’s manager is', () => {
    const production = readdirSync(INFRASTRUCTURE).filter(
      (file) =>
        file.endsWith('.ts') &&
        !file.includes('.test.') &&
        !file.includes('fixture') &&
        !file.includes('workflow-states') &&
        !file.includes('workflow-seed'),
    );

    for (const file of production) {
      const code = readFileSync(join(INFRASTRUCTURE, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\/\/[^\n]*/g, ' ');

      for (const forbidden of [
        '@work/identity',
        '@work/organization',
        '@work/employment',
        '@work/recruitment',
        'ReportingLinePort',
        'resolveManager',
        'managerOf',
      ]) {
        expect([file, forbidden, code.includes(forbidden)]).toStrictEqual([file, forbidden, false]);
      }
    }
  });
});
