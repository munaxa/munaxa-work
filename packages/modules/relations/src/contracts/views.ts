/**
 * What Employee Relations publishes.
 *
 * **Views only.** No handler, no store, no dependency type and no domain aggregate leaves this
 * module: a consumer that could reach a handler could bypass this module's permission checks, and
 * one that could reach a store could bypass its tenancy — which in this domain means bypassing the
 * access trail as well.
 *
 * **Nothing here carries a person.** A violation view names an employment and never a name, a
 * national identifier, a manager or an organisation. Those belong to People, Employment and
 * Organization, and a screen that needs one asks the module that owns it. A disciplinary view that
 * carried a name would be a directory of accused people.
 *
 * Contracts are versioned. A breaking change to anything here requires an ADR.
 */

export interface LocalizedTextView {
  readonly en: string;
  readonly ar: string;
}

/**
 * One entry in a tenant's violation catalogue.
 *
 * `severity` is the tenant's own word, published as written. Nothing in this product interprets it,
 * orders by it, or infers a penalty from it — ordering is `sequence`, and it is here so a screen
 * lists the catalogue the way the tenant arranged it rather than alphabetically.
 *
 * `source` says which authority wrote the entry: `tenant` today, `country_pack` once Phase 11.1
 * supplies packs. **It records provenance and enforces nothing** — statutory validation is
 * `NOT VERIFIED` and deferred (D-5.2-06).
 */
export interface ViolationCategoryView {
  readonly violationCategoryId: string;
  readonly code: string;
  readonly name: LocalizedTextView;
  readonly severity: string;
  readonly sequence: number;
  /** How far back a prior violation counts. Configuration; **nothing counts with it yet**. */
  readonly repeatWindowDays: number;
  readonly source: string;
  readonly countryPackId?: string;
  readonly countryPackVersion?: number;
  readonly active: boolean;
  readonly version: number;
}

/**
 * One recorded violation.
 *
 * `categoryCode` and `severity` are **what the catalogue said when the violation was recorded**, not
 * what it says now — so a screen shows what the record meant at the time even after the entry was
 * renamed or re-graded. `violationCategoryId` still points at the entry, so both questions can be
 * asked.
 *
 * There is no `state` transition here and no evidence: Checkpoint 1 records that a violation
 * occurred, and everything the lifecycle does with it afterwards is a later capability.
 */
export interface ViolationView {
  readonly violationId: string;
  readonly employmentId: string;
  readonly violationCategoryId: string;
  readonly categoryCode: string;
  readonly severity: string;
  /** The civil date the conduct occurred, `YYYY-MM-DD`. */
  readonly occurredOn: string;
  readonly description: string;
  readonly state: string;
  /** When it was recorded, as an ISO instant. Distinct from when the conduct occurred. */
  readonly recordedOn: string;
  readonly version: number;
}

/** One bounded page of violations for a single employment. */
export interface ViolationPageView {
  readonly items: readonly ViolationView[];
  readonly total: number;
}
