import { beforeEach, describe, expect, it } from 'vitest';

import type { CandidateSnapshot, RequisitionSnapshot } from '../contracts/views.js';

import { inMemoryRecruitmentStores } from './in-memory-stores.js';
import { RecruitmentPermissions } from './recruitment-permissions.js';
import {
  TENANT_A,
  TENANT_B,
  aCandidate,
  anApprovedRequisition,
  asTenant,
  ask,
  harnessFor,
  harnessWithStores,
  send,
  testClock,
  type Harness,
} from './recruitment-test-harness.js';

/**
 * Who may do what, and what one tenant can see of another.
 *
 * The separations asserted here are the ones the approved decisions turn on. **A recruiter does not
 * hold People's or Employment's permissions** and never acquires them: the module holds the narrow
 * cross-domain permission for the duration of one operation (ADR-0043), which is why a caller with
 * only recruitment permissions can create a candidate, match against People and hire.
 *
 * **Approving is not managing**, for requisitions and for offers alike; **writing feedback is not
 * managing interviews**; and **anonymizing is neither**. Each is a control somebody would otherwise
 * hold by accident.
 */
describe('authorization', () => {
  let harness: Harness;

  beforeEach(() => {
    testClock.reset();
    harness = harnessFor(TENANT_A);
  });

  it('lets a recruiter with no People permission match a candidate against the register', () =>
    asTenant(TENANT_A, async () => {
      const onlyRecruitment = harnessFor(TENANT_A, [
        RecruitmentPermissions.candidateManage,
        RecruitmentPermissions.candidateRead,
      ]);
      const candidate = await aCandidate(onlyRecruitment);

      onlyRecruitment.people.add(candidate.email);

      const matched = await ask<{ matches: readonly unknown[] }>(onlyRecruitment, {
        queryName: 'recruitment.match-candidate',
        candidateId: candidate.candidateId,
      });

      if (!matched.ok) throw new Error('expected a match list');
      expect(matched.value.matches).toHaveLength(1);
    }));

  it('refuses to approve a requisition for somebody who may only manage one', () =>
    asTenant(TENANT_A, async () => {
      const manager = harnessFor(TENANT_A, [RecruitmentPermissions.requisitionManage]);
      const created = await send<{ requisitionId: string }>(manager, {
        commandName: 'recruitment.create-requisition',
        positionId: manager.organization.add(),
        unitId: manager.organization.add(),
        headcountRequested: 1,
        reasonCode: 'growth',
        requestedByEmploymentId: manager.employment.add(),
      });

      if (!created.ok) throw new Error('expected a requisition');
      await send(manager, {
        commandName: 'recruitment.submit-requisition',
        requisitionId: created.value.requisitionId,
        expectedVersion: 1,
      });

      const decided = await send(manager, {
        commandName: 'recruitment.decide-requisition',
        requisitionId: created.value.requisitionId,
        decision: 'approved',
        expectedVersion: 2,
      });

      expect(decided.ok).toBe(false);
      if (decided.ok) return;
      expect(decided.error.kind).toBe('forbidden');
    }));

  it('refuses to publish a vacancy for somebody who may only edit one', () =>
    asTenant(TENANT_A, async () => {
      const requisition = await anApprovedRequisition(harness);
      const vacancy = await send<{ vacancyId: string }>(harness, {
        commandName: 'recruitment.open-vacancy',
        requisitionId: requisition.requisitionId,
        title: { en: 'Field engineer', ar: 'مهندس ميداني' },
      });

      if (!vacancy.ok) throw new Error('expected a vacancy');

      const editor = harnessWithStores(TENANT_A, harness.stores, [
        RecruitmentPermissions.vacancyManage,
      ]);
      const published = await send(editor, {
        commandName: 'recruitment.publish-vacancy',
        vacancyId: vacancy.value.vacancyId,
        expectedVersion: 1,
      });

      expect(published.ok).toBe(false);
    }));

  it('refuses to anonymize a candidate for somebody who may manage them', () =>
    asTenant(TENANT_A, async () => {
      const candidate = await aCandidate(harness);
      const recruiter = harnessWithStores(TENANT_A, harness.stores, [
        RecruitmentPermissions.candidateManage,
      ]);
      const anonymized = await send(recruiter, {
        commandName: 'recruitment.anonymize-candidate',
        candidateId: candidate.candidateId,
        expectedVersion: 1,
      });

      expect(anonymized.ok).toBe(false);
    }));

  it('refuses to export for somebody who may read', () =>
    asTenant(TENANT_A, async () => {
      const reader = harnessFor(TENANT_A, [
        RecruitmentPermissions.candidateRead,
        RecruitmentPermissions.applicationRead,
      ]);
      const exported = await ask(reader, { queryName: 'recruitment.export' });

      expect(exported.ok).toBe(false);
    }));
});

describe('tenant isolation', () => {
  it('does not answer one tenant’s read with another tenant’s candidate', async () => {
    testClock.reset();

    const stores = inMemoryRecruitmentStores();
    const first = harnessWithStores(TENANT_A, stores);
    const second = harnessWithStores(TENANT_B, stores);
    const candidate = await asTenant(TENANT_A, () => aCandidate(first));
    const read = await asTenant(TENANT_B, () =>
      ask<CandidateSnapshot>(second, {
        queryName: 'recruitment.read-candidate',
        candidateId: candidate.candidateId,
      }),
    );

    expect(read.ok).toBe(false);
    if (read.ok) return;
    // Not "forbidden": naming a candidate identifier as real would itself disclose that somebody is
    // in this system, and in this module they never consented to being here.
    expect(read.error.kind).toBe('not_found');
  });

  it('keeps each tenant’s numbering to itself', async () => {
    testClock.reset();

    const stores = inMemoryRecruitmentStores();
    const first = harnessWithStores(TENANT_A, stores);
    const second = harnessWithStores(TENANT_B, stores);
    const one = await asTenant(TENANT_A, () => anApprovedRequisition(first));
    const two = await asTenant(TENANT_B, () => anApprovedRequisition(second));
    const readFirst = await asTenant(TENANT_A, () =>
      ask<RequisitionSnapshot>(first, {
        queryName: 'recruitment.read-requisition',
        requisitionId: one.requisitionId,
      }),
    );
    const readSecond = await asTenant(TENANT_B, () =>
      ask<RequisitionSnapshot>(second, {
        queryName: 'recruitment.read-requisition',
        requisitionId: two.requisitionId,
      }),
    );

    if (!readFirst.ok || !readSecond.ok) throw new Error('expected both requisitions');
    // Both are the first requisition of their own tenant. A shared counter would have made one of
    // them the second, and a customer auditing their numbers would find a gap nobody could explain.
    expect(readFirst.value.requisition.requisitionNumber).toBe('REQ-2026-000001');
    expect(readSecond.value.requisition.requisitionNumber).toBe('REQ-2026-000001');
  });

  it('does not let one tenant search another’s pipeline', async () => {
    testClock.reset();

    const stores = inMemoryRecruitmentStores();
    const first = harnessWithStores(TENANT_A, stores);
    const second = harnessWithStores(TENANT_B, stores);

    await asTenant(TENANT_A, () => aCandidate(first));

    const found = await asTenant(TENANT_B, () =>
      ask<{ total: number }>(second, { queryName: 'recruitment.search-candidates' }),
    );

    if (!found.ok) throw new Error('expected a page');
    expect(found.value.total).toBe(0);
  });
});
