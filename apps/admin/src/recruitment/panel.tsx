import type { ReactNode } from 'react';
import { Inline } from '@munaxa/ui';
import type { FeedbackView, InterviewView, OfferView } from '@work/recruitment/contracts';

import {
  Cell,
  Clear,
  HiringSection,
  Identifier,
  Isolated,
  Reference,
  Refused,
  Row,
  Rows,
  Term,
  type HiringProps,
} from './frame';
import { DASH, count, day, instant } from './exact';
import { INTERVIEW_TONE, OFFER_TONE } from './tones';
import type { ApplicationProps } from './application';
import type { InterviewFeedback } from './api';

/**
 * The panel, what it said, and what was offered.
 *
 * **Feedback is never aggregated.** No average, no total, no majority, no "three of five recommend"
 * and no composite verdict. Recruitment publishes each interviewer's recommendation and score and
 * refuses to combine them, and its reason is the right one: whether three fours beat one five is a
 * hiring policy, and a formula shipped in a screen would be that policy invented where the
 * specification is silent. Each verdict is rendered as its own row, in the server's own order.
 *
 * **Withheld is not empty.** Feedback sits behind `recruitment.interview.feedback.read`, which is a
 * different permission from the one that reads the application: a caller may see that an interview
 * happened and not what the panel thought of the candidate. That interview's row says the panel's
 * answer was withheld — never that nobody answered, which on a hiring record is the opposite claim.
 *
 * **An offer's figures are not shown.** `proposedCompensation` is published as an opaque map the
 * module stores as authored and never computes with, and Compensation is authoritative for what
 * anybody is actually paid. What is rendered is the offer's *state*: its status, its version, the
 * dates it turns on, and when it was answered.
 *
 * **Interviewers stay identifiers.** A panel of five on each of four rounds is twenty employment
 * reads to render twenty names, which is the unbounded lookup the applications list already refuses;
 * the one bounded name this slice resolves is on the requisition, where there is one of each.
 */

const InterviewRow = ({
  t,
  language,
  interview,
}: ApplicationProps & { readonly interview: InterviewView }): ReactNode => (
  <Row>
    <Cell numeric>{count(interview.roundNumber)}</Cell>
    <Cell>
      <Isolated>{interview.modeCode}</Isolated>
    </Cell>
    <Cell>
      <Term
        t={t}
        group="interview"
        value={interview.status}
        tone={INTERVIEW_TONE[interview.status]}
      />
    </Cell>
    <Cell>
      <Isolated>{instant(interview.scheduledFrom, language)}</Isolated>
    </Cell>
    <Cell>
      <Isolated>{instant(interview.scheduledTo, language)}</Isolated>
    </Cell>
    <Cell>
      {interview.locationText === undefined ? DASH : <Isolated>{interview.locationText}</Isolated>}
    </Cell>
    <Cell>
      {interview.interviewerEmploymentIds.length === 0 ? (
        DASH
      ) : (
        <Inline gap={2} wrap>
          {interview.interviewerEmploymentIds.map((employmentId) => (
            <Reference key={employmentId} value={employmentId} />
          ))}
        </Inline>
      )}
    </Cell>
  </Row>
);

export const InterviewsSection = ({
  t,
  language,
  interviews,
}: ApplicationProps & { readonly interviews: readonly InterviewView[] }): ReactNode => {
  const title = t('recruitment.label.interviews');

  if (interviews.length === 0) {
    return <Clear t={t} title={title} message="recruitment.label.noInterviews" />;
  }

  return (
    <HiringSection title={title}>
      <Rows
        headings={[
          t('recruitment.label.round'),
          t('recruitment.label.mode'),
          t('recruitment.label.status'),
          t('recruitment.label.from'),
          t('recruitment.label.to'),
          t('recruitment.label.location'),
          t('recruitment.label.interviewers'),
        ]}
        numeric={[0]}
      >
        {interviews.map((interview) => (
          <InterviewRow
            key={interview.interviewId}
            t={t}
            language={language}
            interview={interview}
          />
        ))}
      </Rows>
      <p className="text-xs text-muted-foreground">{t('recruitment.label.boundaryInterviewers')}</p>
    </HiringSection>
  );
};

const FeedbackRow = ({
  t,
  language,
  round,
  verdict,
}: ApplicationProps & {
  readonly round: number;
  readonly verdict: FeedbackView;
}): ReactNode => (
  <Row>
    <Cell numeric>{count(round)}</Cell>
    <Identifier value={verdict.interviewerEmploymentId} />
    <Cell>{t(`recruitment.recommendation.${verdict.recommendation}`)}</Cell>
    <Cell numeric>{count(verdict.score)}</Cell>
    <Cell>{verdict.strengths === undefined ? DASH : <Isolated>{verdict.strengths}</Isolated>}</Cell>
    <Cell>{verdict.concerns === undefined ? DASH : <Isolated>{verdict.concerns}</Isolated>}</Cell>
    <Cell>
      <Isolated>{instant(verdict.submittedAt, language)}</Isolated>
    </Cell>
  </Row>
);

