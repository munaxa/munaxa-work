import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { PinoLogger } from 'nestjs-pino';
import {
  IdentityDispatcher,
  InvitationsController,
  DelegationController,
  EmploymentLinkController,
  PortalAccessController,
  MemberProfileController,
  MembersController,
  PostgresMembershipDirectory,
  identityModule,
  postgresIdentityStores,
  systemClock,
  type TenantMembershipDirectory,
} from '@work/identity';
import { StoredTenantSettings } from '@work/organization';
import {
  Dispatcher,
  ModuleRegistry,
  UnauthenticatedPort,
  type EventDispatcher,
  type PermissionChecker,
  type PlatformAuthenticationPort,
  type UnitOfWork,
  type WorkModule,
} from '@work/kernel';
import type { Environment } from '@work/config';

import { ENVIRONMENT, environmentProvider } from '../configuration/environment.provider.js';
import {
  DATABASE_POOL,
  DatabaseModule,
  EVENT_DISPATCHER,
  UNIT_OF_WORK,
} from '../persistence/database.module.js';

import {
  DeferredCommandSender,
  organizationModuleFor,
} from '../organization/organization.composition.js';
import { DeferredPeopleSender, peopleModuleFor } from '../people/people.composition.js';
import {
  DeferredEmploymentSender,
  employmentModuleFor,
} from '../employment/employment.composition.js';
import { assignmentFilledHeadcount, postgresEmploymentStores } from '@work/employment';

import {
  AUTHENTICATION_PORT,
  DEFERRED_SENDERS,
  DISPATCHER,
  MEMBERSHIP_DIRECTORY,
  MODULE_REGISTRY,
  PEOPLE_MODULE,
  PERMISSION_CHECKER,
} from './identity.tokens.js';
import { PlatformPermissionChecker } from './permission-checker.js';

