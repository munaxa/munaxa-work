import type { ReactNode } from 'react';
import { Badge, EmptyState, Inline, KpiGrid, StatCard } from '@munaxa/ui';
import type { RequisitionView, VacancyView } from '@work/recruitment/contracts';

import {
  Boundaries,
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
import { textIn, type Language } from './locale';
import { REQUISITION_TONE, VACANCY_TONE } from './tones';
import type { HiringForDisplay, Listing } from './api';

/**
 * The hiring workspace: what was authorized, and what is open because of it.
 *
 * The screen this replaced was three unrelated lists — requisitions, vacancies and candidates —
 * with no way to open any row and nothing anywhere that said how many people were in a pipeline.
 * The order here is the hiring process's own: headcount is authorized before an opening exists, and
 * an opening exists before anybody can apply.
 *
 * **Every figure is the server's.** The four totals are `PagedResult.total`, counted in the
 * database. Nothing on this screen sums headcount across requisitions, percentages a stage against
 * a total, or sorts a funnel by how many people are in it — a requisition's remaining headcount is
 * published per requisition because what is left is the number somebody acts on, and a sum of them
 * across a page would be a fifth figure the module never published.
 */

export interface WorkspaceProps extends HiringProps {
  readonly language: Language;
}

/**
 * One total.
 *
 * A refused read is a dash and **no sentence**: a tile is not the place to explain a boundary, and
 * four tiles each carrying the same apology is the wall of repeated apology the Employee Record's
 * verification named. The explanation is said once, by `NothingReadable` below.
 */
const Total = ({
  t,
  label,
  listing,
}: HiringProps & {
  readonly label: string;
  readonly listing: Listing<unknown> | undefined;
}): ReactNode => (
  <StatCard
    label={t(label)}
    value={listing === undefined ? DASH : count(listing.total)}
    hint={shownOf(listing)}
  />
);

/** True when not one of the four reads answered — the ordinary state of this deployment. */
export const answeredNothing = (hiring: HiringForDisplay): boolean =>
  hiring.requisitions === undefined &&
  hiring.vacancies === undefined &&
  hiring.candidates === undefined &&
  hiring.applications === undefined;

/**
 * The one sentence that replaces the whole workspace when nothing answered.
 *
 * Five headings and four tiles each carrying the same apology is what that state used to look like,
 * and it reads as a broken screen rather than a locked one. The Employee Record settled this: say it
 * once.
 */
export const NothingReadable = ({ t }: HiringProps): ReactNode => (
  <EmptyState
    title={t('recruitment.label.nothingReadable')}
    description={t('admin.notice.notSignedIn')}
  />
);

/** The four figures the workspace opens with, each one a total the server counted. */
export const HiringOverview = ({
  t,
  hiring,
}: HiringProps & { readonly hiring: HiringForDisplay }): ReactNode => (
  <KpiGrid cols={{ base: 2, md: 4 }}>
    <Total t={t} label="recruitment.label.requisitions" listing={hiring.requisitions} />
    <Total t={t} label="recruitment.label.vacancies" listing={hiring.vacancies} />
    <Total t={t} label="recruitment.label.applications" listing={hiring.applications} />
    <Total t={t} label="recruitment.label.candidates" listing={hiring.candidates} />
  </KpiGrid>
);

const RequisitionRow = ({
  t,
  language,
  requisition,
}: WorkspaceProps & { readonly requisition: RequisitionView }): ReactNode => (
  <Row>
    <Cell>
      <a
        href={`/recruitment/requisitions/${requisition.requisitionId}?lang=${language}`}
        className="underline underline-offset-4"
      >
        <Isolated>{requisition.requisitionNumber}</Isolated>
      </a>
    </Cell>
    <Cell>
      <Term
        t={t}
        group="requisition"
        value={requisition.status}
        tone={REQUISITION_TONE[requisition.status]}
      />
    </Cell>
    <Cell numeric>{count(requisition.headcountRequested)}</Cell>
    <Cell numeric>{count(requisition.headcountFilled)}</Cell>
    <Cell numeric>{count(requisition.headcountRemaining)}</Cell>
    <Cell>
      <Isolated>{day(requisition.targetStartDate)}</Isolated>
    </Cell>
  </Row>
);

export const RequisitionsSection = ({
  t,
  language,
  requisitions,
}: WorkspaceProps & { readonly requisitions: Listing<RequisitionView> | undefined }): ReactNode => {
  const title = t('recruitment.label.requisitions');

  if (requisitions === undefined) return <Refused t={t} title={title} />;
  if (requisitions.items.length === 0) {
    return <Clear t={t} title={title} message="recruitment.label.noRequisitions" />;
  }

  return (
    <HiringSection title={title} description={shownOf(requisitions)}>
      <Rows
        headings={[
          t('recruitment.label.number'),
          t('recruitment.label.status'),
          t('recruitment.label.headcount'),
          t('recruitment.label.filled'),
          t('recruitment.label.remaining'),
          t('recruitment.label.targetStartDate'),
        ]}
        numeric={[2, 3, 4]}
      >
        {requisitions.items.map((requisition) => (
          <RequisitionRow
            key={requisition.requisitionId}
            t={t}
            language={language}
            requisition={requisition}
          />
        ))}
      </Rows>
      <p className="text-xs text-muted-foreground">
        {t('recruitment.label.headcountIsAuthorized')}
      </p>
    </HiringSection>
  );
};

const VacancyRow = ({
  t,
  language,
  vacancy,
}: WorkspaceProps & { readonly vacancy: VacancyView }): ReactNode => (
  <Row>
    <Cell>{textIn(vacancy.title, language)}</Cell>
    <Cell>
      <Term t={t} group="vacancy" value={vacancy.status} tone={VACANCY_TONE[vacancy.status]} />
    </Cell>
    <Cell>
      <Isolated>{day(vacancy.openedOn)}</Isolated>
    </Cell>
    <Cell>
      <Isolated>{day(vacancy.closesOn)}</Isolated>
    </Cell>
    <Cell>
      {vacancy.channels.length === 0 ? (
        DASH
      ) : (
        <Inline gap={1} wrap>
          {vacancy.channels.map((channel) => (
            <Badge key={channel} tone="muted">
              <Isolated>{channel}</Isolated>
            </Badge>
          ))}
        </Inline>
      )}
    </Cell>
  </Row>
);

export const VacanciesSection = ({
  t,
  language,
  vacancies,
}: WorkspaceProps & { readonly vacancies: Listing<VacancyView> | undefined }): ReactNode => {
  const title = t('recruitment.label.vacancies');

  if (vacancies === undefined) return <Refused t={t} title={title} />;
  if (vacancies.items.length === 0) {
    return <Clear t={t} title={title} message="recruitment.label.noVacancies" />;
  }

  return (
    <HiringSection title={title} description={shownOf(vacancies)}>
      <Rows
        headings={[
          t('recruitment.label.title'),
          t('recruitment.label.status'),
          t('recruitment.label.openedOn'),
          t('recruitment.label.closesOn'),
          t('recruitment.label.channels'),
        ]}
      >
        {vacancies.items.map((vacancy) => (
          <VacancyRow key={vacancy.vacancyId} t={t} language={language} vacancy={vacancy} />
        ))}
      </Rows>
    </HiringSection>
  );
};

/** What this workspace does not do, said rather than left as an absence. */
const WORKSPACE_BOUNDARIES = [
  'recruitment.label.boundaryWrites',
  'recruitment.label.boundaryPerson',
  'recruitment.label.boundaryCompensation',
  'recruitment.label.boundaryPortal',
  'recruitment.label.boundaryDocuments',
  'recruitment.label.boundaryOrganization',
  'admin.notice.readOnly',
] as const;

export const WorkspaceBoundaries = ({ t }: HiringProps): ReactNode => (
  <Boundaries t={t} keys={WORKSPACE_BOUNDARIES} />
);
