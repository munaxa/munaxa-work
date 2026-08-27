import type { ReactNode } from 'react';
import type { CorrectionView, TimeEventView } from '@work/attendance/contracts';

import {
  AttendanceSection,
  Cell,
  Identifier,
  Clear,
  Duration,
  Isolated,
  Note,
  Reference,
  Refused,
  Row,
  Rows,
  Sentence,
  Term,
  When,
  shownOf,
} from './frame';
import { count, day, instant, reference } from './exact';
import { CORRECTION_TONE } from './tones';
import type { DayProps } from './day';
import type { Listing } from './api';

/**
 * The punches behind a day's figures, and the corrections raised against it.
 *
 * Apart from `day.tsx` because a screen file's budget is four hundred lines, and because these two
 * are the day's *evidence* where the rest of that file is the day's *verdict*. Reviewing them
 * together is what makes a corrected day auditable.
 */

/**
 * Which punches a correction replaced, read from the day's own snapshot.
 *
 * The contract states the relation from one end only: a *superseding* event carries
 * `supersedesEventId`. The event it replaced carries no mark of its own — and the module returns
 * both, deliberately, "so that somebody reviewing a corrected day sees what was originally
 * captured".
 *
 * So the relation is read from both ends within one snapshot, which is complete by construction:
 * `forDay` returns every event on the day. This is the server's own relation rendered in the
 * direction it was not published in — **not a rule about which punch wins**. Nothing here decides
 * that; the domain already did, by writing the replacement.
 */
export const replacedIn = (events: readonly TimeEventView[]): ReadonlyMap<string, string> =>
  new Map(
    events
      .filter((event) => event.supersedesEventId !== undefined)
      .map((event) => [event.supersedesEventId as string, event.eventId]),
  );

const EVENT_HEADINGS = [
  'attendance.label.occurredAt',
  'attendance.label.kind',
  'attendance.label.source',
  'attendance.label.eventState',
  'attendance.label.receivedAt',
  'attendance.label.clockSkew',
  'attendance.label.device',
] as const;

const EventRow = ({
  t,
  language,
  event,
  replacedBy,
}: DayProps & {
  readonly event: TimeEventView;
  readonly replacedBy: string | undefined;
}): ReactNode => (
  <Row>
    <When>
      <Isolated>{instant(event.occurredAt, language)}</Isolated>
    </When>
    <Cell>
      <Term t={t} group="event" value={event.kind} tone="muted" />
    </Cell>
    <Cell>
      <Term t={t} group="source" value={event.source} tone="muted" />
    </Cell>
    <Cell>
      {replacedBy === undefined ? (
        <span className="text-sm text-muted-foreground">{t('attendance.label.current')}</span>
      ) : (
        <span className="flex flex-col">
          <span className="text-sm text-muted-foreground">{t('attendance.label.replaced')}</span>
          <Reference value={replacedBy} />
        </span>
      )}
      {event.supersedesEventId === undefined ? undefined : (
        <span className="flex flex-col">
          <span className="text-xs text-muted-foreground">{t('attendance.label.supersedes')}</span>
          <Reference value={event.supersedesEventId} />
        </span>
      )}
    </Cell>
    <When>
      <Isolated>{instant(event.receivedAt, language)}</Isolated>
    </When>
    <Cell numeric>
      <Duration>
        {t('attendance.label.seconds').replace('{seconds}', count(event.clockSkewSeconds))}
      </Duration>
    </Cell>
    <Cell>
      <Reference value={reference(event.deviceReference)} />
      {event.capturedOffline ? (
        <span className="ms-1 text-xs text-muted-foreground">
          {t('attendance.label.capturedOffline')}
        </span>
      ) : undefined}
    </Cell>
  </Row>
);

/**
 * The punches behind the figures.
 *
 * `attendance.event.read` is a separate permission from reading the day, so a caller may hold the
 * day and not these. The day read carries them together — the module's own composite — which means
 * an absent list here is an absent day, not a refused punch list; the section says so rather than
 * claiming nobody clocked in.
 */
