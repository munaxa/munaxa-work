import { beforeEach, describe, expect, it } from 'vitest';

import type { DuplicateCandidateView } from '../contracts/views.js';

import {
  ALL,
  MARCH,
  TENANT_A,
  aPerson,
  asTenant,
  ask,
  harnessFor,
  send,
  testClock,
  type Harness,
} from './people-test-harness.js';

/**
 * AD-001 — *a Person is created once* — proven at the moment it is about to be broken.
 *
 * What a duplicate costs is not tidiness. A second Person for one human being splits their service
 * period, so an end-of-service gratuity computes on four years instead of eleven; it splits their
 * leave balance and their loan repayments; and it registers one national identifier twice with a
 * social insurance authority. Every one of those looks like a correct number.
 */

const AHMED = { en: 'Ahmed Al-Ghamdi', ar: 'أحمد الغامدي' };
/** The same name typed without the hamza. One human being, two keyboards. */
const AHMED_AGAIN = { en: 'Ahmed Alghamdi', ar: 'احمد الغامدي' };

const pending = async (harness: Harness): Promise<readonly DuplicateCandidateView[]> => {
  const listed = await ask<{ readonly items: readonly DuplicateCandidateView[] }>(harness, {
    queryName: 'people.list-duplicates',
    status: 'pending',
  });

  return listed.ok ? listed.value.items : [];
};

describe('creating somebody who may already exist', () => {
  let harness: Harness;

  beforeEach(() => {
    testClock.reset();
    harness = harnessFor(TENANT_A, ALL);
  });

  it('is refused before the second record is written, not discovered after payroll ran twice', async () => {
    await asTenant(TENANT_A, async () => {
      await aPerson(harness, 'P-0001', AHMED, { dateOfBirth: '1990-03-14' });

      const again = await send(harness, {
        commandName: 'people.create-person',
        personNumber: 'P-0002',
        legalName: AHMED_AGAIN,
        dateOfBirth: '1990-03-14',
      });

      expect(again.ok).toBe(false);
      expect(!again.ok && again.error).toMatchObject({ reason: 'person_may_already_exist' });
    });
  });

  it('is allowed when the caller acknowledges it, because twins are two people', async () => {
    await asTenant(TENANT_A, async () => {
      await aPerson(harness, 'P-0001', AHMED, { dateOfBirth: '1990-03-14' });

      const again = await send<{ readonly duplicatesQueued: number }>(harness, {
        commandName: 'people.create-person',
        personNumber: 'P-0002',
        legalName: AHMED_AGAIN,
        dateOfBirth: '1990-03-14',
        acknowledgedDuplicates: true,
      });

      expect(again.ok && again.value.duplicatesQueued).toBe(1);
    });
  });

  it('queues the pair for a human rather than merging anything by itself', async () => {
    await asTenant(TENANT_A, async () => {
      await aPerson(harness, 'P-0001', AHMED, { dateOfBirth: '1990-03-14' });
      await aPerson(harness, 'P-0002', AHMED_AGAIN, {
        dateOfBirth: '1990-03-14',
        acknowledgedDuplicates: true,
      });

      const queue = await pending(harness);

      expect(queue).toHaveLength(1);
      expect(queue[0]).toMatchObject({ reason: 'name-and-date-of-birth', status: 'pending' });
    });
  });

  it('does not flag two people who share a name and were born on different days', async () => {
    await asTenant(TENANT_A, async () => {
      await aPerson(harness, 'P-0001', AHMED, { dateOfBirth: '1990-03-14' });

      const other = await send(harness, {
        commandName: 'people.create-person',
        personNumber: 'P-0002',
        legalName: AHMED,
        dateOfBirth: '1991-07-02',
      });

      expect(other.ok).toBe(true);
      expect(await pending(harness)).toHaveLength(0);
    });
  });
});

