import type { AccessEventState } from '../domain/access-event.js';
import type { CaseEventState } from '../domain/case-event.js';
import type { InvestigationRecord } from '../domain/investigation.js';
import type {
  AccessAction,
  CaseState,
  CountryPackSource,
  InvestigationState,
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
 * **Civil dates are projected as text, and that is load-bearing.** `node-postgres` returns a `date`
 * column as a JavaScript `Date` at midnight UTC, so `select *` would hand the mapper an object where
 * the row type promises `'YYYY-MM-DD'`. Checkpoint 1 declared the string and no test read one back
 * from the database, so the mismatch sat unnoticed until Checkpoint 3 compared civil dates to bound
 * a repeat window — where a `Date` on the left of a string comparison silently produces the wrong
 * set. Every select of these tables therefore names its columns and wraps the dates in `to_char`
 * rather than using `select *`.
 *
 * Kept as strings rather than converted to `Date` for the original reason: the day conduct happened
 * is a day in the tenant's world, and turning it into an instant attaches a time zone to a fact that
 * has none.
 */

/** The violation's columns, with `occurred_on` as a civil string. Used by every read of the table. */
export const VIOLATION_COLUMNS = `id, tenant_id, employment_id, violation_category_id,
  category_code, severity, to_char(occurred_on, 'YYYY-MM-DD') as occurred_on,
  reported_by, description, state, recorded_at, version`;

/** The investigation's columns, with both civil dates as strings, for the same reason. */
export const INVESTIGATION_COLUMNS = `id, tenant_id, violation_id, investigator_membership_id,
  to_char(opened_on, 'YYYY-MM-DD') as opened_on, subject, findings, recommendation,
  to_char(concluded_on, 'YYYY-MM-DD') as concluded_on, state, corrects_investigation_id, version`;

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

export interface InvestigationRow {
  readonly id: string;
  readonly violation_id: string;
  readonly investigator_membership_id: string;
  readonly opened_on: string;
  readonly subject: string;
  readonly findings: string | null;
  readonly recommendation: string | null;
  readonly concluded_on: string | null;
  readonly state: string;
  readonly corrects_investigation_id: string | null;
  readonly version: number | string;
}

export const investigationState = (row: InvestigationRow): InvestigationRecord => ({
  investigationId: row.id,
  violationId: row.violation_id,
  investigatorMembershipId: row.investigator_membership_id,
  openedOn: row.opened_on,
  subject: row.subject,
  state: row.state as InvestigationState,
  version: asNumber(row.version),
  ...(orUndefined(row.findings) === undefined ? {} : { findings: row.findings as string }),
  ...(orUndefined(row.recommendation) === undefined
    ? {}
    : { recommendation: row.recommendation as string }),
  ...(orUndefined(row.concluded_on) === undefined
    ? {}
    : { concludedOn: row.concluded_on as string }),
  ...(orUndefined(row.corrects_investigation_id) === undefined
    ? {}
    : { correctsInvestigationId: row.corrects_investigation_id as string }),
});

export const investigationValues = (state: InvestigationRecord, tenantId: string): RowValues => ({
  id: state.investigationId,
  tenant_id: tenantId,
  violation_id: state.violationId,
  investigator_membership_id: state.investigatorMembershipId,
  opened_on: state.openedOn,
  subject: state.subject,
  findings: orNull(state.findings),
  recommendation: orNull(state.recommendation),
  concluded_on: orNull(state.concludedOn),
  state: state.state,
  corrects_investigation_id: orNull(state.correctsInvestigationId),
});

export interface CaseEventRow {
  readonly id: string;
  readonly violation_id: string;
  readonly sequence: number | string;
  readonly from_state: string;
  readonly to_state: string;
  readonly reason: string;
  readonly actor: string;
  readonly occurred_at: Date;
  readonly correlation_id: string;
  readonly investigation_id: string | null;
}

export const caseEventState = (row: CaseEventRow): CaseEventState => ({
  caseEventId: row.id,
  violationId: row.violation_id,
  sequence: asNumber(row.sequence),
  fromState: row.from_state as CaseState,
  toState: row.to_state as CaseState,
  reason: row.reason,
  actor: row.actor,
  occurredAt: row.occurred_at,
  correlationId: row.correlation_id,
  ...(orUndefined(row.investigation_id) === undefined
    ? {}
    : { investigationId: row.investigation_id as string }),
});

export const caseEventValues = (state: CaseEventState, tenantId: string): RowValues => ({
  id: state.caseEventId,
  tenant_id: tenantId,
  violation_id: state.violationId,
  sequence: state.sequence,
  from_state: state.fromState,
  to_state: state.toState,
  reason: state.reason,
  actor: state.actor,
  occurred_at: state.occurredAt,
  correlation_id: state.correlationId,
  investigation_id: orNull(state.investigationId),
});
