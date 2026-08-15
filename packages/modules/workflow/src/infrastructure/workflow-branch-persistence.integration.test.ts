import { uuidV7, type Transaction } from '@work/kernel';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { BranchCondition } from '../domain/condition.js';
import {
  APPROVER,
  CONNECTION,
  DEPUTY,
  SECOND_APPROVER,
  TENANT_A,
  openWorkflowFixture,
  requireDatabaseInCi,
  type WorkflowFixture,
} from './workflow-database.fixture.js';
import {
  aBranchTemplate,
  aDefinition,
  aDraft,
  aGroup,
  aGroupTemplate,
  aStartedInstance,
  stepAt,
} from './workflow-states.js';

/**
 * The four columns Phase 16B added to a template and to a running step, through the real mappers.
 *
 * **A repository persists a condition; it never reads one.** `condition` is `jsonb`, and the mapper
 * stringifies on the way in and hands back what PostgreSQL parsed on the way out. It does not look at
 * a key, check an operator or evaluate anything: the database checks the *shape*, the domain decides
 * the *meaning*, and a repository that interpreted a condition would be a third place the rule lived.
 *
 * **The two approver columns are deliberately asymmetric.** A template's membership is nullable
 * because a `group` template names no person; a running step's is not, because the group was expanded
 * into its members before the row existed. Both halves are asserted here rather than assumed from the
 * schema, because a mapper is exactly where an asymmetry gets quietly flattened.
 *
 * **Nothing in this file re-tests the arithmetic.** The tally is the domain's and is asserted there;
 * what is under test is whether the numbers survive real columns intact — an `integer` quorum that
 * came back as a string, or an ordinal rounded through a float, would break the arithmetic without
 * changing a line of it.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi("Workflow's branch persistence suite");

const OVER_FIFTY: BranchCondition = { key: 'amount', operator: 'greater-than', value: 50_000 };

suite('the branch columns, persisted', () => {
  let fixture: WorkflowFixture;

  beforeAll(async () => {
    fixture = await openWorkflowFixture('workflow_branch_repo_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  const inA = <TResult>(work: (transaction: Transaction) => Promise<TResult>): Promise<TResult> =>
    fixture.inTenant(TENANT_A, work);

  describe('a step template', () => {
    it('round-trips a group approver with no membership on it', async () => {
      const definition = aDefinition();
      const draft = aDraft(definition);
      const group = aGroup();
      const template = aGroupTemplate(draft, 1, group.approvalGroupId, {
        branchRule: 'majority',
        quorum: 2,
        condition: [OVER_FIFTY],
      });

      await inA(async (transaction) => {
        await fixture.stores.groups.insert(transaction, group);
        await fixture.stores.definitions.insert(transaction, definition);
        await fixture.stores.versions.insert(transaction, draft);
        await fixture.stores.versions.insertTemplate(transaction, template);
      });

      const read = await inA((transaction) =>
        fixture.stores.versions.templatesFor(transaction, draft.workflowVersionId),
      );

      // Field for field, including the absent membership: `approverMembershipId` must not come back
      // as `null`, which is a different thing from a key that is not there.
      expect(read[0]).toStrictEqual(template);
      expect(read[0] === undefined ? true : 'approverMembershipId' in read[0]).toBe(false);
    });

    it('round-trips a membership approver with no branch configuration at all', async () => {
      const definition = aDefinition();
      const draft = aDraft(definition);
      const template = aBranchTemplate(draft, 1, APPROVER);

      await inA(async (transaction) => {
        await fixture.stores.definitions.insert(transaction, definition);
        await fixture.stores.versions.insert(transaction, draft);
        await fixture.stores.versions.insertTemplate(transaction, template);
      });

      const read = await inA((transaction) =>
        fixture.stores.versions.templatesFor(transaction, draft.workflowVersionId),
      );

      // Exactly what every step configured before this phase is, and the four new columns are all
      // null — which `branchOf` reads as `unanimous` with a quorum of one, in one place.
      expect(read[0]).toStrictEqual(template);
    });

    it('keeps an empty condition distinct from no condition at all', async () => {
      const definition = aDefinition();
      const draft = aDraft(definition);
      const empty = aBranchTemplate(draft, 1, APPROVER, { condition: [] });
      const absent = aBranchTemplate(draft, 2, SECOND_APPROVER);

      await inA(async (transaction) => {
        await fixture.stores.definitions.insert(transaction, definition);
        await fixture.stores.versions.insert(transaction, draft);
        await fixture.stores.versions.insertTemplate(transaction, empty);
        await fixture.stores.versions.insertTemplate(transaction, absent);
      });

      const read = await inA((transaction) =>
        fixture.stores.versions.templatesFor(transaction, draft.workflowVersionId),
      );

      // They mean the same thing to `conditionsOf` — a branch that always runs — and they are not
      // the same stored value. A mapper that collapsed `[]` to absent would be returning what is
      // equivalent rather than what was written.
      expect(read[0]?.condition).toStrictEqual([]);
      expect(read[1] === undefined ? true : 'condition' in read[1]).toBe(false);
    });

    it('round-trips several conditions, with a list value and a text value', async () => {
      const definition = aDefinition();
      const draft = aDraft(definition);
      const conditions: readonly BranchCondition[] = [
        OVER_FIFTY,
        { key: 'kind', operator: 'equals', value: 'capital' },
        { key: 'unit', operator: 'in', value: ['finance', 'operations'] },
      ];
      const template = aBranchTemplate(draft, 1, APPROVER, { condition: conditions });

      await inA(async (transaction) => {
        await fixture.stores.definitions.insert(transaction, definition);
        await fixture.stores.versions.insert(transaction, draft);
        await fixture.stores.versions.insertTemplate(transaction, template);
      });

      const read = await inA((transaction) =>
        fixture.stores.versions.templatesFor(transaction, draft.workflowVersionId),
      );

      // Order included: `all-of` is evaluated in the order it was written, and a `jsonb` array
      // preserves it. (A `jsonb` *object* would not preserve key order, which is why a condition is
      // a list of triples rather than a map.)
      expect(read[0]?.condition).toStrictEqual(conditions);
      expect(typeof (read[0]?.condition?.[0]?.value ?? '')).toBe('number');
    });

    it('takes several templates at one ordinal, because that is a branch', async () => {
      const definition = aDefinition();
      const draft = aDraft(definition);

      await inA(async (transaction) => {
        await fixture.stores.definitions.insert(transaction, definition);
        await fixture.stores.versions.insert(transaction, draft);
        for (const approver of [APPROVER, SECOND_APPROVER, DEPUTY]) {
          await fixture.stores.versions.insertTemplate(
            transaction,
            aBranchTemplate(draft, 1, approver, { branchRule: 'majority' }),
          );
        }
      });

      const read = await inA((transaction) =>
        fixture.stores.versions.templatesFor(transaction, draft.workflowVersionId),
      );

      // Under 16A's unique index the second insert would have failed. The repository does not make
      // the schema stricter than Checkpoint 3 left it.
      expect(read).toHaveLength(3);
      expect(new Set(read.map((template) => template.ordinal))).toStrictEqual(new Set([1]));
    });
  });

  describe('a running step', () => {
    it('round-trips the snapshot columns, provenance and all', async () => {
      const seed = aStartedInstance([APPROVER]);
      const step = stepAt(seed, 0);
      const snapshotted = {
        ...step,
        sourceGroupId: uuidV7(),
        branchRule: 'first-response' as const,
        quorum: 1,
        condition: [OVER_FIFTY],
      };

      await inA(async (transaction) => {
        await fixture.stores.definitions.insert(transaction, seed.definition);
        await fixture.stores.versions.insert(transaction, seed.version);
        await fixture.stores.instances.insert(transaction, seed.instance);
        await fixture.stores.steps.insert(transaction, snapshotted);
      });

      const read = await inA((transaction) =>
        fixture.stores.steps.byId(transaction, snapshotted.stepId),
      );

      // `source_group_id` holds an identifier of a group that was never inserted, and the write
      // succeeds: it is provenance rather than a reference, which is what stops a running approval
      // depending on a list somebody may later delete.
      expect(read).toStrictEqual(snapshotted);
    });

    it('takes several steps of one instance at one ordinal, all awaiting at once', async () => {
      const seed = aStartedInstance([APPROVER]);
      const branch = [SECOND_APPROVER, DEPUTY].map((approver) => ({
        ...stepAt(seed, 0),
        stepId: uuidV7(),
        approverMembershipId: approver,
        status: 'awaiting' as const,
      }));

      await inA(async (transaction) => {
        await fixture.stores.definitions.insert(transaction, seed.definition);
        await fixture.stores.versions.insert(transaction, seed.version);
        await fixture.stores.instances.insert(transaction, seed.instance);
        for (const step of [stepAt(seed, 0), ...branch]) {
          await fixture.stores.steps.insert(transaction, step);
        }
      });

      const read = await inA((transaction) =>
        fixture.stores.steps.forInstance(transaction, seed.instance.instanceId),
      );

      // Three steps, one ordinal, three awaiting. Both of the indexes that would have refused this
      // were widened in Checkpoint 3, and the repository must not put either back.
      expect(read).toHaveLength(3);
      expect(read.filter((step) => step.status === 'awaiting')).toHaveLength(3);
      expect(new Set(read.map((step) => step.ordinal))).toStrictEqual(new Set([1]));
    });

    it('keeps a quorum an integer rather than a string or a float', async () => {
      const seed = aStartedInstance([APPROVER]);
      const step = { ...stepAt(seed, 0), quorum: 3, ordinal: 100_000 };

      await inA(async (transaction) => {
        await fixture.stores.definitions.insert(transaction, seed.definition);
        await fixture.stores.versions.insert(transaction, seed.version);
        await fixture.stores.instances.insert(transaction, seed.instance);
        await fixture.stores.steps.insert(transaction, step);
      });

      const read = await inA((transaction) => fixture.stores.steps.byId(transaction, step.stepId));

      // The tally is integer arithmetic over these two numbers. A quorum that came back as `'3'`
      // would make `responses >= quorum` a string comparison, and an ordinal past a smallint is the
      // AD-004 case the column type exists for.
      expect([read?.quorum, Number.isInteger(read?.quorum)]).toStrictEqual([3, true]);
      expect([read?.ordinal, Number.isInteger(read?.ordinal)]).toStrictEqual([100_000, true]);
    });
  });

  describe('the reads a branch makes, and their plans', () => {
    /**
     * The plan of a statement the repository itself issued.
     *
     * `enable_seqscan = off` asks the narrower question a fixture can honestly answer — whether an
     * index is *reachable* — rather than which index the planner prefers over a handful of rows.
     * Index choice at real volume is the performance checkpoint's.
     */
    const planFor = async (sql: string, parameters: readonly unknown[]): Promise<string> =>
      fixture.asTenant(TENANT_A, async (client) => {
        await client.query('set local enable_seqscan = off');

        const { rows } = await client.query<{ 'QUERY PLAN': string }>(
          `explain (format text) ${sql}`,
          parameters,
        );

        return rows.map((row) => row['QUERY PLAN']).join('\n');
      });

    it('reaches an index for a group search, with the tenant inside the condition', async () => {
      await inA(async (transaction) => {
        for (const code of ['a-group', 'b-group']) {
          await fixture.stores.groups.insert(transaction, aGroup(code));
        }
      });

      const plan = await planFor(
        `select g.id from workflow_approval_group g
           where g.tenant_id = $1 and g.deleted_at is null
           order by g.code, g.id limit 50 offset 0`,
        [TENANT_A],
      );

      expect(plan).toContain('workflow_approval_group_code_idx');
      expect(plan).not.toContain('Seq Scan');
      // The tenant is *inside* the index condition rather than a filter applied after it.
      expect(plan).toMatch(/Index Cond: \(tenant_id =/);
      /**
       * **An incremental sort, and not a full one.**
       *
       * The index is `(tenant_id, code)` and the read orders by `code, id` — deterministic paging
       * needs the identifier as a tie-break, and the index cannot supply it. What PostgreSQL does
       * with that is sort *within* each run of equal codes, and a code is unique per tenant, so each
       * run is one row. A plain `Sort` would be the thing to worry about: it would mean the whole
       * tenant's groups were read and ordered before the limit could apply.
       */
      expect(plan).toContain('Presorted Key: code');
      expect(plan).not.toMatch(/(?:^|->\s+)Sort\s+\(cost/m);
    });

    it('reaches an index for many groups at once, in one scan rather than one per group', async () => {
      const groups = [aGroup(), aGroup(), aGroup()];

      await inA(async (transaction) => {
        for (const group of groups) await fixture.stores.groups.insert(transaction, group);
      });

      const plan = await planFor(
        `select m.id from workflow_approval_group_member m
           where m.approval_group_id = any($1::uuid[]) and m.tenant_id = $2
             and m.deleted_at is null
           order by m.approval_group_id, m.membership_id`,
        [groups.map((group) => group.approvalGroupId), TENANT_A],
      );

      expect(plan).toContain('workflow_approval_group_member_group_idx');
      expect(plan).not.toContain('Seq Scan');
      // One scan over an array parameter — the plan is the same shape whatever the array's length,
      // which is what makes the cost of starting an approval independent of how many lists it names.
      // Three groups produce one `= ANY`, not three index conditions ORed together, and certainly
      // not three statements.
      expect(plan).toMatch(/approval_group_id = ANY/);
      expect(plan.match(/Index Scan/g) ?? []).toHaveLength(1);
    });

    it('reaches the branch index for an instance’s open steps', async () => {
      const plan = await planFor(
        `select s.id from workflow_step s
           where s.tenant_id = $1 and s.instance_id = $2 and s.status = 'awaiting'
             and s.deleted_at is null
           order by s.ordinal, s.id`,
        [TENANT_A, '01930000-0000-7000-8000-0000000000ee'],
      );

      expect(plan).toContain('workflow_step_awaiting_idx');
    });
  });
});
