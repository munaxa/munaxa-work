import {
  isCountryPackSource,
  isEntityCode,
  type CountryPackSource,
} from './relations-vocabulary.js';
import { accept, refuse, type RelationsResult } from './relations-rejection.js';

/**
 * What a tenant calls a kind of violation — the catalogue its disciplinary policy is written in.
 *
 * **Nothing statutory and nothing jurisdictional ships.** Not "unauthorised absence", not
 * "insubordination", not a penalty any labour law prescribes. Every one of those is a *row a tenant
 * or a country pack writes*; this module ships the shape and none of the content (AD-002, 00B). A
 * search of this package for a country code or a jurisdiction name finds nothing, and a test asserts
 * that.
 *
 * Four fields are load-bearing:
 *
 * - **`code`** is how a tenant refers to the entry for ever. It is unique per tenant, it is never
 *   editable, and a recorded violation freezes a copy of it — because a code that could be reused
 *   for something else would silently rewrite what an old violation was about.
 * - **`severity`** is a **label the tenant chooses**, deliberately not a closed set (AD-002).
 *   Nothing in this module orders by it, compares it, or infers anything legal from it.
 * - **`sequence`** is what ordering actually uses (D-5.2-07): an integer, persisted as data. It is
 *   *not* required to be unique — reads order by `(sequence, code)`, which is deterministic whether
 *   or not two entries share a rank, so a tenant is never forced to renumber a catalogue to insert
 *   an entry into it.
 * - **`repeatWindowDays`** is how far back a prior violation still counts. Configuration only:
 *   **nothing in Checkpoint 1 counts anything**, because escalation is a later capability. It is
 *   here because the specification puts it on this entity and a catalogue defined without it would
 *   have to be re-defined later.
 *
 * **`active` is how an entry leaves service, and there is no delete.** A violation recorded against
 * an entry must still read correctly years later, so entries are deactivated rather than removed —
 * and a deactivated entry cannot be used to record a *new* violation while every old one keeps
 * pointing at it.
 */

export interface LocalizedName {
  readonly en: string;
  readonly ar: string;
}

export interface ViolationCategoryState {
  readonly violationCategoryId: string;
  readonly code: string;
  readonly name: LocalizedName;
  /** A tenant's own word. Never interpreted, never ordered by, never a closed set (AD-002). */
  readonly severity: string;
  /** Deterministic ordering, as data. Non-negative; ties break on `code`. */
  readonly sequence: number;
  /** How far back a prior violation counts. **Nothing reads it in Checkpoint 1.** */
  readonly repeatWindowDays: number;
  readonly source: CountryPackSource;
  readonly countryPackId?: string;
  readonly countryPackVersion?: number;
  readonly active: boolean;
  readonly version: number;
}

export interface DefineViolationCategoryRequest {
  readonly violationCategoryId: string;
  readonly code: string;
  readonly name: LocalizedName;
  readonly severity: string;
  readonly sequence: number;
  readonly repeatWindowDays: number;
  readonly source: string;
  readonly countryPackId?: string;
  readonly countryPackVersion?: number;
  readonly active?: boolean;
}

export const createViolationCategory = (
  request: DefineViolationCategoryRequest,
): RelationsResult<ViolationCategoryState> => {
  const checked = validate(request);

  if (!checked.ok) return checked;

  return accept({
    violationCategoryId: request.violationCategoryId,
    code: request.code,
    name: request.name,
    severity: request.severity.trim(),
    sequence: request.sequence,
    repeatWindowDays: request.repeatWindowDays,
    source: checked.value,
    active: request.active ?? true,
    version: 1,
    ...(request.countryPackId === undefined ? {} : { countryPackId: request.countryPackId }),
    ...(request.countryPackVersion === undefined
      ? {}
      : { countryPackVersion: request.countryPackVersion }),
  });
};

const validate = (request: DefineViolationCategoryRequest): RelationsResult<CountryPackSource> => {
  if (!isEntityCode(request.code)) return refuse('category_code_malformed', { field: 'code' });
  if (request.name.en.trim() === '' || request.name.ar.trim() === '') {
    // Both languages are required by the domain rather than by a screen. A category named only in
    // English is a dropdown an Arabic-speaking administrator cannot read — and this is the dropdown
    // somebody picks from while recording a disciplinary matter.
    return refuse('category_name_incomplete', { field: 'name' });
  }
  if (request.severity.trim() === '')
    return refuse('category_severity_missing', { field: 'severity' });
  if (!Number.isInteger(request.sequence) || request.sequence < 0) {
    return refuse('category_sequence_invalid', { field: 'sequence' });
  }
  if (!Number.isInteger(request.repeatWindowDays) || request.repeatWindowDays < 0) {
    return refuse('category_repeat_window_invalid', { field: 'repeatWindowDays' });
  }
  return sourceOf(request);
};

/**
 * Which authority wrote this rule — and the invariant that keeps the boundary honest.
 *
 * A `country_pack` entry must name the pack it came from. Without that, a row would claim statutory
 * provenance nothing could trace, which is worse than claiming none: it would look like a rule
 * somebody may not lawfully change. **No pack exists yet** (Phase 11.1), so in practice every row
 * written today is `tenant` — and this refusal is what stops a caller pretending otherwise.
 */
const sourceOf = (request: DefineViolationCategoryRequest): RelationsResult<CountryPackSource> => {
  if (!isCountryPackSource(request.source)) {
    return refuse('category_source_unknown', { field: 'source' });
  }
  if (request.source === 'country_pack' && request.countryPackId === undefined) {
    return refuse('category_pack_source_needs_pack', { field: 'countryPackId' });
  }
  if (request.source === 'tenant' && request.countryPackId !== undefined) {
    return refuse('category_tenant_source_has_pack', { field: 'countryPackId' });
  }
  if (
    request.countryPackVersion !== undefined &&
    (!Number.isInteger(request.countryPackVersion) || request.countryPackVersion < 1)
  ) {
    return refuse('category_pack_version_invalid', { field: 'countryPackVersion' });
  }
  return accept(request.source);
};

/**
 * Whether a *new* violation may be recorded against this entry.
 *
 * Only `active` is asked. Nothing here consults a country pack, a jurisdiction or a statutory limit:
 * **legal validity is NOT VERIFIED and deferred to Phase 11.1** (D-5.2-06), and a function that
 * pretended to answer it would be the invented legal content this phase must not create.
 */
export const acceptsNewViolations = (state: ViolationCategoryState): boolean => state.active;
