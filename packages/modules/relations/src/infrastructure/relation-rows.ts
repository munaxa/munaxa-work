import type { AccessEventState } from '../domain/access-event.js';
import type {
  AccessAction,
  CountryPackSource,
  ViolationState,
} from '../domain/relations-vocabulary.js';
import type { LocalizedName, ViolationCategoryState } from '../domain/violation-category.js';
import type { ViolationRecord } from '../domain/violation.js';
import { asNumber, orNull, orUndefined, type RowValues } from './row-writer.js';

/**
 * Rows into domain state and back, in one file.
 *
 * The mapping is deliberately explicit rather than a spread: a column added to a table does not
 * reach the domain until somebody writes it here, and a field added to the domain does not reach the
 * database either. In a module whose rows are evidence, an accidental round-trip is how a value
 * nobody chose ends up on a record somebody is judged by.
 *
 * **`version` never appears in a values map** — `auditForInsert` writes it on insert and
 * `Repository.updateRow` appends `version = version + 1`, so emitting it here would assign the same
 * column twice in one statement. The integration suite found exactly that, which is why this note
 * exists rather than a comment saying it was intended.
 *
 * `occurred_on` is a `date` and comes back as one. It is kept as the civil string the domain uses
 * rather than converted to a `Date`, because the day conduct happened is a day in the tenant's
 * world — turning it into an instant would attach a time zone to a fact that has none.
 */

export interface ViolationCategoryRow {
  readonly id: string;
  readonly code: string;
  readonly name: LocalizedName;
  readonly severity: string;
  readonly sequence: number | string;
  readonly repeat_window_days: number | string;
  readonly source: string;
  readonly country_pack_id: string | null;
  readonly country_pack_version: number | string | null;
  readonly active: boolean;
  readonly version: number | string;
}

export const violationCategoryState = (row: ViolationCategoryRow): ViolationCategoryState => {
  const packVersion = orUndefined(row.country_pack_version);

  return {
    violationCategoryId: row.id,
    code: row.code,
    name: row.name,
    severity: row.severity,
    sequence: asNumber(row.sequence),
    repeatWindowDays: asNumber(row.repeat_window_days),
    source: row.source as CountryPackSource,
    active: row.active,
    version: asNumber(row.version),
    ...(orUndefined(row.country_pack_id) === undefined
      ? {}
      : { countryPackId: row.country_pack_id as string }),
    ...(packVersion === undefined ? {} : { countryPackVersion: asNumber(packVersion) }),
  };
};

export const violationCategoryValues = (
  state: ViolationCategoryState,
  tenantId: string,
): RowValues => ({
  id: state.violationCategoryId,
  tenant_id: tenantId,
  code: state.code,
  name: JSON.stringify(state.name),
  severity: state.severity,
  sequence: state.sequence,
  repeat_window_days: state.repeatWindowDays,
  source: state.source,
  country_pack_id: orNull(state.countryPackId),
  country_pack_version: orNull(state.countryPackVersion),
  active: state.active,
});

export interface ViolationRow {
  readonly id: string;
  readonly employment_id: string;
  readonly violation_category_id: string;
  readonly category_code: string;
  readonly severity: string;
  readonly occurred_on: string;
  readonly reported_by: string;
  readonly description: string;
  readonly state: string;
  readonly recorded_at: Date;
  readonly version: number | string;
}

export const violationState = (row: ViolationRow): ViolationRecord => ({
  violationId: row.id,
  employmentId: row.employment_id,
  violationCategoryId: row.violation_category_id,
  categoryCode: row.category_code,
  severity: row.severity,
  occurredOn: row.occurred_on,
  reportedBy: row.reported_by,
  description: row.description,
  state: row.state as ViolationState,
  recordedAt: row.recorded_at,
  version: asNumber(row.version),
});

export const violationValues = (state: ViolationRecord, tenantId: string): RowValues => ({
  id: state.violationId,
  tenant_id: tenantId,
  employment_id: state.employmentId,
  violation_category_id: state.violationCategoryId,
  category_code: state.categoryCode,
  severity: state.severity,
  occurred_on: state.occurredOn,
  reported_by: state.reportedBy,
  description: state.description,
  state: state.state,
  recorded_at: state.recordedAt,
});

export interface AccessEventRow {
  readonly id: string;
  readonly violation_id: string;
  readonly action: string;
  readonly actor: string;
  readonly occurred_at: Date;
  readonly correlation_id: string;
}

export const accessEventState = (row: AccessEventRow): AccessEventState => ({
  accessEventId: row.id,
  violationId: row.violation_id,
  action: row.action as AccessAction,
  actor: row.actor,
  occurredAt: row.occurred_at,
  correlationId: row.correlation_id,
});

export const accessEventValues = (state: AccessEventState, tenantId: string): RowValues => ({
  id: state.accessEventId,
  tenant_id: tenantId,
  violation_id: state.violationId,
  action: state.action,
  actor: state.actor,
  occurred_at: state.occurredAt,
  correlation_id: state.correlationId,
});
