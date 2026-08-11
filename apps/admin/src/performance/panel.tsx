import type { ReactNode } from 'react';
import type {
  CalibrationSessionView,
  FeedbackView,
  PeerAggregateView,
  ReconciliationFindingView,
  ReviewerAssignmentView,
  TalentPlacementView,
} from '@work/performance/contracts';

import { scoreText } from './scoring';
import {
  Empty,
  Figure,
  Section,
  Status,
  Table,
  instant,
  short,
  type SectionProps,
} from './sections';

/**
 * The multi-rater panel, calibration, the nine-box and feedback.
 *
 * **Nothing here says "anonymous", and nothing here can.** Every response is an attributed row: the
 * table carries `created_by`, the correlation identifier records the request, and row-level security
 * is tenant-scoped. The reviewer's identity is *confidential* — shown to those the API permits — and
 * the screen uses that word. Calling it anonymity would be claiming a guarantee this architecture
 * cannot make, and an employee told their feedback was anonymous when it is not has been misled
 * about something that matters to them.
 *
 * **Below the configured minimum the aggregate is withheld, and the screen says withheld.** That
 * withholds a number. It does not make the responses anonymous, and the field is called `available`
 * rather than `anonymous` for exactly that reason.
 */

export const PanelSection = ({
  t,
  language,
  reviewers,
  aggregate,
}: SectionProps & {
  readonly reviewers: readonly ReviewerAssignmentView[];
  readonly aggregate: PeerAggregateView | undefined;
}): ReactNode => (
  <Section t={t} title="panel" note="performance.notice.notAnonymous">
    {reviewers.length === 0 ? (
      <Empty t={t} />
    ) : (
      <Table t={t} headers={['reviewer', 'role', 'response', 'requestedAt']}>
        {reviewers.map((reviewer) => (
          <tr key={reviewer.reviewerAssignmentId}>
            {/* An identifier, and only to a caller the API let read this. Never "Anonymous". */}
            <td>{short(reviewer.reviewerEmploymentId)}</td>
            <td>{t(`performance.vocabulary.reviewerRole.${reviewer.role}`)}</td>
            <td>
              <Status t={t} group="assignmentStatus" status={reviewer.status} />
            </td>
            <td>{instant(reviewer.requestedAt, language)}</td>
          </tr>
        ))}
      </Table>
    )}

    {aggregate === undefined ? undefined : (
      <div className="flex flex-col gap-1">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <Figure t={t} label="responses" value={aggregate.responseCount} />
          <Figure t={t} label="minimumResponses" value={aggregate.minimumResponses ?? '—'} />
          {/* Present only when the minimum was met. A withheld aggregate shows no number at all. */}
          <Figure
            t={t}
            label="score"
            value={aggregate.available ? scoreText(aggregate.averageScore) : '—'}
          />
        </dl>
        {aggregate.available ? undefined : (
          <p className="text-xs opacity-70">{t('performance.notice.aggregateWithheld')}</p>
        )}
      </div>
    )}
  </Section>
);

export const CalibrationSection = ({
  t,
  language,
  sessions,
}: SectionProps & { readonly sessions: readonly CalibrationSessionView[] }): ReactNode => (
  <Section t={t} title="calibrationSessions" note="performance.notice.calibrationKept">
    {sessions.length === 0 ? (
      <Empty t={t} />
    ) : (
      <Table t={t} headers={['code', 'unit', 'status', 'decidedAt']}>
        {sessions.map((session) => (
          <tr key={session.calibrationSessionId}>
            <td>{session.code}</td>
            <td>{short(session.organizationUnitId)}</td>
            <td>
              <Status t={t} group="calibrationStatus" status={session.status} />
            </td>
            <td>{instant(session.concludedAt ?? session.scheduledFor, language)}</td>
          </tr>
        ))}
      </Table>
    )}
  </Section>
);

