import type { Metadata } from '../domain/attendance-aggregate.js';
import type { TimeEventState } from '../domain/time-event.js';
import type { EventKind, EventSource } from '../domain/attendance-vocabulary.js';

import { asCoordinate, asVersion, civilDateColumn, orNull, type RowValues } from './row-writer.js';

/**
 * The raw time event, as a row.
 *
 * **There is no update mapping in this file, and that absence is the point.** A raw event is what a
 * reader captured; a correction inserts a *new* event carrying `supersedes_event_id` and the
 * original stays exactly as it was (ADR-0052). A mapping that could rewrite one would be the only
 * thing standing between an amended record and a rewritten one, and "we are careful" is not a
 * guarantee.
 *
 * Three instants are stored separately and always written together: when the punch **occurred** (the
 * one the calculation uses), when the client **reported** it, and when the server **received** it.
 * Collapsing them loses the ability to explain a figure to somebody who disputes it — and, for an
 * offline mobile punch flushed the next morning, they are three genuinely different times.
 */

export interface TimeEventRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly employment_id: string;
  readonly kind: string;
  readonly source: string;
  readonly source_reference: string | null;
  readonly device_reference: string | null;
  readonly event_key: string;
  readonly occurred_at: Date;
  readonly reported_at: Date;
  readonly received_at: Date;
  readonly clock_skew_seconds: number | string;
  readonly captured_offline: boolean;
  readonly zone: string;
  readonly attendance_date: string;
  readonly supersedes_event_id: string | null;
  readonly latitude: string | number | null;
  readonly longitude: string | number | null;
  readonly location_accuracy_metres: number | string | null;
  readonly note: string | null;
  readonly import_batch_id: string | null;
  readonly metadata: Metadata;
  readonly version: number | string;
}

export const EVENT_COLUMNS = `e.id, e.tenant_id, e.employment_id, e.kind, e.source, e.source_reference,
  e.device_reference, e.event_key, e.occurred_at, e.reported_at, e.received_at, e.clock_skew_seconds,
  e.captured_offline, e.zone, ${civilDateColumn('e.attendance_date', 'attendance_date')},
  e.supersedes_event_id, e.latitude, e.longitude, e.location_accuracy_metres, e.note,
  e.import_batch_id, e.metadata, e.version`;

/**
 * Punch location evidence, and nothing derived from it.
 *
 * No geofence verdict is read here because none is stored: this product has no authoritative work
 * location to verify a coordinate against, and a verdict with nothing behind it would be a claim
 * rather than a fact (ADR-0055).
 */
const locationOf = (
  row: TimeEventRow,
): Partial<Pick<TimeEventState, 'latitude' | 'longitude' | 'locationAccuracyMetres'>> => {
  const latitude = asCoordinate(row.latitude);
  const longitude = asCoordinate(row.longitude);
  const accuracy = asCoordinate(row.location_accuracy_metres);

  return {
    ...(latitude === undefined ? {} : { latitude }),
    ...(longitude === undefined ? {} : { longitude }),
    ...(accuracy === undefined ? {} : { locationAccuracyMetres: accuracy }),
  };
};

const provenanceOf = (
  row: TimeEventRow,
): Partial<
  Pick<
    TimeEventState,
    'sourceReference' | 'deviceReference' | 'supersedesEventId' | 'note' | 'importBatchId'
  >
> => ({
  ...(row.source_reference === null ? {} : { sourceReference: row.source_reference }),
  ...(row.device_reference === null ? {} : { deviceReference: row.device_reference }),
  ...(row.supersedes_event_id === null ? {} : { supersedesEventId: row.supersedes_event_id }),
  ...(row.note === null ? {} : { note: row.note }),
  ...(row.import_batch_id === null ? {} : { importBatchId: row.import_batch_id }),
});

export const toTimeEvent = (row: TimeEventRow): TimeEventState => ({
  id: row.id,
  tenantId: row.tenant_id,
  employmentId: row.employment_id,
  kind: row.kind as EventKind,
  source: row.source as EventSource,
  eventKey: row.event_key,
  occurredAt: row.occurred_at,
  reportedAt: row.reported_at,
  receivedAt: row.received_at,
  clockSkewSeconds: asVersion(row.clock_skew_seconds),
  capturedOffline: row.captured_offline,
  zone: row.zone,
  attendanceDate: row.attendance_date,
  ...provenanceOf(row),
  ...locationOf(row),
  metadata: row.metadata,
  version: asVersion(row.version),
});

/** The only mapping this file offers, because insert is the only write the table accepts. */
export const timeEventInsert = (state: TimeEventState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  employment_id: state.employmentId,
  kind: state.kind,
  source: state.source,
  source_reference: orNull(state.sourceReference),
  device_reference: orNull(state.deviceReference),
  event_key: state.eventKey,
  occurred_at: state.occurredAt,
  reported_at: state.reportedAt,
  received_at: state.receivedAt,
  clock_skew_seconds: state.clockSkewSeconds,
  captured_offline: state.capturedOffline,
  zone: state.zone,
  attendance_date: state.attendanceDate,
  supersedes_event_id: orNull(state.supersedesEventId),
  latitude: orNull(state.latitude),
  longitude: orNull(state.longitude),
  location_accuracy_metres: orNull(state.locationAccuracyMetres),
  note: orNull(state.note),
  import_batch_id: orNull(state.importBatchId),
  metadata: JSON.stringify(state.metadata),
});
