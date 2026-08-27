import type { ReactNode } from 'react';
import type { EmploymentView } from '@work/employment/contracts';
import type { LeaveRequestDayView, LeaveRequestView, LeaveTypeView } from '@work/leave/contracts';

import {
  Boundaries,
  Cell,
  Clear,
  Duration,
  Fact,
  Facts,
  Isolated,
  LeaveSection,
  Reference,
  Wrote,
  Row,
  Rows,
  Term,
  When,
  type LeaveProps,
} from './frame';
import { DASH, count, day, instant, minutes, reference } from './exact';
import { nameIn, type Language } from './locale';
import { standingHref } from './register';
import type { RequestForDisplay } from './api';

/**
 * One leave request, opened.
 *
 * Until this route existed the product could list a leave request and never examine one: there was
 * no way to see which dates it covered, whether anybody had decided it, or what the requester's
 * balance was when they asked. A request whose row does not open is a report.
 *
 * **The request is the subject.** Its dates and its state are the heading; the facts it reports
 * about itself are directly under it, and the dates it covers are the first section because that is
 * what a leave request *is*.
 *
 * **Three reads, two permissions, and one of them belongs to another module.** `leave.read` answers
 * the request, its approval chain and the configured types; Employment's own bounded read of one
 * identifier answers who the requester is, and returns a name only when the caller may read the
 * person. Each says which of those happened to it.
 *
 * **Nothing here computes.** The total is the request's own `totalMinutes`, each date's length is
 * that day row's own `minutes`, and the expected length beside it is the day row's own
 * `expectedMinutes`. A screen that added the day rows up would be a second answer to a question the
 * domain settled once, against a policy and a working pattern this screen cannot see.
 */

export interface RequestProps extends LeaveProps {
  readonly language: Language;
}

/** The request's own leave type, found in the one list Leave publishes. Never guessed. */
export const typeOf = (
  types: readonly LeaveTypeView[] | undefined,
  leaveTypeId: string,
): LeaveTypeView | undefined => types?.find((type) => type.leaveTypeId === leaveTypeId);

const Requester = ({
  t,
  language,
  request,
  employment,
}: RequestProps & {
  readonly request: LeaveRequestView;
  readonly employment: EmploymentView | undefined;
}): ReactNode => (
  <>
    <Fact
      label={t('leave.label.employment')}
      value={
        <a
          href={standingHref(request.employmentId, language, request.leaveTypeId)}
          className="underline underline-offset-4"
        >
          <Reference value={reference(request.employmentId)} />
        </a>
      }
    />
    <Fact
      label={t('leave.label.person')}
      value={
        employment?.personName === undefined
          ? t('admin.label.notResolved')
          : nameIn(employment.personName as { en: string; ar: string }, language)
      }
    />
    <Fact
      label={t('leave.label.employmentNumber')}
      value={<Reference value={reference(employment?.employmentNumber)} />}
    />
  </>
);

/** What the request says about itself, in the one raised block this screen gets. */
export const RequestSummary = ({
  t,
  language,
  detail,
}: RequestProps & { readonly detail: RequestForDisplay }): ReactNode => {
  const { request, employment, types } = detail;
  const type = typeOf(types, request.leaveTypeId);

  return (
    <Facts>
      <Requester t={t} language={language} request={request} employment={employment} />
      <Fact
        label={t('leave.label.leaveType')}
        value={
          type === undefined ? (
            <Reference value={reference(request.leaveTypeId)} />
          ) : (
            <>
              {nameIn(type.name, language)} <Reference value={type.code} />
            </>
          )
        }
      />
      <Fact
        label={t('leave.label.total')}
        value={<Duration>{minutes(t, request.totalMinutes)}</Duration>}
      />
      <Fact
        label={t('leave.label.balanceAtRequest')}
        value={<Duration>{minutes(t, request.balanceAtRequestMinutes)}</Duration>}
      />
      <Fact
        label={t('leave.label.requestedBy')}
        value={<Reference value={reference(request.requestedBy)} />}
      />
      <Fact
        label={t('leave.label.requestedAt')}
        value={<Isolated>{instant(request.requestedAt, language)}</Isolated>}
      />
      <Fact
        label={t('leave.label.approvedAt')}
        value={<Isolated>{instant(request.approvedAt, language)}</Isolated>}
      />
      <Fact
        label={t('leave.label.version')}
        value={<Isolated>{count(request.version)}</Isolated>}
      />
    </Facts>
  );
};

/**
 * What the request also carries, when it carries it.
 *
 * The justification is the requester's own words and is shown under its own heading rather than in
 * a facts grid, because on a sick-leave request it is close to health data and deserves to look
 * like text somebody wrote rather than like a field.
 */
/**
 * A `Fact` that renders only when there is something to say.
 *
 * A grid of five labels each answered by a dash tells a reader that five things are missing, when
 * what is true is that five things do not apply to this request. An approved request has no
 * cancellation, and printing "CANCELLED —" beside it is noise dressed as information.
 */
