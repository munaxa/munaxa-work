import type { ReactNode } from 'react';
import { Badge, Inline } from '@munaxa/ui';
import type { ApplicationView, CandidateView } from '@work/recruitment/contracts';

import {
  Cell,
  Clear,
  HiringSection,
  Isolated,
  Refused,
  Row,
  Rows,
  Term,
  shownOf,
  type HiringProps,
} from './frame';
import { DASH, count, day } from './exact';
import { orderedStatuses, textIn } from './locale';
import { APPLICATION_TONE, CANDIDATE_TONE, VACANCY_TONE } from './tones';
import type { Listing, VacancyPipeline } from './api';
import type { WorkspaceProps } from './workspace';

/**
 * The pipeline, the applications in it, and the people who applied.
 *
 * **The pipeline is the core surface of a hiring product and every number in it is the server's.**
 * `PipelineView` publishes `countsByStatus` and `total` from an aggregate query the module wrote
 * precisely so that a vacancy with forty thousand applications is not loaded to be counted. This
 * screen adds nothing to it: no percentage, no conversion rate, no stage-over-stage ratio and no
 * total of its own.
 *
 * **The applications list shows no candidate names.** `ApplicationView` carries none, and one
 * candidate read per row is the unbounded N+1 the module's own handler comments warn about. The
 * name is on the application record, one bounded read away, and the list says so.
 */

/**
 * One vacancy's pipeline, exactly as the server counted it.
 *
 * The stages are shown in the order Recruitment declares them, never sorted by size — a funnel that
 * reordered itself every time somebody applied would be unreadable. A stage the server did not
 * report is not shown as a zero: `countsByStatus` is what the aggregate query returned, and turning
 * an absent key into a nought would be this screen answering a question the server did not.
 */
const Stages = ({
  t,
  counts,
}: HiringProps & { readonly counts: Readonly<Record<string, number>> }): ReactNode => {
  const statuses = orderedStatuses(counts);

  if (statuses.length === 0) return <span>{t('recruitment.label.noApplications')}</span>;

  return (
    <Inline gap={2} wrap>
      {statuses.map((status) => (
        <Badge key={status} tone="muted" className="whitespace-nowrap">
          {t(`recruitment.status.application.${status}`)}
          {/* A separator that is a character rather than whitespace: JSX collapses the space
              between a translated word and an isolated number, and `Screening40` is not a stage. */}
          <span className="mx-1 opacity-50">·</span>
          <Isolated>{count(counts[status])}</Isolated>
        </Badge>
      ))}
    </Inline>
  );
};

const PipelineRow = ({
  t,
  language,
  entry,
  withStatus,
}: WorkspaceProps & {
  readonly entry: VacancyPipeline;
  readonly withStatus: boolean;
}): ReactNode => {
  const counts = entry.pipeline?.countsByStatus;

  return (
    <Row>
      <Cell>{textIn(entry.vacancy.title, language)}</Cell>
      {withStatus ? (
        <Cell>
          <Term
            t={t}
            group="vacancy"
            value={entry.vacancy.status}
            tone={VACANCY_TONE[entry.vacancy.status]}
          />
        </Cell>
      ) : null}
      <Cell numeric>{count(entry.pipeline?.total)}</Cell>
      <Cell>
        {counts === undefined ? (
          t('admin.notice.sectionWithheld')
        ) : (
          <Stages t={t} counts={counts} />
        )}
      </Cell>
    </Row>
  );
};

export const PipelineSection = ({
  t,
  language,
  pipelines,
  withStatus = false,
}: WorkspaceProps & {
  readonly pipelines: readonly VacancyPipeline[] | undefined;
  /**
   * Whether to carry the vacancy's own status.
   *
   * On the requisition record this table is the only list of that requisition's vacancies, so it
   * carries the status. On the hiring workspace the Vacancies section directly above already does,
   * and repeating it is duplicated information rather than a second useful column.
   */
  readonly withStatus?: boolean;
}): ReactNode => {
  const title = t('recruitment.label.pipeline');

  if (pipelines === undefined) return <Refused t={t} title={title} />;
  if (pipelines.length === 0) {
    return <Clear t={t} title={title} message="recruitment.label.noVacancies" />;
  }

  return (
    <HiringSection title={title} description={t('recruitment.label.pipelineIsCounted')}>
      <Rows
        headings={[
          t('recruitment.label.title'),
          ...(withStatus ? [t('recruitment.label.status')] : []),
          t('recruitment.label.applications'),
          t('recruitment.label.stages'),
        ]}
        numeric={[withStatus ? 2 : 1]}
      >
        {pipelines.map((entry) => (
          <PipelineRow
            key={entry.vacancy.vacancyId}
            t={t}
            language={language}
            entry={entry}
            withStatus={withStatus}
          />
        ))}
      </Rows>
    </HiringSection>
  );
};

