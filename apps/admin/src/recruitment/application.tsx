import type { ReactNode } from 'react';
import type { ApplicationEventView, ApplicationView } from '@work/recruitment/contracts';

import {
  Boundaries,
  Cell,
  Clear,
  Fact,
  Facts,
  HiringSection,
  Identifier,
  Isolated,
  Reference,
  Row,
  Rows,
  Term,
  type HiringProps,
  type Tone,
} from './frame';
import { DASH, day, instant } from './exact';
import { textIn, type Language } from './locale';
import { APPLICATION_TONE, CANDIDATE_TONE, HIRE_TONE } from './tones';
import type { ApplicationForDisplay } from './api';

/**
 * One application: who applied, where they have got to, and how they got there.
 *
 * **The snapshot is one read and this screen does not take it apart.** `ApplicationSnapshot` returns
 * the application, its history, its interviews and its offers together, and the module's own handler
 * says why: answering the question in four round trips is four chances to show an interview from one
 * state beside a status from another. Nothing here re-asks for any of them.
 *
 * **A hire that stopped half way stays visible.** `hireState` is published as a state rather than a
 * success, because a hire that registered a person and failed to create an employment is a fact
 * operations must be able to see (ADR-0046). `failed` is rendered like every other state, and
 * success is never inferred from an employment identifier being present.
 *
 * **The candidate is a bounded read, not a lookup pass.** `ApplicationView` carries a `candidateId`
 * and no name, so the name comes from one `GET /recruitment/candidates/:candidateId` on this one
 * application — which is exactly why the applications list on the workspace shows no names at all.
 *
 * **Contact details are not shown.** Recruitment publishes a candidate's email and telephone under
 * `recruitment.candidate.read`, and this screen renders neither: what it is for is the hiring
 * decision, and a candidate is a person who does not work here yet. The boundary is stated rather
 * than left as an apparent omission.
 */

export const applicationTone = (status: string): Tone => APPLICATION_TONE[status] ?? 'muted';

export interface ApplicationProps extends HiringProps {
  readonly language: Language;
}

/** The candidate, when the caller may read candidates. */
const Candidate = ({
  t,
  language,
  detail,
}: ApplicationProps & { readonly detail: ApplicationForDisplay }): ReactNode => {
  const candidate = detail.candidate?.candidate;

  if (candidate === undefined) {
    return (
      <>
        <Fact label={t('recruitment.label.candidate')} value={t('admin.notice.sectionWithheld')} />
        <Fact
          label={t('recruitment.label.candidateId')}
          value={<Reference value={detail.snapshot.application.candidateId} />}
        />
      </>
    );
  }

  return (
    <>
      <Fact
        label={t('recruitment.label.candidate')}
        value={textIn(candidate.displayName, language)}
      />
      <Fact
        label={t('recruitment.label.candidateNumber')}
        value={<Isolated>{candidate.candidateNumber}</Isolated>}
      />
      <Fact
        label={t('recruitment.label.candidateStatus')}
        value={
          <Term
            t={t}
            group="candidate"
            value={candidate.status}
            tone={CANDIDATE_TONE[candidate.status]}
          />
        }
      />
      <Fact
        label={t('recruitment.label.person')}
        value={
          candidate.personId === undefined ? (
            t('recruitment.label.notYetAPerson')
          ) : (
            <Reference value={candidate.personId} />
          )
        }
      />
    </>
  );
};

/** Where the hire got to, when one was attempted. Never inferred from an employment existing. */
const Hire = ({
  t,
  language,
  application,
}: ApplicationProps & { readonly application: ApplicationView }): ReactNode => (
  <>
    <Fact
      label={t('recruitment.label.hireState')}
      value={
        <Term
          t={t}
          group="hire"
          value={application.hireState}
          tone={application.hireState === undefined ? undefined : HIRE_TONE[application.hireState]}
        />
      }
    />
    <Fact
      label={t('recruitment.label.hireFailure')}
      value={
        application.hireFailureReason === undefined ? (
          DASH
        ) : (
          <Isolated>{application.hireFailureReason}</Isolated>
        )
      }
    />
    <Fact
      label={t('recruitment.label.employment')}
      value={
        application.employmentId === undefined ? (
          DASH
        ) : (
          <a
            href={`/employment/${application.employmentId}?lang=${language}`}
            className="underline underline-offset-4"
          >
            {t('recruitment.label.openTheRecord')}
          </a>
        )
      }
    />
  </>
);

