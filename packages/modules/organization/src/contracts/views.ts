import type {
  CalendarDayKind,
  IsoWeekday,
  OrganizationStatus,
  PositionCriticality,
} from '../domain/organization-vocabulary.js';
import type { CenterKind } from '../domain/financial-center.js';
import type { EstablishmentStatus } from '../domain/organization-vocabulary.js';

/**
 * The read shapes other modules, the API and the SDK depend on.
 *
 * They are deliberately *not* the aggregates. An aggregate has behaviour and invariants and is
 * loaded to be changed; a view is a flat, serializable answer to a question. Publishing the
 * aggregate would mean every consumer holds a reference to something whose internals are free to
 * change, and the boundary would last until the first refactor.
 *
 * Dates are `Date` rather than strings: serialization is the API layer's business, and a
 * contract that pre-formatted them would force one format on every consumer, including the ones
 * rendering Hijri.
 *
 * Names are `Record<string, string>` — language tag to text — rather than a resolved string, for
 * the same reason. Which language a reader wants is not knowable here, and resolving it early is
 * how a product ends up bilingual everywhere except its org chart.
 */

export interface OrganizationUnitTypeView {
  readonly id: string;
  readonly code: string;
  readonly name: Readonly<Record<string, string>>;
  readonly ordinal: number;
  readonly allowedParentCodes: readonly string[];
  readonly allowedAtRoot: boolean;
  readonly carriesLegalEntity: boolean;
  readonly status: OrganizationStatus;
  readonly version: number;
}

export interface OrganizationUnitView {
  readonly id: string;
  readonly unitTypeId: string;
  readonly code: string;
  readonly name: Readonly<Record<string, string>>;
  readonly description?: Readonly<Record<string, string>>;
  readonly status: OrganizationStatus;
  readonly metadata: Readonly<Record<string, string>>;
  readonly effectiveFrom: Date;
  readonly effectiveTo?: Date;
  readonly version: number;
}

export interface UnitPlacementView {
  readonly id: string;
  readonly unitId: string;
  /** Absent means this unit was a root of the structure for this period. */
  readonly parentUnitId?: string;
  readonly effectiveFrom: Date;
  readonly effectiveTo?: Date;
  readonly version: number;
}

/**
 * One node of the structure as it stood on a date, with its children nested.
 *
 * Nested rather than flat because a tree is what a consumer wants and reassembling one from a
 * flat list is work every consumer would repeat. Depth is not a field: there is no maximum, and
 * publishing one would invite a consumer to rely on it (AD-003).
 */
export interface OrganizationTreeNode {
  readonly unit: OrganizationUnitView;
  readonly children: readonly OrganizationTreeNode[];
}

export interface OrganizationTree {
  readonly asOf: Date;
  readonly roots: readonly OrganizationTreeNode[];
  /** Units that exist but had no placement on this date — real, and not yet in the structure. */
  readonly unplacedUnitIds: readonly string[];
}

export interface LegalEntityView {
  readonly id: string;
  readonly unitId: string;
  /** ISO 3166-1 alpha-2. What Phase 11.1 resolves a country pack from — never the tenant. */
  readonly countryCode: string;
  readonly registeredName: Readonly<Record<string, string>>;
  readonly registrationNumber: string;
  readonly taxIdentifier?: string;
  /** ISO 4217. */
  readonly currencyCode: string;
  readonly incorporatedOn?: Date;
  readonly status: OrganizationStatus;
  readonly effectiveFrom: Date;
  readonly effectiveTo?: Date;
  readonly version: number;
}

/**
 * Which legal entity, and therefore which country, governs a unit on a date.
 *
 * This is the contract Phase 11.1 depends on, and the reason it is published separately from
 * `LegalEntityView`: a consumer asking "which country's law applies to somebody working here"
 * should not have to know that the answer is found by walking the hierarchy upward, nor be able
 * to get it wrong by reading the unit's own registration when the unit has none.
 */
export interface GoverningLegalEntity {
  readonly unitId: string;
  readonly asOf: Date;
  readonly legalEntity: LegalEntityView | undefined;
  /** The chain walked to find it, nearest first. Empty when the unit carries its own. */
  readonly throughUnitIds: readonly string[];
}

export interface FinancialCenterView {
  readonly id: string;
  readonly kind: CenterKind;
  readonly code: string;
  readonly name: Readonly<Record<string, string>>;
  readonly unitId?: string;
  readonly status: OrganizationStatus;
  readonly metadata: Readonly<Record<string, string>>;
  readonly effectiveFrom: Date;
  readonly effectiveTo?: Date;
  readonly version: number;
}

export interface PositionView {
  readonly id: string;
  readonly code: string;
  readonly title: Readonly<Record<string, string>>;
  readonly description?: Readonly<Record<string, string>>;
  readonly family?: string;
  readonly grade?: string;
  readonly criticality: PositionCriticality;
  readonly status: OrganizationStatus;
  readonly metadata: Readonly<Record<string, string>>;
  readonly effectiveFrom: Date;
  readonly effectiveTo?: Date;
  readonly version: number;
}

export interface EstablishmentView {
  readonly id: string;
  readonly positionId: string;
  readonly unitId: string;
  readonly budgetedHeadcount: number;
  readonly status: EstablishmentStatus;
  readonly approvedAt?: Date;
  readonly effectiveFrom: Date;
  readonly effectiveTo?: Date;
  readonly version: number;
}

/**
 * Approved, filled and vacant for one position in one unit on a date.
 *
 * `filled` is supplied by Employment's assignment events and is zero until Phase 5 exists.
 * Organization never counts employees (AD-002); it reports the budget and the projection built
 * from somebody else's count.
 */
export interface EstablishmentPostureView {
  readonly positionId: string;
  readonly unitId: string;
  readonly asOf: Date;
  readonly approved: number;
  readonly filled: number;
  readonly vacant: number;
}

export interface OrganizationCalendarView {
  readonly id: string;
  readonly code: string;
  readonly name: Readonly<Record<string, string>>;
  readonly unitId?: string;
  readonly timeZone: string;
  /** ISO-8601 weekdays: Monday is 1, Sunday is 7. */
  readonly workingDays: readonly IsoWeekday[];
  readonly status: OrganizationStatus;
  readonly effectiveFrom: Date;
  readonly effectiveTo?: Date;
  readonly version: number;
}

export interface CalendarDayView {
  /** `YYYY-MM-DD` in the calendar's own time zone. */
  readonly onDate: string;
  readonly kind: CalendarDayKind;
  readonly name: Readonly<Record<string, string>>;
}

export interface TenantSettingsView {
  readonly id: string;
  readonly language: string;
  readonly calendar: string;
  readonly timeZone: string;
  readonly numerals: string;
  readonly invitationValidityDays: number;
  readonly defaultPortals: readonly string[];
  readonly version: number;
}

/**
 * The whole organization, as one document.
 *
 * What export produces and what import consumes, and deliberately the same shape in both
 * directions: an export that cannot be re-imported is a backup nobody can restore.
 */
export interface OrganizationSnapshot {
  readonly exportedAt: Date;
  readonly unitTypes: readonly OrganizationUnitTypeView[];
  readonly units: readonly OrganizationUnitView[];
  readonly placements: readonly UnitPlacementView[];
  readonly legalEntities: readonly LegalEntityView[];
  readonly centers: readonly FinancialCenterView[];
  readonly positions: readonly PositionView[];
  readonly establishments: readonly EstablishmentView[];
  readonly calendars: readonly OrganizationCalendarView[];
}