describe('the identifier, which is where a duplicate is usually found', () => {
  let harness: Harness;

  beforeEach(() => {
    testClock.reset();
    harness = harnessFor(TENANT_A, ALL);
  });

  it('refuses a number another person already holds, without echoing the number back', async () => {
    await asTenant(TENANT_A, async () => {
      const first = await aPerson(harness, 'P-0001', AHMED);
      const second = await aPerson(harness, 'P-0002', {
        en: 'A. Alghamdi',
        ar: 'أ. الغامدي',
      });

      await send(harness, {
        commandName: 'people.record-identifier',
        personId: first,
        identifierType: 'national-id',
        value: '1234567890',
      });

      const clash = await send(harness, {
        commandName: 'people.record-identifier',
        personId: second,
        identifierType: 'national-id',
        value: '1234567890',
      });

      expect(clash.ok).toBe(false);
      expect(JSON.stringify(clash.ok ? {} : clash.error)).not.toContain('1234567890');
    });
  });

  it('recognizes one document typed with different separators as one document', async () => {
    await asTenant(TENANT_A, async () => {
      const first = await aPerson(harness, 'P-0001', AHMED);
      const second = await aPerson(harness, 'P-0002', { en: 'A. G.', ar: 'أ. غ.' });

      await send(harness, {
        commandName: 'people.record-identifier',
        personId: first,
        identifierType: 'national-id',
        value: '1234-5678-90',
      });

      const clash = await send(harness, {
        commandName: 'people.record-identifier',
        personId: second,
        identifierType: 'national-id',
        value: '1234 5678 90',
      });

      expect(clash.ok).toBe(false);
    });
  });

  it('does not clash a passport against a national identifier that shares a number', async () => {
    await asTenant(TENANT_A, async () => {
      const first = await aPerson(harness, 'P-0001', AHMED);
      const second = await aPerson(harness, 'P-0002', { en: 'A. G.', ar: 'أ. غ.' });

      await send(harness, {
        commandName: 'people.record-identifier',
        personId: first,
        identifierType: 'national-id',
        value: '1234567890',
      });

      const passport = await send(harness, {
        commandName: 'people.record-identifier',
        personId: second,
        identifierType: 'passport',
        value: '1234567890',
      });

      expect(passport.ok).toBe(true);
    });
  });

  it('stops flagging a withdrawn document, so a renewal does not flag its own holder', async () => {
    await asTenant(TENANT_A, async () => {
      const person = await aPerson(harness, 'P-0001', AHMED);
      const other = await aPerson(harness, 'P-0002', { en: 'A. G.', ar: 'أ. غ.' });
      const recorded = await send<{ readonly identifierId: string }>(harness, {
        commandName: 'people.record-identifier',
        personId: person,
        identifierType: 'passport',
        value: 'X9988776',
      });

      if (!recorded.ok) throw new Error('unreachable');

      await send(harness, {
        commandName: 'people.withdraw-identifier',
        identifierId: recorded.value.identifierId,
        expectedVersion: 1,
      });

      // Recording the same number for somebody else no longer clashes with the withdrawn one.
      const reused = await send(harness, {
        commandName: 'people.record-identifier',
        personId: other,
        identifierType: 'passport',
        value: 'X9988776',
      });

      expect(reused.ok).toBe(true);
    });
  });

  it('flags a shared mobile number, which is weaker evidence than a document and still evidence', async () => {
    await asTenant(TENANT_A, async () => {
      const first = await aPerson(harness, 'P-0001', AHMED);
      const second = await aPerson(harness, 'P-0002', { en: 'A. G.', ar: 'أ. غ.' });

      await send(harness, {
        commandName: 'people.record-contact',
        personId: first,
        channel: 'mobile',
        purpose: 'personal',
        value: '+966 50 123 4567',
        effectiveFrom: MARCH,
      });

      const clash = await send(harness, {
        commandName: 'people.record-contact',
        personId: second,
        channel: 'mobile',
        purpose: 'personal',
        value: '+966501234567',
        effectiveFrom: MARCH,
      });

      expect(clash.ok).toBe(false);
      expect(!clash.ok && clash.error).toMatchObject({
        reason: 'contact_may_belong_to_another_person',
      });
    });
  });
});

describe('reviewing a duplicate', () => {
  let harness: Harness;

  beforeEach(() => {
    testClock.reset();
    harness = harnessFor(TENANT_A, ALL);
  });

  const aQueuedPair = async (): Promise<DuplicateCandidateView> => {
    await aPerson(harness, 'P-0001', AHMED, { dateOfBirth: '1990-03-14' });
    await aPerson(harness, 'P-0002', AHMED_AGAIN, {
      dateOfBirth: '1990-03-14',
      acknowledgedDuplicates: true,
    });

    const queue = await pending(harness);
    const candidate = queue[0];

    if (candidate === undefined) throw new Error('nothing was queued');
    return candidate;
  };

  it('records the decision and who made it, taken from the context rather than the command', async () => {
    await asTenant(TENANT_A, async () => {
      const candidate = await aQueuedPair();
      const reviewed = await send(harness, {
        commandName: 'people.review-duplicate',
        candidateId: candidate.candidateId,
        decision: 'dismissed',
        note: 'Brothers. Different national identifiers.',
        expectedVersion: candidate.version,
        // A caller trying to name somebody else as the reviewer.
        reviewedBy: 'user:somebody-else',
      });

      expect(reviewed.ok).toBe(true);

      const listed = await ask<{ readonly items: readonly DuplicateCandidateView[] }>(harness, {
        queryName: 'people.list-duplicates',
        status: 'dismissed',
      });

      expect(listed.ok && listed.value.items[0]?.reviewedBy).not.toBe('user:somebody-else');
    });
  });

  it('is terminal, so re-deciding cannot overwrite who decided and when', async () => {
    await asTenant(TENANT_A, async () => {
      const candidate = await aQueuedPair();

      await send(harness, {
        commandName: 'people.review-duplicate',
        candidateId: candidate.candidateId,
        decision: 'dismissed',
        expectedVersion: candidate.version,
      });

      const again = await send(harness, {
        commandName: 'people.review-duplicate',
        candidateId: candidate.candidateId,
        decision: 'confirmed',
        expectedVersion: candidate.version + 1,
      });

      expect(again.ok).toBe(false);
      expect(!again.ok && again.error).toMatchObject({ kind: 'rejected' });
    });
  });

  it('confirming does not merge anybody — a merge is a separate, separately held command', async () => {
    await asTenant(TENANT_A, async () => {
      const candidate = await aQueuedPair();

      await send(harness, {
        commandName: 'people.review-duplicate',
        candidateId: candidate.candidateId,
        decision: 'confirmed',
        expectedVersion: candidate.version,
      });

      const read = await ask<{ readonly status: string }>(harness, {
        queryName: 'people.read-person',
        personId: candidate.duplicateOfPersonId,
      });

      expect(read.ok && read.value.status).not.toBe('merged');
    });
  });

  it('queues one decision for a pair however many times detection runs', async () => {
    await asTenant(TENANT_A, async () => {
      const candidate = await aQueuedPair();

      await send(harness, { commandName: 'people.rescan-person', personId: candidate.personId });
      await send(harness, {
        commandName: 'people.rescan-person',
        personId: candidate.duplicateOfPersonId,
      });

      expect(await pending(harness)).toHaveLength(1);
    });
  });
});
