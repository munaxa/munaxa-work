import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { uuidV7 } from '@work/kernel';
import { ALL_WORKFLOW_PERMISSIONS } from '@work/workflow';

import {
  APPROVER,
  B_APPROVER,
  CONNECTION,
  DEPUTY,
  REQUESTER,
  TENANT_A,
  TENANT_B,
  openWorkflowApi,
  permitting,
  requireDatabaseInCi,
  type WorkflowApiFixture,
} from './workflow-api.fixture.js';
import { anApprovalGroup, BASE, get, post } from './workflow-api-scenario.js';
import { http } from './workflow-api.fixture.js';

/**
 * The approval-group surface, over the wire.
 *
 * **A group is a list somebody wrote down, and every assertion here is about keeping it that.** No
 * route accepts a role, a manager, a position or an employment; no route resolves a membership
 * through Identity; and there is no route that answers "which lists is this person on" — the
 * question a directory exists to answer, and one this product has committed never to build.
 *
 * The tests are about the **edge**: what a malformed body earns, what a well-formed but refused one
 * earns, what a second tenant sees, and what an unknown property does. The rules themselves belong
 * to the domain and the database and are proved there; what is under test is that they arrive intact
 * and come back as the right status.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Workflow API approval-group suite');

const NAME = { en: 'Capital approvers', ar: 'معتمدو النفقات' };

suite('the approval-group API', () => {
  let fixture: WorkflowApiFixture;
  let inA: INestApplication;
  let inB: INestApplication;

  beforeAll(async () => {
    fixture = await openWorkflowApi();
    inA = await fixture.applicationFor(TENANT_A, permitting(...ALL_WORKFLOW_PERMISSIONS), APPROVER);
    inB = await fixture.applicationFor(
      TENANT_B,
      permitting(...ALL_WORKFLOW_PERMISSIONS),
      B_APPROVER,
    );
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  describe('naming a list and filling it', () => {
    it('creates a bilingual list, reads it back, and orders its members', async () => {
      const group = await anApprovalGroup(inA, [REQUESTER, APPROVER, DEPUTY]);
      const read = await get(inA, `/approval-groups/${group.approvalGroupId}`);
      const body = read.body as {
        readonly group: { readonly code: string; readonly name: Record<string, string> };
        readonly members: readonly { readonly membershipId: string; readonly addedOn: string }[];
      };

      expect(read.status).toBe(200);
      expect(body.group.name).toStrictEqual(NAME);
      // Ordered by membership identifier, which is what makes two reads agree and two approvals
      // started from one list produce their steps in the same sequence.
      expect(body.members.map((member) => member.membershipId)).toStrictEqual(
        [APPROVER, REQUESTER, DEPUTY].sort((left, right) => left.localeCompare(right)),
      );
      // An instant, as a string. No `Date` crosses this boundary in either direction.
      expect(body.members[0]?.addedOn).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('answers 404 for a list that is not there', async () => {
      const missing = await get(inA, `/approval-groups/${uuidV7()}`);

      expect(missing.status).toBe(404);
    });

    it('answers 400 for an identifier that is not a UUID', async () => {
      const malformed = await get(inA, '/approval-groups/not-a-uuid');

      expect(malformed.status).toBe(400);
    });
  });

  describe('what the edge refuses', () => {
    it('refuses a code that is not a code, and a name in one language', async () => {
      const shape = await post(inA, '/approval-groups', { code: 'Capital Approvers', name: NAME });
      const half = await post(inA, '/approval-groups', {
        code: 'half-named',
        name: { en: 'Only English' },
      });
      const missing = await post(inA, '/approval-groups', { code: 'nameless' });

      // 400 rather than 422: each of these is a client that can fix its request by sending
      // different bytes, which is exactly the distinction the shared filter draws.
      expect([shape.status, half.status, missing.status]).toStrictEqual([400, 400, 400]);
    });

    it('refuses an unknown property rather than dropping it', async () => {
      const smuggled = await post(inA, '/approval-groups', {
        code: 'smuggled',
        name: NAME,
        tenantId: TENANT_B,
        status: 'active',
        ownerMembershipId: APPROVER,
      });

      // `forbidNonWhitelisted`. A tenant that could arrive in a body is a tenant a client chooses,
      // and a `status` that silently dropped would be a lifecycle somebody thought they had set.
      expect(smuggled.status).toBe(400);
    });

    it('answers 409 for a code this tenant already used, and takes it in another', async () => {
      await post(inA, '/approval-groups', { code: 'finance-directors', name: NAME });

      const again = await post(inA, '/approval-groups', { code: 'finance-directors', name: NAME });
      const elsewhere = await post(inB, '/approval-groups', {
        code: 'finance-directors',
        name: NAME,
      });

      expect(again.status).toBe(409);
      // Codes are unique per tenant, not globally: two organizations both have finance directors.
      expect(elsewhere.status).toBe(201);
    });

    it('answers 409 for a membership already on the list, and 404 for a list that is not there', async () => {
      const group = await anApprovalGroup(inA, [APPROVER]);
      const again = await post(inA, `/approval-groups/${group.approvalGroupId}/members`, {
        membershipId: APPROVER,
      });
      const nowhere = await post(inA, `/approval-groups/${uuidV7()}/members`, {
        membershipId: APPROVER,
      });

      expect([again.status, nowhere.status]).toStrictEqual([409, 404]);
    });

    it('refuses a membership identifier that is not one', async () => {
      const group = await anApprovalGroup(inA, []);
      const malformed = await post(inA, `/approval-groups/${group.approvalGroupId}/members`, {
        membershipId: 'somebody',
      });

      expect(malformed.status).toBe(400);
    });
  });

  describe('taking somebody off a list', () => {
    const remove = (
      application: INestApplication,
      approvalGroupMemberId: string,
    ): Promise<{ readonly status: number }> =>
      http(application)
        .delete(`${BASE}/approval-groups/members/${approvalGroupMemberId}`)
        .send()
        .then((response) => ({ status: response.status }));

    it('removes exactly the named membership and leaves the list', async () => {
      const group = await anApprovalGroup(inA, [APPROVER, REQUESTER]);
      const removed = await remove(inA, group.approvalGroupMemberId);
      const read = await get(inA, `/approval-groups/${group.approvalGroupId}`);
      const body = read.body as {
        readonly members: readonly { readonly membershipId: string }[];
      };

      // 200 rather than 201: Nest answers a `DELETE` with 200, and the two creations on this
      // controller answer 201. Asserted as it is rather than as it might have been designed.
      expect(removed.status).toBe(200);
      // The helper removes the first membership it added, which is `APPROVER`. What is left is the
      // other one — not "one fewer", which a removal of the wrong row would also satisfy.
      expect(body.members.map((member) => member.membershipId)).toStrictEqual([REQUESTER]);
    });

    it('answers 404 for a membership row that is not there', async () => {
      expect((await remove(inA, uuidV7())).status).toBe(404);
    });

    it('refuses to remove a membership from another tenant’s list', async () => {
      const group = await anApprovalGroup(inA, [APPROVER]);

      // Not "forbidden": the row is invisible to B, which is indistinguishable from one that never
      // existed — the only answer that discloses nothing about what A is doing.
      expect((await remove(inB, group.approvalGroupMemberId)).status).toBe(404);

      const survived = await get(inA, `/approval-groups/${group.approvalGroupId}`);

      expect((survived.body as { readonly members: readonly unknown[] }).members).toHaveLength(1);
    });
  });

  describe('two tenants, the same names', () => {
    it('shows each tenant only its own lists, and totals only its own', async () => {
      await anApprovalGroup(inA, [APPROVER]);
      await anApprovalGroup(inA, [APPROVER]);
      await anApprovalGroup(inB, [B_APPROVER]);

      const mine = await get(inA, '/approval-groups');
      const theirs = await get(inB, '/approval-groups');

      expect((mine.body as { readonly total: number }).total).toBe(2);
      // A total computed without the tenant predicate would disclose how many lists another
      // organization keeps even when no row came back.
      expect((theirs.body as { readonly total: number }).total).toBe(1);
    });

    it('answers 404 rather than 403 for another tenant’s list', async () => {
      const group = await anApprovalGroup(inA, [APPROVER]);
      const seen = await get(inB, `/approval-groups/${group.approvalGroupId}`);

      expect(seen.status).toBe(404);
    });
  });

  describe('paging the lists', () => {
    beforeEach(async () => {
      for (let index = 0; index < 5; index += 1) await anApprovalGroup(inA, []);
    });

    const codesOn = async (query: string): Promise<readonly string[]> => {
      const page = await get(inA, `/approval-groups${query}`);

      return (page.body as { readonly items: readonly { readonly code: string }[] }).items.map(
        (item) => item.code,
      );
    };

    it('pages deterministically, with no overlap and nothing skipped', async () => {
      const first = await codesOn('?page=1&size=2');
      const second = await codesOn('?page=2&size=2');
      const third = await codesOn('?page=3&size=2');

      expect([first, second, third].flat()).toHaveLength(5);
      expect(new Set([first, second, third].flat()).size).toBe(5);
      // Ordered, so a row cannot appear on two pages and another on none.
      expect([...first, ...second, ...third]).toStrictEqual(
        [...first, ...second, ...third].sort((left, right) => left.localeCompare(right)),
      );
    });

    it('answers a page beyond the last with an empty page rather than a refusal', async () => {
      const beyond = await get(inA, '/approval-groups?page=99&size=2');

      expect(beyond.status).toBe(200);
      expect((beyond.body as { readonly items: readonly unknown[] }).items).toStrictEqual([]);
      // The total still counts everything behind the filter, which is what a screen shows.
      expect((beyond.body as { readonly total: number }).total).toBe(5);
    });

    it('falls back on a malformed page or size rather than reaching the database with NaN', async () => {
      for (const query of ['?page=abc', '?size=abc', '?page=0', '?size=-1', '?page=1.5']) {
        const page = await get(inA, `/approval-groups${query}`);

        expect([query, page.status]).toStrictEqual([query, 200]);
        expect([
          query,
          (page.body as { readonly items: readonly unknown[] }).items.length,
        ]).toStrictEqual([query, 5]);
      }
    });

    it('caps the page size rather than letting a caller ask for everything', async () => {
      const huge = await get(inA, '/approval-groups?size=100000');

      // The shared helper's maximum is 200; a caller cannot widen it from the query string.
      expect(huge.status).toBe(200);
      expect((huge.body as { readonly items: readonly unknown[] }).items).toHaveLength(5);
    });
  });
});