/**
 * The composition root for Workforce Identity, and for module registration generally.
 *
 * The pattern here is the one every later module follows: build the module's dependencies,
 * register it, and let the registry derive permissions, navigation and health from what it
 * declared. Nothing is registered by hand, because a permission that exists in code but not in
 * the administration screen is invisible until a customer finds it.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [
    MembersController,
    InvitationsController,
    DelegationController,
    EmploymentLinkController,
    PortalAccessController,
    MemberProfileController,
  ],
  providers: [
    environmentProvider,
    {
      // Platform's adapter replaces this in a deployment that has one. Until then it
      // authenticates nobody, which is the only safe default for a port this product does not
      // own — see `UnauthenticatedPort`.
      provide: AUTHENTICATION_PORT,
      useFactory: (): PlatformAuthenticationPort => new UnauthenticatedPort(),
    },
    {
      provide: MEMBERSHIP_DIRECTORY,
      inject: [DATABASE_POOL],
      useFactory: (pool: Pool): TenantMembershipDirectory => new PostgresMembershipDirectory(pool),
    },
    {
      // Built once and handed the dispatcher below, which is the only way to give bulk import a
      // dispatcher assembled from a list that includes bulk import.
      provide: DEFERRED_SENDERS,
      useFactory: (): DeferredSenders => ({
        organization: new DeferredCommandSender(),
        people: new DeferredPeopleSender(),
        employment: new DeferredEmploymentSender(),
      }),
    },
    {
      // One checker, given to the pipeline *and* to People's reads. Two would eventually differ,
      // and the difference would be a caller redacted by one and not the other.
      provide: PERMISSION_CHECKER,
      useFactory: (): PermissionChecker => new PlatformPermissionChecker(),
    },
    {
      provide: PEOPLE_MODULE,
      inject: [UNIT_OF_WORK, PERMISSION_CHECKER, ENVIRONMENT, PinoLogger, DEFERRED_SENDERS],
      useFactory: (
        unitOfWork: UnitOfWork,
        permissions: PermissionChecker,
        environment: Environment,
        logger: PinoLogger,
        senders: DeferredSenders,
      ): WorkModule =>
        peopleModuleFor(unitOfWork, permissions, environment, logger.logger, senders.people),
    },
    {
      provide: MODULE_REGISTRY,
      inject: [UNIT_OF_WORK, DATABASE_POOL, ENVIRONMENT, DEFERRED_SENDERS, PEOPLE_MODULE],
      useFactory: (
        unitOfWork: UnitOfWork,
        pool: Pool,
        environment: Environment,
        senders: DeferredSenders,
        people: WorkModule,
      ): ModuleRegistry => {
        const registry = new ModuleRegistry();

        registry.register(identityModuleFor(unitOfWork, pool, environment));
        // Organization is registered with Employment's filled-headcount adapter rather than
        // `NoAssignmentsYet`: the port Phase 3 declared for exactly this, used as designed. Nothing
        // in Organization changes — the composition root chooses the implementation, and the
        // establishment's `filled` figure stops being zero because there are now assignments to
        // count.
        registry.register(
          organizationModuleFor(
            unitOfWork,
            senders.organization,
            assignmentFilledHeadcount(unitOfWork, postgresEmploymentStores()),
          ),
        );
        registry.register(people);
        registry.register(employmentModuleFor(unitOfWork, senders.employment));
        return registry;
      },
    },
    {
      provide: DISPATCHER,
      inject: [MODULE_REGISTRY, EVENT_DISPATCHER, DEFERRED_SENDERS, PERMISSION_CHECKER],
      useFactory: (
        registry: ModuleRegistry,
        events: EventDispatcher,
        senders: DeferredSenders,
        permissions: PermissionChecker,
      ): Dispatcher => {
        const dispatcher = new Dispatcher(permissions);

        for (const module of registry.registered) {
          for (const handler of module.commands ?? []) {
            dispatcher.registerCommand(handler);
          }
          for (const handler of module.queries ?? []) {
            dispatcher.registerQuery(handler);
          }
          for (const handler of module.eventHandlers ?? []) events.register(handler);
        }
        senders.organization.attach(dispatcher);
        senders.people.attach(dispatcher);
        senders.employment.attach(dispatcher);
        return dispatcher;
      },
    },
    {
      provide: IdentityDispatcher,
      inject: [DISPATCHER],
      useFactory: (dispatcher: Dispatcher): IdentityDispatcher =>
        new IdentityDispatcher(dispatcher),
    },
  ],
  exports: [AUTHENTICATION_PORT, MEMBERSHIP_DIRECTORY, DISPATCHER, MODULE_REGISTRY],
})
export class IdentityModule {}

/**
 * The three senders that are handed their dispatcher once it exists.
 *
 * One object rather than three providers, so the factories that need them stay inside the
 * five-parameter budget — a list any longer is one somebody eventually passes in the wrong order.
 */
interface DeferredSenders {
  readonly organization: DeferredCommandSender;
  readonly people: DeferredPeopleSender;
  readonly employment: DeferredEmploymentSender;
}

/**
 * The tenant's identity defaults now come from *that tenant*, falling back to the deployment's
 * validated configuration for a tenant that has configured none.
 *
 * This one substitution is the outward shape of the Phase 2 debt being closed. `StoredTenantSettings`
 * is Organization's adapter for the port Identity already asked through, so Identity's use cases
 * did not change — which is the evidence the port was drawn in the right place (ADR-0036).
 *
 * Nothing about a country, a calendar or a language is written here (00B).
 */
const identityModuleFor = (
  unitOfWork: UnitOfWork,
  pool: Pool,
  environment: Environment,
): WorkModule =>
  identityModule({
    unitOfWork,
    stores: postgresIdentityStores(),
    settings: new StoredTenantSettings(pool, {
      language: environment.DEFAULT_LOCALE,
      calendar: environment.DEFAULT_CALENDAR,
      timeZone: environment.DEFAULT_TIME_ZONE,
      numerals: environment.DEFAULT_NUMERALS,
      invitationValidityDays: environment.INVITATION_VALIDITY_DAYS,
      defaultPortals: environment.DEFAULT_PORTALS,
    }),
    clock: systemClock,
  });