/**
 * The nine-box.
 *
 * **Performance comes from the review's own rating; only potential was supplied by a human.** The
 * box code is derived from the pair rather than typed, so a placement cannot flatter somebody the
 * engine rated otherwise — and the two bands are shown separately so an administrator can see which
 * axis was a measurement and which was a judgement.
 *
 * Nothing here is a career path or a succession plan. Those are Phase 15's, and this screen does not
 * anticipate them.
 */
export const TalentSection = ({
  t,
  language,
  placements,
  withheld,
}: SectionProps & {
  readonly placements: readonly TalentPlacementView[];
  readonly withheld: boolean;
}): ReactNode => (
  <Section t={t} title="talent">
    {withheld ? (
      <p className="text-sm opacity-70">{t('performance.notice.withheld')}</p>
    ) : placements.length === 0 ? (
      <Empty t={t} />
    ) : (
      <Table
        t={t}
        headers={['employment', 'performanceBand', 'potentialBand', 'box', 'reason', 'recordedAt']}
      >
        {placements.map((placement) => (
          <tr key={placement.talentPlacementId}>
            <td>{short(placement.employmentId)}</td>
            {/* Derived from the rating the engine produced, not supplied. */}
            <td>{placement.performanceBand}</td>
            <td>{placement.potentialBand}</td>
            <td>{placement.boxCode}</td>
            <td>{placement.rationale ?? '—'}</td>
            <td>{instant(placement.placedAt, language)}</td>
          </tr>
        ))}
      </Table>
    )}
  </Section>
);

/**
 * Performance feedback: continuous, attributed, and withdrawable without being erasable.
 *
 * This is Performance's own vocabulary — praise, suggestion, observation, requested — and not
 * Recruitment's interview feedback, which is a different act by different people about a different
 * question.
 */
export const FeedbackSection = ({
  t,
  language,
  feedback,
}: SectionProps & { readonly feedback: readonly FeedbackView[] }): ReactNode => (
  <Section t={t} title="feedback" note="performance.notice.notAnonymous">
    {feedback.length === 0 ? (
      <Empty t={t} />
    ) : (
      <Table t={t} headers={['subject', 'author', 'kind', 'visibility', 'body', 'givenAt']}>
        {feedback.map((given) => (
          <tr key={given.feedbackId}>
            <td>{short(given.subjectEmploymentId)}</td>
            {/* Always attributed. There is no `anonymous` visibility and there will not be one. */}
            <td>{short(given.authorEmploymentId)}</td>
            <td>{t(`performance.vocabulary.feedbackKind.${given.kind}`)}</td>
            <td>{t(`performance.vocabulary.feedbackVisibility.${given.visibility}`)}</td>
            <td>{given.body}</td>
            <td>{instant(given.givenAt, language)}</td>
          </tr>
        ))}
      </Table>
    )}
  </Section>
);

/** What reconciliation found. It reports; it repairs nothing. */
export const FindingsSection = ({
  t,
  findings,
  withheld,
}: SectionProps & {
  readonly findings: readonly ReconciliationFindingView[];
  readonly withheld: boolean;
}): ReactNode => (
  <Section t={t} title="findings">
    {withheld ? (
      <p className="text-sm opacity-70">{t('performance.notice.withheld')}</p>
    ) : findings.length === 0 ? (
      <Empty t={t} />
    ) : (
      <Table t={t} headers={['kind', 'review', 'reason']}>
        {findings.map((finding) => (
          <tr key={`${finding.kind}-${finding.subjectId}`}>
            <td>{finding.kind}</td>
            <td>{short(finding.subjectId)}</td>
            {/* The pairs the report attached, rendered as pairs. Nothing is interpreted:
                reconciliation names what is wrong and this screen repeats it. */}
            <td>
              {Object.entries(finding.detail)
                .map(([key, value]) => `${key}: ${value}`)
                .join(' · ') || '—'}
            </td>
          </tr>
        ))}
      </Table>
    )}
  </Section>
);