export const ApplicationSummary = ({
  t,
  language,
  detail,
}: ApplicationProps & { readonly detail: ApplicationForDisplay }): ReactNode => {
  const application = detail.snapshot.application;

  return (
    <Facts>
      <Candidate t={t} language={language} detail={detail} />
      <Fact
        label={t('recruitment.label.stage')}
        value={<Isolated>{application.stageCode ?? DASH}</Isolated>}
      />
      <Fact
        label={t('recruitment.label.appliedOn')}
        value={<Isolated>{day(application.appliedOn)}</Isolated>}
      />
      <Fact
        label={t('recruitment.label.source')}
        value={<Isolated>{application.sourceCode}</Isolated>}
      />
      <Fact
        label={t('recruitment.label.screening')}
        value={<Isolated>{application.screeningOutcome ?? DASH}</Isolated>}
      />
      <Fact
        label={t('recruitment.label.rejectionReason')}
        value={<Isolated>{application.rejectionReasonCode ?? DASH}</Isolated>}
      />
      <Hire t={t} language={language} application={application} />
    </Facts>
  );
};

const HistoryRow = ({
  t,
  language,
  event,
}: ApplicationProps & { readonly event: ApplicationEventView }): ReactNode => (
  <Row>
    <Cell>
      <Isolated>{instant(event.occurredAt, language)}</Isolated>
    </Cell>
    <Cell>
      <Term
        t={t}
        group="application"
        value={event.fromStatus}
        tone={event.fromStatus === undefined ? undefined : APPLICATION_TONE[event.fromStatus]}
      />
    </Cell>
    <Cell>
      <Term
        t={t}
        group="application"
        value={event.toStatus}
        tone={APPLICATION_TONE[event.toStatus]}
      />
    </Cell>
    <Cell>
      <Isolated>{event.stageCode ?? DASH}</Isolated>
    </Cell>
    <Cell>
      <Isolated>{event.reasonCode ?? DASH}</Isolated>
    </Cell>
    <Cell>{event.note === undefined ? DASH : <Isolated>{event.note}</Isolated>}</Cell>
    <Identifier value={event.recordedBy} />
  </Row>
);

/**
 * Every movement, newest first.
 *
 * The module writes a history row in the same transaction as the movement, so a history cannot be
 * missing for exactly the change somebody later disputes — and the order is the server's, sorted by
 * the handler rather than re-sorted here.
 */
export const HistorySection = ({
  t,
  language,
  history,
}: ApplicationProps & { readonly history: readonly ApplicationEventView[] }): ReactNode => {
  const title = t('recruitment.label.history');

  if (history.length === 0) {
    return <Clear t={t} title={title} message="recruitment.label.noHistory" />;
  }

  return (
    <HiringSection title={title}>
      <Rows
        headings={[
          t('recruitment.label.occurredAt'),
          t('recruitment.label.from'),
          t('recruitment.label.to'),
          t('recruitment.label.stage'),
          t('recruitment.label.reason'),
          t('recruitment.label.note'),
          t('recruitment.label.recordedBy'),
        ]}
      >
        {history.map((event) => (
          <HistoryRow key={event.eventId} t={t} language={language} event={event} />
        ))}
      </Rows>
    </HiringSection>
  );
};

/** What the application record does not do. */
const APPLICATION_BOUNDARIES = [
  'recruitment.label.boundaryWrites',
  'recruitment.label.boundaryContact',
  'recruitment.label.boundaryCompensation',
  'recruitment.label.boundaryFeedback',
  'recruitment.label.boundaryInterviewers',
  'admin.notice.readOnly',
] as const;

export const ApplicationBoundaries = ({ t }: HiringProps): ReactNode => (
  <Boundaries t={t} keys={APPLICATION_BOUNDARIES} />
);
