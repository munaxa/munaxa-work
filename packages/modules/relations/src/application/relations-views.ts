import type { ViolationCategoryState } from '../domain/violation-category.js';
import type { ViolationRecord } from '../domain/violation.js';
import type { ViolationCategoryView, ViolationView } from '../contracts/views.js';

/**
 * Domain state into published view, in one direction only.
 *
 * Here rather than in the query handlers so there is exactly one place that decides what leaves this
 * module. A field added to an aggregate does not reach a consumer until somebody adds it here, which
 * is the point: in this domain an accidentally published field is an accidental disclosure about a
 * named person.
 *
 * **`reportedBy` is not published.** It names the member of staff who filed the allegation, and
 * putting it on a view would hand the accused a screen showing who reported them. It is recorded on
 * the row, where a permission decides who reads it, and Checkpoint 1 publishes no read of it.
 */

export const violationCategoryView = (state: ViolationCategoryState): ViolationCategoryView => ({
  violationCategoryId: state.violationCategoryId,
  code: state.code,
  name: state.name,
  severity: state.severity,
  sequence: state.sequence,
  repeatWindowDays: state.repeatWindowDays,
  source: state.source,
  active: state.active,
  version: state.version,
  ...(state.countryPackId === undefined ? {} : { countryPackId: state.countryPackId }),
  ...(state.countryPackVersion === undefined
    ? {}
    : { countryPackVersion: state.countryPackVersion }),
});

export const violationView = (state: ViolationRecord): ViolationView => ({
  violationId: state.violationId,
  employmentId: state.employmentId,
  violationCategoryId: state.violationCategoryId,
  categoryCode: state.categoryCode,
  severity: state.severity,
  occurredOn: state.occurredOn,
  description: state.description,
  state: state.state,
  recordedOn: state.recordedAt.toISOString(),
  version: state.version,
});
