import type { ServiceLevelTarget, ServiceLevelUnit } from '../domain/service-level.js';
import { asNumber, type RowValues } from './row-writer.js';

/**
 * The two service-level columns, which appear on **two** tables and are mapped identically on both.
 *
 * `workflow_step_template` carries the target an administrator configured; `workflow_step` carries
 * the copy taken when the instance started. The columns, the constraint and the mapping are the same,
 * so they are written once here rather than twice — a second copy is how a target comes to round-trip
 * on a template and be silently dropped on a step.
 *
 * **Two columns rather than one interval**, because "two days" and "forty-eight hours" are the same
 * duration and not the same sentence: an administrator typed one of them and a screen has to show it
 * back. **Both or neither**, which the database requires through
 * `workflow_step_template_service_level_check` and `workflow_step_service_level_check`; neither
 * function below has a shape that could produce half a target.
 *
 * **Nothing here computes anything.** No due time, no state, no overdue minutes and no elapsed
 * anything — those are derived by `domain/service-level.ts` from the stored target, the instant the
 * step began waiting, and a reading instant the caller supplies. A repository that computed one would
 * be answering "is this overdue?" as at whenever a row happened to be read, and the answer would then
 * depend on which query loaded it.
 */

/** A target, split across its two columns — or two nulls. */
export const serviceLevelValues = (target: ServiceLevelTarget | undefined): RowValues => ({
  service_level_count: target === undefined ? null : target.count,
  service_level_unit: target === undefined ? null : target.unit,
});

/**
 * The same two columns read back as one value object, or nothing at all.
 *
 * Separate from `presentOf` because a target is **two columns and one field**, which no per-column
 * helper can express. `asNumber` because an `integer` column can arrive from the driver as a string,
 * and a count that reached the domain as `'2'` would make `Number.isInteger` false and a due time
 * `NaN`. The exactness suite asserts the type rather than trusting it.
 */
export const serviceLevelOf = (
  count: number | null,
  unit: string | null,
): { serviceLevel?: ServiceLevelTarget } =>
  count === null || unit === null
    ? {}
    : { serviceLevel: { count: asNumber(count), unit: unit as ServiceLevelUnit } };
