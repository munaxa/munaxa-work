import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { uuidV7 } from '@work/kernel';
import { ALL_WORKFLOW_PERMISSIONS } from '@work/workflow';

import {
  APPROVER,
  CONNECTION,
  DEPUTY,
  TENANT_A,
  UNADOPTED,
  openWorkflowApi,
  permitting,
  requireDatabaseInCi,
  type WorkflowApiFixture,
} from './workflow-api.fixture.js';
import { aDraftVersion, anApprovalGroup, post } from './workflow-api-scenario.js';

/**
 * Configuring a branch over HTTP, and what the edge refuses on the way.
 *
 * The branch itself running — two people asked at once, one tally, one completed approval — is
 * `workflow.parallel.spec.ts`. This file is only about what a version will accept.
 *
 * **The kind of approver is derived and never sent.** There is no `approverKind` property on the
 * step body, so `forbidNonWhitelisted` refuses one outright — a client cannot claim `group` while
 * naming a person, and `role` has no field to arrive in. Naming both approvers or neither is the
 * *domain's* refusal rather than a 400, because both bodies are well formed and which one the caller
 * meant is a question about the process they are configuring.
 *
 * **Nothing about a tally is computed here.** The controller carries a rule, a quorum and a
 * condition through untouched; the denominator, the threshold and the outcome come back from the
 * application's own view. A second implementation at the edge would be a second answer to "who is
 * approved", disagreeing with the first the day either changed.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Workflow API branch suite');

const NAME = { en: 'Approval', ar: 'اعتماد' };

interface StepBody {
  readonly ordinal: number;
  readonly name?: Record<string, string>;
  readonly approverMembershipId?: string;
  readonly approverGroupId?: string;
  readonly branchRule?: string;
  readonly quorum?: number;
  readonly condition?: readonly Record<string, unknown>[];
  readonly approverKind?: string;
}

suite('configuring a branch over HTTP', () => {
  let fixture: WorkflowApiFixture;
  let application: INestApplication;
  let workflowVersionId: string;

  beforeAll(async () => {
    fixture = await openWorkflowApi();
    application = await fixture.applicationFor(
      TENANT_A,
      permitting(...ALL_WORKFLOW_PERMISSIONS),
      APPROVER,
    );
  });

  afterAll(async () => {
    await fixture.close();
  });

  /** A fresh definition and draft version per test, so a refusal is never the previous test's. */
  beforeEach(async () => {
    await fixture.truncate();
    workflowVersionId = (await aDraftVersion(application, UNADOPTED)).workflowVersionId;
  });

  const addStep = (step: StepBody): Promise<{ readonly status: number }> =>
    post(application, `/versions/${workflowVersionId}/steps`, { name: NAME, ...step });

  describe('which approver a step names', () => {
    it('takes a person, and takes a list', async () => {
      const group = await anApprovalGroup(application, [APPROVER]);
      const person = await addStep({ ordinal: 1, approverMembershipId: APPROVER });
      const list = await addStep({ ordinal: 2, approverGroupId: group.approvalGroupId });

      expect([person.status, list.status]).toStrictEqual([201, 201]);
    });

    it('refuses a step naming both, and one naming neither', async () => {
      const group = await anApprovalGroup(application, [APPROVER]);
      const both = await addStep({
        ordinal: 1,
        approverMembershipId: APPROVER,
        approverGroupId: group.approvalGroupId,
      });
      const neither = await addStep({ ordinal: 1 });

      // 422 rather than 400: both bodies are well formed, and the domain names which mistake it was
      // — `step-approver-ambiguous` for two readings, `step-approver-required` for none.
      expect([both.status, neither.status]).toStrictEqual([422, 422]);
    });

    it('refuses a client that tries to name the kind itself', async () => {
      const smuggled = await addStep({
        ordinal: 1,
        approverMembershipId: APPROVER,
        approverKind: 'group',
      });
      const invented = await addStep({
        ordinal: 1,
        approverMembershipId: APPROVER,
        approverKind: 'role',
      });

      // Refused at the edge by `forbidNonWhitelisted`, so the derivation cannot be argued with —
      // and `role` is not "an unknown kind" here, it is an unknown *property*.
      expect([smuggled.status, invented.status]).toStrictEqual([400, 400]);
    });

    it('answers 404 for a list that is not there', async () => {
      const nowhere = await addStep({ ordinal: 1, approverGroupId: uuidV7() });

      // Caught while the administrator is still editing, rather than at every approval started from
      // a version that names a list nobody can find.
      expect(nowhere.status).toBe(404);
    });
  });

  describe('how a branch ends', () => {
    it('takes the three rules the domain declares and refuses a fourth', async () => {
      for (const branchRule of ['unanimous', 'majority', 'first-response']) {
        const taken = await addStep({ ordinal: 1, approverMembershipId: APPROVER, branchRule });

        expect([branchRule, taken.status]).toStrictEqual([branchRule, 201]);
      }

      const invented = await addStep({
        ordinal: 1,
        approverMembershipId: DEPUTY,
        branchRule: 'two-thirds',
      });

      // A proportion would arrive as a rule, and there is nowhere for one to be stored even if the
      // edge let it past.
      expect(invented.status).toBe(400);
    });

    it('takes a quorum of one or more and refuses zero, a negative and a fraction', async () => {
      const one = await addStep({ ordinal: 1, approverMembershipId: APPROVER, quorum: 1 });

      expect(one.status).toBe(201);
      for (const quorum of [0, -1, 1.5]) {
        const refused = await addStep({ ordinal: 1, approverMembershipId: DEPUTY, quorum });

        expect([quorum, refused.status]).toStrictEqual([quorum, 400]);
      }
    });

    it('refuses a quorum larger than the branch when the version is published', async () => {
      await addStep({ ordinal: 1, approverMembershipId: APPROVER, quorum: 2 });

      const published = await post(application, `/versions/${workflowVersionId}/publication`, {
        expectedVersion: 1,
      });

      // 422: a branch of one that needs two responses could never end, and the version is where a
      // branch's size is finally known.
      expect(published.status).toBe(422);
    });
  });

  describe('the condition a branch runs under', () => {
    it('takes the five operators the domain declares', async () => {
      const conditions = [
        { key: 'kind', operator: 'equals', value: 'capital' },
        { key: 'kind', operator: 'not-equals', value: 'revenue' },
        { key: 'amount', operator: 'greater-than', value: 50_000 },
        { key: 'amount', operator: 'less-than', value: 90_000 },
        { key: 'unit', operator: 'in', value: ['finance', 'operations'] },
      ];
      const taken = await addStep({
        ordinal: 1,
        approverMembershipId: APPROVER,
        condition: conditions,
      });

      expect(taken.status).toBe(201);
    });

    it('refuses an operator the domain does not have, and a clause with no key', async () => {
      const invented = await addStep({
        ordinal: 1,
        approverMembershipId: APPROVER,
        condition: [{ key: 'amount', operator: 'matches', value: 'x' }],
      });
      const keyless = await addStep({
        ordinal: 1,
        approverMembershipId: APPROVER,
        condition: [{ operator: 'equals', value: 'x' }],
      });
      const valueless = await addStep({
        ordinal: 1,
        approverMembershipId: APPROVER,
        condition: [{ key: 'amount', operator: 'equals' }],
      });

      expect([invented.status, keyless.status, valueless.status]).toStrictEqual([400, 400, 400]);
    });

    it('leaves the kind of a value to the domain rather than guessing at the edge', async () => {
      const mistyped = await addStep({
        ordinal: 1,
        approverMembershipId: APPROVER,
        condition: [{ key: 'amount', operator: 'greater-than', value: 'lots' }],
      });

      // A text bound on an ordering comparison is well formed on the wire and refused by
      // `conditionIsWellFormed` with a reason that names the comparison — 422, not 400. Declaring
      // `value` as a number at the edge would have refused the `equals`-on-text case the feature
      // exists for.
      expect(mistyped.status).toBe(422);
    });
  });
});
