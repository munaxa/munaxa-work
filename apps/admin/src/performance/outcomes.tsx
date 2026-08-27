import type { ReactNode } from 'react';
import type {
  CalibrationSessionView,
  CycleView,
  FeedbackView,
  ReconciliationFindingView,
  TalentPlacementView,
} from '@work/performance/contracts';

import { count, instant, reference } from './exact';
import {
  Cell,
  Clear,
  Figure,
  Identifier,
  Isolated,
  Note,
  Opens,
  PerformanceSection,
  Refused,
  Row,
  Rows,
  Sentence,
  Term,
  When,
  Wrote,
  shownOf,
} from './frame';
import type { Listing } from './api';
import { nameIn, type Language, type Translate } from './locale';
import { CALIBRATION_TONE, FEEDBACK_TONE } from './tones';

/**
 * What came out of the cycle: the calibration sessions, the nine-box, the feedback and what
 * reconciliation found.
 *
 * **Three separate permissions, three separate refusals.** `performance.calibrate` answers the
 * sessions, `performance.talent.read` the matrix and `performance.reconcile` the findings. A caller
 * who can read the cycles and not the matrix sees a withheld section, which is exactly what that
 * permission separation means.
 *
 * **Nothing here says "anonymous", and nothing here can.** Every feedback row is attributed: the
 * table carries the author, the correlation identifier records the request, and row-level security
 * is tenant-scoped. Feedback authorship is *confidential* — shown to those the API permits — and the
 * screen uses that word. Calling it anonymity would be claiming a guarantee this architecture
 * cannot make, to the person it matters to most.
 *
 * **The nine-box shows both bands separately.** Performance came from the review's own rating;
 * only potential was supplied by a human, and the box code is derived by the domain from the pair
 * rather than typed. Showing one blended figure would hide which axis was a measurement and which
 * was a judgement.
 */

export interface OutcomeProps {
  readonly t: Translate;
  readonly language: Language;
}

/** The calibration sessions of the running cycle, and how many decisions each recorded. */
export const CalibrationSection = ({
  t,
  language,
  sessions,
  cycle,
}: OutcomeProps & {
  readonly sessions: Listing<CalibrationSessionView> | undefined;
  readonly cycle: CycleView | undefined;
}): ReactNode => {
  const title = t('performance.label.calibrationSessions');

  if (cycle === undefined) return undefined;
  if (sessions === undefined)
    return <Refused t={t} title={title} reason="performance.withheld.calibration" />;
  if (sessions.items.length === 0)
    return <Clear t={t} title={title} message="performance.notice.noCalibration" />;

  return (
    <PerformanceSection title={title} description={shownOf(sessions)}>
      <Rows
        headings={[
          t('performance.label.code'),
          t('performance.label.name'),
          t('performance.label.unit'),
          t('performance.label.status'),
          t('performance.label.decisions'),
          t('performance.label.decidedAt'),
        ]}
        numeric={[4]}
      >
        {sessions.items.map((session) => (
          <Row key={session.calibrationSessionId}>
            <Cell>
              <Isolated>{session.code}</Isolated>
            </Cell>
            <Cell>
              <Wrote>{nameIn(session.name, language)}</Wrote>
            </Cell>
            <Identifier value={reference(session.organizationUnitId)} />
            <Cell>
              <Term
                t={t}
                group="calibrationStatus"
                value={session.status}
                tone={CALIBRATION_TONE[session.status]}
              />
            </Cell>
            <Cell numeric>
              <Figure>{count(session.decisionCount)}</Figure>
            </Cell>
            {/* The instant it concluded. A session still scheduled has not concluded, and shows so. */}
            <When>
              <Isolated>{instant(session.concludedAt, language)}</Isolated>
            </When>
          </Row>
        ))}
      </Rows>
      <Note t={t} message="performance.notice.calibrationKept" />
    </PerformanceSection>
  );
};