export const EventsSection = ({
  t,
  language,
  events,
}: DayProps & { readonly events: readonly TimeEventView[] }): ReactNode => {
  const title = t('attendance.label.punches');

  if (events.length === 0) {
    return <Clear t={t} title={title} message="attendance.label.noPunches" />;
  }
  const replaced = replacedIn(events);

  return (
    <AttendanceSection title={title} description={<Isolated>{count(events.length)}</Isolated>}>
      <Rows headings={EVENT_HEADINGS.map(t)} numeric={[5]}>
        {events.map((event) => (
          <EventRow
            key={event.eventId}
            t={t}
            language={language}
            event={event}
            replacedBy={replaced.get(event.eventId)}
          />
        ))}
      </Rows>
      <Note t={t} message="attendance.notice.eventsIncludeSuperseded" />
      <Note t={t} message="attendance.notice.eventsAreOwnPermission" />
    </AttendanceSection>
  );
};

const CORRECTION_HEADINGS = [
  'attendance.label.date',
  'attendance.label.employment',
  'attendance.label.kind',
  'attendance.label.state',
  'attendance.label.proposed',
  'attendance.label.reason',
  'attendance.label.justification',
  'attendance.label.requestedBy',
  'attendance.label.decidedBy',
] as const;

/**
 * What somebody asked to change about the attendance record.
 *
 * A correction is a *request* with its own lifecycle, and requesting one is a different permission
 * from deciding it — the domain additionally refuses self-approval. The screen shows the state and
 * who acted; it offers no way to decide one, because that is a write.
 *
 * The justification is the requester's own words and is isolated so its own language decides its
 * direction: an English sentence in an Arabic table otherwise loses its full stop to the front.
 *
 * **The same section serves both screens, and it says which it is on.** On the register it is every
 * outstanding correction across the tenant; on a day it is one employment's, because
 * `correctionFilters` accepts `employmentId`, `state` and `kind` and publishes **no date filter** —
 * so a day cannot narrow them to itself, and the section says so rather than letting a reader
 * assume it has.
 */
export const CorrectionsSection = ({
  t,
  language,
  corrections,
  scopedToEmployment = false,
}: DayProps & {
  readonly corrections: Listing<CorrectionView> | undefined;
  readonly scopedToEmployment?: boolean;
}): ReactNode => {
  const title = t('attendance.label.corrections');

  if (corrections === undefined) return <Refused t={t} title={title} />;
  if (corrections.items.length === 0) {
    return <Clear t={t} title={title} message="attendance.label.noCorrections" />;
  }

  return (
    <AttendanceSection title={title} description={shownOf(corrections)}>
      <Rows headings={CORRECTION_HEADINGS.map(t)}>
        {corrections.items.map((correction) => (
          <Row key={correction.correctionId}>
            <When>
              <Isolated>{day(correction.attendanceDate)}</Isolated>
            </When>
            <Identifier value={reference(correction.employmentId)} />
            <Cell>
              <Term t={t} group="correction" value={correction.kind} tone="muted" />
            </Cell>
            <Cell>
              <Term
                t={t}
                group="correctionState"
                value={correction.state}
                tone={CORRECTION_TONE[correction.state]}
              />
            </Cell>
            <When>
              <Isolated>{instant(correction.proposedOccurredAt, language)}</Isolated>
            </When>
            <Cell>
              <Reference value={reference(correction.reasonCode)} />
            </Cell>
            <Sentence>{correction.justification}</Sentence>
            <Cell>
              <Reference value={reference(correction.requestedBy)} />
            </Cell>
            <Cell>
              <Reference value={reference(correction.decidedBy)} />
            </Cell>
          </Row>
        ))}
      </Rows>
      {scopedToEmployment ? <Note t={t} message="attendance.notice.correctionScope" /> : undefined}
    </AttendanceSection>
  );
};
