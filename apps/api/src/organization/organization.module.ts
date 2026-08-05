import { Module } from '@nestjs/common';
import {
  AdministrationController,
  CalendarsController,
  CentersController,
  EstablishmentController,
  HierarchyController,
  LegalEntitiesController,
  OrganizationDispatcher,
  PositionsController,
  UnitTypesController,
  UnitsController,
} from '@work/organization';
import { Dispatcher } from '@work/kernel';

import { DISPATCHER } from '../identity/identity.tokens.js';
import { IdentityModule } from '../identity/identity.module.js';

/**
 * Organization's transport, dispatching through the pipeline the identity module assembled.
 *
 * The registry and the dispatcher are shared across modules deliberately: permissions,
 * navigation and health are derived from *every* registered module, so a second dispatcher would
 * give the administration screen half the permissions and the navigation half the entries. What
 * is not shared is the transport — a module owns its own controllers.
 *
 * The module's *composition* lives in `organization.composition.ts` rather than here, because
 * the identity module's composition registers Organization on the shared registry while this
 * file imports the identity module to reach the dispatcher. Keeping both in one file would make
 * those two facts a cycle.
 */
@Module({
  imports: [IdentityModule],
  controllers: [
    UnitTypesController,
    UnitsController,
    HierarchyController,
    LegalEntitiesController,
    CentersController,
    PositionsController,
    EstablishmentController,
    CalendarsController,
    AdministrationController,
  ],
  providers: [
    {
      provide: OrganizationDispatcher,
      inject: [DISPATCHER],
      useFactory: (dispatcher: Dispatcher): OrganizationDispatcher =>
        new OrganizationDispatcher(dispatcher),
    },
  ],
})
export class OrganizationModule {}