const ApplicationRow = ({
  t,
  language,
  application,
}: WorkspaceProps & { readonly application: ApplicationView }): ReactNode => (
  <Row>
    <Cell>
      <a
        href={`/recruitment/applications/${application.applicationId}?lang=${language}`}
        className="underline underline-offset-4"
      >
        <Isolated>{application.applicationNumber}</Isolated>
      </a>
    </Cell>
    <Cell>
      <Term
        t={t}
        group="application"
        value={application.status}
        tone={APPLICATION_TONE[application.status]}
      />
    </Cell>
    <Cell>
      <Isolated>{application.stageCode ?? DASH}</Isolated>
    </Cell>
    <Cell>
      <Isolated>{day(application.appliedOn)}</Isolated>
    </Cell>
    <Cell>
      <Term t={t} group="hire" value={application.hireState} tone={undefined} />
    </Cell>
  </Row>
);

export const ApplicationsSection = ({
  t,
  language,
  applications,
}: WorkspaceProps & { readonly applications: Listing<ApplicationView> | undefined }): ReactNode => {
  const title = t('recruitment.label.applications');

  if (applications === undefined) return <Refused t={t} title={title} />;
  if (applications.items.length === 0) {
    return <Clear t={t} title={title} message="recruitment.label.noApplications" />;
  }

  return (
    <HiringSection title={title} description={shownOf(applications)}>
      <Rows
        headings={[
          t('recruitment.label.number'),
          t('recruitment.label.status'),
          t('recruitment.label.stage'),
          t('recruitment.label.appliedOn'),
          t('recruitment.label.hireState'),
        ]}
      >
        {applications.items.map((application) => (
          <ApplicationRow
            key={application.applicationId}
            t={t}
            language={language}
            application={application}
          />
        ))}
      </Rows>
      <p className="text-xs text-muted-foreground">{t('recruitment.label.namesOnTheRecord')}</p>
    </HiringSection>
  );
};

const CandidateRow = ({
  t,
  language,
  candidate,
}: WorkspaceProps & { readonly candidate: CandidateView }): ReactNode => (
  <Row>
    <Cell>
      <Isolated>{candidate.candidateNumber}</Isolated>
    </Cell>
    <Cell>{textIn(candidate.displayName, language)}</Cell>
    <Cell>
      <Term
        t={t}
        group="candidate"
        value={candidate.status}
        tone={CANDIDATE_TONE[candidate.status]}
      />
    </Cell>
    <Cell>
      <Isolated>{candidate.sourceCode}</Isolated>
    </Cell>
  </Row>
);

export const CandidatesSection = ({
  t,
  language,
  candidates,
}: WorkspaceProps & { readonly candidates: Listing<CandidateView> | undefined }): ReactNode => {
  const title = t('recruitment.label.candidates');

  if (candidates === undefined) return <Refused t={t} title={title} />;
  if (candidates.items.length === 0) {
    return <Clear t={t} title={title} message="recruitment.label.noCandidates" />;
  }

  return (
    <HiringSection title={title} description={shownOf(candidates)}>
      <Rows
        headings={[
          t('recruitment.label.number'),
          t('recruitment.label.candidate'),
          t('recruitment.label.status'),
          t('recruitment.label.source'),
        ]}
      >
        {candidates.items.map((candidate) => (
          <CandidateRow
            key={candidate.candidateId}
            t={t}
            language={language}
            candidate={candidate}
          />
        ))}
      </Rows>
    </HiringSection>
  );
};
