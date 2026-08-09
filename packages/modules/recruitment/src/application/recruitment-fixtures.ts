import { anApplication, send, type Harness } from './recruitment-test-harness.js';

/**
 * The two multi-step fixtures the pipeline and hire suites share.
 *
 * They go through the real commands rather than writing rows, because the states they produce — an
 * application in `interviewing`, an offer that was drafted, approved, issued and accepted — are
 * exactly the preconditions the rules under test depend on. A fixture that wrote them directly would
 * quietly disable the rules it was setting up.
 */

export interface PipelineFixture {
  readonly applicationId: string;
  readonly candidateId: string;
  readonly vacancyId: string;
  readonly requisitionId: string;
}

/**
 * An application that has reached `interviewing`, through the funnel rather than into the middle of
 * it: `received → interviewing` is not a permitted transition, which is the pipeline being a
 * pipeline.
 */
export const anInterviewedApplication = async (harness: Harness): Promise<PipelineFixture> => {
  const application = await anApplication(harness);

  for (const [index, status] of ['screening', 'interviewing'].entries()) {
    const moved = await send(harness, {
      commandName: 'recruitment.move-application',
      applicationId: application.applicationId,
      status,
      expectedVersion: index + 1,
    });

    if (!moved.ok) throw new Error(`could not move to ${status}: ${JSON.stringify(moved.error)}`);
  }
  return application;
};

/** An application with an accepted offer: everything the hire needs, and nothing more. */
export const anAcceptedOffer = async (
  harness: Harness,
): Promise<PipelineFixture & { readonly offerId: string }> => {
  const application = await anInterviewedApplication(harness);
  const offer = await send<{ offerId: string }>(harness, {
    commandName: 'recruitment.draft-offer',
    applicationId: application.applicationId,
    proposedStartDate: '2026-11-01',
    proposedCompensation: { base: '18000', period: 'monthly' },
    proposedEmploymentTypeCode: 'full-time',
    currencyCode: 'SAR',
  });

  if (!offer.ok) throw new Error('expected an offer');

  const { offerId } = offer.value;
  const steps = [
    { commandName: 'recruitment.submit-offer', offerId, expectedVersion: 1 },
    { commandName: 'recruitment.decide-offer', offerId, decision: 'approved', expectedVersion: 2 },
    {
      commandName: 'recruitment.issue-offer',
      offerId,
      expectedVersion: 3,
      expectedApplicationVersion: 3,
    },
    {
      commandName: 'recruitment.record-offer-response',
      offerId,
      response: 'accepted',
      expectedVersion: 4,
    },
  ];

  for (const step of steps) {
    const result = await send(harness, step);

    if (!result.ok) {
      throw new Error(`${step.commandName} failed: ${JSON.stringify(result.error)}`);
    }
  }
  return { ...application, offerId };
};
