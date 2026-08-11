import {
  success,
  type Command,
  type CommandHandler,
  type HandlerFailure,
  type Result,
  type Transaction,
} from '@work/kernel';

import { AttendanceDay } from '../domain/attendance-day.js';
import { recordTimeEvent, type PunchLocation, type RecordTimeEvent } from '../domain/time-event.js';
import { policyOn } from '../domain/attendance-policy.js';
import type { EventKind, EventSource } from '../domain/attendance-vocabulary.js';
import { civilDateAt } from '../domain/zoned-time.js';

import { conflicted, currentTenant, notFound, refusedBy } from './attendance-context.js';
import { DEFAULT_ZONE, zoneFor } from './expectation-resolution.js';
import { AttendancePermissions } from './attendance-permissions.js';
import type { AttendanceDependencies } from './attendance-dependencies.js';
import { INERT_POLICY } from '../domain/attendance-policy.js';

/**
 * Recording a time event, idempotently.
 *
 * **This is the phase's central reliability property**, and it is the same shape Phase 7 proved:
 * a read against the deduplication key, an insert, and a database constraint that decides the race.
 * A device retry, a mobile offline queue flushing twice and a re-run import all converge on one
 * row; two concurrent submissions race on `attendance_time_event_key`, the loser reads the winner,
 * and both callers get the same event identifier back (ADR-0053).
 *
 * A repeat is a **success** carrying `alreadyRecorded: true`, never a `409`. A retry that fails is
 * not an idempotent endpoint, and a punch clock will retry.
 *
 * Two things happen besides the insert, both in the same transaction:
 *
 * - The **attendance date is resolved in a real zone**, never by truncating a UTC instant. A punch
 *   at 02:00 in Riyadh belongs to that date, not to the UTC day before it.
 * - The **day is opened and marked stale**. Ingestion creates the day rather than the calculator,
 *   because a day that only exists once somebody has calculated it is a day the reconciliation
 *   query cannot find when the calculation never ran.
 */

