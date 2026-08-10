/**
 * What Compensation needs of Employment and of Organization, and nothing more.
 *
 * Ports rather than queries, because those modules own their data and this one may not read their
 * tables. **Every method here runs under a bounded service grant** (ADR-0043): the caller is
 * authorized for the *compensation* operation, and the module — not the user — holds the narrow
 * cross-domain read the check needs. Managing compensation must not require a permission on the
 * employment register or on the organizational structure.
 *
 * Note what is **not** here: no `create`, no `update`, no `personId`, no salary anybody else holds
 * (nobody else holds one), and no employment status this module stores. Compensation references an
 * employment and copies no fact from it (ADR-0051).
 */

/**
 * One employment, **as it stood on a date**.
 *
 * `status` is `statusOn` where Employment can reconstruct it: a raise effective in March is checked
 * against March's status, not today's. The placement fields come from Employment's effective-dated
 * `AssignmentView` rather than from Organization, because Employment has already resolved where
 * somebody sat on a date and asking Organization separately would produce a second answer.
 */
export interface EmploymentForCompensation {
  readonly employmentId: string;
  readonly status: string;
  readonly startDate: string;
  readonly endDate?: string;
  readonly unitId?: string;
  readonly positionId?: string;
  readonly costCenterId?: string;
  readonly legalEntityId?: string;
}

export interface EmploymentDirectoryPort {
  /** One employment as at a date. Never "as it is now" when recording something historical. */
  find(employmentId: string, asOf: string): Promise<EmploymentForCompensation | undefined>;
  /** A bounded page of employments a bulk operation covers. */
  activeEmployments(limit: number): Promise<readonly EmploymentForCompensation[]>;
}

/**
 * The legal entity a compensation record is governed under.
 *
 * The country and the entity currency both come from here, because ADR-0035 puts them on the legal
 * entity rather than on the tenant — a tenant operating in two countries has two entities, two
 * currencies and two country packs, and a tenant-level currency would be wrong for one of them.
 *
 * **`known: false` is not "no legal entity".** It means Organization could not be asked, and the
 * difference decides whether a default currency is resolved or a caller is asked to state one. A
 * module that collapsed the two would silently price somebody in the wrong currency.
 */
export interface LegalEntityForCompensation {
  readonly legalEntityId: string;
  readonly countryCode: string;
  readonly currencyCode: string;
}

export type GoverningEntity =
  | { readonly known: false }
  | { readonly known: true; readonly entity: LegalEntityForCompensation | undefined };

export interface OrganizationDirectoryPort {
  governingLegalEntity(unitId: string, asOf: string): Promise<GoverningEntity>;
}

/**
 * The Organization adapter for a composition where Organization cannot answer.
 *
 * It exists for tests and for a composition that deliberately leaves Organization out. It answers
 * "unknown" honestly, and a caller relying on an entity currency is refused by name rather than
 * silently given one this module invented.
 */
export const organizationUnavailable: OrganizationDirectoryPort = {
  governingLegalEntity: () => Promise.resolve({ known: false }),
};

/** The clock, injected so recorded instants are testable. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