/** One row saying an interview's panel was withheld — deliberately not an absent row. */
const WithheldRow = ({ t, round }: HiringProps & { readonly round: number }): ReactNode => (
  <Row>
    <Cell numeric>{count(round)}</Cell>
    <Cell>{t('admin.notice.sectionWithheld')}</Cell>
    <Cell>{DASH}</Cell>
    <Cell numeric>{DASH}</Cell>
    <Cell>{DASH}</Cell>
    <Cell>{DASH}</Cell>
    <Cell>{DASH}</Cell>
  </Row>
);

const roundOf = (interviews: readonly InterviewView[], interviewId: string): number | undefined =>
  interviews.find((interview) => interview.interviewId === interviewId)?.roundNumber;

/**
 * Every verdict the panel recorded, one row each, with nothing computed from them.
 *
 * The rows are grouped by interview because that is how they were given; the round number comes
 * from the interview the snapshot already returned, so no extra read is made to label a row.
 */
export const PanelSection = ({
  t,
  language,
  interviews,
  panels,
}: ApplicationProps & {
  readonly interviews: readonly InterviewView[];
  readonly panels: readonly InterviewFeedback[];
}): ReactNode => {
  const title = t('recruitment.label.panel');

  if (panels.length === 0) {
    return <Clear t={t} title={title} message="recruitment.label.noInterviews" />;
  }

  // `recruitment.interview.feedback.read` is held by a caller, not by an interview, so when it is
  // refused every round is refused together. Saying so once is the record's own rule — a withheld
  // section is one line, not the same sentence repeated down a column.
  if (panels.every((panel) => panel.feedback === undefined)) {
    return <Refused t={t} title={title} />;
  }

  return (
    <HiringSection title={title}>
      <Rows
        headings={[
          t('recruitment.label.round'),
          t('recruitment.label.interviewer'),
          t('recruitment.label.recommendation'),
          t('recruitment.label.score'),
          t('recruitment.label.strengths'),
          t('recruitment.label.concerns'),
          t('recruitment.label.submittedAt'),
        ]}
        numeric={[0, 3]}
      >
        {panels.map((panel) => {
          const round = roundOf(interviews, panel.interviewId) ?? 0;

          if (panel.feedback === undefined) {
            return <WithheldRow key={panel.interviewId} t={t} round={round} />;
          }
          return panel.feedback.map((verdict) => (
            <FeedbackRow
              key={verdict.feedbackId}
              t={t}
              language={language}
              round={round}
              verdict={verdict}
            />
          ));
        })}
      </Rows>
      <p className="text-xs text-muted-foreground">{t('recruitment.label.boundaryFeedback')}</p>
    </HiringSection>
  );
};

const OfferRow = ({
  t,
  language,
  offer,
}: ApplicationProps & { readonly offer: OfferView }): ReactNode => (
  <Row>
    <Cell>
      <Isolated>{offer.offerNumber}</Isolated>
    </Cell>
    <Cell numeric>{count(offer.offerVersion)}</Cell>
    <Cell>
      <Term t={t} group="offer" value={offer.status} tone={OFFER_TONE[offer.status]} />
    </Cell>
    <Cell>
      <Isolated>{day(offer.proposedStartDate)}</Isolated>
    </Cell>
    <Cell>
      <Isolated>{day(offer.expiresOn)}</Isolated>
    </Cell>
    <Cell>
      <Isolated>{instant(offer.issuedAt, language)}</Isolated>
    </Cell>
    <Cell>
      <Isolated>{instant(offer.decidedAt, language)}</Isolated>
    </Cell>
    <Cell>
      {offer.decisionNote === undefined ? DASH : <Isolated>{offer.decisionNote}</Isolated>}
    </Cell>
  </Row>
);

export const OffersSection = ({
  t,
  language,
  offers,
}: ApplicationProps & { readonly offers: readonly OfferView[] }): ReactNode => {
  const title = t('recruitment.label.offers');

  if (offers.length === 0) {
    return <Clear t={t} title={title} message="recruitment.label.noOffers" />;
  }

  return (
    <HiringSection title={title}>
      <Rows
        headings={[
          t('recruitment.label.number'),
          t('recruitment.label.version'),
          t('recruitment.label.status'),
          t('recruitment.label.proposedStartDate'),
          t('recruitment.label.expiresOn'),
          t('recruitment.label.issuedAt'),
          t('recruitment.label.decidedAt'),
          t('recruitment.label.note'),
        ]}
        numeric={[1]}
      >
        {offers.map((offer) => (
          <OfferRow key={offer.offerId} t={t} language={language} offer={offer} />
        ))}
      </Rows>
      <p className="text-xs text-muted-foreground">{t('recruitment.label.boundaryCompensation')}</p>
    </HiringSection>
  );
};
