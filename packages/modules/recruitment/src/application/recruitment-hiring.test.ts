import { beforeEach, describe, expect, it } from 'vitest';
import { uuidV7 } from '@work/kernel';

import type { ApplicationSnapshot, FeedbackView } from '../contracts/views.js';

import {
  TENANT_A,
  asTenant,
  ask,
  harnessFor,
  send,
  testClock,
  type Harness,
} from './recruitment-test-harness.js';
import { anAcceptedOffer, anInterviewedApplication } from './recruitment-fixtures.js';

/**
 * Interviews, offers and the hire.
 *
 * The hire tests are the ones that matter most in this module: the saga spans three transactions and
 * two other domains, and what is asserted here is not that the happy path works but that a stopped
 * hire is **detectable**, that a retry **converges** rather than duplicating, and that an
 * application never reads `hired` without an employment behind it (ADR-0046).
 */

describe('interviews', () => {
  let harness: Harness;

  beforeEach(() => {
    testClock.reset();
    harness = harnessFor(TENANT_A);
  });

  it('refuses a panel naming an employment that does not exist in this tenant', () =>
    asTenant(TENANT_A, async () => {
      const application = await anInterviewedApplication(harness);
      const scheduled = await send(harness, {
        commandName: 'recruitment.schedule-interview',
        applicationId: application.applicationId,
        roundNumber: 1,
        modeCode: 'video',
        interviewerEmploymentIds: [uuidV7()],
      });

      expect(scheduled.ok).toBe(false);
    }));

  it('refuses feedback from somebody who was not on the panel', () =>
    asTenant(TENANT_A, async () => {
      const application = await anInterviewedApplication(harness);
      const interviewer = harness.employment.add();
      const interview = await send<{ interviewId: string }>(harness, {
        commandName: 'recruitment.schedule-interview',
        applicationId: application.applicationId,
        roundNumber: 1,
        modeCode: 'video',
        interviewerEmploymentIds: [interviewer],
      });

      if (!interview.ok) throw new Error('expected an interview');

      const submitted = await send(harness, {
        commandName: 'recruitment.submit-interview-feedback',
        interviewId: interview.value.interviewId,
        interviewerEmploymentId: harness.employment.add(),
        recommendation: 'yes',
      });

      expect(submitted.ok).toBe(false);
    }));

  it('takes one verdict per interviewer and refuses a revision', () =>
    asTenant(TENANT_A, async () => {
      const application = await anInterviewedApplication(harness);
      const interviewer = harness.employment.add();
      const interview = await send<{ interviewId: string }>(harness, {
        commandName: 'recruitment.schedule-interview',
        applicationId: application.applicationId,
        roundNumber: 1,
        modeCode: 'video',
        interviewerEmploymentIds: [interviewer],
      });

      if (!interview.ok) throw new Error('expected an interview');

      const first = await send(harness, {
        commandName: 'recruitment.submit-interview-feedback',
        interviewId: interview.value.interviewId,
        interviewerEmploymentId: interviewer,
        score: 4,
        recommendation: 'yes',
      });
      const second = await send(harness, {
        commandName: 'recruitment.submit-interview-feedback',
        interviewId: interview.value.interviewId,
        interviewerEmploymentId: interviewer,
        score: 5,
        recommendation: 'strong_yes',
      });

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(false);

      const read = await ask<readonly FeedbackView[]>(harness, {
        queryName: 'recruitment.read-feedback',
        interviewId: interview.value.interviewId,
      });

      if (!read.ok) throw new Error('expected feedback');
      expect(read.value).toHaveLength(1);
      expect(read.value[0]?.score).toBe(4);
    }));
});

describe('offers', () => {
  let harness: Harness;

  beforeEach(() => {
    testClock.reset();
    harness = harnessFor(TENANT_A);
  });

  it('stores the proposed compensation as authored and never interprets it', () =>
    asTenant(TENANT_A, async () => {
      const application = await anAcceptedOffer(harness);
      const read = await ask<ApplicationSnapshot>(harness, {
        queryName: 'recruitment.read-application',
        applicationId: application.applicationId,
      });

      if (!read.ok) throw new Error('expected an application');
      expect(read.value.offers[0]?.proposedCompensation).toStrictEqual({
        base: '18000',
        period: 'monthly',
      });
      expect(read.value.offers[0]?.status).toBe('accepted');
    }));

  it('refuses a second live offer for one application', () =>
    asTenant(TENANT_A, async () => {
      const application = await anAcceptedOffer(harness);
      const second = await send<{ offerId: string; offerVersion: number }>(harness, {
        commandName: 'recruitment.draft-offer',
        applicationId: application.applicationId,
        proposedStartDate: '2026-12-01',
      });

      if (!second.ok) throw new Error('expected a second version');
      expect(second.value.offerVersion).toBe(2);

      await send(harness, {
        commandName: 'recruitment.submit-offer',
        offerId: second.value.offerId,
        expectedVersion: 1,
      });
      await send(harness, {
        commandName: 'recruitment.decide-offer',
        offerId: second.value.offerId,
        decision: 'approved',
        expectedVersion: 2,
      });

      const issued = await send(harness, {
        commandName: 'recruitment.issue-offer',
        offerId: second.value.offerId,
        expectedVersion: 3,
        expectedApplicationVersion: 3,
      });

      expect(issued.ok).toBe(false);
    }));

  it('refuses an acceptance recorded against terms nobody issued', () =>
    asTenant(TENANT_A, async () => {
      const application = await anInterviewedApplication(harness);
      const offer = await send<{ offerId: string }>(harness, {
        commandName: 'recruitment.draft-offer',
        applicationId: application.applicationId,
        proposedStartDate: '2026-11-01',
      });

      if (!offer.ok) throw new Error('expected an offer');

      const accepted = await send(harness, {
        commandName: 'recruitment.record-offer-response',
        offerId: offer.value.offerId,
        response: 'accepted',
        expectedVersion: 1,
      });

      expect(accepted.ok).toBe(false);
    }));
});
