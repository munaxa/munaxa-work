import { createHash } from 'node:crypto';

import { uuidV7 } from '@work/kernel';

import { checkedText, checkedZone, definedOnly, type Metadata } from './attendance-aggregate.js';
import { accept, refuse, type AttendanceResult } from './attendance-rejection.js';
import {
  EVENT_KINDS,
  EVENT_SOURCES,
  isCivilDate,
  type EventKind,
  type EventSource,
} from './attendance-vocabulary.js';

/**
 * One raw time event, exactly as it was captured.
 *
 * A plain shape rather than an aggregate, because it has one invariant — **it never changes** — and
 * an aggregate with no state transitions is a class pretending to have behaviour. The invariant is
 * enforced structurally instead: the repository that stores these offers `insert` and reads, and no
 * `update`, no `softDelete` and no `restore`. A correction writes a *new* event carrying
 * `supersedesEventId`, and the original stays exactly as it was (ADR-0052).
 *
 * **Three timestamps, and they are not the same thing.** `reportedAt` is what the client claimed,
 * `receivedAt` is when the server accepted it, and `occurredAt` is the instant the domain treats as
 * authoritative. A mobile punch queued on an aeroplane and a turnstile with a drifting clock are
 * both ordinary; conflating the three loses the only evidence that either happened.
 */

export interface TimeEventState {
  readonly id: string;
  readonly tenantId: string;
  /** Employment's, by identifier and by foreign key. Attendance never references a Person. */
  readonly employmentId: string;
  readonly kind: EventKind;
  readonly source: EventSource;
  /** The originating system's own identifier, opaque. Stored and compared, never parsed. */
  readonly sourceReference?: string;
  readonly deviceReference?: string;
  readonly eventKey: string;
  readonly occurredAt: Date;
  readonly reportedAt: Date;
  readonly receivedAt: Date;
  readonly clockSkewSeconds: number;
  readonly capturedOffline: boolean;
  /** The zone resolved at ingestion, kept so a recalculation years later uses the zone that applied. */
  readonly zone: string;
  readonly attendanceDate: string;
  readonly supersedesEventId?: string;
  /** Punch location evidence, where a tenant enables capture. Not an authoritative work location. */
  readonly latitude?: number;
  readonly longitude?: number;
  readonly locationAccuracyMetres?: number;
  readonly note?: string;
  readonly importBatchId?: string;
  readonly metadata: Metadata;
  readonly version: number;
}

export interface RecordTimeEvent {
  readonly tenantId: string;
  readonly employmentId: string;
  readonly kind: EventKind;
  readonly source: EventSource;
  readonly sourceReference?: string;
  readonly deviceReference?: string;
  /** A client-supplied idempotency key. A mobile queue and an API caller should always send one. */
  readonly idempotencyKey?: string;
  readonly reportedAt: Date;
  readonly receivedAt: Date;
  readonly capturedOffline?: boolean;
  readonly zone: string;
  readonly attendanceDate: string;
  /** How far the client's clock may diverge before the server's receipt time is used instead. */
  readonly clockSkewToleranceSeconds: number;
  readonly supersedesEventId?: string;
  readonly location?: PunchLocation;
  readonly note?: string;
  readonly importBatchId?: string;
  readonly metadata?: Metadata;
}

/**
 * Where a punch was made, when the tenant has enabled capture for that source.
 *
 * **This is evidence, not a work location and not a track.** There is no site to verify it against
 * — this product has no location model, and ADR-0041 explains why inventing one inside Attendance
 * would be worse than the gap. So there is no geofence verdict here, no radius and no permitted
 * site: a verdict with nothing behind it would be a claim (ADR-0055).
 *
 * One point, at the punch. Nothing in this module can hold a second point for the same event, and
 * nothing accepts a sequence of them.
 */
export interface PunchLocation {
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracyMetres?: number;
}

const NOTE_LIMIT = 1024;
const MAX_ACCURACY_METRES = 100_000;
const LATITUDE_LIMIT = 90;
const LONGITUDE_LIMIT = 180;
const MILLISECONDS_PER_SECOND = 1000;

export const recordTimeEvent = (request: RecordTimeEvent): AttendanceResult<TimeEventState> => {
  const shape = checkedShape(request);

  if (!shape.ok) return shape;

  const skewSeconds = Math.round(
    (request.reportedAt.getTime() - request.receivedAt.getTime()) / MILLISECONDS_PER_SECOND,
  );
  // The client clock is never trusted. Within tolerance the reported instant is used, because it
  // is closer to when the person actually stood at the door; beyond it the server's receipt is
  // used, because a clock hours out would put the punch on another day. Both survive either way,
  // and the divergence is stored rather than discarded — it is data, not an error.
  const occurredAt =
    Math.abs(skewSeconds) <= request.clockSkewToleranceSeconds
      ? request.reportedAt
      : request.receivedAt;
  const location = shape.value.location;

  return accept({
    id: uuidV7(request.receivedAt.getTime()),
    tenantId: request.tenantId,
    employmentId: request.employmentId,
    kind: request.kind,
    source: request.source,
    ...definedOnly({
      sourceReference: request.sourceReference,
      deviceReference: request.deviceReference,
      supersedesEventId: request.supersedesEventId,
      note: shape.value.note,
      importBatchId: request.importBatchId,
    }),
    ...locationFields(location),
    eventKey: eventKeyFor(request, occurredAt),
    occurredAt,
    reportedAt: request.reportedAt,
    receivedAt: request.receivedAt,
    clockSkewSeconds: skewSeconds,
    capturedOffline: request.capturedOffline ?? false,
    zone: shape.value.zone,
    attendanceDate: request.attendanceDate,
    metadata: request.metadata ?? {},
    version: 0,
  });
};