export interface RecordEventCommand extends Command {
  readonly commandName: 'attendance.record-event';
  readonly employmentId: string;
  readonly kind: EventKind;
  readonly source: EventSource;
  /** Send one from any client that may retry. Only the client knows its third attempt is its first. */
  readonly idempotencyKey?: string;
  readonly sourceReference?: string;
  readonly deviceReference?: string;
  /** What the client says. Defaults to now; never trusted beyond the policy's tolerance. */
  readonly reportedAt?: Date;
  readonly capturedOffline?: boolean;
  readonly location?: PunchLocation;
  readonly note?: string;
  readonly importBatchId?: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface EventRecorded {
  readonly eventId: string;
  readonly employmentId: string;
  readonly attendanceDate: string;
  readonly occurredAt: Date;
  readonly zone: string;
  /** False when this request created it; true when an earlier one had. Both are successes. */
  readonly alreadyRecorded: boolean;
  readonly clockSkewSeconds: number;
}

export const recordEventHandler = (
  dependencies: AttendanceDependencies,
): CommandHandler<RecordEventCommand, EventRecorded> => ({
  commandName: 'attendance.record-event',
  permission: AttendancePermissions.eventRecord,

  handle: async (command) => {
    const recorded = await dependencies.unitOfWork.execute((transaction) =>
      ingestOnce(transaction, dependencies, command),
    );

    if (recorded.ok || recorded.error.kind !== 'conflict') return recorded;
    if (recorded.error.reason !== 'event_race_lost') return recorded;

    // The race: another submission committed the same key between this one's read and its insert,
    // and the unique index refused the second row. Re-reading converges on the winner, which is
    // what makes a retrying punch clock safe rather than a source of duplicates.
    return dependencies.unitOfWork.execute((transaction) =>
      readExisting(transaction, dependencies, command),
    );
  },
});

const ingestOnce = async (
  transaction: Transaction,
  dependencies: AttendanceDependencies,
  command: RecordEventCommand,
): Promise<Result<EventRecorded, HandlerFailure>> => {
  const now = dependencies.clock.now();
  const reportedAt = command.reportedAt ?? now;
  const provisionalDate = civilDateAt(reportedAt, DEFAULT_ZONE);
  const employment = await dependencies.employment.find(command.employmentId, provisionalDate);

  if (employment === undefined) return notFound<EventRecorded>('employment');
  // An employment that had already ended is not somebody at work. Refused by name rather than
  // dropped, because a reader that keeps sending punches for a departed employee is an operational
  // fact somebody should see.
  if (employment.endDate !== undefined && provisionalDate > employment.endDate) {
    return conflicted('employment_ended');
  }

  const zone = await zoneFor(transaction, dependencies, {
    employmentId: command.employmentId,
    onDate: provisionalDate,
    tenantZone: DEFAULT_ZONE,
  });
  const attendanceDate = civilDateAt(reportedAt, zone);
  const tolerance = await skewToleranceFor(transaction, dependencies, attendanceDate);
  const request: RecordTimeEvent = {
    tenantId: currentTenant(),
    employmentId: command.employmentId,
    kind: command.kind,
    source: command.source,
    ...optional(command),
    reportedAt,
    receivedAt: now,
    zone,
    attendanceDate,
    clockSkewToleranceSeconds: tolerance,
  };
  const event = recordTimeEvent(request);

  if (!event.ok) return refusedBy(event.error);

  const existing = await dependencies.stores.events.byKey(transaction, event.value.eventKey);

  if (existing !== undefined) return success(recordedFrom(existing, true));

  try {
    await dependencies.stores.events.insert(transaction, event.value);
  } catch (error: unknown) {
    if (!isUniqueViolation(error)) throw error;
    return conflicted('event_race_lost');
  }
  await touchDay(
    transaction,
    dependencies,
    { employmentId: event.value.employmentId, attendanceDate, zone },
    now,
  );
  return success(recordedFrom(event.value, false));
};

const optional = (
  command: RecordEventCommand,
): Partial<
  Pick<
    RecordTimeEvent,
    | 'idempotencyKey'
    | 'sourceReference'
    | 'deviceReference'
    | 'capturedOffline'
    | 'location'
    | 'note'
    | 'importBatchId'
    | 'metadata'
  >
> => ({
  ...(command.idempotencyKey === undefined ? {} : { idempotencyKey: command.idempotencyKey }),
  ...(command.sourceReference === undefined ? {} : { sourceReference: command.sourceReference }),
  ...(command.deviceReference === undefined ? {} : { deviceReference: command.deviceReference }),
  ...(command.capturedOffline === undefined ? {} : { capturedOffline: command.capturedOffline }),
  ...(command.location === undefined ? {} : { location: command.location }),
  ...(command.note === undefined ? {} : { note: command.note }),
  ...(command.importBatchId === undefined ? {} : { importBatchId: command.importBatchId }),
  ...(command.metadata === undefined ? {} : { metadata: command.metadata }),
});

/**
 * Opens the day if it does not exist, and marks it as needing recalculation either way.
 *
 * **In the same transaction as the event.** A mark written afterwards is the mark that will be
 * missing for exactly the day whose events arrived during a deployment, and the reconciliation
 * query would then never find it (ADR-0053).
 */
const touchDay = async (
  transaction: Transaction,
  dependencies: AttendanceDependencies,
  day: { readonly employmentId: string; readonly attendanceDate: string; readonly zone: string },
  now: Date,
): Promise<void> => {
  const { employmentId, attendanceDate, zone } = day;
  const existing = await dependencies.stores.days.byDate(transaction, employmentId, attendanceDate);

  if (existing === undefined) {
    const opened = AttendanceDay.open(
      { tenantId: currentTenant(), employmentId, attendanceDate, zone },
      now,
    );

    await dependencies.stores.days.insert(transaction, opened.snapshot());
    return;
  }

  const opened = AttendanceDay.rehydrate(existing);

  opened.markStale(now);
  await dependencies.stores.days.update(transaction, opened.snapshot(), existing.version);
};

/**
 * The tolerance beyond which a client's clock is disbelieved.
 *
 * From the policy in force on the date, so a tenant that tightens it does so from a date rather
 * than retroactively. With no policy configured the inert value applies — zero would make every
 * device with a second of drift produce an event on the server's clock instead of the punch's.
 */
const skewToleranceFor = async (
  transaction: Transaction,
  dependencies: AttendanceDependencies,
  attendanceDate: string,
): Promise<number> => {
  const policies = await dependencies.stores.policies.published(transaction);

  return (
    policyOn(policies, attendanceDate)?.clockSkewToleranceSeconds ??
    INERT_POLICY.clockSkewToleranceSeconds
  );
};

const readExisting = async (
  transaction: Transaction,
  dependencies: AttendanceDependencies,
  command: RecordEventCommand,
): Promise<Result<EventRecorded, HandlerFailure>> => {
  const now = dependencies.clock.now();
  const reportedAt = command.reportedAt ?? now;
  const zone = await zoneFor(transaction, dependencies, {
    employmentId: command.employmentId,
    onDate: civilDateAt(reportedAt, DEFAULT_ZONE),
    tenantZone: DEFAULT_ZONE,
  });
  const attendanceDate = civilDateAt(reportedAt, zone);
  const event = recordTimeEvent({
    tenantId: currentTenant(),
    employmentId: command.employmentId,
    kind: command.kind,
    source: command.source,
    ...optional(command),
    reportedAt,
    receivedAt: now,
    zone,
    attendanceDate,
    clockSkewToleranceSeconds: await skewToleranceFor(transaction, dependencies, attendanceDate),
  });

  if (!event.ok) return refusedBy(event.error);

  const existing = await dependencies.stores.events.byKey(transaction, event.value.eventKey);

  if (existing === undefined) return conflicted('event_race_lost');
  return success(recordedFrom(existing, true));
};

const recordedFrom = (
  event: {
    readonly id: string;
    readonly employmentId: string;
    readonly attendanceDate: string;
    readonly occurredAt: Date;
    readonly zone: string;
    readonly clockSkewSeconds: number;
  },
  alreadyRecorded: boolean,
): EventRecorded => ({
  eventId: event.id,
  employmentId: event.employmentId,
  attendanceDate: event.attendanceDate,
  occurredAt: event.occurredAt,
  zone: event.zone,
  alreadyRecorded,
  clockSkewSeconds: event.clockSkewSeconds,
});

/**
 * PostgreSQL's unique-violation SQLSTATE, recognised without importing the driver.
 *
 * `23505` is the code, and reading it from an unknown rather than importing `pg` keeps the
 * application layer free of the database driver — which is the layer rule, and also what lets the
 * in-memory store raise the same error so the race branch is exercised without a database.
 */
export const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { readonly code?: unknown }).code === '23505';