/** The nine-box placements: which review, which employment, and the two bands separately. */
export const TalentSection = ({
  t,
  placements,
  cycle,
}: {
  readonly t: Translate;
  readonly placements: Listing<TalentPlacementView> | undefined;
  readonly cycle: CycleView | undefined;
}): ReactNode => {
  const title = t('performance.label.talent');

  if (cycle === undefined) return undefined;
  if (placements === undefined)
    return <Refused t={t} title={title} reason="performance.withheld.talent" />;
  if (placements.items.length === 0)
    return <Clear t={t} title={title} message="performance.notice.noPlacements" />;

  return (
    <PerformanceSection title={title} description={shownOf(placements)}>
      <Rows
        headings={[
          t('performance.label.employment'),
          t('performance.label.review'),
          t('performance.label.box'),
          t('performance.label.performanceBand'),
          t('performance.label.potentialBand'),
          t('performance.label.reason'),
        ]}
        numeric={[3, 4]}
      >
        {placements.items.map((placement) => (
          <Row key={placement.talentPlacementId}>
            <Identifier value={reference(placement.employmentId)} />
            <Opens
              href={`/performance/reviews/${placement.reviewId}`}
              label={t('performance.label.openReview')}
              value={reference(placement.reviewId)}
            />
            <Cell>
              <Isolated>{placement.boxCode}</Isolated>
            </Cell>
            <Cell numeric>
              <Figure>{count(placement.performanceBand)}</Figure>
            </Cell>
            <Cell numeric>
              <Figure>{count(placement.potentialBand)}</Figure>
            </Cell>
            <Sentence>{placement.rationale}</Sentence>
          </Row>
        ))}
      </Rows>
      <Note t={t} message="performance.notice.bandsSeparate" />
    </PerformanceSection>
  );
};

/** Feedback given in this tenant. Attributed, never anonymous, and the screen says which. */
export const FeedbackSection = ({
  t,
  language,
  feedback,
  cycle,
}: OutcomeProps & {
  readonly feedback: Listing<FeedbackView> | undefined;
  readonly cycle: CycleView | undefined;
}): ReactNode => {
  const title = t('performance.label.feedback');

  if (cycle === undefined) return undefined;
  if (feedback === undefined)
    return <Refused t={t} title={title} reason="performance.withheld.feedback" />;
  if (feedback.items.length === 0)
    return <Clear t={t} title={title} message="performance.notice.noFeedback" />;

  return (
    <PerformanceSection title={title} description={shownOf(feedback)}>
      <Rows
        headings={[
          t('performance.label.subject'),
          t('performance.label.author'),
          t('performance.label.kind'),
          t('performance.label.visibility'),
          t('performance.label.body'),
          t('performance.label.givenAt'),
        ]}
      >
        {feedback.items.map((entry) => (
          <Row key={entry.feedbackId}>
            <Identifier value={reference(entry.subjectEmploymentId)} />
            <Identifier value={reference(entry.authorEmploymentId)} />
            <Cell>
              <Term
                t={t}
                group="feedbackKind"
                value={entry.kind}
                tone={FEEDBACK_TONE[entry.kind]}
              />
            </Cell>
            <Cell>{t(`performance.vocabulary.feedbackVisibility.${entry.visibility}`)}</Cell>
            <Sentence>{entry.body}</Sentence>
            <When>
              <Isolated>{instant(entry.givenAt, language)}</Isolated>
            </When>
          </Row>
        ))}
      </Rows>
      <Note t={t} message="performance.notice.notAnonymous" />
    </PerformanceSection>
  );
};

/**
 * What reconciliation found. **It reports; it repairs nothing.**
 *
 * `detail` is an open map the module fills per finding kind, so it is rendered as the pairs it
 * carries rather than reshaped into columns this screen invented. The kind is the module's own
 * closed vocabulary and is translated; the values inside `detail` are data and are not.
 */
export const FindingsSection = ({
  t,
  findings,
  cycle,
}: {
  readonly t: Translate;
  readonly findings: Listing<ReconciliationFindingView> | undefined;
  readonly cycle: CycleView | undefined;
}): ReactNode => {
  const title = t('performance.label.findings');

  if (cycle === undefined) return undefined;
  if (findings === undefined)
    return <Refused t={t} title={title} reason="performance.withheld.reconciliation" />;
  if (findings.items.length === 0)
    return <Clear t={t} title={title} message="performance.notice.noFindings" />;

  return (
    <PerformanceSection title={title} description={shownOf(findings)}>
      <Rows
        headings={[
          t('performance.label.kind'),
          t('performance.label.subject'),
          t('performance.label.detail'),
        ]}
      >
        {findings.items.map((finding) => (
          <Row key={`${finding.kind}-${finding.subjectId}`}>
            <Cell>{t(`performance.vocabulary.findingKind.${finding.kind}`)}</Cell>
            <Identifier value={reference(finding.subjectId)} />
            <Sentence>
              {Object.entries(finding.detail)
                .map(([key, value]) => `${key}: ${value}`)
                .join(' · ')}
            </Sentence>
          </Row>
        ))}
      </Rows>
      <Note t={t} message="performance.notice.findingsReportOnly" />
    </PerformanceSection>
  );
};