/**
 * Punch location evidence, as columns — complete or absent.
 *
 * Extracted so the event constructor stays inside its complexity budget, and because the rule it
 * encodes is worth naming: half a coordinate is evidence of nothing, so latitude and longitude are
 * written together or not at all (ADR-0055).
 */
const locationFields = (
  location: PunchLocation | undefined,
): Partial<Pick<TimeEventState, 'latitude' | 'longitude' | 'locationAccuracyMetres'>> => {
  if (location === undefined) return {};

  return {
    latitude: location.latitude,
    longitude: location.longitude,
    ...definedOnly({ locationAccuracyMetres: location.accuracyMetres }),
  };
};

interface CheckedShape {
  readonly zone: string;
  readonly note?: string;
  readonly location?: PunchLocation;
}

const checkedShape = (request: RecordTimeEvent): AttendanceResult<CheckedShape> => {
  if (!EVENT_KINDS.includes(request.kind)) return refuse('event_kind_unknown');
  if (!EVENT_SOURCES.includes(request.source)) return refuse('event_source_unknown');
  if (!isCivilDate(request.attendanceDate)) {
    return refuse('date_malformed', { field: 'attendanceDate' });
  }

  const zone = checkedZone(request.zone);

  if (!zone.ok) return zone;

  const note = checkedText(request.note, 'note', NOTE_LIMIT);

  if (!note.ok) return note;

  const location = checkedLocation(request.location);

  if (!location.ok) return location;

  return accept({
    zone: zone.value,
    ...(note.value === undefined ? {} : { note: note.value }),
    ...(location.value === undefined ? {} : { location: location.value }),
  });
};

/** A coordinate is either complete and plausible or absent. Half a position is evidence of nothing. */
const checkedLocation = (
  location: PunchLocation | undefined,
): AttendanceResult<PunchLocation | undefined> => {
  if (location === undefined) return accept(undefined);
  if (!Number.isFinite(location.latitude) || Math.abs(location.latitude) > LATITUDE_LIMIT) {
    return refuse('location_malformed', { field: 'latitude' });
  }
  if (!Number.isFinite(location.longitude) || Math.abs(location.longitude) > LONGITUDE_LIMIT) {
    return refuse('location_malformed', { field: 'longitude' });
  }
  if (
    location.accuracyMetres !== undefined &&
    (!Number.isInteger(location.accuracyMetres) ||
      location.accuracyMetres < 0 ||
      location.accuracyMetres > MAX_ACCURACY_METRES)
  ) {
    return refuse('location_malformed', { field: 'accuracyMetres' });
  }
  return accept(location);
};

/**
 * The deduplication identity, and the whole of the ingestion path's idempotency.
 *
 * Three derivations, in order of how much the caller told us:
 *
 * 1. **A client-supplied idempotency key.** What a mobile offline queue and an API integration
 *    should always send, because only the client knows that its third attempt is the same punch as
 *    its first.
 * 2. **The source's own reference.** A device or an export file that carries a stable record
 *    identifier already answers the question; re-importing the file is then free.
 * 3. **A digest of what makes a punch what it is** — the employment, the kind, the instant, the
 *    source and the device. It deduplicates a device that resends, and deliberately does *not*
 *    deduplicate two genuine punches at the same instant from two different readers: those differ
 *    by device, both are recorded, and a `duplicate_punch` exception asks a human which is real.
 *
 * A digest rather than the concatenation, because the parts are caller-controlled and a column has
 * a length. Truncating a concatenation is how two different punches come to share a key.
 */
export const eventKeyFor = (request: RecordTimeEvent, occurredAt: Date): string => {
  if (request.idempotencyKey !== undefined && request.idempotencyKey.trim() !== '') {
    return `k:${request.idempotencyKey.trim()}`;
  }
  if (request.sourceReference !== undefined && request.sourceReference.trim() !== '') {
    return `s:${request.source}:${request.sourceReference.trim()}`;
  }
  const parts = [
    request.employmentId,
    request.kind,
    occurredAt.toISOString(),
    request.source,
    request.deviceReference ?? '',
  ].join('|');

  return `d:${createHash('sha256').update(parts).digest('hex')}`;
};

/** A correction's event, carrying the identifier of the one it replaces. The original is untouched. */
export const supersedingEvent = (
  request: RecordTimeEvent,
  supersedesEventId: string,
): AttendanceResult<TimeEventState> =>
  recordTimeEvent({ ...request, source: 'correction', supersedesEventId });