const Given = ({
  label,
  value,
}: {
  readonly label: string;
  readonly value: ReactNode | undefined;
}): ReactNode => (value === undefined ? undefined : <Fact label={label} value={value} />);

/**
 * What the request also carries, when it carries it.
 *
 * The justification is the requester's own words and is shown under its own heading rather than in
 * a facts grid, because on a sick-leave request it is close to health data and deserves to look
 * like text somebody wrote rather than like a field.
 */
export const RequestNarrative = ({
  t,
  language,
  request,
}: RequestProps & { readonly request: LeaveRequestView }): ReactNode => {
  const facts = [
    ['leave.label.reason', request.reasonCode],
    ['leave.label.attachment', request.attachmentReference],
    ['leave.label.supersedes', request.supersedesRequestId],
    ['leave.label.cancelledBy', request.cancelledBy],
  ] as const;

  if (request.justification === undefined && request.cancelledAt === undefined) {
    if (facts.every(([, value]) => value === undefined)) return undefined;
  }

  return (
    <LeaveSection title={t('leave.label.justification')}>
      {request.justification === undefined ? undefined : (
        <p className="text-sm text-foreground">
          <Wrote>{request.justification}</Wrote>
        </p>
      )}
      <Facts>
        {facts.map(([label, value]) => (
          <Given
            key={label}
            label={t(label)}
            value={value === undefined ? undefined : <Reference value={value} />}
          />
        ))}
        <Given
          label={t('leave.label.cancelledAt')}
          value={
            request.cancelledAt === undefined ? undefined : (
              <Isolated>{instant(request.cancelledAt, language)}</Isolated>
            )
          }
        />
      </Facts>
    </LeaveSection>
  );
};

const DayRow = ({
  t,
  dayRow,
  hourly,
}: LeaveProps & {
  readonly dayRow: LeaveRequestDayView;
  readonly hourly: boolean;
}): ReactNode => (
  <Row>
    <When>
      <Isolated>{day(dayRow.onDate)}</Isolated>
    </When>
    <Cell>
      <Term t={t} group="portion" value={dayRow.portion} tone="muted" />
    </Cell>
    <Cell numeric>
      <Duration>{minutes(t, dayRow.minutes)}</Duration>
    </Cell>
    <Cell numeric>
      <Duration>{minutes(t, dayRow.expectedMinutes)}</Duration>
    </Cell>
    {hourly ? (
      <>
        <Cell>
          <Isolated>{dayRow.startLocal ?? DASH}</Isolated>
        </Cell>
        <Cell>
          <Isolated>{dayRow.endLocal ?? DASH}</Isolated>
        </Cell>
      </>
    ) : undefined}
    <Cell>
      <Isolated>{dayRow.zone}</Isolated>
    </Cell>
  </Row>
);

/**
 * The dates the request covers, one row each.
 *
 * A request is not a date range: it is the set of dates the domain decided it covers, under the
 * policy's duration basis and against the working pattern Attendance published. Rendering the range
 * and letting a reader infer the dates would put a screen's arithmetic where a domain's decision
 * belongs — and on `calendar_days` the two answers differ.
 */
export const DaysSection = ({
  t,
  request,
}: LeaveProps & { readonly request: LeaveRequestView }): ReactNode => {
  const title = t('leave.label.days');

  if (request.days.length === 0) return <Clear t={t} title={title} message="leave.label.empty" />;

  // Only hourly leave carries a wall clock. Three rows of dashes under "From" and "Until" would
  // say five things are missing, when what is true is that this request is not hourly.
  const hourly = request.days.some((dayRow) => dayRow.startLocal !== undefined);
  const headings = [
    t('leave.label.onDate'),
    t('leave.label.portion'),
    t('leave.label.total'),
    t('leave.label.expected'),
    ...(hourly ? [t('leave.label.startsAt'), t('leave.label.endsAt')] : []),
    t('leave.label.zone'),
  ];

  return (
    <LeaveSection title={title} description={<Isolated>{count(request.days.length)}</Isolated>}>
      <Rows headings={headings} numeric={[2, 3]}>
        {request.days.map((dayRow) => (
          <DayRow
            key={`${dayRow.onDate}-${dayRow.portion}`}
            t={t}
            dayRow={dayRow}
            hourly={hourly}
          />
        ))}
      </Rows>
    </LeaveSection>
  );
};

/** What the request record does not do. */
const REQUEST_BOUNDARIES = [
  'leave.label.noMoney',
  'leave.label.noAttendance',
  'leave.label.noEmploymentStatus',
  'leave.label.noDocuments',
  'leave.notice.minutesAsPublished',
  'admin.notice.readOnly',
] as const;

export const RequestBoundaries = ({ t }: LeaveProps): ReactNode => (
  <Boundaries t={t} keys={REQUEST_BOUNDARIES} />
);
