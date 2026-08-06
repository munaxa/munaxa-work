import type { OrganizationStores } from '../application/organization-ports.js';

import { CalendarRepository } from './calendar.repository.js';
import { EstablishmentRepository } from './establishment.repository.js';
import { FinancialCenterRepository } from './financial-center.repository.js';
import { LegalEntityRepository } from './legal-entity.repository.js';
import { PlacementRepository } from './placement.repository.js';
import { PositionRepository } from './position.repository.js';
import { TenantSettingsRepository } from './tenant-settings.repository.js';
import { UnitRepository } from './unit.repository.js';
import { UnitTypeRepository } from './unit-type.repository.js';

/**
 * The module's persistence, assembled.
 *
 * Repositories are stateless — they hold a table name and nothing else, and every method takes
 * the transaction — so one instance each is correct and there is nothing per-request to build.
 */
export const postgresOrganizationStores = (): OrganizationStores => ({
  unitTypes: new UnitTypeRepository(),
  units: new UnitRepository(),
  placements: new PlacementRepository(),
  legalEntities: new LegalEntityRepository(),
  centers: new FinancialCenterRepository(),
  positions: new PositionRepository(),
  establishments: new EstablishmentRepository(),
  calendars: new CalendarRepository(),
  tenantSettings: new TenantSettingsRepository(),
});
